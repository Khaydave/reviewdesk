-- Personal sidebar pins and recently opened work items.
create table if not exists public.user_sidebar_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('project', 'review')),
  item_id text not null,
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id),
  check (not is_pinned or pinned_at is not null)
);

create index if not exists user_sidebar_items_recent_idx
  on public.user_sidebar_items(user_id, last_opened_at desc)
  where last_opened_at is not null;

alter table public.user_sidebar_items enable row level security;
revoke all on public.user_sidebar_items from anon;
grant select, insert, update, delete on public.user_sidebar_items to authenticated;

create policy "Users can view their sidebar items" on public.user_sidebar_items
  for select to authenticated using (user_id = auth.uid());

create policy "Users can pin accessible projects and reviews" on public.user_sidebar_items
  for insert to authenticated with check (
    user_id = auth.uid()
    and (
      (item_type = 'project' and exists (
        select 1 from public.projects p where p.id::text = item_id and p.owner_id = auth.uid()
      ))
      or
      (item_type = 'review' and exists (
        select 1 from public.review_assignments a where a.id::text = item_id and a.reviewer_id = auth.uid()
      ))
    )
  );

create policy "Users can update their pinned accessible work" on public.user_sidebar_items
  for update to authenticated using (user_id = auth.uid()) with check (
    user_id = auth.uid()
    and (
      (item_type = 'project' and exists (
        select 1 from public.projects p where p.id::text = item_id and p.owner_id = auth.uid()
      ))
      or
      (item_type = 'review' and exists (
        select 1 from public.review_assignments a where a.id::text = item_id and a.reviewer_id = auth.uid()
      ))
    )
  );

create policy "Users can remove their sidebar items" on public.user_sidebar_items
  for delete to authenticated using (user_id = auth.uid());
