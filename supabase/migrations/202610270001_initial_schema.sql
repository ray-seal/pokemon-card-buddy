-- Pokémon Card Buddy Supabase schema
-- Apply via Supabase migrations. All user-owned rows are protected by RLS.

create extension if not exists pgcrypto;

create table if not exists public.user_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Collection' check (char_length(name) between 1 and 40),
  collection_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists user_collections_user_id_idx on public.user_collections(user_id);
alter table public.user_collections enable row level security;
create policy "Users manage their own collections" on public.user_collections
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.binders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Binder' check (char_length(name) between 1 and 50),
  pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists binders_user_id_idx on public.binders(user_id);
alter table public.binders enable row level security;
create policy "Users manage their own binders" on public.binders
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('binder-photos', 'binder-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

create policy "Users read own binder photos" on storage.objects for select to authenticated
  using (bucket_id = 'binder-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own binder photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'binder-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update own binder photos" on storage.objects for update to authenticated
  using (bucket_id = 'binder-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'binder-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own binder photos" on storage.objects for delete to authenticated
  using (bucket_id = 'binder-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
