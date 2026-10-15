create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  client text not null default 'Personal project',
  description text not null default '',
  status text not null default 'Draft' check (status in ('Draft','Pending','Changes requested','Approved')),
  due_date timestamptz,
  retention_days integer not null default 14 check (retention_days between 1 and 30),
  review_token text unique,
  allow_download boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  object_key text not null unique,
  version integer not null default 1 check (version > 0),
  uploaded_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reminder_sent_at timestamptz
);

create table if not exists public.review_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_name text not null,
  body text not null,
  kind text not null default 'comment' check (kind in ('comment','changes','approval')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  detail text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
create index if not exists project_files_expiry_idx on public.project_files(expires_at) where reminder_sent_at is null;
create index if not exists comments_project_created_idx on public.review_comments(project_id, created_at);
create index if not exists notifications_owner_created_idx on public.notifications(owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.review_comments enable row level security;
alter table public.notifications enable row level security;

create policy "Users can read their profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Users can update their profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Users can create their profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Owners manage projects" on public.projects for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners manage project files" on public.project_files for all to authenticated using (uploaded_by = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())) with check (uploaded_by = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy "Owners read review comments" on public.review_comments for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy "Owners manage notifications" on public.notifications for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A reviewer link is a bearer credential. Keep direct table access private and expose only
-- this narrow RPC, which returns the shared project's review-safe fields.
create or replace function public.get_public_review(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'client', p.client, 'description', p.description,
    'status', p.status, 'allow_download', p.allow_download, 'updated_at', p.updated_at,
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'content_type', f.content_type, 'byte_size', f.byte_size, 'version', f.version, 'uploaded_at', f.uploaded_at) order by f.uploaded_at desc) from public.project_files f where f.project_id = p.id and f.expires_at > now()), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author_name', c.author_name, 'body', c.body, 'kind', c.kind, 'created_at', c.created_at) order by c.created_at) from public.review_comments c where c.project_id = p.id), '[]'::jsonb)
  )
  from public.projects p
  where p.review_token = p_token and p.status <> 'Draft'
  limit 1;
$$;

create or replace function public.submit_public_review(p_token text, p_author_name text, p_body text default '', p_action text default 'comment')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.projects%rowtype;
  new_status text;
  comment_body text;
  notice_title text;
begin
  select * into target from public.projects where review_token = p_token and status <> 'Draft' for update;
  if not found then raise exception 'Review link not found'; end if;
  if length(trim(coalesce(p_author_name,''))) < 1 or length(p_author_name) > 120 then raise exception 'Enter your name'; end if;
  if p_action not in ('comment','changes','approval') then raise exception 'Invalid review action'; end if;
  if p_action = 'comment' and length(trim(coalesce(p_body,''))) < 1 then raise exception 'Enter a comment'; end if;
  if target.status = 'Approved' and p_action in ('approval','changes') then raise exception 'This work has already been approved'; end if;
  comment_body := case when p_action = 'approval' then 'Approved this submission.' when p_action = 'changes' and length(trim(coalesce(p_body,''))) = 0 then 'Please make the requested changes.' else trim(coalesce(p_body,'')) end;
  new_status := case when p_action = 'approval' then 'Approved' when p_action = 'changes' then 'Changes requested' else target.status end;
  insert into public.review_comments(project_id, author_name, body, kind) values (target.id, trim(p_author_name), comment_body, p_action);
  update public.projects set status = new_status, updated_at = now() where id = target.id;
  notice_title := case when p_action = 'approval' then 'Project approved' when p_action = 'changes' then 'Changes requested' else 'New reviewer comment' end;
  insert into public.notifications(owner_id, project_id, title, detail) values (target.owner_id, target.id, notice_title, target.title);
  return jsonb_build_object('ok', true, 'status', new_status);
end;
$$;

revoke all on function public.get_public_review(text) from public;
revoke all on function public.submit_public_review(text,text,text,text) from public;
grant execute on function public.get_public_review(text) to anon, authenticated;
grant execute on function public.submit_public_review(text,text,text,text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name','')) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
