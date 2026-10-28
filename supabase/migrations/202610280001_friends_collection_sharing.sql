-- Friends can see explicitly shared Pokédex checklists only.
-- Binder metadata and Storage policies are deliberately unchanged and remain private.

alter table public.user_profiles
  add column if not exists friend_code text,
  add column if not exists avatar_id text not null default 'pokeball';

update public.user_profiles
set friend_code = upper(encode(gen_random_bytes(6), 'hex'))
where friend_code is null;

alter table public.user_profiles
  alter column friend_code set default upper(encode(gen_random_bytes(6), 'hex')),
  alter column friend_code set not null;

create unique index if not exists user_profiles_friend_code_unique
  on public.user_profiles (friend_code);

alter table public.user_profiles
  drop constraint if exists user_profiles_avatar_id_check;
alter table public.user_profiles
  add constraint user_profiles_avatar_id_check
  check (avatar_id in ('pokeball','pikachu','eevee','bulbasaur','charmander','squirtle','snorlax','gengar','psyduck'));

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b)),
  unique (user_a, user_b)
);
create index if not exists friendships_user_a_status_idx on public.friendships(user_a, status);
create index if not exists friendships_user_b_status_idx on public.friendships(user_b, status);
alter table public.friendships enable row level security;

drop policy if exists "Users can read public usernames" on public.user_profiles;
create policy "Users read own and accepted friends profiles"
  on public.user_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.status in ('accepted','pending')
        and (
          (f.user_a = (select auth.uid()) and f.user_b = user_profiles.user_id)
          or (f.user_b = (select auth.uid()) and f.user_a = user_profiles.user_id)
        )
    )
  );

create policy "Users read their friendship rows"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create policy "Recipients can answer pending friend requests"
  on public.friendships for update to authenticated
  using (
    status = 'pending'
    and requested_by <> (select auth.uid())
    and (select auth.uid()) in (user_a, user_b)
  )
  with check (
    status in ('accepted','declined')
    and requested_by <> (select auth.uid())
    and (select auth.uid()) in (user_a, user_b)
  );

-- RLS UPDATE checks the new row but cannot compare it with OLD values.
-- Keep the requested pair and original requester immutable when a recipient responds.
create or replace function public.guard_friendship_participants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_a <> old.user_a
     or new.user_b <> old.user_b then
    raise exception 'Friend request participants cannot be changed';
  end if;
  if new.requested_by <> old.requested_by
     and not (old.status = 'declined' and new.status = 'pending') then
    raise exception 'Requester can change only when a declined request is retried';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_friendship_participants_immutable on public.friendships;
create trigger guard_friendship_participants_immutable
  before update on public.friendships
  for each row execute function public.guard_friendship_participants();
revoke all on function public.guard_friendship_participants() from public, anon, authenticated;

create policy "Participants can remove friendship or request"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create table if not exists public.friend_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists friend_code_attempts_user_time_idx
  on public.friend_code_attempts(user_id, attempted_at);
alter table public.friend_code_attempts enable row level security;

create or replace function public.request_friend_by_code(requested_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_username text;
  v_avatar text;
  v_pair_a uuid;
  v_pair_b uuid;
  v_existing public.friendships%rowtype;
  v_attempts integer;
begin
  if v_me is null then
    return jsonb_build_object('error', 'sign_in_required');
  end if;

  delete from public.friend_code_attempts
  where attempted_at < now() - interval '24 hours';

  insert into public.friend_code_attempts(user_id) values (v_me);
  select count(*) into v_attempts
  from public.friend_code_attempts
  where user_id = v_me and attempted_at > now() - interval '1 hour';

  if v_attempts > 15 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  select user_id, username, avatar_id
    into v_target, v_username, v_avatar
  from public.user_profiles
  where friend_code = upper(trim(coalesce(requested_code, '')))
  limit 1;

  if v_target is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_target = v_me then
    return jsonb_build_object('error', 'cannot_add_self');
  end if;

  v_pair_a := least(v_me, v_target);
  v_pair_b := greatest(v_me, v_target);

  select * into v_existing from public.friendships
  where user_a = v_pair_a and user_b = v_pair_b;

  if found and v_existing.status = 'accepted' then
    return jsonb_build_object('status', 'already_friends', 'username', v_username, 'avatar_id', v_avatar);
  elsif found and v_existing.status = 'pending' then
    return jsonb_build_object('status', 'request_pending', 'username', v_username, 'avatar_id', v_avatar);
  elsif found and v_existing.status = 'declined' then
    update public.friendships
      set status = 'pending', requested_by = v_me, created_at = now(), updated_at = now()
      where id = v_existing.id;
  else
    insert into public.friendships(user_a, user_b, requested_by, status)
      values (v_pair_a, v_pair_b, v_me, 'pending');
  end if;

  return jsonb_build_object('status', 'request_sent', 'username', v_username, 'avatar_id', v_avatar);
end;
$$;

revoke all on function public.request_friend_by_code(text) from public, anon, authenticated;
grant execute on function public.request_friend_by_code(text) to authenticated;

create table if not exists public.collection_shares (
  collection_id uuid not null,
  owner_id uuid not null,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (collection_id, friend_id),
  check (owner_id <> friend_id),
  foreign key (owner_id, collection_id)
    references public.user_collections(user_id, id) on delete cascade
);
create index if not exists collection_shares_friend_id_idx on public.collection_shares(friend_id);
alter table public.collection_shares enable row level security;

create policy "Users read their collection share grants"
  on public.collection_shares for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      friend_id = (select auth.uid())
      and exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and f.user_a < f.user_b
          and (
            (f.user_a = collection_shares.owner_id and f.user_b = collection_shares.friend_id)
            or (f.user_b = collection_shares.owner_id and f.user_a = collection_shares.friend_id)
          )
      )
    )
  );

create policy "Owners share collections with accepted friends"
  on public.collection_shares for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.user_a = collection_shares.owner_id and f.user_b = collection_shares.friend_id)
          or (f.user_b = collection_shares.owner_id and f.user_a = collection_shares.friend_id)
        )
    )
  );

create policy "Owners revoke collection shares"
  on public.collection_shares for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Friends read explicitly shared collections"
  on public.user_collections for select to authenticated
  using (
    exists (
      select 1 from public.collection_shares cs
      where cs.collection_id = user_collections.id
        and cs.owner_id = user_collections.user_id
        and cs.friend_id = (select auth.uid())
    )
  );

create or replace function public.purge_friend_collection_shares()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'accepted' then
      delete from public.collection_shares
      where (owner_id = old.user_a and friend_id = old.user_b)
         or (owner_id = old.user_b and friend_id = old.user_a);
    end if;
    return old;
  end if;
  if old.status = 'accepted' and new.status <> 'accepted' then
    delete from public.collection_shares
    where (owner_id = old.user_a and friend_id = old.user_b)
       or (owner_id = old.user_b and friend_id = old.user_a);
  end if;
  return new;
end;
$$;

drop trigger if exists purge_shares_when_friendship_ends on public.friendships;
create trigger purge_shares_when_friendship_ends
  before update of status or delete on public.friendships
  for each row execute function public.purge_friend_collection_shares();
revoke all on function public.purge_friend_collection_shares() from public, anon, authenticated;
