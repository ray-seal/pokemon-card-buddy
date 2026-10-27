import { POKEMON, REGIONS } from './data/pokemon.js';
import { loadProfiles, createProfile, switchProfile, loadProfileCollection, saveProfileCollection, renameProfile, deleteProfile } from './storage.js';
import { getStatus, setFlag, getStats } from './collection.js';
import { applyView, FILTERS, SORTS } from './filter.js';

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
});
$('renameProfile').addEventListener('click', () => {
  const current = profiles.profiles[profiles.activeId];
  const name = window.prompt('Rename this collection:', current.name);
  if (name === null || !name.trim()) return;
  profiles = renameProfile(profiles, profiles.activeId, name);
  renderProfiles(); renderStats();
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
});
sortSel.addEventListener('change', () => { view.sort = sortSel.value; renderList(); });

renderProfiles();
renderStats();
renderList();

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
