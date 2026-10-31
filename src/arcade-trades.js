import { loadFriendHub } from './friends-cloud.js';
import { getSupabaseClient } from './cloud.js';

const INVENTORY_KEY = 'cardbuddy.virtual.v1';
const $ = (id) => document.getElementById(id);
async function signedInClient() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  if (!data.user) throw new Error('Sign in with your CardBuddy account to trade virtual cards.');
  return { supabase, user: data.user };
}
function readLocalState() {
  try { return JSON.parse(localStorage.getItem(INVENTORY_KEY) || '{}') || {}; }
  catch { return {}; }
}
function localCards() {
  const state = readLocalState();
  return Array.isArray(state.inventory) ? state.inventory : [];
}
function cardPayload(card) {
  return {
    id: String(card.id),
    name: String(card.name || card.pokemonName || 'Unknown Pokémon'),
    pokemonName: card.pokemonName || '',
    pokemonId: card.pokemonId || null,
    dexNumber: card.dexNumber ?? null,
    cardId: card.cardId || null,
    image: card.image || '',
    setName: card.setName || '',
    cardNumber: card.cardNumber || '',
    rarity: card.rarity || 'Common',
    rarityIndex: Math.max(0, Math.min(5, Number(card.rarityIndex) || 0)),
    pack: card.pack || 'pack',
    region: card.region || '',
  };
}
function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'assets.tcgdex.net' || url.hostname.endsWith('.tcgdex.net'))
      ? url.href : '';
  } catch { return ''; }
}
function makeCardNode(card, compact = false) {
  const wrap = document.createElement('div');
  wrap.className = 'p2p-card' + (compact ? ' compact' : '');
  const imgUrl = safeImageUrl(card?.image);
  if (imgUrl) {
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = String(card?.name || 'Trading card');
    img.loading = 'lazy';
    img.onerror = () => { img.hidden = true; };
    wrap.append(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'p2p-card-placeholder';
    placeholder.textContent = '🃏';
    wrap.append(placeholder);
  }
  const info = document.createElement('div');
  info.className = 'p2p-card-info';
  const name = document.createElement('strong');
  name.textContent = String(card?.name || card?.pokemonName || 'Unknown card');
  const meta = document.createElement('small');
  meta.textContent = [card?.rarity || 'Common', card?.setName || '', card?.cardNumber ? '#' + card.cardNumber : ''].filter(Boolean).join(' · ');
  info.append(name, meta);
  wrap.append(info);
  return wrap;
}
function status(message, error = false) {
  const node = $('p2pStatus');
  node.textContent = message;
  node.classList.toggle('is-error', error);
}
function callout(title, message) {
  const node = document.createElement('div');
  node.className = 'p2p-empty';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  node.append(strong, p);
  return node;
}
function setBusy(value) {
  busy = value;
  $('p2pRefresh').disabled = value;
  $('p2pCreateOffer').disabled = value || !$('p2pFriend').value || !$('p2pOwnCard').value || !$('p2pFriendCard').value;
  $('p2pCreateOffer').textContent = value ? 'Working…' : 'Review and send offer';
}
function syncCreateButton() {
  $('p2pCreateOffer').disabled = busy || !friends.length || !$('p2pFriend').value || !$('p2pOwnCard').value || !$('p2pFriendCard').value;
}
function renderFriends() {
  const select = $('p2pFriend');
  const previous = select.value;
  select.replaceChildren(new Option('Choose a friend…', ''));
  friends.forEach(friend => select.add(new Option('@' + friend.username, friend.id)));
  if (friends.some(friend => friend.id === previous)) select.value = previous;
  $('p2pFriendEmpty').hidden = friends.length > 0;
}
function renderOwnCards() {
  const select = $('p2pOwnCard');
  const previous = select.value;
  select.replaceChildren(new Option('Choose one of your cards…', ''));
  ownCards.forEach(card => {
    const label = (card.name || 'Unknown card') + ' · ' + (card.rarity || 'Common') + (card.reserved ? ' · RESERVED' : '');
    const option = new Option(label, card.id);
    option.disabled = Boolean(card.reserved);
    select.add(option);
  });
  if (ownCards.some(card => card.id === previous && !card.reserved)) select.value = previous;
  syncCreateButton();
}
function renderFriendCards() {
  const select = $('p2pFriendCard');
  const previous = select.value;
  select.replaceChildren(new Option('Choose a card they own…', ''));
  friendCards.forEach(card => {
    const label = (card.name || 'Unknown card') + ' · ' + (card.rarity || 'Common');
    select.add(new Option(label, card.item_id));
  });
  if (friendCards.some(card => card.item_id === previous)) select.value = previous;
  $('p2pFriendCardEmpty').hidden = friendCards.length > 0;
  syncCreateButton();
}
function normalizeOwnRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    ...(row.card_data || {}),
    id: String(row.local_item_id),
    reserved: Boolean(row.reserved),
    serverItemId: row.item_id,
  }));
}
function normalizeFriendRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    ...(row.card_data || {}),
    item_id: row.item_id,
    rarityIndex: Number(row.rarity_tier) || 0,
  }));
}
function applyCloudInventory(rows) {
  const state = readLocalState();
  state.inventory = normalizeOwnRows(rows);
  state.unlockedPokemon = Array.isArray(state.unlockedPokemon) ? state.unlockedPokemon : [];
  for (const card of state.inventory) {
    if (card.pokemonId && !state.unlockedPokemon.includes(card.pokemonId)) state.unlockedPokemon.push(card.pokemonId);
  }
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('cardbuddy-virtual-inventory-replaced'));
}
async function syncAndLoadInventory(supabase) {
  const payload = localCards().map(cardPayload);
  if (payload.length) {
    const { error: syncError } = await supabase.rpc('arcade_sync_inventory', { p_cards: payload });
    if (syncError) throw syncError;
  }
  const { data, error } = await supabase.rpc('arcade_get_my_inventory');
  if (error) throw error;
  applyCloudInventory(data || []);
  ownCards = normalizeOwnRows(data || []);
  renderOwnCards();
}
async function loadOffers(supabase) {
  const { data, error } = await supabase.rpc('arcade_list_trade_hub');
  if (error) throw error;
  renderOffers(data?.offers || []);
  renderHistory(data?.history || []);
}
function renderOffers(offers) {
  const incoming = $('p2pIncoming');
  const outgoing = $('p2pOutgoing');
  incoming.replaceChildren();
  outgoing.replaceChildren();
  const inbound = offers.filter(offer => offer.incoming);
  const outbound = offers.filter(offer => !offer.incoming);
  if (!inbound.length) incoming.append(callout('No incoming offers', 'When a friend offers you a card, it will appear here.'));
  if (!outbound.length) outgoing.append(callout('No outgoing offers', 'Offers you send will appear here until they are accepted, declined or cancelled.'));
  for (const offer of inbound) incoming.append(makeOfferCard(offer, true));
  for (const offer of outbound) outgoing.append(makeOfferCard(offer, false));
}
function makeOfferCard(offer, incoming) {
  const card = document.createElement('article');
  card.className = 'p2p-offer-card';
  const heading = document.createElement('div');
  heading.className = 'p2p-offer-heading';
  const title = document.createElement('strong');
  title.textContent = incoming ? 'Offer from @' + offer.proposer_name : 'Offer to @' + offer.recipient_name;
  const date = document.createElement('small');
  date.textContent = new Date(offer.created_at).toLocaleString('en-GB');
  heading.append(title, date);
  const exchange = document.createElement('div');
  exchange.className = 'p2p-exchange';
  const give = document.createElement('div');
  give.className = 'p2p-exchange-side';
  give.append(makeCardNode(incoming ? offer.recipient_card : offer.proposer_card, true));
  const arrow = document.createElement('span');
  arrow.className = 'p2p-exchange-arrow';
  arrow.textContent = '⇄';
  const receive = document.createElement('div');
  receive.className = 'p2p-exchange-side';
  receive.append(makeCardNode(incoming ? offer.proposer_card : offer.recipient_card, true));
  const giveLabel = document.createElement('small');
  giveLabel.textContent = 'You give';
  const receiveLabel = document.createElement('small');
  receiveLabel.textContent = 'You receive';
  give.prepend(giveLabel);
  receive.prepend(receiveLabel);
  exchange.append(give, arrow, receive);
  card.append(heading, exchange);
  if (offer.message) {
    const message = document.createElement('p');
    message.className = 'p2p-offer-message';
    message.textContent = offer.message;
    card.append(message);
  }
  const actions = document.createElement('div');
  actions.className = 'p2p-offer-actions';
  if (incoming) {
    actions.append(
      makeButton('Decline', () => respond(offer, false), 'secondary'),
      makeButton('Accept exact trade', () => respond(offer, true), 'primary-button')
    );
  } else {
    actions.append(makeButton('Cancel offer', () => cancel(offer), 'secondary'));
  }
  card.append(actions);
  return card;
}
function makeButton(label, handler, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}
function renderHistory(history) {
  const root = $('p2pHistory');
  root.replaceChildren();
  if (!history.length) {
    root.append(callout('No completed trades yet', 'Your successful player-to-player swaps will be recorded here.'));
    return;
  }
  history.forEach(entry => {
    const row = document.createElement('article');
    row.className = 'p2p-history-row';
    row.append(
      makeCardNode(entry.received_card || {}, true),
      makeCardNode(entry.my_card || {}, true)
    );
    const label = document.createElement('p');
    label.textContent = 'Traded with @' + entry.other_username + ' · ' + new Date(entry.completed_at).toLocaleDateString('en-GB');
    row.append(label);
    root.append(row);
  });
}
async function respond(offer, accept) {
  if (busy) return;
  if (accept) {
    const yours = offer.recipient_card?.name || 'your card';
    const theirs = offer.proposer_card?.name || 'their card';
    if (!window.confirm('Confirm this exact exchange?\n\nYou give: ' + yours + '\nYou receive: ' + theirs + '\n\nBoth cards will transfer immediately.')) return;
  } else if (!window.confirm('Decline this trade offer? The reserved cards will become available again.')) return;
  await runAction(async supabase => {
    const { error } = await supabase.rpc('arcade_respond_trade', { p_trade_id: offer.trade_id, p_accept: accept });
    if (error) throw error;
    status(accept ? 'Trade completed! Both virtual cards have changed owners.' : 'Offer declined. Both cards are available again.');
    await syncAndLoadInventory(supabase);
    await loadOffers(supabase);
    if ($('p2pFriend').value) await loadFriendCards(supabase, $('p2pFriend').value);
  });
}
async function cancel(offer) {
  if (!window.confirm('Cancel this offer? Both reserved cards will become available again.')) return;
  await runAction(async supabase => {
    const { error } = await supabase.rpc('arcade_cancel_trade', { p_trade_id: offer.trade_id });
    if (error) throw error;
    status('Offer cancelled. Both cards are available again.');
    await syncAndLoadInventory(supabase);
    await loadOffers(supabase);
    if ($('p2pFriend').value) await loadFriendCards(supabase, $('p2pFriend').value);
  });
}
async function loadFriendCards(supabase, friendId) {
  friendCards = [];
  renderFriendCards();
  if (!friendId) return;
  const { data, error } = await supabase.rpc('arcade_get_friend_inventory', { p_friend_id: friendId });
  if (error) throw error;
  friendCards = normalizeFriendRows(data || []);
  renderFriendCards();
}
async function runAction(action) {
  if (busy) return;
  setBusy(true);
  try {
    const { supabase } = await signedInClient();
    await action(supabase);
  } catch (error) {
    status(error?.message || 'The trade action could not be completed. No cards were changed.', true);
  } finally {
    setBusy(false);
  }
}
async function refreshHub() {
  if (busy) return;
  setBusy(true);
  status('Connecting to the Arcade trading floor…');
  try {
    const { supabase } = await signedInClient();
    const hub = await loadFriendHub();
    friends = hub.friends || [];
    renderFriends();
    await syncAndLoadInventory(supabase);
    await loadOffers(supabase);
    if ($('p2pFriend').value) await loadFriendCards(supabase, $('p2pFriend').value);
    if (!friends.length) status('Add and accept a friend in Friends before sending player-to-player offers.');
    else status('Trading floor refreshed. Your virtual inventory is synced and ready.');
  } catch (error) {
    status(error?.message || 'Could not load the trading floor.', true);
  } finally {
    setBusy(false);
  }
}
async function createOffer() {
  if (busy) return;
  const friendId = $('p2pFriend').value;
  const offered = ownCards.find(card => card.id === $('p2pOwnCard').value);
  const requested = friendCards.find(card => card.item_id === $('p2pFriendCard').value);
  if (!friendId || !offered || offered.reserved || !requested) {
    status('Choose an available card of your own and an available card from your friend.', true);
    return;
  }
  const friend = friends.find(item => item.id === friendId);
  const message = $('p2pMessage').value.trim();
  const review = 'Send this exact offer to @' + (friend?.username || 'your friend') + '?\n\nYou give: ' + offered.name + ' (' + (offered.rarity || 'Common') + ')\nYou receive: ' + requested.name + ' (' + (requested.rarity || 'Common') + ')\n\nBoth cards will be reserved until the offer is accepted, declined or cancelled.';
  if (!window.confirm(review)) return;
  await runAction(async supabase => {
    const { error } = await supabase.rpc('arcade_create_trade', {
      p_recipient_id: friendId,
      p_offered_local_id: offered.id,
      p_requested_item_id: requested.item_id,
      p_message: message || null,
    });
    if (error) throw error;
    $('p2pMessage').value = '';
    status('Offer sent. Your card and your friend’s chosen card are now reserved until the offer is resolved.');
    await syncAndLoadInventory(supabase);
    await loadOffers(supabase);
    await loadFriendCards(supabase, friendId);
  });
}
function showTradeTab() {
  const sections = ['collectionSection','binderSection','friendsSection','virtualSection','playerTradeSection'];
  sections.forEach(id => { const section = $(id); if (section) section.hidden = id !== 'playerTradeSection'; });
  document.querySelectorAll('.app-tabs button').forEach(button => button.classList.toggle('active', button.id === 'showPlayerTrades'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  void refreshHub();
}
$('showPlayerTrades').addEventListener('click', showTradeTab);
$('p2pRefresh').addEventListener('click', refreshHub);
$('p2pFriend').addEventListener('change', async () => {
  if (busy) return;
  await runAction(async supabase => {
    await loadFriendCards(supabase, $('p2pFriend').value);
  });
});
$('p2pOwnCard').addEventListener('change', syncCreateButton);
$('p2pFriendCard').addEventListener('change', syncCreateButton);
$('p2pCreateOffer').addEventListener('click', createOffer);

window.addEventListener('cardbuddy-virtual-card-removed', async (event) => {
  const localId = String(event.detail?.id || '');
  if (!localId) return;
  try {
    const { supabase } = await signedInClient();
    await supabase.rpc('arcade_remove_inventory_card', { p_local_item_id: localId });
  } catch {
    // Guest play and offline NPC trades remain local. The next signed-in
    // inventory refresh will still protect any card already transferred.
  }
});
