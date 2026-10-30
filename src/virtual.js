import { POKEMON, REGIONS } from './data/pokemon.js';

const STORE = 'cardbuddy.virtual.v1';
const PACKS = [
  { id: 'starter', name: 'Starter', price: 100, cards: 5, theme: 'blue', odds: [60,25,12,2.5,.45,.05] },
  { id: 'premium', name: 'Premium', price: 200, cards: 5, theme: 'purple', odds: [40,25,20,10,4,1] },
  { id: 'elite', name: 'Elite', price: 350, cards: 6, theme: 'green', odds: [25,25,25,15,8,2] },
  { id: 'legendary', name: 'Legendary', price: 550, cards: 6, theme: 'gold', odds: [15,20,25,20,15,5] },
];
const RARITIES = ['Common','Uncommon','Rare','Epic','Legendary','Grail'];
const REGIONAL_PRICES = { starter: 125, premium: 250, elite: 425, legendary: 675 };
const REGION_VARIANTS = {
  Kanto: [{name:'Red',hue:150},{name:'Green',hue:270},{name:'Blue',hue:0},{name:'Yellow',hue:210}],
  Johto: [{name:'Gold',hue:38},{name:'Silver',hue:0},{name:'Crystal',hue:190},{name:'SoulSilver',hue:215}],
  Hoenn: [{name:'Ruby',hue:345},{name:'Sapphire',hue:210},{name:'Emerald',hue:125},{name:'Omega',hue:285}],
  Sinnoh: [{name:'Diamond',hue:205},{name:'Pearl',hue:330},{name:'Platinum',hue:0},{name:'Legends',hue:45}],
  Unova: [{name:'Black',hue:0},{name:'White',hue:0},{name:'Black 2',hue:215},{name:'White 2',hue:180}],
  Kalos: [{name:'X',hue:0},{name:'Y',hue:345},{name:'Central',hue:195},{name:'Coastal',hue:125}],
  Alola: [{name:'Sun',hue:38},{name:'Moon',hue:245},{name:'Ultra Sun',hue:18},{name:'Ultra Moon',hue:275}],
  Galar: [{name:'Sword',hue:0},{name:'Shield',hue:210},{name:'Crown',hue:190},{name:'Isle',hue:125}],
  Paldea: [{name:'Scarlet',hue:345},{name:'Violet',hue:255},{name:'Teal',hue:150},{name:'Indigo',hue:225}],
};
const $ = (id) => document.getElementById(id);
const safeParse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
const freshState = () => ({ coins: 100, inventory: [], packsOpened: 0, unlockedPokemon: [], daily: { date: today(), checkin: false, firstPack: false, firstPackEarned: false, fivePacks: false, fivePacksEarned: false, packsOpened: 0 }, history: [] });
let state = safeParse(localStorage.getItem(STORE)) || freshState();
if (!Array.isArray(state.inventory)) state.inventory = [];
if (!Array.isArray(state.unlockedPokemon)) state.unlockedPokemon = [];
if (!Array.isArray(state.tradeHistory)) state.tradeHistory = [];
let tradeCatalogue = null;
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
function packMarkup(pack, small = false, variant = null) {
  const assetId = pack.baseId || pack.id;
  const hue = variant?.hue ?? 0;
  const tint = hue ? ' style="filter:hue-rotate(' + hue + 'deg) saturate(1.18)"' : '';
  return '<div class="virtual-pack-face ' + pack.theme + (small ? ' compact' : '') + (pack.regional ? ' regional-foil' : '') + '"><img' + tint + ' src="assets/packs/cardbuddy-' + assetId + '.svg" alt="' + pack.name + (variant ? ' ' + variant.name : '') + ' CardBuddy booster pack" loading="lazy"></div>';
}
function renderPackCards(root, packs, regional = false) {
  root.replaceChildren(...packs.map((pack) => {
    const card = document.createElement('article');
    card.className = 'virtual-pack-card' + (regional ? ' regional-pack-card' : '');
    const sub = regional ? pack.region + ' Pokémon only · any card set or artwork' : pack.cards + ' virtual cards · improved high-rarity odds';
    card.innerHTML = packMarkup(pack) + '<div class="virtual-pack-meta"><h4>' + pack.name + ' Pack</h4><p>' + sub + '</p><div class="virtual-pack-buy"><strong>🪙 ' + pack.price + '</strong><button type="button" ' + (state.coins < pack.price ? 'disabled' : '') + '>Choose pack</button></div></div>';
    card.querySelector('button').addEventListener('click', () => startPack(pack));
    return card;
  }));
}
function regionalPacks(region) {
  return PACKS.map((base) => ({
    ...base, id: 'regional-' + region.toLowerCase() + '-' + base.id, baseId: base.id,
    name: region + ' ' + base.name, price: REGIONAL_PRICES[base.id], region, regional: true,
    variants: REGION_VARIANTS[region] || [{name:'Classic',hue:0},{name:'Light',hue:35},{name:'Deep',hue:210},{name:'Bright',hue:125}],
  }));
}
function renderPacks() {
  renderPackCards($('virtualPackGrid'), PACKS);
  renderRegionalPacks();
}
function renderRegionalPacks() {
  const region = $('virtualRegionalPackRegion').value || REGIONS[0];
  renderPackCards($('virtualRegionalPackGrid'), regionalPacks(region), true);
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
    const cacheKey = 'cardbuddy.tcgdex.catalogue.v4';
    const sessionCache = safeParse(sessionStorage.getItem(cacheKey));
    const savedCache = safeParse(localStorage.getItem(cacheKey));
    const legacyCache = safeParse(sessionStorage.getItem('cardbuddy.tcgdex.catalogue.v3')) || safeParse(localStorage.getItem('cardbuddy.tcgdex.catalogue.v3'));
    if (Array.isArray(sessionCache) && sessionCache.length) return sessionCache;
    if (Array.isArray(legacyCache) && legacyCache.length) {
      try { sessionStorage.setItem(cacheKey, JSON.stringify(legacyCache)); } catch {}
      try { localStorage.setItem(cacheKey, JSON.stringify(legacyCache)); } catch {}
      return legacyCache;
    }
    if (Array.isArray(savedCache) && savedCache.length) {
      try { sessionStorage.setItem(cacheKey, JSON.stringify(savedCache)); } catch {}
      return savedCache;
    }
    let cards = null;
    try {
      const response = await fetch('https://api.tcgdex.net/v2/en/cards');
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload)) cards = payload.filter((card) => card.image && card.name && card.id);
      }
    } catch { /* Use a previously saved catalogue when the API is offline. */ }
    if (!cards?.length) throw new Error('TCGdex card catalogue is unavailable');
    try { sessionStorage.setItem(cacheKey, JSON.stringify(cards)); } catch {}
    try { localStorage.setItem(cacheKey, JSON.stringify(cards)); } catch {}
    return cards;
  })().catch((error) => { cardCataloguePromise = null; throw error; });
  return cardCataloguePromise;
}
const regionalCataloguePromises = new Map();
async function loadRegionalCatalogue(region) {
  if (regionalCataloguePromises.has(region)) return regionalCataloguePromises.get(region);
  const promise = (async () => {
    const key = 'cardbuddy.tcgdex.region.v1.' + region.toLowerCase();
    const cached = safeParse(sessionStorage.getItem(key)) || safeParse(localStorage.getItem(key));
    if (Array.isArray(cached) && cached.length) {
      try { sessionStorage.setItem(key, JSON.stringify(cached)); } catch {}
      return cached;
    }
    const dexNumbers = POKEMON.filter((pokemon) => pokemon.region === region).map((pokemon) => pokemon.dexNumber);
    if (!dexNumbers.length) throw new Error('Unknown Pokédex region');
    let cards = [];
    try {
      const url = 'https://api.tcgdex.net/v2/en/cards?dexId=' + encodeURIComponent('eq:' + dexNumbers.join('|'));
      const response = await fetch(url);
      if (response.ok) {
        const payload = await response.json();
        cards = Array.isArray(payload) ? payload.filter((card) => card.id && card.name && card.image) : [];
      }
    } catch { /* Try the saved all-card catalogue as a local fallback. */ }
    if (!cards.length) {
      const allCards = await loadCardCatalogue();
      const regionIds = new Set(dexNumbers);
      cards = allCards.filter((brief) => {
        const species = matchPokemon(brief.name);
        return species && regionIds.has(species.dexNumber);
      });
    }
    if (!cards.length) throw new Error('No cards are listed for ' + region);
    try { sessionStorage.setItem(key, JSON.stringify(cards)); } catch {}
    try { localStorage.setItem(key, JSON.stringify(cards)); } catch {}
    return cards;
  })().catch((error) => { regionalCataloguePromises.delete(region); throw error; });
  regionalCataloguePromises.set(region, promise);
  return promise;
}
async function fetchCardDetail(brief) {
  const key = 'cardbuddy.tcgdex.card.v1.' + brief.id;
  try {
    const response = await fetch('https://api.tcgdex.net/v2/en/cards/' + encodeURIComponent(brief.id));
    if (response.ok) {
      const detail = await response.json();
      const full = { ...brief, ...detail, image: detail.image || brief.image };
      try { localStorage.setItem(key, JSON.stringify(full)); } catch {}
      return full;
    }
  } catch { /* Reuse a previously retrieved full card when the API is offline. */ }
  const cached = safeParse(localStorage.getItem(key));
  return cached && cached.category === 'Pokemon' ? cached : brief;
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
  const catalogue = pack.regional ? await loadRegionalCatalogue(pack.region) : await loadCardCatalogue();
  const pokemonBriefs = catalogue.filter((brief) => matchPokemon(brief.name) && brief.image && brief.id);
  if (!pokemonBriefs.length) throw new Error('No Pokémon cards are currently listed for this pack');
  const pulls = [];
  const used = new Set();
  for (let slot = 0; slot < pack.cards; slot++) {
    let accepted = null;
    for (let attempt = 0; attempt < 35 && !accepted; attempt++) {
      const candidates = pokemonBriefs.filter((brief) => !used.has(brief.id));
      const pool = candidates.length ? candidates : pokemonBriefs;
      const brief = pool[Math.floor(Math.random() * pool.length)];
      try {
        const source = await fetchCardDetail(brief);
        const dexIds = Array.isArray(source.dexId) ? source.dexId.map(Number) : (source.dexId == null ? [] : [Number(source.dexId)]);
        const species = POKEMON.find((pokemon) => dexIds.includes(pokemon.dexNumber)) || matchPokemon(source.name);
        if (source.category !== 'Pokemon' || !species) continue;
        if (pack.regional && species.region !== pack.region) continue;
        accepted = { source, species };
        used.add(brief.id);
      } catch { /* Try another Pokémon card. */ }
    }
    if (!accepted) throw new Error('Could not find enough eligible Pokémon cards');
    const { source, species } = accepted;
    const rarityIndex = rollRarity(pack);
    pulls.push({
      id: uid(), pokemonId: species.id, dexNumber: species.dexNumber, pokemonName: species.name,
      name: source.name || species.name, cardId: source.id || null, image: imageForCard(source),
      setName: source?.set?.name || '', cardNumber: source?.localId || '', rarity: RARITIES[rarityIndex],
      rarityIndex, pack: pack.id, region: pack.region || species.region, obtainedAt: new Date().toISOString(),
    });
  }
  return pulls;
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
function startPack(packOrId) {
  currentPack = typeof packOrId === 'string' ? PACKS.find((pack) => pack.id === packOrId) : packOrId;
  if (!currentPack || state.coins < currentPack.price) return;
  state.coins -= currentPack.price;
  save();
  ripStarted = false;
  currentPack.choiceVariants = currentPack.regional
    ? Array.from({length:8},(_,i)=>currentPack.variants[i % currentPack.variants.length]).sort(()=>Math.random()-.5)
    : Array.from({length:8},()=>({name:'Classic',hue:0}));
  $('virtualCloseRip').hidden = false;
  $('virtualRipOverlay').hidden = false;
  $('virtualChoiceGrid').hidden = false;
  $('virtualSelectedPack').hidden = true;
  $('virtualReveal').hidden = true;
  $('virtualRipInstruction').textContent = currentPack.regional ? 'Choose your ' + currentPack.region + ' pack design' : 'Choose one of your eight packs';
  $('virtualChoiceGrid').replaceChildren(...Array.from({ length: 8 }, (_, index) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'virtual-choice';
    choice.setAttribute('aria-label', 'Choose ' + currentPack.choiceVariants[index].name + ' pack ' + (index + 1));
    choice.innerHTML = packMarkup(currentPack, true, currentPack.choiceVariants[index]);
    choice.addEventListener('click', () => choosePack(index));
    return choice;
  }));
}
function choosePack(index = 0) {
  const variant = currentPack.choiceVariants?.[index] || {name:'Classic',hue:0};
  currentPack.selectedVariant = variant;
  $('virtualChoiceGrid').hidden = true;
  $('virtualSelectedPack').hidden = false;
  $('virtualRipInstruction').textContent = 'Your ' + currentPack.name + (currentPack.regional ? ' · ' + variant.name : '') + ' pack is ready';
  $('virtualPackArtwork').className = 'virtual-pack-art ' + currentPack.theme + (currentPack.regional ? ' regional-foil' : '');
  $('virtualPackArtwork').style.backgroundImage = 'url("assets/packs/cardbuddy-' + (currentPack.baseId || currentPack.id) + '.svg")';
  $('virtualPackArtwork').style.filter = variant.hue ? 'hue-rotate(' + variant.hue + 'deg) saturate(1.18)' : '';
}
async function finishRip() {
  if (!currentPack || ripStarted || $('virtualReveal').hidden === false) return;
  ripStarted = true;
  $('virtualCloseRip').hidden = true;
  $('virtualRipInstruction').textContent = 'The seal is breaking…';
  $('virtualSelectedPack').classList.add('is-ripping');
  try { pendingCards = await generateCards(currentPack); }
  catch (error) {
    // Refund exactly once. Clear the paid pack so closing the overlay cannot
    // refund the same purchase again.
    const failedPack = currentPack;
    if (failedPack) state.coins += failedPack.price;
    currentPack = null;
    pendingCards = [];
    save(); ripStarted = false;
    $('virtualSelectedPack').classList.remove('is-ripping');
    $('virtualRipInstruction').textContent = 'Card scans are temporarily unavailable. Your coins have been returned once. Please try again shortly.';
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
  state.history.unshift({ date: new Date().toISOString(), pack: currentPack.id, region: currentPack.region || null, cards: pendingCards.map((card) => card.id) });
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

const TRADE_NPCS = {
  mystery: { name: 'Mystery Trader', description: 'Offer a card and receive a random card from the same rarity tier.' },
  general: { name: 'General Collector', description: 'Choose any Pokémon card from the catalogue. The rarity tier must match.' },
  kanto: { name: 'Kanto Keeper', description: 'Accepts cards from any region, but only offers Kanto Pokémon of matching rarity.' },
};
function tradeRarity(card) {
  const index = Number.isInteger(card?.rarityIndex) ? card.rarityIndex : 0;
  return Math.max(0, Math.min(RARITIES.length - 1, index));
}
function tradeSpecies(card) {
  return POKEMON.find((pokemon) => pokemon.id === card.pokemonId)
    || POKEMON.find((pokemon) => pokemon.dexNumber === Number(card.dexNumber))
    || matchPokemon(card.name);
}
function tradeCardFromBrief(brief, rarityIndex) {
  const species = matchPokemon(brief.name);
  if (!species) return null;
  return {
    id: uid(), pokemonId: species.id, dexNumber: species.dexNumber, pokemonName: species.name,
    name: brief.name || species.name, cardId: brief.id || null, image: imageForCard(brief),
    setName: brief.set?.name || '', cardNumber: brief.localId || '',
    rarity: RARITIES[rarityIndex], rarityIndex, pack: 'npc-trade',
    region: species.region, obtainedAt: new Date().toISOString(),
  };
}
async function ensureTradeCatalogue() {
  if (tradeCatalogue) return tradeCatalogue;
  tradeCatalogue = loadCardCatalogue().then(cards => cards.filter(card => card?.id && card?.name && card?.image && matchPokemon(card.name)));
  return tradeCatalogue;
}
function renderTradeOptions() {
  const offer = $('virtualTradeOffer');
  const target = $('virtualTradeTarget');
  const npc = $('virtualTradeNpc').value;
  const offered = state.inventory.find(card => card.id === offer.value);
  const tier = offered ? tradeRarity(offered) : null;
  const inventory = [...state.inventory].sort((a,b) => a.name.localeCompare(b.name));
  offer.replaceChildren(new Option('Choose a card you own…',''), ...inventory.map(card =>
    new Option(card.name + ' · ' + RARITIES[tradeRarity(card)] + (state.inventory.filter(item => item.cardId === card.cardId).length === 1 ? ' · last copy' : ''), card.id)
  ));
  if (offered && state.inventory.some(card => card.id === offered.id)) offer.value = offered.id;
  const catalogue = tradeCatalogue || [];
  const eligible = offered ? catalogue.filter(brief => {
    const species = matchPokemon(brief.name);
    return brief.id !== offered.cardId && (npc !== 'kanto' || species?.region === 'Kanto');
  }) : [];
  const previous = target.value;
  target.replaceChildren(new Option(npc === 'mystery' ? 'Random matching card' : 'Choose a return card…', ''));
  if (npc !== 'mystery' && offered) {
    eligible.forEach(brief => target.add(new Option(brief.name + ' · ' + (brief.set?.name || brief.id), brief.id)));
    if (eligible.some(brief => brief.id === previous)) target.value = previous;
  }
  target.disabled = !offered || npc === 'mystery';
  $('virtualTradeRule').textContent = TRADE_NPCS[npc].description + (offered ? ' Offered rarity: ' + RARITIES[tier] + '.' : '');
  $('virtualTradeButton').disabled = !offered || (npc !== 'mystery' && !target.value);
  $('virtualTradeHistory').replaceChildren(...state.tradeHistory.slice(0,15).map(entry => {
    const row = document.createElement('article'); row.className = 'virtual-trade-history-row';
    const give = document.createElement('span'); give.textContent = 'Gave: ' + entry.gave + ' · ' + entry.gaveRarity;
    const receive = document.createElement('strong'); receive.textContent = 'Received: ' + entry.got + ' · ' + entry.gotRarity;
    const who = document.createElement('small'); who.textContent = entry.npc + ' · ' + new Date(entry.date).toLocaleDateString('en-GB');
    row.append(give, receive, who); return row;
  }));
  if (!state.tradeHistory.length) {
    const empty = document.createElement('p'); empty.className = 'note'; empty.textContent = 'No trades yet. Your first swap is waiting.'; $('virtualTradeHistory').append(empty);
  }
}
async function prepareTradeCatalogue() {
  $('virtualTradeRule').textContent = 'Loading the card catalogue…';
  try { await ensureTradeCatalogue(); renderTradeOptions(); }
  catch { $('virtualTradeRule').textContent = 'The card catalogue is unavailable right now. Try again shortly.'; }
}
function renderTradeHub() {
  renderTradeOptions();
  void prepareTradeCatalogue();
}
let pendingNpcTrade = null;
async function makeNpcTrade() {
  const button = $('virtualTradeButton');
  if (button.disabled) return;
  const offer = $('virtualTradeOffer').value;
  const offered = state.inventory.find(card => card.id === offer);
  const npc = $('virtualTradeNpc').value;
  if (!offered) { $('virtualTradeRule').textContent = 'Choose a card you actually own.'; return; }
  const tier = tradeRarity(offered);
  button.disabled = true;
  button.textContent = 'Preparing trade…';
  try {
    const catalogue = await ensureTradeCatalogue();
    const pool = catalogue.filter(brief => {
      const species = matchPokemon(brief.name);
      return brief.id !== offered.cardId && (npc !== 'kanto' || species?.region === 'Kanto');
    });
    if (!pool.length) { $('virtualTradeRule').textContent = 'No eligible return cards are available right now.'; return; }
    const chosenId = npc === 'mystery' ? null : $('virtualTradeTarget').value;
    const brief = chosenId ? pool.find(card => card.id === chosenId) : pool[Math.floor(Math.random() * pool.length)];
    if (!brief) { $('virtualTradeRule').textContent = 'Choose a valid return card.'; return; }
    const returnCard = tradeCardFromBrief(brief, tier);
    if (!returnCard) { $('virtualTradeRule').textContent = 'That return card could not be prepared. Please choose another.'; return; }
    const lastCopy = state.inventory.filter(card => card.cardId === offered.cardId).length <= 1;
    pendingNpcTrade = { offeredId: offered.id, returnCard, npc, tier };
    $('virtualTradeReviewText').textContent = 'You will give ' + offered.name + ' (' + RARITIES[tier] + ') and receive ' + returnCard.name + ' (' + RARITIES[tier] + ') from ' + TRADE_NPCS[npc].name + '.' + (lastCopy ? ' This is your last copy.' : '');
    $('virtualTradeReview').showModal();
  } catch (error) {
    console.error('NPC trade preparation failed:', error);
    $('virtualTradeRule').textContent = 'The trade could not be prepared. No cards have been exchanged. Please try again.';
  } finally {
    button.textContent = 'Review and trade';
    renderTradeOptions();
  }
}
function completeNpcTrade() {
  if (!pendingNpcTrade) return;
  const { offeredId, returnCard, npc, tier } = pendingNpcTrade;
  const currentIndex = state.inventory.findIndex(card => card.id === offeredId);
  if (currentIndex < 0) {
    $('virtualTradeRule').textContent = 'That card is no longer in your inventory. No trade was made.';
    pendingNpcTrade = null;
    $('virtualTradeReview').close();
    renderTradeOptions();
    return;
  }
  const offered = state.inventory[currentIndex];
  state.inventory.splice(currentIndex, 1);
  state.inventory.push(returnCard);
  if (returnCard.pokemonId && !state.unlockedPokemon.includes(returnCard.pokemonId)) state.unlockedPokemon.push(returnCard.pokemonId);
  state.tradeHistory.unshift({
    gave: offered.name, gaveRarity: RARITIES[tier], got: returnCard.name, gotRarity: RARITIES[tier],
    npc: TRADE_NPCS[npc].name, date: new Date().toISOString(),
  });
  state.tradeHistory = state.tradeHistory.slice(0,100);
  pendingNpcTrade = null;
  $('virtualTradeReview').close();
  save();
  window.dispatchEvent(new CustomEvent('cardbuddy-virtual-inventory-updated'));
  renderTradeOptions();
  renderPacks();
  $('virtualTradeRule').textContent = 'Trade complete! ' + returnCard.name + ' has been added to your virtual collection.';
}

function setVirtualView(view) {
  for (const [name, id] of [['packs','virtualPacksView'],['binder','virtualBinderView'],['pokedex','virtualPokedexView'],['rewards','virtualRewardsView'],['trades','virtualTradesView']]) $(id).hidden = name !== view;
  document.querySelectorAll('[data-virtual-view]').forEach((button) => button.classList.toggle('active', button.dataset.virtualView === view));
  if (view === 'packs') renderPacks();
  if (view === 'pokedex') window.dispatchEvent(new CustomEvent('cardbuddy-virtual-pokedex-render'));
  if (view === 'binder') window.dispatchEvent(new CustomEvent('cardbuddy-virtual-binder-render'));
  if (view === 'rewards') renderChallenges();
  if (view === 'trades') renderTradeHub();
}
document.querySelectorAll('[data-virtual-view]').forEach((button) => {
  button.addEventListener('click', () => setVirtualView(button.dataset.virtualView));
});
$('virtualCheckin').addEventListener('click', () => setVirtualView('rewards'));
$('virtualTradeNpc').addEventListener('change', renderTradeOptions);
$('virtualTradeOffer').addEventListener('change', renderTradeOptions);
$('virtualTradeTarget').addEventListener('change', renderTradeOptions);
$('virtualTradeButton').addEventListener('click', makeNpcTrade);
$('virtualTradeConfirm').addEventListener('click', completeNpcTrade);
$('virtualTradeCancel').addEventListener('click', () => { pendingNpcTrade = null; $('virtualTradeReview').close(); });
$('virtualTradeReview').addEventListener('cancel', () => { pendingNpcTrade = null; });
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
$('virtualRegionalPackRegion').replaceChildren(...REGIONS.map((region) => new Option(region, region)));
$('virtualRegionalPackRegion').addEventListener('change', renderRegionalPacks);
renderPacks();
renderChallenges();
void repairLegacyInventory();
