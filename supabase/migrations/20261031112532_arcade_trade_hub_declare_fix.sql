create or replace function private.arcade_list_trade_hub()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_offers jsonb;
  v_history jsonb;
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
