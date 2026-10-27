-- Unique public usernames for Pokémon Card Buddy accounts.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
create unique index if not exists user_profiles_username_unique_ci
  on public.user_profiles (lower(username));
alter table public.user_profiles enable row level security;
create policy "Users can read public usernames" on public.user_profiles
  for select to authenticated using (true);
create policy "Users can create their own username" on public.user_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own username" on public.user_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
