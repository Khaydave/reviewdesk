-- ReviewDesk uses individual accounts with a searchable, privacy-safe colleague list.
-- Legacy organisation records are retained for existing data but are no longer used.

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_ci_key on public.profiles (lower(username)) where username is not null;
alter table public.projects alter column organization_id drop not null;

-- Existing organisation logins now act as ordinary individual accounts.
drop trigger if exists profiles_account_type_immutable on public.profiles;
update public.profiles set account_type = 'individual' where account_type is distinct from 'individual';

create table if not exists public.colleague_connections (
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  colleague_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, colleague_id),
  check (owner_id <> colleague_id)
);
create index if not exists colleague_connections_owner_created_idx on public.colleague_connections(owner_id, created_at desc);
alter table public.colleague_connections enable row level security;
grant select, insert, delete on public.colleague_connections to authenticated;
create policy "Users manage their saved colleagues" on public.colleague_connections for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and colleague_id <> auth.uid());

drop policy if exists "Workspace profiles are visible to members" on public.profiles;
drop policy if exists "Organisation accounts read member profiles" on public.profiles;
create policy "Users can view saved colleague profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.colleague_connections c where c.owner_id = auth.uid() and c.colleague_id = profiles.id
  ));

create or replace function public.search_profiles(p_query text)
returns table(id uuid, display_name text, username text)
language sql stable security definer set search_path = public, auth
as $$
  select p.id, p.display_name, p.username
  from public.profiles p
  join auth.users u on u.id = p.id
  where auth.uid() is not null
    and p.id <> auth.uid()
    and length(trim(coalesce(p_query, ''))) between 3 and 254
    and (
      lower(p.username) = lower(trim(both '@' from trim(p_query)))
      or lower(u.email) = lower(trim(p_query))
    )
  limit 1;
$$;
revoke all on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to authenticated;

-- New registrations keep the chosen username exactly as entered, normalized to lowercase.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  display_name text;
  new_username text;
begin
  display_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'Member');
  new_username := lower(coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), regexp_replace(display_name, '[^a-zA-Z0-9_]+', '_', 'g') || '_' || substr(replace(new.id::text, '-', ''), 1, 6)));
  if new_username !~ '^[a-z0-9_]{3,24}$' then raise exception 'Username must be 3 to 24 letters, numbers, or underscores'; end if;
  insert into public.profiles(id, display_name, username, account_type)
  values (new.id, display_name, new_username, 'individual')
  on conflict (id) do update set display_name = excluded.display_name, username = excluded.username, account_type = 'individual';
  return new;
end;
$$;

-- Project ownership remains personal, while an assigned reviewer can open that project.
drop policy if exists "Members can read organization projects" on public.projects;
drop policy if exists "Organisation accounts read all project states" on public.projects;
drop policy if exists "Owners manage projects" on public.projects;
create policy "Owners manage projects" on public.projects for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Assigned reviewers read projects" on public.projects for select to authenticated
  using (exists (select 1 from public.review_assignments a where a.project_id = projects.id and a.reviewer_id = auth.uid()));

drop policy if exists "Members can read organization file metadata" on public.project_files;
create policy "Assigned reviewers read project files" on public.project_files for select to authenticated
  using (exists (select 1 from public.review_assignments a where a.project_id = project_files.project_id and a.reviewer_id = auth.uid()));
drop policy if exists "Members can read organization comments" on public.review_comments;
drop policy if exists "Organisation accounts read project comments" on public.review_comments;
create policy "Assigned reviewers read project comments" on public.review_comments for select to authenticated
  using (exists (select 1 from public.review_assignments a where a.project_id = review_comments.project_id and a.reviewer_id = auth.uid()));

drop policy if exists "Project owners manage assignments" on public.review_assignments;
create policy "Project owners manage assignments" on public.review_assignments for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
drop policy if exists "Organisation accounts read review progress" on public.review_assignments;

-- Assignment notifications are in-app only and can be sent to any valid ReviewDesk account.
create or replace function public.notify_reviewers(p_project_id uuid, p_reviewer_ids uuid[], p_title text default 'Review assigned to you', p_detail text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare project_title text;
begin
  select title into project_title from public.projects where id = p_project_id and owner_id = auth.uid();
  if project_title is null then raise exception 'Only project owners can assign reviewers'; end if;
  insert into public.notifications(owner_id, project_id, title, detail)
  select distinct u.id, p_project_id, coalesce(nullif(p_title, ''), 'Review update'), coalesce(nullif(p_detail, ''), project_title)
  from unnest(coalesce(p_reviewer_ids, '{}'::uuid[])) as reviewers(reviewer_id)
  join auth.users u on u.id = reviewers.reviewer_id
  where u.id <> auth.uid();
end;
$$;
revoke all on function public.notify_reviewers(uuid,uuid[],text,text) from public;
grant execute on function public.notify_reviewers(uuid,uuid[],text,text) to authenticated;
