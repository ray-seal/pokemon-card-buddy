-- Player-to-player trading for CardBuddy Arcade.
-- Virtual inventory only. Physical binders and Pokédex collections are untouched.

alter table public.arcade_inventory
  add column if not exists local_item_id text;

update public.arcade_inventory
set local_item_id = item_id::text
where local_item_id is null;

alter table public.arcade_inventory
  alter column local_item_id set not null;

create unique index if not exists arcade_inventory_local_item_id_uidx
  on public.arcade_inventory(local_item_id);

create index if not exists arcade_trade_items_inventory_item_idx
  on public.arcade_trade_items(inventory_item_id);

create index if not exists arcade_trade_offers_participants_status_idx
  on public.arcade_trade_offers(proposer_id, recipient_id, status, created_at desc);

create or replace function public.arcade_sync_inventory(p_cards jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_card jsonb;
  v_local_id text;
  v_rarity integer;
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Sign in to sync your Arcade inventory.'; end if;
  if jsonb_typeof(coalesce(p_cards, '[]'::jsonb)) <> 'array' then
    raise exception 'Inventory payload must be an array.';
  end if;
  if jsonb_array_length(coalesce(p_cards, '[]'::jsonb)) > 2000 then
    raise exception 'Inventory sync is limited to 2,000 cards at a time.';
  end if;

  for v_card in select value from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb))
  loop
    if jsonb_typeof(v_card) <> 'object' then continue; end if;
    v_local_id := left(coalesce(v_card->>'id', ''), 128);
    if v_local_id = '' then continue; end if;
    if coalesce(v_card->>'rarityIndex', '') ~ '^[0-5]$' then
      v_rarity := (v_card->>'rarityIndex')::integer;
    else
      v_rarity := 0;
    end if;

    insert into public.arcade_inventory
      (user_id, local_item_id, card_id, card_data, rarity_tier, obtained_via)
    values
      (v_user, v_local_id,
       left(coalesce(v_card->>'cardId', v_card->>'name', 'unknown'), 120),
       v_card, v_rarity, left(coalesce(v_card->>'pack', 'pack'), 40))
    on conflict (local_item_id) do update
      set card_id = excluded.card_id,
          card_data = excluded.card_data,
          rarity_tier = excluded.rarity_tier,
          obtained_via = excluded.obtained_via
      where public.arcade_inventory.user_id = v_user
        and not exists (
          select 1
          from public.arcade_trade_items ti
          join public.arcade_trade_offers o on o.trade_id = ti.trade_id
          where ti.inventory_item_id = public.arcade_inventory.item_id
            and o.status = 'pending'
        );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.arcade_get_my_inventory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to use the Trade Hub.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', i.item_id,
      'local_item_id', i.local_item_id,
      'card_data', i.card_data,
      'rarity_tier', i.rarity_tier,
      'reserved', exists (
        select 1 from public.arcade_trade_items ti
        join public.arcade_trade_offers o on o.trade_id = ti.trade_id
        where ti.inventory_item_id = i.item_id and o.status = 'pending'
      )
    ) order by i.created_at, i.item_id)
    from public.arcade_inventory i
    where i.user_id = v_user
  ), '[]'::jsonb);
end;
$$;

create or replace function public.arcade_get_friend_inventory(p_friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to use the Trade Hub.'; end if;
  if p_friend_id is null or p_friend_id = v_user or not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and f.user_a = least(v_user, p_friend_id)
      and f.user_b = greatest(v_user, p_friend_id)
  ) then
    raise exception 'You can only trade with an accepted friend.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', i.item_id,
      'card_data', i.card_data,
      'rarity_tier', i.rarity_tier
    ) order by i.created_at, i.item_id)
    from public.arcade_inventory i
    where i.user_id = p_friend_id
      and not exists (
        select 1 from public.arcade_trade_items ti
        join public.arcade_trade_offers o on o.trade_id = ti.trade_id
        where ti.inventory_item_id = i.item_id and o.status = 'pending'
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.arcade_list_trade_hub()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
declare v_offers jsonb;
declare v_history jsonb;
begin
  if v_user is null then raise exception 'Sign in to use the Trade Hub.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'trade_id', o.trade_id,
    'proposer_id', o.proposer_id,
    'recipient_id', o.recipient_id,
    'status', o.status,
    'message', o.message,
    'created_at', o.created_at,
    'incoming', o.recipient_id = v_user,
    'proposer_name', coalesce(pp.username, 'Collector'),
    'recipient_name', coalesce(rp.username, 'Collector'),
    'proposer_card', pi.card_data,
    'recipient_card', ri.card_data
  ) order by o.created_at desc), '[]'::jsonb)
  into v_offers
  from public.arcade_trade_offers o
  join public.arcade_trade_items pit on pit.trade_id = o.trade_id and pit.side = 'proposer'
  join public.arcade_inventory pi on pi.item_id = pit.inventory_item_id
  join public.arcade_trade_items rit on rit.trade_id = o.trade_id and rit.side = 'recipient'
  join public.arcade_inventory ri on ri.item_id = rit.inventory_item_id
  left join public.user_profiles pp on pp.user_id = o.proposer_id
  left join public.user_profiles rp on rp.user_id = o.recipient_id
  where o.status = 'pending' and (o.proposer_id = v_user or o.recipient_id = v_user);

  select coalesce(jsonb_agg(jsonb_build_object(
    'trade_id', h.trade_id,
    'player_a', h.player_a,
    'player_b', h.player_b,
    'player_a_gave', h.player_a_gave,
    'player_b_gave', h.player_b_gave,
    'completed_at', h.completed_at,
    'other_username', case when h.player_a = v_user then coalesce(pb.username, 'Collector') else coalesce(pa.username, 'Collector') end,
    'my_card', case when h.player_a = v_user then h.player_a_gave else h.player_b_gave end,
    'received_card', case when h.player_a = v_user then h.player_b_gave else h.player_a_gave end
  ) order by h.completed_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.arcade_trade_history
    where player_a = v_user or player_b = v_user
    order by completed_at desc limit 25
  ) h
  left join public.user_profiles pa on pa.user_id = h.player_a
  left join public.user_profiles pb on pb.user_id = h.player_b;

  return jsonb_build_object('offers', v_offers, 'history', v_history);
end;
$$;

create or replace function public.arcade_create_trade(
  p_recipient_id uuid,
  p_offered_local_id text,
  p_requested_item_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_offer_item public.arcade_inventory%rowtype;
  v_request_item public.arcade_inventory%rowtype;
  v_trade_id uuid;
begin
  if v_user is null then raise exception 'Sign in to create a trade.'; end if;
  if p_recipient_id is null or p_recipient_id = v_user then raise exception 'Choose another player.'; end if;
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and f.user_a = least(v_user, p_recipient_id)
      and f.user_b = greatest(v_user, p_recipient_id)
  ) then raise exception 'You can only trade with an accepted friend.'; end if;

  -- Lock both cards in a stable order so simultaneous offers cannot reserve either twice.
  perform i.item_id
  from public.arcade_inventory i
  where i.item_id in (
    select item_id from public.arcade_inventory
    where user_id = v_user and local_item_id = p_offered_local_id
    union
    select item_id from public.arcade_inventory
    where user_id = p_recipient_id and item_id = p_requested_item_id
  )
  order by i.item_id
  for update;

  select * into v_offer_item
  from public.arcade_inventory
  where user_id = v_user and local_item_id = p_offered_local_id;
  if not found then raise exception 'That card is not in your synced virtual inventory.'; end if;

  select * into v_request_item
  from public.arcade_inventory
  where user_id = p_recipient_id and item_id = p_requested_item_id;
  if not found then raise exception 'That card is no longer available.'; end if;

  if exists (
    select 1 from public.arcade_trade_items ti
    join public.arcade_trade_offers o on o.trade_id = ti.trade_id
    where ti.inventory_item_id in (v_offer_item.item_id, v_request_item.item_id)
      and o.status = 'pending'
  ) then raise exception 'One of those cards is already reserved in another trade.'; end if;

  insert into public.arcade_trade_offers
    (proposer_id, recipient_id, status, proposer_confirmed, recipient_confirmed, message)
  values
    (v_user, p_recipient_id, 'pending', true, false, nullif(left(trim(coalesce(p_message, '')), 180), ''))
  returning trade_id into v_trade_id;

  insert into public.arcade_trade_items (trade_id, owner_id, inventory_item_id, side)
  values
    (v_trade_id, v_user, v_offer_item.item_id, 'proposer'),
    (v_trade_id, p_recipient_id, v_request_item.item_id, 'recipient');

  return v_trade_id;
end;
$$;

create or replace function public.arcade_respond_trade(p_trade_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_offer public.arcade_trade_offers%rowtype;
  v_proposer_item public.arcade_inventory%rowtype;
  v_recipient_item public.arcade_inventory%rowtype;
begin
  if v_user is null then raise exception 'Sign in to respond to a trade.'; end if;

  select * into v_offer from public.arcade_trade_offers
  where trade_id = p_trade_id for update;
  if not found or v_offer.recipient_id <> v_user then raise exception 'That trade offer is not addressed to you.'; end if;
  if v_offer.status <> 'pending' then raise exception 'That trade offer is no longer active.'; end if;

  if not coalesce(p_accept, false) then
    update public.arcade_trade_offers
      set status = 'declined', updated_at = now()
      where trade_id = p_trade_id;
    return jsonb_build_object('status', 'declined');
  end if;

  perform i.item_id
  from public.arcade_inventory i
  where i.item_id in (
    select inventory_item_id from public.arcade_trade_items
    where trade_id = p_trade_id
  )
  order by i.item_id
  for update;

  select i.* into v_proposer_item
  from public.arcade_trade_items ti
  join public.arcade_inventory i on i.item_id = ti.inventory_item_id
  where ti.trade_id = p_trade_id and ti.side = 'proposer';
  select i.* into v_recipient_item
  from public.arcade_trade_items ti
  join public.arcade_inventory i on i.item_id = ti.inventory_item_id
  where ti.trade_id = p_trade_id and ti.side = 'recipient';

  if v_proposer_item.item_id is null or v_recipient_item.item_id is null
     or v_proposer_item.user_id <> v_offer.proposer_id
     or v_recipient_item.user_id <> v_offer.recipient_id then
    raise exception 'A card in this offer is no longer owned by the expected player.';
  end if;

  -- Both players have confirmed the exact one-for-one exchange. Transfer atomically.
  update public.arcade_inventory set user_id = v_offer.recipient_id
    where item_id = v_proposer_item.item_id;
  update public.arcade_inventory set user_id = v_offer.proposer_id
    where item_id = v_recipient_item.item_id;

  insert into public.arcade_trade_history
    (trade_id, player_a, player_b, player_a_gave, player_b_gave)
  values
    (p_trade_id, v_offer.proposer_id, v_offer.recipient_id,
     v_proposer_item.card_data, v_recipient_item.card_data);

  update public.arcade_trade_offers
    set status = 'completed', proposer_confirmed = true, recipient_confirmed = true,
        updated_at = now(), completed_at = now()
    where trade_id = p_trade_id;

  return jsonb_build_object('status', 'completed');
end;
$$;

create or replace function public.arcade_cancel_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to cancel a trade.'; end if;
  update public.arcade_trade_offers
    set status = 'cancelled', updated_at = now()
    where trade_id = p_trade_id and proposer_id = v_user and status = 'pending';
  if not found then raise exception 'That trade can no longer be cancelled.'; end if;
  return jsonb_build_object('status', 'cancelled');
end;
$$;

create or replace function public.arcade_remove_inventory_card(p_local_item_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return false; end if;
  delete from public.arcade_inventory i
  where i.user_id = v_user and i.local_item_id = p_local_item_id
    and not exists (
      select 1 from public.arcade_trade_items ti
      join public.arcade_trade_offers o on o.trade_id = ti.trade_id
      where ti.inventory_item_id = i.item_id and o.status = 'pending'
    );
  return found;
end;
$$;

revoke all on function public.arcade_sync_inventory(jsonb) from public, anon, authenticated;
revoke all on function public.arcade_get_my_inventory() from public, anon, authenticated;
revoke all on function public.arcade_get_friend_inventory(uuid) from public, anon, authenticated;
revoke all on function public.arcade_list_trade_hub() from public, anon, authenticated;
revoke all on function public.arcade_create_trade(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.arcade_respond_trade(uuid, boolean) from public, anon, authenticated;
revoke all on function public.arcade_cancel_trade(uuid) from public, anon, authenticated;
revoke all on function public.arcade_remove_inventory_card(text) from public, anon, authenticated;

grant execute on function public.arcade_sync_inventory(jsonb) to authenticated;
grant execute on function public.arcade_get_my_inventory() to authenticated;
grant execute on function public.arcade_get_friend_inventory(uuid) to authenticated;
grant execute on function public.arcade_list_trade_hub() to authenticated;
grant execute on function public.arcade_create_trade(uuid, text, uuid, text) to authenticated;
grant execute on function public.arcade_respond_trade(uuid, boolean) to authenticated;
grant execute on function public.arcade_cancel_trade(uuid) to authenticated;
grant execute on function public.arcade_remove_inventory_card(text) to authenticated;

