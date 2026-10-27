import { POKEMON, REGIONS } from './data/pokemon.js';
import { loadProfiles, createProfile, switchProfile, loadProfileCollection, saveProfileCollection, renameProfile, deleteProfile } from './storage.js';
import { getStatus, setFlag, getStats } from './collection.js';
import { applyView, FILTERS, SORTS } from './filter.js';
import { signIn, signUp, signOut, currentUser, syncCollection, inspectCollectionSync, watchAuth, getUsername, saveUsername } from './cloud.js';

const activePokemon = POKEMON;
let profiles = loadProfiles();
let collection = loadProfileCollection(profiles.activeId);
const view = { query: '', filter: 'all', sort: 'dex', region: 'all' };

const $ = (id) => document.getElementById(id);
const list = $('list');
const search = $('search');
const filterSel = $('filter');
const sortSel = $('sort');
const regionSel = $('region');
const profileSel = $('profile');

regionSel.append(new Option('All Pokémon', 'all'));
for (const r of REGIONS) regionSel.append(new Option(r, r));

function renderProfiles() {
  profileSel.replaceChildren(...Object.values(profiles.profiles).map((p) => new Option(p.name, p.id)));
  profileSel.value = profiles.activeId;
}

function fill(select, options) {
  for (const [value, { label }] of Object.entries(options)) {
    select.append(new Option(label, value));
  }
}
fill(filterSel, FILTERS);
fill(sortSel, SORTS);

const pad = (n) => String(n).padStart(3, '0');

function renderStats() {
  const scoped = view.region === 'all' ? activePokemon : activePokemon.filter((p) => p.region === view.region);
  const s = getStats(scoped, collection);
  $('scope').textContent = `${view.region === 'all' ? 'All Pokémon' : view.region}: ${profiles.profiles[profiles.activeId].name}`;
  $('count').textContent = `${s.owned} / ${s.total} collected`;
  $('percent').textContent = `${s.percent}%`;
  $('wantedCount').textContent = `${s.wanted} wanted`;
  const bar = $('bar');
  bar.value = s.owned;
  bar.max = s.total;
}

function row(p) {
  const st = getStatus(collection, p.id);
  const li = document.createElement('li');
  li.className = 'row' + (st.owned ? ' is-owned' : '');
  li.dataset.id = p.id;

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = `#${pad(p.dexNumber)}`;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.name;
  if (st.owned) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '✓ Owned';
    name.append(badge);
  }

  li.append(num, name, check(p, 'owned', 'Owned'), check(p, 'wanted', 'Wanted'));
  return li;
}

function check(p, flag, label) {
  const l = document.createElement('label');
  l.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = getStatus(collection, p.id)[flag];
  input.setAttribute('aria-label', `${label}: ${p.name} #${pad(p.dexNumber)}`);
  input.addEventListener('change', () => {
    collection = setFlag(collection, p.id, flag, input.checked);
    saveProfileCollection(profiles.activeId, collection);
    renderStats();
    renderList();
    refreshSyncAvailability();
  });
  const text = document.createElement('span');
  text.textContent = label;
  l.append(input, text);
  return l;
}

function renderList() {
  const items = applyView(activePokemon, collection, view);
  list.replaceChildren(...items.map(row));
  $('empty').hidden = items.length > 0;
}

search.addEventListener('input', () => {
  view.query = search.value;
  $('clear').hidden = !search.value;
  renderList();
});
$('clear').addEventListener('click', () => {
  search.value = '';
  view.query = '';
  $('clear').hidden = true;
  renderList();
  search.focus();
});
filterSel.addEventListener('change', () => { view.filter = filterSel.value; renderList(); });
regionSel.addEventListener('change', () => { view.region = regionSel.value; renderStats(); renderList(); });
profileSel.addEventListener('change', () => {
  profiles = switchProfile(profiles, profileSel.value);
  collection = loadProfileCollection(profiles.activeId);
  renderStats();
  renderList();
  refreshSyncAvailability();
});
$('renameProfile').addEventListener('click', () => {
  const current = profiles.profiles[profiles.activeId];
  const name = window.prompt('Rename this collection:', current.name);
  if (name === null || !name.trim()) return;
  profiles = renameProfile(profiles, profiles.activeId, name);
  renderProfiles(); renderStats();
  refreshSyncAvailability();
});
$('deleteProfile').addEventListener('click', () => {
  const current = profiles.profiles[profiles.activeId];
  if (Object.keys(profiles.profiles).length <= 1) {
    window.alert('Keep at least one collection. You can rename this one instead.');
    return;
  }
  if (!window.confirm(`Remove “${current.name}” and its saved Pokémon checklist? This cannot be undone. Other collections will be kept.`)) return;
  const oldId = profiles.activeId;
  profiles = deleteProfile(profiles, oldId);
  collection = loadProfileCollection(profiles.activeId);
  renderProfiles(); renderStats(); renderList();
});
$('newProfile').addEventListener('click', () => {
  const name = window.prompt('Name for the new collection:');
  if (name === null) return;
  profiles = createProfile(profiles, name);
  collection = loadProfileCollection(profiles.activeId);
  renderProfiles();
  renderStats();
  renderList();
  refreshSyncAvailability();
});
sortSel.addEventListener('change', () => { view.sort = sortSel.value; renderList(); });

renderProfiles();
renderStats();
renderList();

const accountStatus = $('accountStatus');
const accountEmail = $('accountEmail');
const accountPassword = $('accountPassword');
const signInButton = $('signIn');
const signUpButton = $('signUp');
const signOutButton = $('signOut');
const syncButton = $('syncCloud');
const accountFields = $('accountFields');
const accountSummary = $('accountSummary');
const accountUsername = $('accountUsername');
let activeUserId = null;
let usernamePromptFor = null;

function showAccount(user) {
  const signedIn = Boolean(user);
  accountFields.hidden = signedIn;
  accountSummary.hidden = !signedIn;
  syncButton.hidden = true;
  syncButton.disabled = !signedIn;
  if (!signedIn) {
    activeUserId = null;
    accountUsername.textContent = 'Signed out';
    accountStatus.textContent = 'Your collection stays on this device until you sign in and choose Sync data.';
  } else {
    activeUserId = user.id;
    accountUsername.textContent = 'Loading username…';
    accountStatus.textContent = 'Checking whether your Pokédex checklist needs syncing…';
    loadAccountUsername(user).catch((error) => {
      accountUsername.textContent = user.email || 'Account';
      accountStatus.textContent = error?.message || 'Could not load username.';
    });
    refreshSyncAvailability();
  }
}

async function loadAccountUsername(user) {
  const username = await getUsername(user.id);
  if (activeUserId !== user.id) return;
  if (username) {
    accountUsername.textContent = '@' + username;
    return;
  }
  if (usernamePromptFor === user.id) return;
  usernamePromptFor = user.id;
  try {
    while (activeUserId === user.id) {
      const proposed = window.prompt('Choose your unique Pokémon Card Buddy username. Use 3–20 letters, numbers or underscores:');
      if (proposed === null) {
        accountUsername.textContent = user.email || 'Account';
        accountStatus.textContent = 'You are signed in. Choose a username later by signing in again.';
        return;
      }
      try {
        const saved = await saveUsername(proposed);
        if (activeUserId !== user.id) return;
        accountUsername.textContent = '@' + saved;
        accountStatus.textContent = 'Username saved. Your Pokédex checklist remains local until you choose Sync data.';
        return;
      } catch (error) {
        window.alert(error?.message || 'Could not save username.');
      }
    }
  } finally {
    usernamePromptFor = null;
  }
}

let syncCheckSequence = 0;
async function refreshSyncAvailability() {
  const sequence = ++syncCheckSequence;
  const userId = activeUserId;
  if (!userId) { syncButton.hidden = true; return; }
  syncButton.hidden = true;
  try {
    const status = await inspectCollectionSync(profiles.profiles[profiles.activeId].name, collection);
    if (sequence !== syncCheckSequence || activeUserId !== userId) return;
    syncButton.hidden = !status.needsSync;
    if (status.needsSync) {
      accountStatus.textContent = status.exists
        ? 'Your local Pokédex checklist differs from the cloud copy. Sync is available.'
        : 'This collection has not been backed up to your account yet.';
    } else {
      accountStatus.textContent = 'Pokédex checklist is up to date. Binder photos and card inventory are not synced yet.';
    }
  } catch (error) {
    if (sequence !== syncCheckSequence || activeUserId !== userId) return;
    syncButton.hidden = false;
    accountStatus.textContent = error?.message || 'Could not check cloud status. You can try syncing.';
  }
}

async function accountAction(action) {
  const email = accountEmail.value.trim();
  const password = accountPassword.value;
  if (!email || !password) {
    accountStatus.textContent = 'Enter your email and password first.';
    return;
  }
  signInButton.disabled = signUpButton.disabled = true;
  accountStatus.textContent = 'Connecting securely…';
  try {
    const result = await action(email, password);
    const needsConfirmation = action === signUp && result?.user && !result?.session;
    const user = needsConfirmation ? null : (result?.session?.user || await currentUser());
    showAccount(user);
    accountStatus.textContent = needsConfirmation
      ? 'Account created. Check your email and open the confirmation link. Once confirmed, return here and sign in if needed.'
      : user
        ? 'Signed in. Loading your account…'
        : 'No active session was created. Check your email confirmation, then sign in.';
  } catch (error) {
    accountStatus.textContent = error?.message || 'Account request failed. Please try again.';
  } finally {
    signInButton.disabled = signUpButton.disabled = false;
  }
}
signInButton.addEventListener('click', () => accountAction(signIn));
signUpButton.addEventListener('click', () => accountAction(signUp));
signOutButton.addEventListener('click', async () => {
  try {
    await signOut();
    showAccount(null);
    accountStatus.textContent = 'Signed out. Your local collection remains on this device.';
  } catch (error) { accountStatus.textContent = error?.message || 'Could not sign out.'; }
});
syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  accountStatus.textContent = 'Syncing your Pokédex checklist…';
  try {
    const result = await syncCollection(profiles.profiles[profiles.activeId].name, collection);
    collection = result.collection;
    saveProfileCollection(profiles.activeId, collection);
    renderStats(); renderList();
    accountStatus.textContent = result.direction === 'uploaded'
      ? 'Pokédex checklist backed up. Binder photos and card inventory are not synced yet.'
      : 'Pokédex checklist synced. Binder photos and card inventory are not synced yet.';
    await refreshSyncAvailability();
  } catch (error) {
    accountStatus.textContent = error?.message || 'Sync failed. Your local data has not been deleted.';
  } finally { syncButton.disabled = false; }
});
watchAuth(showAccount).catch(() => { /* Local checklist remains usable offline. */ });
currentUser().then(showAccount).catch(() => showAccount(null));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}


const collectionSection = document.getElementById('collectionSection');
const binderSection = document.getElementById('binderSection');
document.getElementById('showCollection').addEventListener('click', () => {
  collectionSection.hidden = false; binderSection.hidden = true;
  document.getElementById('showCollection').classList.add('active');
  document.getElementById('showBinder').classList.remove('active');
});
document.getElementById('showBinder').addEventListener('click', () => {
  collectionSection.hidden = true; binderSection.hidden = false;
  document.getElementById('showBinder').classList.add('active');
  document.getElementById('showCollection').classList.remove('active');
});
