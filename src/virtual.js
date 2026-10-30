import { POKEMON } from './data/pokemon.js';

const STORE = 'cardbuddy.virtual.v1';
const PACKS = [
  { id: 'starter', name: 'Starter', price: 100, cards: 5, theme: 'blue', odds: [60,25,12,2.5,.45,.05] },
  { id: 'premium', name: 'Premium', price: 200, cards: 5, theme: 'purple', odds: [40,25,20,10,4,1] },
  { id: 'elite', name: 'Elite', price: 350, cards: 6, theme: 'green', odds: [25,25,25,15,8,2] },
  { id: 'legendary', name: 'Legendary', price: 550, cards: 6, theme: 'gold', odds: [15,20,25,20,15,5] },
];
const RARITIES = [
  { name: 'Common', colour: '#aab5c5' },
  { name: 'Uncommon', colour: '#52d18a' },
  { name: 'Rare', colour: '#5c9cff' },
  { name: 'Epic', colour: '#b77aff' },
  { name: 'Legendary', colour: '#ff7474' },
  { name: 'Grail', colour: '#ffd36a' },
];
const $ = (id) => document.getElementById(id);
const safeParse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const today = () => new Date().toISOString().slice(0, 10);
const freshState = () => ({ coins: 100, inventory: [], packsOpened: 0, daily: { date: today(), checkin: false, firstPack: false, fivePacks: false, packsOpened: 0 }, history: [] });
let state = safeParse(localStorage.getItem(STORE)) || freshState();
let currentPack = null;
let pendingCards = [];
let selectedChoice = -1;
let touchStartX = null;
let ripStarted = false;

function save() {
  localStorage.setItem(STORE, JSON.stringify(state));
  renderWallet();
  renderBinder();
  renderChallenges();
}
function resetDaily() {
  if (state.daily?.date !== today()) state.daily = { date: today(), checkin: false, firstPack: false, fivePacks: false, packsOpened: 0 };
  if (typeof state.daily.packsOpened !== 'number') state.daily.packsOpened = 0;
}
function renderWallet() { $('virtualCoins').textContent = state.coins.toLocaleString('en-GB'); }
function packMarkup(pack, small = false) {
  return '<div class="virtual-pack-face ' + pack.theme + (small ? ' compact' : '') + '"><span class="pack-crown">♛</span><strong>CARDBUDDY</strong><small>' + pack.name.toUpperCase() + ' PACK</small><i>✦</i></div>';
}
function renderPacks() {
  $('virtualPackGrid').replaceChildren(...PACKS.map((pack) => {
    const card = document.createElement('article');
    card.className = 'virtual-pack-card';
    card.innerHTML = packMarkup(pack) + '<div class="virtual-pack-meta"><h4>' + pack.name + ' Pack</h4><p>' + pack.cards + ' virtual cards · improved high-rarity odds</p><div class="virtual-pack-buy"><strong>🪙 ' + pack.price + '</strong><button type="button" ' + (state.coins < pack.price ? 'disabled' : '') + '>Choose pack</button></div></div>';
    card.querySelector('button').addEventListener('click', () => startPack(pack.id));
    return card;
  }));
}
function rollRarity(pack) {
  const roll = Math.random() * 100;
  let total = 0;
  for (let i = 0; i < pack.odds.length; i++) {
    total += pack.odds[i];
    if (roll < total) return i;
  }
  return 0;
}
function generateCards(pack) {
  return Array.from({ length: pack.cards }, () => {
    const pokemon = POKEMON[Math.floor(Math.random() * POKEMON.length)];
    const rarity = rollRarity(pack);
    return { id: crypto.randomUUID(), pokemonId: pokemon.id, dexNumber: pokemon.dexNumber, name: pokemon.name, rarity: RARITIES[rarity].name, rarityIndex: rarity, pack: pack.id, obtainedAt: new Date().toISOString() };
  });
}
function startPack(packId) {
  currentPack = PACKS.find((pack) => pack.id === packId);
  if (!currentPack || state.coins < currentPack.price) return;
  state.coins -= currentPack.price;
  save();
  selectedChoice = -1;
  ripStarted = false;
  $('virtualCloseRip').hidden = false;
  $('virtualRipOverlay').hidden = false;
  $('virtualChoiceGrid').hidden = false;
  $('virtualSelectedPack').hidden = true;
  $('virtualReveal').hidden = true;
  $('virtualRipInstruction').textContent = 'Choose one of your eight packs';
  $('virtualChoiceGrid').replaceChildren(...Array.from({ length: 8 }, (_, index) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'virtual-choice';
    choice.setAttribute('aria-label', 'Choose pack ' + (index + 1));
    choice.innerHTML = packMarkup(currentPack, true);
    choice.addEventListener('click', () => choosePack(index));
    return choice;
  }));
}
function choosePack(index) {
  selectedChoice = index;
  $('virtualChoiceGrid').hidden = true;
  $('virtualSelectedPack').hidden = false;
  $('virtualRipInstruction').textContent = 'Your ' + currentPack.name + ' pack is ready';
  $('virtualPackArtwork').className = 'virtual-pack-art ' + currentPack.theme;
}
function finishRip() {
  if (!currentPack || ripStarted || $('virtualReveal').hidden === false) return;
  ripStarted = true;
  $('virtualCloseRip').hidden = true;
  pendingCards = generateCards(currentPack);
  $('virtualSelectedPack').classList.add('is-ripping');
  $('virtualRipInstruction').textContent = 'The seal is breaking…';
  window.setTimeout(() => {
    $('virtualSelectedPack').hidden = true;
    $('virtualReveal').hidden = false;
    $('virtualRipInstruction').textContent = 'Pack opened!';
    $('virtualRevealCards').replaceChildren(...pendingCards.map((card, index) => {
      const pokemon = POKEMON.find((p) => p.id === card.pokemonId);
      const article = document.createElement('article');
      article.className = 'virtual-pull-card rarity-' + card.rarityIndex;
      article.style.animationDelay = (index * 140) + 'ms';
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + card.dexNumber + '.png';
      const number = document.createElement('small');
      number.textContent = '#' + String(card.dexNumber).padStart(4, '0');
      const name = document.createElement('strong');
      name.textContent = card.name;
      const rarity = document.createElement('span');
      rarity.textContent = card.rarity;
      article.append(img, number, name, rarity);
      return article;
    }));
    const grail = pendingCards.some((card) => card.rarityIndex === 5);
    const legendary = pendingCards.some((card) => card.rarityIndex >= 4);
    $('virtualReveal').classList.toggle('has-grail', grail);
    $('virtualReveal').classList.toggle('has-legendary', legendary);
  }, 720);
}
function completePack() {
  if (!pendingCards.length) return;
  state.inventory.push(...pendingCards);
  state.packsOpened += 1;
  resetDaily();
  state.daily.packsOpened += 1;
  state.history.unshift({ date: new Date().toISOString(), pack: currentPack.id, cards: pendingCards.map((card) => card.id) });
  if (!state.daily.firstPack) { state.daily.firstPack = true; state.coins += 25; }
  if (state.daily.packsOpened >= 5 && !state.daily.fivePacks) { state.daily.fivePacks = true; state.coins += 75; }
  pendingCards = [];
  currentPack = null;
  ripStarted = false;
  $('virtualCloseRip').hidden = false;
  $('virtualRipOverlay').hidden = true;
  $('virtualReveal').classList.remove('has-grail', 'has-legendary');
  save();
  renderPacks();
}
function claimCheckin() {
  resetDaily();
  if (state.daily.checkin) return;
  state.daily.checkin = true;
  state.coins += 25;
  save();
  renderPacks();
}
function renderCheckin() {
  resetDaily();
  $('virtualCheckin').disabled = state.daily.checkin;
  $('virtualCheckin').textContent = state.daily.checkin ? 'Claimed ✓' : 'Claim +25';
  $('virtualCheckinStatus').textContent = state.daily.checkin ? 'You have collected today’s 25 coins.' : 'Collect your daily 25 coins.';
}
function renderBinder() {
  const count = state.inventory.length;
  const unique = new Set(state.inventory.map((card) => card.pokemonId)).size;
  $('virtualBinderStats').textContent = count + ' cards · ' + unique + ' unique Pokémon · ' + state.packsOpened + ' packs opened';
  const cards = [...state.inventory].reverse();
  $('virtualCardGrid').replaceChildren(...cards.map((card) => {
    const article = document.createElement('article');
    article.className = 'virtual-binder-card rarity-' + card.rarityIndex;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + card.dexNumber + '.png';
    const name = document.createElement('strong');
    name.textContent = card.name;
    const meta = document.createElement('small');
    meta.textContent = '#' + String(card.dexNumber).padStart(4, '0') + ' · ' + card.rarity;
    article.append(img, name, meta);
    return article;
  }));
}
function renderChallenges() {
  resetDaily();
  const challenges = [
    { title: 'Daily check-in', description: 'Claim your daily coins', reward: 25, done: state.daily.checkin },
    { title: 'First pack of the day', description: 'Open any virtual pack', reward: 25, done: state.daily.firstPack },
    { title: 'Pack collector', description: 'Open five packs today', reward: 75, done: state.daily.fivePacks },
    { title: 'Friend trade', description: 'Trade a virtual card with a friend', reward: 50, done: false, locked: true },
    { title: 'Mystery swap', description: 'Exchange a card with the mystery trader', reward: 25, done: false, locked: true },
  ];
  $('virtualChallengeList').replaceChildren(...challenges.map((challenge) => {
    const item = document.createElement('article');
    item.className = 'virtual-challenge' + (challenge.done ? ' is-done' : '');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = challenge.title;
    const description = document.createElement('p');
    description.textContent = challenge.description + (challenge.locked ? ' · Coming soon' : '');
    copy.append(title, description);
    const reward = document.createElement('b');
    reward.textContent = challenge.done ? 'Claimed ✓' : '+' + challenge.reward + ' 🪙';
    item.append(copy, reward);
    return item;
  }));
}
function setVirtualView(view) {
  for (const [name, id] of [['packs','virtualPacksView'],['binder','virtualBinderView'],['rewards','virtualRewardsView']]) $(id).hidden = name !== view;
  document.querySelectorAll('[data-virtual-view]').forEach((button) => button.classList.toggle('active', button.dataset.virtualView === view));
  if (view === 'packs') renderPacks();
  if (view === 'binder') renderBinder();
  if (view === 'rewards') renderChallenges();
}
$('virtualCheckin').addEventListener('click', () => { claimCheckin(); renderCheckin(); renderChallenges(); });
$('virtualCloseRip').addEventListener('click', () => {
  if (currentPack && !pendingCards.length) state.coins += currentPack.price;
  currentPack = null; pendingCards = []; ripStarted = false;
  $('virtualCloseRip').hidden = false;
  $('virtualRipOverlay').hidden = true; save(); renderPacks();
});
$('virtualDone').addEventListener('click', completePack);
document.querySelectorAll('[data-virtual-view]').forEach((button) => button.addEventListener('click', () => setVirtualView(button.dataset.virtualView)));
$('virtualPackArtwork').addEventListener('pointerdown', (event) => { touchStartX = event.clientX; });
$('virtualPackArtwork').addEventListener('pointerup', (event) => {
  if (touchStartX !== null && Math.abs(event.clientX - touchStartX) > 38) finishRip();
  touchStartX = null;
});
$('virtualPackArtwork').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') finishRip(); });
$('virtualPackArtwork').setAttribute('role', 'button');
$('virtualPackArtwork').setAttribute('tabindex', '0');

const tabs = {
  showCollection: ['collectionSection','binderSection','friendsSection','virtualSection'],
  showBinder: ['binderSection','collectionSection','friendsSection','virtualSection'],
  showFriends: ['friendsSection','collectionSection','binderSection','virtualSection'],
  showVirtual: ['virtualSection','collectionSection','binderSection','friendsSection'],
};
for (const [buttonId, sections] of Object.entries(tabs)) {
  const button = $(buttonId);
  if (!button) continue;
  button.addEventListener('click', () => {
    sections.forEach((id, index) => { const section = $(id); if (section) section.hidden = index !== 0; });
    document.querySelectorAll('.app-tabs button').forEach((tab) => tab.classList.toggle('active', tab === button));
    if (buttonId === 'showVirtual') setVirtualView('packs');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
resetDaily();
renderWallet();
renderCheckin();
renderPacks();
renderBinder();
renderChallenges();
