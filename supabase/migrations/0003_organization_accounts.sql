-- Separate organisation logins, department management, and department-scoped oversight.
alter table public.profiles
  add column if not exists account_type text not null default 'individual'
  check (account_type in ('individual', 'organization'));

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.organization_members
  add column if not exists department_id uuid references public.departments(id) on delete set null;

alter table public.projects
  add column if not exists department_id uuid references public.departments(id) on delete set null;

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists organization_invites_org_idx on public.organization_invites(organization_id, created_at desc);
create index if not exists organization_members_department_idx on public.organization_members(organization_id, department_id);
create index if not exists projects_department_updated_idx on public.projects(department_id, updated_at desc);

create or replace function public.is_organization_account(p_organization_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
    join public.profiles p on p.id = o.created_by
    where o.id = p_organization_id and o.created_by = p_user_id and p.account_type = 'organization'
  );
$$;
revoke all on function public.is_organization_account(uuid,uuid) from public;
grant execute on function public.is_organization_account(uuid,uuid) to authenticated;

alter table public.departments enable row level security;
alter table public.organization_invites enable row level security;

create policy "Organisation accounts and members read departments" on public.departments for select to authenticated
using (public.is_organization_account(organization_id) or public.is_organization_member(organization_id, auth.uid()));
create policy "Organisation accounts manage departments" on public.departments for all to authenticated
using (public.is_organization_account(organization_id)) with check (public.is_organization_account(organization_id));
create policy "Organisation accounts manage invites" on public.organization_invites for all to authenticated
using (public.is_organization_account(organization_id)) with check (public.is_organization_account(organization_id));
create policy "Organisation accounts read their organisation record" on public.organizations for select to authenticated
using (public.is_organization_account(id));
create policy "Organisation accounts read their members" on public.organization_members for select to authenticated
using (public.is_organization_account(organization_id));
create policy "Organisation accounts read member profiles" on public.profiles for select to authenticated
using (exists (
  select 1 from public.organization_members m
  where m.user_id = profiles.id and public.is_organization_account(m.organization_id)
));
create policy "Organisation accounts read all project states" on public.projects for select to authenticated
using (public.is_organization_account(organization_id));
create policy "Organisation accounts read project comments" on public.review_comments for select to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_account(p.organization_id)));
create policy "Organisation accounts read review progress" on public.review_assignments for select to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_account(p.organization_id)));

create or replace function public.guard_profile_account_type()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.account_type is distinct from old.account_type then
    raise exception 'Account type cannot be changed after registration';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_account_type_immutable on public.profiles;
create trigger profiles_account_type_immutable before update of account_type on public.profiles
for each row execute function public.guard_profile_account_type();

create or replace function public.validate_project_department()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.organization_id = new.organization_id
  ) then
    raise exception 'Project department must belong to its organisation';
  end if;
  return new;
end;
$$;
drop trigger if exists projects_validate_department on public.projects;
create trigger projects_validate_department before insert or update of department_id, organization_id on public.projects
for each row execute function public.validate_project_department();

update public.projects p set department_id = m.department_id
from public.organization_members m
where m.organization_id = p.organization_id and m.user_id = p.owner_id and p.department_id is null and m.department_id is not null;

create or replace function public.create_organization_department(p_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  org_id uuid;
  department_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to your organisation account first'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'Department name must be 1 to 100 characters'; end if;
  select id into org_id from public.organizations where created_by = auth.uid() and public.is_organization_account(id);
  if org_id is null then raise exception 'Only an organisation account can create departments'; end if;
  insert into public.departments(organization_id, name) values (org_id, trim(p_name)) returning id into department_id;
  return department_id;
end;
$$;
revoke all on function public.create_organization_department(text) from public;
grant execute on function public.create_organization_department(text) to authenticated;

create or replace function public.create_organization_invite(p_department_id uuid default null)
returns text language plpgsql security definer set search_path = public
as $$
declare
  org_id uuid;
  invite_token text;
begin
  if auth.uid() is null then raise exception 'Sign in to your organisation account first'; end if;
  select id into org_id from public.organizations where created_by = auth.uid() and public.is_organization_account(id);
  if org_id is null then raise exception 'Only an organisation account can invite members'; end if;
  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id and organization_id = org_id) then
    raise exception 'That department does not belong to your organisation';
  end if;
  insert into public.organization_invites(organization_id, department_id, created_by)
  values (org_id, p_department_id, auth.uid()) returning token into invite_token;
  return invite_token;
end;
$$;
revoke all on function public.create_organization_invite(uuid) from public;
grant execute on function public.create_organization_invite(uuid) to authenticated;

create or replace function public.revoke_organization_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.organization_invites i set revoked_at = now()
  where i.id = p_invite_id and public.is_organization_account(i.organization_id);
  if not found then raise exception 'Invite not found or already revoked'; end if;
end;
$$;
revoke all on function public.revoke_organization_invite(uuid) from public;
grant execute on function public.revoke_organization_invite(uuid) to authenticated;

create or replace function public.join_organization(p_invite_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  joined_org uuid;
  invited_department uuid;
  account_kind text;
begin
  if auth.uid() is null then raise exception 'Sign in before joining an organisation'; end if;
  select account_type into account_kind from public.profiles where id = auth.uid();
  if account_kind is distinct from 'individual' then raise exception 'Organisation accounts cannot join as members'; end if;
  select organization_id, department_id into joined_org, invited_department
  from public.organization_invites where token = p_invite_token and revoked_at is null;
  if joined_org is null then
    -- Older workspace links remain valid during migration.
    select id into joined_org from public.organizations where invite_token = p_invite_token;
    invited_department := null;
  end if;
  if joined_org is null then raise exception 'This organisation invite is invalid or has expired'; end if;
  insert into public.organization_members(organization_id, user_id, role, department_id)
  values (joined_org, auth.uid(), 'member', invited_department)
  on conflict (organization_id, user_id) do update set department_id = excluded.department_id, created_at = now();
  return joined_org;
end;
$$;
revoke all on function public.join_organization(text) from public;
grant execute on function public.join_organization(text) to authenticated;

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
  if auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid() and account_type = 'organization') then
    raise exception 'Organisation accounts are read-only and cannot submit project reviews';
  end if;
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
revoke all on function public.submit_public_review(text,text,text,text) from public;
grant execute on function public.submit_public_review(text,text,text,text) to anon, authenticated;

-- New individual accounts keep a private starter workspace. Organisation accounts get
-- their own organisation record and are not added as a human reviewer/member.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  account_kind text;
  display_name text;
  org_name text;
  new_username text;
  new_org_id uuid;
begin
  account_kind := case when new.raw_user_meta_data->>'account_type' = 'organization' then 'organization' else 'individual' end;
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1), 'Member');
  org_name := coalesce(nullif(new.raw_user_meta_data->>'organization_name', ''), display_name);
  new_username := lower(regexp_replace(coalesce(nullif(new.raw_user_meta_data->>'username', ''), display_name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);
  insert into public.profiles(id, display_name, username, account_type)
  values (new.id, case when account_kind = 'organization' then org_name else display_name end, new_username, account_kind)
  on conflict (id) do update set account_type = excluded.account_type;
  if account_kind = 'organization' then
    insert into public.organizations(name, created_by) values (org_name, new.id);
  else
    insert into public.organizations(name, created_by) values (display_name || '''s workspace', new.id) returning id into new_org_id;
    insert into public.organization_members(organization_id, user_id, role) values (new_org_id, new.id, 'owner');
  end if;
  return new;
end;
$$;
