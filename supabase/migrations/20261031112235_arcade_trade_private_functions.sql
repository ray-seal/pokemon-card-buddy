-- Keep privileged trade transactions outside the exposed Data API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.arcade_sync_inventory(jsonb) set schema private;
alter function public.arcade_get_my_inventory() set schema private;
alter function public.arcade_get_friend_inventory(uuid) set schema private;
alter function public.arcade_list_trade_hub() set schema private;
alter function public.arcade_create_trade(uuid, text, uuid, text) set schema private;
alter function public.arcade_respond_trade(uuid, boolean) set schema private;
alter function public.arcade_cancel_trade(uuid) set schema private;
alter function public.arcade_remove_inventory_card(text) set schema private;

create or replace function public.arcade_sync_inventory(p_cards jsonb)
returns integer language sql security invoker set search_path = ''
as $$ select private.arcade_sync_inventory(p_cards); $$;
create or replace function public.arcade_get_my_inventory()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.arcade_get_my_inventory(); $$;
create or replace function public.arcade_get_friend_inventory(p_friend_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.arcade_get_friend_inventory(p_friend_id); $$;
create or replace function public.arcade_list_trade_hub()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.arcade_list_trade_hub(); $$;
create or replace function public.arcade_create_trade(p_recipient_id uuid, p_offered_local_id text, p_requested_item_id uuid, p_message text default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.arcade_create_trade(p_recipient_id, p_offered_local_id, p_requested_item_id, p_message); $$;
create or replace function public.arcade_respond_trade(p_trade_id uuid, p_accept boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.arcade_respond_trade(p_trade_id, p_accept); $$;
create or replace function public.arcade_cancel_trade(p_trade_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.arcade_cancel_trade(p_trade_id); $$;
create or replace function public.arcade_remove_inventory_card(p_local_item_id text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.arcade_remove_inventory_card(p_local_item_id); $$;

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

