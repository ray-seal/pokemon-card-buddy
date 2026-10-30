import { POKEMON, REGIONS } from './data/pokemon.js';

const STORE = 'cardbuddy.virtual.v1';
const PACKS = [
  { id: 'starter', name: 'Starter', price: 100, cards: 5, theme: 'blue', odds: [60,25,12,2.5,.45,.05] },
  { id: 'premium', name: 'Premium', price: 200, cards: 5, theme: 'purple', odds: [40,25,20,10,4,1] },
  { id: 'elite', name: 'Elite', price: 350, cards: 6, theme: 'green', odds: [25,25,25,15,8,2] },
  { id: 'legendary', name: 'Legendary', price: 550, cards: 6, theme: 'gold', odds: [15,20,25,20,15,5] },
];
const RARITIES = ['Common','Uncommon','Rare','Epic','Legendary','Grail'];
const $ = (id) => document.getElementById(id);
const safeParse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
const freshState = () => ({ coins: 100, inventory: [], packsOpened: 0, unlockedPokemon: [], daily: { date: today(), checkin: false, firstPack: false, firstPackEarned: false, fivePacks: false, fivePacksEarned: false, packsOpened: 0 }, history: [] });
let state = safeParse(localStorage.getItem(STORE)) || freshState();
if (!Array.isArray(state.inventory)) state.inventory = [];
if (!Array.isArray(state.unlockedPokemon)) state.unlockedPokemon = [];
let currentPack = null;
let pendingCards = [];
let revealIndex = 0;
let cardCataloguePromise = null;
let touchStartX = null;
let ripStarted = false;

function save() {
  localStorage.setItem(STORE, JSON.stringify(state));
  renderWallet();
  renderChallenges();
  window.dispatchEvent(new CustomEvent('cardbuddy-virtual-inventory-updated'));
}
function resetDaily() {
  if (state.daily?.date !== today()) state.daily = { date: today(), checkin: false, firstPack: false, firstPackEarned: false, fivePacks: false, fivePacksEarned: false, packsOpened: 0 };
  if (typeof state.daily.packsOpened !== 'number') state.daily.packsOpened = 0;
  // Older saves marked bonuses as claimed when they were automatically paid.
  if (typeof state.daily.firstPackEarned !== 'boolean') state.daily.firstPackEarned = Boolean(state.daily.firstPack);
  if (typeof state.daily.fivePacksEarned !== 'boolean') state.daily.fivePacksEarned = Boolean(state.daily.fivePacks);
}
function renderWallet() { $('virtualCoins').textContent = state.coins.toLocaleString('en-GB'); }
function packMarkup(pack, small = false) {
  return '<div class="virtual-pack-face ' + pack.theme + (small ? ' compact' : '') + '"><img src="assets/packs/cardbuddy-' + pack.id + '.svg" alt="' + pack.name + ' CardBuddy booster pack" loading="lazy"></div>';
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
function normaliseName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function matchPokemon(cardName) {
  const raw = String(cardName || '').toLowerCase();
  if (raw.includes('nidoran') && raw.includes('♀')) return POKEMON.find((pokemon) => pokemon.dexNumber === 29) || null;
  if (raw.includes('nidoran') && raw.includes('♂')) return POKEMON.find((pokemon) => pokemon.dexNumber === 32) || null;
  const name = normaliseName(cardName);
  return POKEMON.find((pokemon) => {
    const species = normaliseName(pokemon.name);
    return name === species || name.startsWith(species) || name.includes(species);
  }) || null;
}
async function loadCardCatalogue() {
  if (cardCataloguePromise) return cardCataloguePromise;
  cardCataloguePromise = (async () => {
    const cached = safeParse(sessionStorage.getItem('cardbuddy.tcgdex.catalogue.v2'));
    if (Array.isArray(cached) && cached.length) return cached;
    let cards = null;
    for (const url of [
      'https://api.tcgdex.net/v2/en/cards?category=Pokemon',
      'https://api.tcgdex.net/v2/en/cards'
    ]) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const payload = await response.json();
        if (Array.isArray(payload) && payload.length) {
          cards = payload.filter((card) => card.image && card.name && card.id && (!card.category || card.category === 'Pokemon'));
          if (cards.length) break;
        }
      } catch { /* Try the unfiltered catalogue endpoint next. */ }
    }
    if (!cards?.length) throw new Error('TCGdex card catalogue is unavailable');
    try { sessionStorage.setItem('cardbuddy.tcgdex.catalogue.v2', JSON.stringify(cards)); } catch {}
    return cards;
  })().catch((error) => { cardCataloguePromise = null; throw error; });
  return cardCataloguePromise;
}
function imageForCard(card) {
  const raw = String(card?.image || '').replace(/\/(?:high|low)\.(?:webp|png|jpg|svg)$/i, '').replace(/\/$/, '');
  return raw ? raw + '/high.png' : '';
}
function attachCardImage(image, card) {
  const raw = String(card?.image || '').replace(/\/(?:high|low)\.(?:webp|png|jpg|svg)$/i, '').replace(/\/$/, '');
  if (!raw) { image.hidden = true; return; }
  const formats = ['high.png','high.webp','high.jpg','low.png','low.webp','low.jpg'];
  let index = 0;
  image.onerror = () => {
    index += 1;
    if (index < formats.length) image.src = raw + '/' + formats[index];
    else { image.onerror = null; image.removeAttribute('src'); image.alt = 'Trading card scan unavailable'; image.classList.add('image-unavailable'); }
  };
  image.src = raw + '/' + formats[index];
}
async function generateCards(pack) {
  const catalogue = await loadCardCatalogue();
  if (!catalogue.length) throw new Error('No card scans are currently available');
  const selected = Array.from({ length: pack.cards }, () => catalogue[Math.floor(Math.random() * catalogue.length)]);
  const detailed = await Promise.all(selected.map(async (brief) => {
    try {
      const response = await fetch('https://api.tcgdex.net/v2/en/cards/' + encodeURIComponent(brief.id));
      if (!response.ok) return brief;
      const detail = await response.json();
      return { ...brief, ...detail, image: detail.image || brief.image };
    } catch { return brief; }
  }));
  return detailed.map((source) => {
    const species = matchPokemon(source.name);
    const rarityIndex = rollRarity(pack);
    return {
      id: uid(), pokemonId: species?.id || null, dexNumber: species?.dexNumber || null, pokemonName: species?.name || '',
      name: source.name || 'Unknown Pokémon', cardId: source.id || null, image: imageForCard(source),
      setName: source?.set?.name || '', cardNumber: source?.localId || '', rarity: RARITIES[rarityIndex],
      rarityIndex, pack: pack.id, obtainedAt: new Date().toISOString(),
    };
  });
}
async function repairLegacyInventory() {
  const missing = state.inventory.filter((card) => !card.image || !card.cardId);
  if (!missing.length) return;
  try {
    const catalogue = await loadCardCatalogue();
    let changed = false;
    for (const card of missing) {
      const match = catalogue.find((brief) => normaliseName(brief.name) === normaliseName(card.name))
        || catalogue.find((brief) => card.pokemonId && matchPokemon(brief.name)?.id === card.pokemonId);
      if (!match) continue;
      card.cardId = match.id;
      card.image = imageForCard(match);
      card.cardNumber = match.localId || card.cardNumber || '';
      changed = true;
    }
    if (changed) {
      localStorage.setItem(STORE, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent('cardbuddy-virtual-inventory-updated'));
    }
  } catch { /* Keep the local collection intact if the catalogue is temporarily offline. */ }
}
function startPack(packId) {
  currentPack = PACKS.find((pack) => pack.id === packId);
  if (!currentPack || state.coins < currentPack.price) return;
  state.coins -= currentPack.price;
  save();
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
function choosePack() {
  $('virtualChoiceGrid').hidden = true;
  $('virtualSelectedPack').hidden = false;
  $('virtualRipInstruction').textContent = 'Your ' + currentPack.name + ' pack is ready';
  $('virtualPackArtwork').className = 'virtual-pack-art ' + currentPack.theme;
  $('virtualPackArtwork').style.backgroundImage = 'url("assets/packs/cardbuddy-' + currentPack.id + '.svg")';
}
async function finishRip() {
  if (!currentPack || ripStarted || $('virtualReveal').hidden === false) return;
  ripStarted = true;
  $('virtualCloseRip').hidden = true;
  $('virtualRipInstruction').textContent = 'The seal is breaking…';
  $('virtualSelectedPack').classList.add('is-ripping');
  try { pendingCards = await generateCards(currentPack); }
  catch (error) {
    state.coins += currentPack.price; save(); ripStarted = false;
    $('virtualSelectedPack').classList.remove('is-ripping');
    $('virtualRipInstruction').textContent = 'Card scans are temporarily unavailable. Your coins have been returned. Please try again shortly.';
    $('virtualCloseRip').hidden = false;
    return;
  }
  window.setTimeout(() => {
    revealIndex = 0;
    $('virtualSelectedPack').hidden = true;
    $('virtualReveal').hidden = false;
    $('virtualRipInstruction').textContent = 'Pack opened!';
    renderCurrentReveal();
  }, 720);
}
function renderCurrentReveal() {
  const card = pendingCards[revealIndex];
  if (!card) return;
  $('virtualRevealCount').textContent = 'CARD ' + (revealIndex + 1) + ' OF ' + pendingCards.length + ' · ' + card.rarity.toUpperCase();
  $('virtualRevealCards').replaceChildren();
  const panel = document.createElement('article');
  panel.className = 'virtual-pull-card full-card rarity-' + card.rarityIndex;
  panel.style.animation = 'reveal-in .42s ease-out both';
  const image = document.createElement('img');
  image.alt = card.name + ' Pokémon trading card';
  if (card.image) image.src = card.image;
  else { image.hidden = true; panel.classList.add('image-unavailable'); }
  let triedPng = false;
  image.onerror = () => {
    if (!triedPng && card.image.endsWith('/high.webp')) {
      triedPng = true;
      image.src = card.image.replace('/high.webp', '/high.png');
      return;
    }
    image.onerror = null;
    image.removeAttribute('src');
    image.alt = 'Trading card image unavailable';
    panel.classList.add('image-unavailable');
  };
  const title = document.createElement('strong');
  title.textContent = card.name;
  const meta = document.createElement('small');
  meta.textContent = card.setName ? card.setName + ' · ' + card.cardNumber : '#' + String(card.dexNumber).padStart(4, '0');
  const rarity = document.createElement('span');
  rarity.textContent = card.rarity;
  panel.append(image, title, meta, rarity);
  $('virtualRevealCards').append(panel);
  $('virtualNextCard').hidden = revealIndex === pendingCards.length - 1;
  $('virtualDone').hidden = revealIndex !== pendingCards.length - 1;
  $('virtualNextCard').textContent = 'Next card →';
  $('virtualReveal').classList.toggle('has-grail', card.rarityIndex === 5);
  $('virtualReveal').classList.toggle('has-legendary', card.rarityIndex === 4);
}
function nextReveal() {
  if (revealIndex >= pendingCards.length - 1) return;
  revealIndex += 1;
  renderCurrentReveal();
}
function completePack() {
  if (!pendingCards.length || revealIndex !== pendingCards.length - 1) return;
  state.inventory.push(...pendingCards);
  for (const card of pendingCards) if (card.pokemonId && !state.unlockedPokemon.includes(card.pokemonId)) state.unlockedPokemon.push(card.pokemonId);
  state.packsOpened += 1;
  resetDaily();
  state.daily.packsOpened += 1;
  state.history.unshift({ date: new Date().toISOString(), pack: currentPack.id, cards: pendingCards.map((card) => card.id) });
  if (!state.daily.firstPackEarned) state.daily.firstPackEarned = true;
  if (state.daily.packsOpened >= 5 && !state.daily.fivePacksEarned) state.daily.fivePacksEarned = true;
  pendingCards = [];
  currentPack = null;
  ripStarted = false;
  $('virtualCloseRip').hidden = false;
  $('virtualRipOverlay').hidden = true;
  $('virtualReveal').classList.remove('has-grail', 'has-legendary');
  save();
  renderPacks();
}
function claimReward(key, amount) {
  resetDaily();
  const earnedKey = key === 'firstPack' ? 'firstPackEarned' : key === 'fivePacks' ? 'fivePacksEarned' : null;
  if (state.daily[key] || (earnedKey && !state.daily[earnedKey])) return;
  state.daily[key] = true;
  state.coins += amount;
  save();
  renderPacks();
  renderCheckin();
  renderChallenges();
}
function renderCheckin() {
  resetDaily();
  $('virtualCheckin').disabled = false;
  $('virtualCheckin').textContent = 'View rewards';
  $('virtualCheckinStatus').textContent = state.daily.checkin ? 'Daily check-in claimed. Visit Rewards for any other coins you have earned.' : 'Your daily 25 coins are waiting on the Rewards screen.';
}
function renderChallenges() {
  resetDaily();
  const challenges = [
    { key: 'checkin', title: 'Daily check-in', description: 'Claim your daily coins', reward: 25, done: state.daily.checkin, earned: true },
    { key: 'firstPack', title: 'First pack of the day', description: 'Open any virtual pack', reward: 25, done: state.daily.firstPack, earned: state.daily.firstPackEarned },
    { key: 'fivePacks', title: 'Pack collector', description: 'Open five packs today', reward: 75, done: state.daily.fivePacks, earned: state.daily.fivePacksEarned },
    { title: 'Friend trade', description: 'Trade a virtual card with a friend', reward: 50, locked: true },
    { title: 'Mystery swap', description: 'Exchange a card with the mystery trader', reward: 25, locked: true },
  ];
  $('virtualChallengeList').replaceChildren(...challenges.map((challenge) => {
    const item = document.createElement('article');
    item.className = 'virtual-challenge' + (challenge.done ? ' is-done' : '');
    const copy = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = challenge.title;
    const description = document.createElement('p');
    description.textContent = challenge.description + (challenge.locked ? ' · Coming soon' : challenge.done ? ' · Claimed' : challenge.earned ? ' · Ready to claim' : ' · Keep playing');
    copy.append(title, description);
    const action = document.createElement('div'); action.className = 'virtual-challenge-action';
    if (challenge.locked) {
      const reward = document.createElement('b'); reward.textContent = '+' + challenge.reward + ' 🪙'; action.append(reward);
    } else if (challenge.done) {
      const reward = document.createElement('b'); reward.textContent = 'Claimed ✓'; action.append(reward);
    } else if (challenge.earned) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Claim +' + challenge.reward;
      button.addEventListener('click', () => claimReward(challenge.key, challenge.reward)); action.append(button);
    } else {
      const reward = document.createElement('b'); reward.textContent = '+' + challenge.reward + ' 🪙'; action.append(reward);
    }
    item.append(copy, action);
    return item;
  }));
}
function setVirtualView(view) {
  for (const [name, id] of [['packs','virtualPacksView'],['binder','virtualBinderView'],['pokedex','virtualPokedexView'],['rewards','virtualRewardsView']]) $(id).hidden = name !== view;
  document.querySelectorAll('[data-virtual-view]').forEach((button) => button.classList.toggle('active', button.dataset.virtualView === view));
  if (view === 'packs') renderPacks();
  if (view === 'pokedex') window.dispatchEvent(new CustomEvent('cardbuddy-virtual-pokedex-render'));
  if (view === 'binder') window.dispatchEvent(new CustomEvent('cardbuddy-virtual-binder-render'));
  if (view === 'rewards') renderChallenges();
}
document.querySelectorAll('[data-virtual-view]').forEach((button) => {
  button.addEventListener('click', () => setVirtualView(button.dataset.virtualView));
});
$('virtualCheckin').addEventListener('click', () => setVirtualView('rewards'));
$('virtualCloseRip').addEventListener('click', () => {
  if (currentPack && !ripStarted) state.coins += currentPack.price;
  currentPack = null; pendingCards = []; ripStarted = false;
  $('virtualCloseRip').hidden = false; $('virtualRipOverlay').hidden = true;
  save(); renderPacks();
});
$('virtualNextCard').addEventListener('click', nextReveal);
$('virtualDone').addEventListener('click', completePack);
$('virtualDone').textContent = 'Add to collection';
$('virtualPackArtwork').addEventListener('pointerdown', (event) => { touchStartX = event.clientX; });
$('virtualPackArtwork').addEventListener('pointerup', (event) => { if (touchStartX !== null && Math.abs(event.clientX - touchStartX) > 38) finishRip(); touchStartX = null; });
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
renderChallenges();
void repairLegacyInventory();
