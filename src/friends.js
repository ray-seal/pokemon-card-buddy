import { POKEMON } from './data/pokemon.js';
import {
  PRESET_AVATARS,
  getMyFriendProfile,
  updateMyAvatar,
  requestFriendByCode,
  loadFriendHub,
  respondToFriendRequest,
  removeFriend,
  setCollectionPermission,
  loadFriendCollections,
} from './friends-cloud.js';

const $ = (id) => document.getElementById(id);
const tab = $('showFriends');
const section = $('friendsSection');
const status = $('friendsStatus');
const codeInput = $('friendCodeInput');
const sendButton = $('sendFriendRequest');
const codeDisplay = $('myFriendCode');
const avatarSelect = $('myAvatar');
const friendsList = $('friendsList');
const incomingList = $('incomingRequests');
const outgoingList = $('outgoingRequests');
const shareControls = $('shareControls');
const friendProfile = $('friendProfile');
let signedIn = false;
let hub = null;
let selectedFriendId = null;
let busy = false;

const avatarEmoji = (id) => PRESET_AVATARS[id] || PRESET_AVATARS.pokeball;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const actionButton = (text, onClick, className = '') => {
  const button = el('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
};
const showStatus = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
};

function showFriendsTab() {
  document.getElementById('collectionSection').hidden = true;
  document.getElementById('binderSection').hidden = true;
  section.hidden = false;
  document.querySelectorAll('.app-tabs button').forEach((button) => button.classList.toggle('active', button === tab));
  if (!signedIn) showStatus('Sign in first to add friends and share selected collections.');
  else if (!hub) refreshHub();
}

tab.addEventListener('click', showFriendsTab);
for (const id of ['showCollection', 'showBinder']) {
  $(id).addEventListener('click', () => { section.hidden = true; });
}

function collectionSummary(collection) {
  const data = collection.collection_data || {};
  let owned = 0;
  let wanted = 0;
  for (const flags of Object.values(data)) {
    if (flags?.owned) owned++;
    if (flags?.wanted) wanted++;
  }
  return { owned, wanted };
}

function renderIncoming() {
  incomingList.replaceChildren();
  if (!hub?.incoming.length) {
    incomingList.append(el('p', 'muted-note', 'No friend requests waiting.'));
    return;
  }
  for (const request of hub.incoming) {
    const card = el('div', 'friend-request');
    const label = el('div', 'friend-person');
    label.append(el('span', 'friend-avatar', avatarEmoji(request.avatar_id)), el('strong', '', request.username ? '@' + request.username : 'Pokémon Card Buddy user'));
    const buttons = el('div', 'friend-actions');
    buttons.append(
      actionButton('Accept', async () => {
        try { await respondToFriendRequest(request.id, true); showStatus('Friend added. Choose which collections they can see.'); await refreshHub(); }
        catch (error) { showStatus(error.message || 'Could not accept request.', true); }
      }, 'primary-button'),
      actionButton('Decline', async () => {
        try { await respondToFriendRequest(request.id, false); showStatus('Request declined.'); await refreshHub(); }
        catch (error) { showStatus(error.message || 'Could not decline request.', true); }
      }, 'secondary')
    );
    card.append(label, buttons);
    incomingList.append(card);
  }
}

function renderOutgoing() {
  outgoingList.replaceChildren();
  if (!hub?.outgoing.length) return;
  outgoingList.append(el('h3', '', 'Sent requests'));
  for (const request of hub.outgoing) {
    const row = el('p', 'muted-note', 'Waiting for ' + (request.username ? '@' + request.username : 'the other collector') + ' to accept.');
    outgoingList.append(row);
  }
}

function renderFriends() {
  friendsList.replaceChildren();
  if (!hub?.friends.length) {
    friendsList.append(el('p', 'muted-note', 'No friends yet. Add someone with their friend code.'));
    return;
  }
  for (const friend of hub.friends) {
    const card = el('div', 'friend-card' + (selectedFriendId === friend.id ? ' selected' : ''));
    const identity = el('div', 'friend-person');
    identity.append(el('span', 'friend-avatar', avatarEmoji(friend.avatar_id)), el('strong', '', '@' + friend.username));
    const actions = el('div', 'friend-actions');
    actions.append(
      actionButton('View collections', async () => {
        selectedFriendId = friend.id;
        renderFriends();
        await viewFriend(friend);
      }, 'primary-button'),
      actionButton('Remove', async () => {
        if (!window.confirm('Remove @' + friend.username + ' from your friends? Their access to your shared collections will be revoked.')) return;
        try {
          await removeFriend(friend.friendshipId);
          if (selectedFriendId === friend.id) { selectedFriendId = null; friendProfile.replaceChildren(); }
          showStatus('Friend removed and collection access revoked.');
          await refreshHub();
        } catch (error) { showStatus(error.message || 'Could not remove friend.', true); }
      }, 'secondary')
    );
    card.append(identity, actions);
    friendsList.append(card);
  }
}

function renderSharing() {
  shareControls.replaceChildren();
  if (!hub?.friends.length) {
    shareControls.append(el('p', 'muted-note', 'Add a friend first. Sharing is off by default.'));
    return;
  }
  if (!hub.collections.length) {
    shareControls.append(el('p', 'muted-note', 'No cloud collections yet. Use Sync data on a collection first. Your local collection is not shared automatically.'));
    return;
  }
  const shareSet = new Set(hub.shares.map((share) => share.collection_id + ':' + share.friend_id));
  for (const friend of hub.friends) {
    const group = el('fieldset', 'share-friend');
    const legend = el('legend', '', avatarEmoji(friend.avatar_id) + ' @' + friend.username);
    group.append(legend);
    group.append(el('p', 'muted-note', 'Choose exactly which synced collections this friend can view.'));
    for (const collection of hub.collections) {
      const label = el('label', 'share-option');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = shareSet.has(collection.id + ':' + friend.id);
      input.disabled = busy;
      input.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await setCollectionPermission(collection.id, friend.id, input.checked);
          showStatus(input.checked ? 'Collection shared with @' + friend.username + '.' : 'Collection access removed for @' + friend.username + '.');
          await refreshHub();
        } catch (error) {
          input.checked = !input.checked;
          showStatus(error.message || 'Could not update sharing permissions.', true);
          input.disabled = false;
        }
      });
      const summary = collectionSummary(collection);
      const copy = el('span');
      copy.append(el('strong', '', collection.name), el('small', '', summary.owned + ' owned · ' + summary.wanted + ' wanted'));
      label.append(input, copy);
      group.append(label);
    }
    shareControls.append(group);
  }
}

function renderProfileRows(collections) {
  friendProfile.replaceChildren();
  if (!collections.length) {
    friendProfile.append(el('p', 'muted-note', 'This collector has not shared any collections with you.'));
    return;
  }
  for (const collection of collections) {
    const details = el('details', 'shared-collection');
    const summary = collectionSummary(collection);
    const heading = el('summary');
    heading.append(el('strong', '', collection.name), el('span', 'muted-note', summary.owned + ' owned · ' + summary.wanted + ' wanted'));
    details.append(heading);
    const data = collection.collection_data || {};
    const items = POKEMON.filter((pokemon) => {
      const flags = data[pokemon.id];
      return flags?.owned || flags?.wanted;
    });
    if (!items.length) {
      details.append(el('p', 'muted-note', 'No Pokémon marked in this collection yet.'));
    } else {
      const list = el('ul', 'shared-pokemon-list');
      for (const pokemon of items) {
        const flags = data[pokemon.id] || {};
        const row = el('li');
        row.append(el('span', 'dex-number', '#' + String(pokemon.dexNumber).padStart(3, '0')));
        row.append(el('span', 'shared-pokemon-name', pokemon.name));
        if (flags.owned) row.append(el('span', 'mini-tag owned-tag', 'Owned'));
        if (flags.wanted) row.append(el('span', 'mini-tag wanted-tag', 'Wanted'));
        list.append(row);
      }
      details.append(list);
    }
    friendProfile.append(details);
  }
}

async function viewFriend(friend) {
  friendProfile.replaceChildren(el('p', 'muted-note', 'Loading shared collections…'));
  try {
    const collections = await loadFriendCollections(friend.id);
    friendProfile.replaceChildren(el('h3', '', avatarEmoji(friend.avatar_id) + ' @' + friend.username));
    friendProfile.append(el('p', 'muted-note', 'Only collections shared with you appear here. Binder pages and all uploaded photos stay private.'));
    const rows = el('div', 'shared-collections-list');
    renderProfileRowsInto(rows, collections);
    friendProfile.append(rows);
  } catch (error) {
    friendProfile.replaceChildren(el('p', 'muted-note', error.message || 'Could not load shared collections.'));
  }
}

function renderProfileRowsInto(target, collections) {
  if (!collections.length) {
    target.append(el('p', 'muted-note', 'This collector has not shared any collections with you.'));
    return;
  }
  for (const collection of collections) {
    const details = el('details', 'shared-collection');
    const summary = collectionSummary(collection);
    const heading = el('summary');
    heading.append(el('strong', '', collection.name), el('span', 'muted-note', summary.owned + ' owned · ' + summary.wanted + ' wanted'));
    details.append(heading);
    const data = collection.collection_data || {};
    const items = POKEMON.filter((pokemon) => data[pokemon.id]?.owned || data[pokemon.id]?.wanted);
    if (!items.length) details.append(el('p', 'muted-note', 'No Pokémon marked in this collection yet.'));
    else {
      const list = el('ul', 'shared-pokemon-list');
      for (const pokemon of items) {
        const flags = data[pokemon.id] || {};
        const row = el('li');
        row.append(el('span', 'dex-number', '#' + String(pokemon.dexNumber).padStart(3, '0')));
        row.append(el('span', 'shared-pokemon-name', pokemon.name));
        if (flags.owned) row.append(el('span', 'mini-tag owned-tag', 'Owned'));
        if (flags.wanted) row.append(el('span', 'mini-tag wanted-tag', 'Wanted'));
        list.append(row);
      }
      details.append(list);
    }
    target.append(details);
  }
}

async function refreshHub() {
  if (!signedIn) return;
  try {
    hub = await loadFriendHub();
    codeDisplay.value = hub.profile?.friend_code || '';
    avatarSelect.value = hub.profile?.avatar_id || 'pokeball';
    renderIncoming();
    renderOutgoing();
    renderFriends();
    renderSharing();
    if (selectedFriendId) {
      const friend = hub.friends.find((item) => item.id === selectedFriendId);
      if (friend) await viewFriend(friend);
      else { selectedFriendId = null; friendProfile.replaceChildren(); }
    }
  } catch (error) {
    showStatus(error.message || 'Could not load Friends. Please try again.', true);
  }
}

$('copyFriendCode').addEventListener('click', async () => {
  if (!codeDisplay.value) return;
  try {
    await navigator.clipboard.writeText(codeDisplay.value);
    showStatus('Friend code copied.');
  } catch {
    codeDisplay.focus();
    codeDisplay.select();
    showStatus('Select and copy your friend code.');
  }
});

sendButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  sendButton.disabled = true;
  try {
    const result = await requestFriendByCode(codeInput.value);
    const message = result.status === 'already_friends'
      ? 'You are already friends with @' + result.username + '.'
      : result.status === 'request_pending'
        ? 'There is already a pending request with @' + result.username + '.'
        : 'Friend request sent to @' + result.username + '.';
    showStatus(message);
    codeInput.value = '';
    await refreshHub();
  } catch (error) {
    showStatus(error.message || 'Could not send friend request.', true);
  } finally {
    busy = false;
    sendButton.disabled = false;
  }
});

avatarSelect.replaceChildren(...Object.entries(PRESET_AVATARS).map(([value, emoji]) => {
  const option = new Option(emoji + ' ' + value[0].toUpperCase() + value.slice(1), value);
  return option;
}));
avatarSelect.addEventListener('change', async () => {
  try {
    await updateMyAvatar(avatarSelect.value);
    showStatus('Preset avatar updated.');
    await refreshHub();
  } catch (error) { showStatus(error.message || 'Could not update avatar.', true); }
});

async function setSignedIn(user) {
  signedIn = Boolean(user);
  tab.disabled = !signedIn;
  if (!signedIn) {
    hub = null;
    codeDisplay.value = '';
    friendsList.replaceChildren();
    incomingList.replaceChildren();
    outgoingList.replaceChildren();
    shareControls.replaceChildren();
    friendProfile.replaceChildren();
    showStatus('Sign in first to add friends and share selected collections.');
    return;
  }
  await refreshHub();
}

async function boot() {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const client = createClient('https://ojnpdosscasvolfhsreh.supabase.co', 'sb_publishable_-I4mu6G34EOY6BxGuDZU6w_cmG-xn9T', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((_event, session) => { setSignedIn(session?.user || null); });
    const { data } = await client.auth.getUser();
    await setSignedIn(data.user || null);
  } catch {
    showStatus('Friends needs an internet connection and a signed-in account.');
  }
}

boot();
