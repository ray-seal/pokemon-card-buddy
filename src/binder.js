const DB_NAME = 'pokemon-card-buddy-binders';
const DB_VERSION = 1;
const STORE = 'binders';
const $ = (id) => document.getElementById(id);
let db;
let binders = [];
let activeId = null;
let pageIndex = 0;
let turning = false;
let touchStartX = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function allBinders() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function saveBinder(binder) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(binder);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
}
function uid() { return globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2); }
function newPage() { return { id: uid(), slots: Array(9).fill(null) }; }
function activeBinder() { return binders.find((b) => b.id === activeId); }
function slotCard(slot, index) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'binder-slot' + (slot?.type === 'wanted' ? ' wanted-slot' : '');
  el.dataset.slot = index;
  if (slot?.type === 'card' && slot.data) {
    const img = document.createElement('img');
    img.src = slot.data;
    img.alt = slot.name || 'Collection card';
    el.append(img);
    const label = document.createElement('span');
    label.className = 'slot-caption';
    label.textContent = slot.name || 'Card';
    el.append(label);
  } else if (slot?.type === 'wanted') {
    const poster = document.createElement('span');
    poster.className = 'wanted-poster';
    const heading = document.createElement('strong'); heading.textContent = 'WANTED';
    const name = document.createElement('span'); name.textContent = slot.name || 'Mystery Pokémon';
    const number = document.createElement('small'); number.textContent = slot.number ? '#' + String(slot.number).padStart(4, '0') : 'Add a target';
    poster.append(heading, document.createElement('span'), name, number);
    el.append(poster);
  } else {
    const plus = document.createElement('span'); plus.className = 'slot-plus'; plus.textContent = '+';
    const label = document.createElement('span'); label.textContent = 'Add card';
    el.append(plus, label);
  }
  el.addEventListener('click', () => editSlot(index));
  el.draggable = !!slot;
  el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); el.classList.remove('drop-target');
    const from = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isInteger(from) || from === index) return;
    const binder = activeBinder(); const slots = binder.pages[pageIndex].slots;
    [slots[from], slots[index]] = [slots[index], slots[from]];
    await saveBinder(binder); render();
  });
  return el;
}
function render() {
  const binder = activeBinder();
  const select = $('binderSelect');
  select.replaceChildren(...binders.map((b) => new Option(b.name, b.id)));
  if (activeId) select.value = activeId;
  $('binderName').textContent = binder?.name || 'My Binder';
  $('binderPageCount').textContent = binder ? `Page ${pageIndex + 1} of ${binder.pages.length}` : 'Create a binder to get started';
  $('binderPages').replaceChildren();
  if (!binder) return;
  pageIndex = Math.max(0, Math.min(pageIndex, binder.pages.length - 1));
  const page = binder.pages[pageIndex];
  $('binderPages').replaceChildren(...page.slots.map((slot, i) => slotCard(slot, i)));
  $('prevBinderPage').disabled = pageIndex === 0;
  $('nextBinderPage').disabled = pageIndex >= binder.pages.length - 1;
  $('deleteBinderPage').disabled = binder.pages.length <= 1;
}
async function turn(delta) {
  const binder = activeBinder();
  if (!binder || turning) return;
  const next = pageIndex + delta;
  if (next < 0 || next >= binder.pages.length) return;
  turning = true;
  const spread = $('binderBook');
  spread.classList.add(delta > 0 ? 'turn-forward' : 'turn-back');
  await new Promise((resolve) => setTimeout(resolve, 360));
  pageIndex = next;
  render();
  spread.classList.remove('turn-forward', 'turn-back');
  turning = false;
}
async function editSlot(index) {
  const binder = activeBinder(); if (!binder) return;
  const existing = binder.pages[pageIndex].slots[index];
  const action = window.prompt('Slot action: type PHOTO, WANTED, REMOVE, or CANCEL', existing ? 'PHOTO' : 'PHOTO');
  if (!action || action.toUpperCase() === 'CANCEL') return;
  const choice = action.toUpperCase();
  if (choice === 'REMOVE') {
    binder.pages[pageIndex].slots[index] = null;
  } else if (choice === 'WANTED') {
    const name = window.prompt('Wanted Pokémon or card name:', existing?.name || '');
    if (!name?.trim()) return;
    const number = window.prompt('Optional Pokédex number (leave blank if not relevant):', existing?.number || '');
    binder.pages[pageIndex].slots[index] = { type: 'wanted', name: name.trim().slice(0, 80), number: number?.trim() || '' };
  } else if (choice === 'PHOTO') {
    const input = $('binderPhotoInput');
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const data = await compressImage(file);
        const name = window.prompt('Optional card name:', existing?.name || file.name.replace(/\.[^.]+$/, '')) ?? '';
        binder.pages[pageIndex].slots[index] = { type: 'card', data, name: name.slice(0, 80) };
        await saveBinder(binder); render();
      } catch { window.alert('That photo could not be loaded. Please try another image.'); }
    };
    input.click(); return;
  } else { window.alert('Choose PHOTO, WANTED, REMOVE or CANCEL.'); return; }
  await saveBinder(binder); render();
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1000; const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    img.src = url;
  });
}
async function init() {
  const section = $('binderSection');
  if (!section) return;
  try { db = await openDb(); binders = await allBinders(); }
  catch { $('binderStatus').textContent = 'Local photo storage is unavailable in this browser.'; return; }
  if (!binders.length) {
    const b = { id: uid(), name: 'My Binder', pages: [newPage()] };
    binders.push(b); activeId = b.id; await saveBinder(b);
  } else activeId = binders[0].id;
  $('newBinder').addEventListener('click', async () => {
    const name = window.prompt('Name this binder:'); if (!name?.trim()) return;
    const b = { id: uid(), name: name.trim().slice(0, 50), pages: [newPage()] };
    binders.push(b); activeId = b.id; pageIndex = 0; await saveBinder(b); render();
  });
  $('binderSelect').addEventListener('change', () => { activeId = $('binderSelect').value; pageIndex = 0; render(); });
  $('renameBinder').addEventListener('click', async () => {
    const b = activeBinder(); if (!b) return;
    const name = window.prompt('Rename binder:', b.name); if (!name?.trim()) return;
    b.name = name.trim().slice(0, 50); await saveBinder(b); render();
  });
  $('removeBinder').addEventListener('click', async () => {
    const b = activeBinder(); if (!b) return;
    if (!window.confirm(`Delete “${b.name}” and its binder photos? This cannot be undone. Your Pokédex collections will not be affected.`)) return;
    await new Promise((resolve, reject) => { const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(b.id); req.onsuccess = resolve; req.onerror = () => reject(req.error); });
    binders = await allBinders();
    if (!binders.length) { const fresh = { id: uid(), name: 'My Binder', pages: [newPage()] }; binders.push(fresh); await saveBinder(fresh); }
    activeId = binders[0].id; pageIndex = 0; render();
  });
  $('addBinderPage').addEventListener('click', async () => {
    const b = activeBinder(); if (!b) return;
    b.pages.splice(pageIndex + 1, 0, newPage()); pageIndex++; await saveBinder(b); render();
  });
  $('deleteBinderPage').addEventListener('click', async () => {
    const b = activeBinder(); if (!b || b.pages.length <= 1) return;
    if (!window.confirm('Delete this page and its slots?')) return;
    b.pages.splice(pageIndex, 1); pageIndex = Math.max(0, pageIndex - 1); await saveBinder(b); render();
  });
  $('prevBinderPage').addEventListener('click', () => turn(-1));
  $('nextBinderPage').addEventListener('click', () => turn(1));
  $('binderBook').addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
  $('binderBook').addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX; touchStartX = null;
    if (Math.abs(dx) > 55) turn(dx < 0 ? 1 : -1);
  }, { passive: true });
  render();
}
init();
