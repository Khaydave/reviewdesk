-- Optional work identity details for individual ReviewDesk profiles.
alter table public.profiles
  add column if not exists organization text not null default '',
  add column if not exists department text not null default '',
  add column if not exists position text not null default '';
