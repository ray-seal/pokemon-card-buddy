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
let draggedSlot = null;
let edgeTurnTimer = null;

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
function ensureInventory(binder) {
  if (!Array.isArray(binder.collectionItems)) binder.collectionItems = [];
  for (const page of binder.pages || []) for (const slot of page.slots || []) {
    if (!slot || slot.collectionItemId) continue;
    slot.collectionItemId = uid();
    binder.collectionItems.push({ id: slot.collectionItemId, type: slot.type, name: slot.name || '', number: slot.number || '', owned: slot.type === 'card', wanted: slot.type === 'wanted' });
  }
}
function syncItem(binder, slot) {
  ensureInventory(binder);
  if (!slot.collectionItemId) slot.collectionItemId = uid();
  const value = { id: slot.collectionItemId, type: slot.type, name: slot.name || '', number: slot.number || '', owned: slot.type === 'card', wanted: slot.type === 'wanted' };
  const item = binder.collectionItems.find((entry) => entry.id === value.id);
  if (item) Object.assign(item, value); else binder.collectionItems.push(value);
}
async function removeSlot(index) {
  const binder = activeBinder();
  const slot = binder?.pages[pageIndex]?.slots[index];
  if (!binder || !slot) return;
  const choice = window.prompt('Remove this item how?\\n\\n1 = Binder only (keep in collection)\\n2 = Binder and collection\\n3 = Move to another binder\\n4 = Cancel', '1');
  if (!choice || choice.trim() === '4') return;
  if (choice.trim() === '1') {
    binder.pages[pageIndex].slots[index] = null;
    await saveBinder(binder);
  } else if (choice.trim() === '2') {
    if (!window.confirm('Remove this specific entry from the linked collection too? Other copies will be kept.')) return;
    ensureInventory(binder);
    binder.collectionItems = binder.collectionItems.filter((item) => item.id !== slot.collectionItemId);
    binder.pages[pageIndex].slots[index] = null;
    await saveBinder(binder);
  } else if (choice.trim() === '3') {
    const destinations = binders.filter((item) => item.id !== binder.id);
    if (!destinations.length) { window.alert('Create another binder first, then you can move items between binders.'); return; }
    const options = destinations.map((item, i) => (i + 1) + ' = ' + item.name).join('\\n');
    const answer = window.prompt('Move to which binder?\\n\\n' + options + '\\n\\nEnter a number:');
    if (answer === null || !answer.trim()) return;
    const destination = destinations[Number(answer) - 1];
    if (!destination) { window.alert('That binder number is not valid.'); return; }
    ensureInventory(binder); ensureInventory(destination);
    const item = binder.collectionItems.find((entry) => entry.id === slot.collectionItemId);
    const movedSlot = { ...slot, collectionItemId: uid() };
    if (item) {
      binder.collectionItems = binder.collectionItems.filter((entry) => entry.id !== item.id);
      destination.collectionItems.push({ ...item, id: movedSlot.collectionItemId });
    } else syncItem(destination, movedSlot);
    let targetPage = destination.pages.find((page) => page.slots.some((entry) => !entry));
    if (!targetPage) { targetPage = newPage(); destination.pages.push(targetPage); }
    targetPage.slots[targetPage.slots.findIndex((entry) => !entry)] = movedSlot;
    binder.pages[pageIndex].slots[index] = null;
    await saveBinder(binder); await saveBinder(destination);
    activeId = destination.id;
    pageIndex = destination.pages.indexOf(targetPage);
  } else { window.alert('Please enter 1, 2, 3 or 4.'); return; }
  render();
}
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
  if (slot) {
    const remove = document.createElement('span');
    remove.className = 'slot-remove';
    remove.textContent = '×';
    remove.title = 'Remove this card or wanted poster';
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', 'Remove this slot');
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeSlot(index);
    });
    el.append(remove);
  }
  el.draggable = !!slot;
  el.addEventListener('dragstart', (e) => { draggedSlot = { pageIndex, slotIndex: index }; e.dataTransfer.setData('text/plain', JSON.stringify(draggedSlot)); e.dataTransfer.effectAllowed = 'move'; $('binderBook').classList.add('is-dragging'); });
  el.addEventListener('dragend', () => { draggedSlot = null; clearTimeout(edgeTurnTimer); $('binderBook').classList.remove('is-dragging'); document.querySelectorAll('.binder-drop-edge').forEach((edge) => edge.classList.remove('edge-active')); });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); el.classList.remove('drop-target');
    let source;
    try { source = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!source || !Number.isInteger(source.pageIndex) || !Number.isInteger(source.slotIndex)) return;
    if (source.pageIndex === pageIndex && source.slotIndex === index) return;
    const binder = activeBinder();
    const fromSlots = binder.pages[source.pageIndex]?.slots;
    const toSlots = binder.pages[pageIndex]?.slots;
    if (!fromSlots || !toSlots || !fromSlots[source.slotIndex]) return;
    [fromSlots[source.slotIndex], toSlots[index]] = [toSlots[index], fromSlots[source.slotIndex]];
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
  const action = window.prompt('What would you like in this pocket?\n\n1 = Add / replace card photo\n2 = Add wanted poster\n3 = Remove / move this item\n4 = Cancel\n\nEnter 1, 2, 3 or 4:', existing ? '1' : '1');
  if (!action || action.trim() === '4') return;
  const choice = ({ '1': 'PHOTO', '2': 'WANTED', '3': 'REMOVE' })[action.trim()] || action.toUpperCase();
  if (choice === 'REMOVE') {
    await removeSlot(index); return;
  } else if (choice === 'WANTED') {
    const name = window.prompt('Wanted Pokémon or card name:', existing?.name || '');
    if (!name?.trim()) return;
    const number = window.prompt('Optional Pokédex number (leave blank if not relevant):', existing?.number || '');
    binder.pages[pageIndex].slots[index] = { type: 'wanted', collectionItemId: existing?.collectionItemId || uid(), name: name.trim().slice(0, 80), number: number?.trim() || '' };
    syncItem(binder, binder.pages[pageIndex].slots[index]);
  } else if (choice === 'PHOTO') {
    const input = $('binderPhotoInput');
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const data = await compressImage(file);
        const name = window.prompt('Optional card name:', existing?.name || file.name.replace(/\.[^.]+$/, '')) ?? '';
        binder.pages[pageIndex].slots[index] = { type: 'card', collectionItemId: existing?.collectionItemId || uid(), data, name: name.slice(0, 80) };
        syncItem(binder, binder.pages[pageIndex].slots[index]);
        await saveBinder(binder); render();
      } catch { window.alert('That photo could not be loaded. Please try another image.'); }
    };
    input.click(); return;
  } else { window.alert('Please enter 1, 2, 3 or 4.'); return; }
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
    const b = { id: uid(), name: 'My Binder', pages: [newPage()], collectionItems: [] };
    binders.push(b); activeId = b.id; await saveBinder(b);
  } else activeId = binders[0].id;
  for (const binder of binders) { ensureInventory(binder); await saveBinder(binder); }
  $('newBinder').addEventListener('click', async () => {
    const name = window.prompt('Name this binder:'); if (!name?.trim()) return;
    const b = { id: uid(), name: name.trim().slice(0, 50), pages: [newPage()], collectionItems: [] };
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
    if (!binders.length) { const fresh = { id: uid(), name: 'My Binder', pages: [newPage()], collectionItems: [] }; binders.push(fresh); await saveBinder(fresh); }
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
  document.querySelectorAll('.binder-drop-edge').forEach((edge) => {
    edge.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!draggedSlot || edgeTurnTimer) return;
      edge.classList.add('edge-active');
      const delta = edge.dataset.direction === 'next' ? 1 : -1;
      edgeTurnTimer = setTimeout(async () => {
        edgeTurnTimer = null;
        await turn(delta);
        edge.classList.remove('edge-active');
      }, 450);
    });
    edge.addEventListener('dragleave', () => { clearTimeout(edgeTurnTimer); edgeTurnTimer = null; edge.classList.remove('edge-active'); });
    edge.addEventListener('drop', (event) => { event.preventDefault(); clearTimeout(edgeTurnTimer); edgeTurnTimer = null; edge.classList.remove('edge-active'); });
  });
  $('binderBook').addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
  $('binderBook').addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX; touchStartX = null;
    if (Math.abs(dx) > 55) turn(dx < 0 ? 1 : -1);
  }, { passive: true });
  render();
}
init();
