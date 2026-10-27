// Local-only storage. Legacy single collection key (never deleted or modified by migration):
export const STORAGE_KEY = 'pokemon-collection-tracker:v1';
// Profile metadata and per-profile collections are stored separately, keyed by stable profile id.
export const PROFILES_KEY = 'pokemon-collection-tracker:profiles:v2';
export const collectionKey = (profileId) => `pokemon-collection-tracker:collection:v2:${profileId}`;

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function readJSON(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Legacy-compatible helpers: operate on an arbitrary key (default: legacy key).
export function loadCollection(storage = globalThis.localStorage, key = STORAGE_KEY) {
  const parsed = readJSON(storage, key);
  return isPlainObject(parsed) ? parsed : {};
}

export function saveCollection(collection, storage = globalThis.localStorage, key = STORAGE_KEY) {
  return writeJSON(storage, key, collection);
}

function newId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return `p-${c.randomUUID()}`;
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function validMeta(m) {
  return isPlainObject(m) && isPlainObject(m.profiles) && Object.keys(m.profiles).length > 0
    && typeof m.activeId === 'string' && m.profiles[m.activeId];
}

// Loads profile metadata, migrating the legacy collection into a default profile only when
// no profile metadata exists yet. Safe to run repeatedly; never overwrites an existing collection.
export function loadProfiles(storage = globalThis.localStorage, makeId = newId) {
  const existing = readJSON(storage, PROFILES_KEY);
  if (validMeta(existing)) return existing;
  // Repair: profiles map present but activeId stale.
  if (isPlainObject(existing) && isPlainObject(existing.profiles) && Object.keys(existing.profiles).length) {
    const meta = { ...existing, activeId: Object.keys(existing.profiles)[0] };
    writeJSON(storage, PROFILES_KEY, meta);
    return meta;
  }
  const id = makeId();
  const meta = { version: 2, activeId: id, profiles: { [id]: { id, name: 'My Collection', createdAt: Date.now() } } };
  // Copy legacy data (if any) without touching the legacy key; never clobber an existing profile collection.
  if (storage.getItem(collectionKey(id)) === null) {
    saveCollection(loadCollection(storage), storage, collectionKey(id));
  }
  writeJSON(storage, PROFILES_KEY, meta);
  return meta;
}

export function saveProfiles(meta, storage = globalThis.localStorage) {
  return writeJSON(storage, PROFILES_KEY, meta);
}

export function createProfile(meta, name, storage = globalThis.localStorage, makeId = newId) {
  const clean = String(name || '').trim().slice(0, 40) || 'New collection';
  let id = makeId();
  while (meta.profiles[id] || storage.getItem(collectionKey(id)) !== null) id = makeId();
  const next = {
    ...meta,
    activeId: id,
    profiles: { ...meta.profiles, [id]: { id, name: clean, createdAt: Date.now() } },
  };
  saveCollection({}, storage, collectionKey(id));
  saveProfiles(next, storage);
  return next;
}

export function switchProfile(meta, id, storage = globalThis.localStorage) {
  if (!meta.profiles[id]) return meta;
  const next = { ...meta, activeId: id };
  saveProfiles(next, storage);
  return next;
}

export const loadProfileCollection = (id, storage = globalThis.localStorage) =>
  loadCollection(storage, collectionKey(id));
export const saveProfileCollection = (id, collection, storage = globalThis.localStorage) =>
  saveCollection(collection, storage, collectionKey(id));


// Rename or remove one profile without touching any other saved collection.
export function renameProfile(meta, id, name, storage = globalThis.localStorage) {
  if (!meta.profiles[id]) return meta;
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return meta;
  const next = { ...meta, profiles: { ...meta.profiles, [id]: { ...meta.profiles[id], name: clean } } };
  saveProfiles(next, storage);
  return next;
}

export function deleteProfile(meta, id, storage = globalThis.localStorage) {
  if (!meta.profiles[id] || Object.keys(meta.profiles).length <= 1) return meta;
  const profiles = { ...meta.profiles };
  delete profiles[id];
  // Only the explicitly selected profile's collection is removed. Other collections and the legacy key remain untouched.
  try { storage.removeItem(collectionKey(id)); } catch { return meta; }
  const activeId = meta.activeId === id ? Object.keys(profiles)[0] : meta.activeId;
  const next = { ...meta, activeId, profiles };
  saveProfiles(next, storage);
  return next;
}
