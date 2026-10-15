-- Organisation workspaces and account-linked review assignments.
create extension if not exists pgcrypto;

alter table public.profiles add column if not exists username text;
update public.profiles
set username = lower(regexp_replace(coalesce(nullif(display_name, ''), 'member'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(id::text, '-', ''), 1, 8)
where username is null or username = '';
create unique index if not exists profiles_username_unique on public.profiles(username);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- Existing users receive a private starter workspace. New registrations get one in the trigger below.
insert into public.organizations(name, created_by)
select coalesce(nullif(p.display_name, ''), 'My') || '''s workspace', p.id
from public.profiles p
where not exists (select 1 from public.organization_members m where m.user_id = p.id)
on conflict do nothing;
insert into public.organization_members(organization_id, user_id, role)
select o.id, o.created_by, 'owner'
from public.organizations o
where not exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = o.created_by);

alter table public.projects add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.projects p set organization_id = m.organization_id
from public.organization_members m where m.user_id = p.owner_id and p.organization_id is null;
alter table public.projects alter column organization_id set not null;
create index if not exists projects_org_updated_idx on public.projects(organization_id, updated_at desc);

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text not null,
  username text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'Pending' check (status in ('Pending','Changes requested','Approved')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, reviewer_id)
);
create index if not exists review_assignments_reviewer_idx on public.review_assignments(reviewer_id, status);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.review_assignments enable row level security;

create or replace function public.is_organization_member(p_organization_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_user_id); $$;
revoke all on function public.is_organization_member(uuid,uuid) from public;
grant execute on function public.is_organization_member(uuid,uuid) to authenticated;

create policy "Members can read their organizations" on public.organizations for select to authenticated
using (public.is_organization_member(id, auth.uid()));
create policy "Owners can update their organizations" on public.organizations for update to authenticated
using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "Members can read organization membership" on public.organization_members for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy "Workspace profiles are visible to members" on public.profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.organization_members mine
  where mine.user_id = auth.uid() and public.is_organization_member(mine.organization_id, profiles.id)
));
create policy "Members can read organization projects" on public.projects for select to authenticated
using (owner_id = auth.uid() or (status <> 'Draft' and public.is_organization_member(projects.organization_id, auth.uid())));
create policy "Members can read organization file metadata" on public.project_files for select to authenticated
using (exists (
  select 1 from public.projects p join public.organization_members m on m.organization_id = p.organization_id
  where p.id = project_files.project_id and m.user_id = auth.uid() and (p.status <> 'Draft' or p.owner_id = auth.uid())
));
create policy "Members can read organization comments" on public.review_comments for select to authenticated
using (exists (
  select 1 from public.projects p join public.organization_members m on m.organization_id = p.organization_id
  where p.id = review_comments.project_id and m.user_id = auth.uid() and (p.status <> 'Draft' or p.owner_id = auth.uid())
));
create policy "Assigned reviewers and project owners can read assignments" on public.review_assignments for select to authenticated
using (reviewer_id = auth.uid() or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy "Project owners manage assignments" on public.review_assignments for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()) and public.is_organization_member((select organization_id from public.projects p where p.id = project_id), reviewer_id));

drop policy if exists "Owners manage projects" on public.projects;
create policy "Owners manage projects" on public.projects for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid() and public.is_organization_member(organization_id, auth.uid()));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_org_id uuid;
  display_name text;
  new_username text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1), 'Member');
  new_username := lower(regexp_replace(coalesce(nullif(new.raw_user_meta_data->>'username', ''), display_name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);
  insert into public.profiles(id, display_name, username) values (new.id, display_name, new_username)
  on conflict (id) do update set display_name = excluded.display_name, username = coalesce(public.profiles.username, excluded.username);
  insert into public.organizations(name, created_by) values (display_name || '''s workspace', new.id) returning id into new_org_id;
  insert into public.organization_members(organization_id, user_id, role) values (new_org_id, new.id, 'owner');
  return new;
end;
$$;

create or replace function public.join_organization(p_invite_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare joined_org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before joining a workspace'; end if;
  select id into joined_org from public.organizations where invite_token = p_invite_token;
  if joined_org is null then raise exception 'This workspace invite is invalid'; end if;
  insert into public.organization_members(organization_id, user_id, role) values (joined_org, auth.uid(), 'member') on conflict (organization_id, user_id) do update set created_at = now();
  return joined_org;
end;
$$;
revoke all on function public.join_organization(text) from public;
grant execute on function public.join_organization(text) to authenticated;

create or replace function public.notify_reviewers(p_project_id uuid, p_reviewer_ids uuid[], p_title text default 'Review assigned to you', p_detail text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare project_title text;
begin
  select title into project_title from public.projects where id = p_project_id and owner_id = auth.uid();
  if project_title is null then raise exception 'Only project owners can assign reviewers'; end if;
  insert into public.notifications(owner_id, project_id, title, detail)
  select distinct reviewer_id, p_project_id, coalesce(nullif(p_title, ''), 'Review update'), coalesce(nullif(p_detail, ''), project_title)
  from unnest(p_reviewer_ids) reviewer_id
  where public.is_organization_member((select organization_id from public.projects where id = p_project_id), reviewer_id);
end;
$$;
revoke all on function public.notify_reviewers(uuid,uuid[],text,text) from public;
grant execute on function public.notify_reviewers(uuid,uuid[],text,text) to authenticated;

create or replace function public.get_public_review(p_token text)
returns jsonb language sql security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'client', p.client, 'description', p.description,
    'status', p.status, 'allow_download', p.allow_download, 'updated_at', p.updated_at,
    'reviewer_name', a.reviewer_name, 'assignment_status', a.status, 'review_is_assigned', a.id is not null,
    'has_assignments', exists (select 1 from public.review_assignments assigned_review where assigned_review.project_id = p.id),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'content_type', f.content_type, 'byte_size', f.byte_size, 'version', f.version, 'uploaded_at', f.uploaded_at) order by f.uploaded_at desc) from (select distinct on (pf.name) pf.id, pf.name, pf.content_type, pf.byte_size, pf.version, pf.uploaded_at from public.project_files pf where pf.project_id = p.id and pf.expires_at > now() order by pf.name, pf.version desc, pf.uploaded_at desc) f), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author_name', c.author_name, 'body', c.body, 'kind', c.kind, 'created_at', c.created_at) order by c.created_at) from public.review_comments c where c.project_id = p.id), '[]'::jsonb)
  )
  from public.projects p left join public.review_assignments a on a.project_id = p.id and a.token = p_token
  where (p.review_token = p_token or a.token = p_token) and p.status <> 'Draft' limit 1;
$$;

create or replace function public.submit_public_review(p_token text, p_author_name text, p_body text default '', p_action text default 'comment')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  target public.projects%rowtype;
  assignment public.review_assignments%rowtype;
  assigned boolean := false;
  comment_body text;
  notice_title text;
  next_status text;
begin
  select p.* into target
  from public.projects p left join public.review_assignments a on a.project_id = p.id and a.token = p_token
  where (p.review_token = p_token or a.token = p_token) and p.status <> 'Draft'
  for update of p;
  if not found then raise exception 'Review link not found'; end if;
  select * into assignment from public.review_assignments where project_id = target.id and token = p_token for update;
  assigned := found;
  if length(trim(coalesce(p_author_name,''))) < 1 or length(p_author_name) > 120 then raise exception 'Enter your name'; end if;
  if p_action not in ('comment','changes','approval') then raise exception 'Invalid review action'; end if;
  if p_action = 'comment' and length(trim(coalesce(p_body,''))) < 1 then raise exception 'Enter a comment'; end if;
  if target.status = 'Approved' and p_action in ('approval','changes') then raise exception 'This work has already been approved'; end if;
  if assigned and assignment.status = 'Approved' and p_action in ('approval','changes') then raise exception 'You have already approved this version'; end if;
  if not assigned and p_action in ('approval','changes') and exists (select 1 from public.review_assignments where project_id = target.id) then raise exception 'Use your assigned review link to record an approval or change request'; end if;
  comment_body := case when p_action = 'approval' then 'Approved this submission.' when p_action = 'changes' and length(trim(coalesce(p_body,''))) = 0 then 'Please make the requested changes.' else trim(coalesce(p_body,'')) end;
  insert into public.review_comments(project_id, author_name, body, kind) values (target.id, case when assigned then assignment.reviewer_name else trim(p_author_name) end, comment_body, p_action);
  if assigned and p_action in ('approval','changes') then
    update public.review_assignments set status = case when p_action = 'approval' then 'Approved' else 'Changes requested' end, responded_at = now() where id = assignment.id;
    select case
      when exists (select 1 from public.review_assignments where project_id = target.id and status = 'Changes requested') then 'Changes requested'
      when not exists (select 1 from public.review_assignments where project_id = target.id and status <> 'Approved') then 'Approved'
      else 'Pending'
    end into next_status;
  else
    next_status := case when p_action = 'approval' then 'Approved' when p_action = 'changes' then 'Changes requested' else target.status end;
  end if;
  update public.projects set status = next_status, updated_at = now() where id = target.id;
  notice_title := case when p_action = 'approval' then 'Reviewer approved' when p_action = 'changes' then 'Changes requested' else 'New reviewer comment' end;
  insert into public.notifications(owner_id, project_id, title, detail) values (target.owner_id, target.id, notice_title, coalesce(assignment.reviewer_name, trim(p_author_name)) || ' · ' || target.title);
  return jsonb_build_object('ok', true, 'status', next_status);
end;
$$;

revoke all on function public.get_public_review(text) from public;
revoke all on function public.submit_public_review(text,text,text,text) from public;
grant execute on function public.get_public_review(text) to anon, authenticated;
grant execute on function public.submit_public_review(text,text,text,text) to anon, authenticated;
