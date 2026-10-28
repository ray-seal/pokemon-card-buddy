const SUPABASE_URL = 'https://ojnpdosscasvolfhsreh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-I4mu6G34EOY6BxGuDZU6w_cmG-xn9T';
let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    );
  }
  return clientPromise;
}

export async function watchAuth(callback) {
  const client = await getClient();
  return client.auth.onAuthStateChange((_event, session) => callback(session?.user || null));
}

export async function currentUser() {
  const client = await getClient();
  const { data, error } = await client.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  return data.user || null;
}

export async function signUp(email, password) {
  const client = await getClient();
  const emailRedirectTo = window.location.origin + window.location.pathname;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

function normalizedChecklist(value) {
  const normalized = {};
  for (const [id, flags] of Object.entries(value || {})) {
    const owned = Boolean(flags?.owned);
    const wanted = Boolean(flags?.wanted);
    if (owned || wanted) normalized[id] = { owned, wanted };
  }
  return normalized;
}

function sameChecklist(a, b) {
  const left = normalizedChecklist(a);
  const right = normalizedChecklist(b);
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && left[key].owned === right[key].owned
      && left[key].wanted === right[key].wanted);
}

export async function inspectCollectionSync(name, localCollection) {
  const client = await getClient();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in first.');
  const { data: rows, error } = await client
    .from('user_collections')
    .select('id,name,collection_data,updated_at')
    .eq('user_id', user.id)
    .eq('name', name)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const remote = rows?.[0] || null;
  return {
    exists: Boolean(remote),
    needsSync: !remote || !sameChecklist(localCollection, remote.collection_data),
    remoteUpdatedAt: remote?.updated_at || null,
  };
}

export async function syncCollection(name, localCollection) {
  const client = await getClient();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in first.');
  const { data: rows, error: readError } = await client
    .from('user_collections')
    .select('id,name,collection_data,updated_at')
    .eq('user_id', user.id)
    .eq('name', name)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (readError) throw readError;

  const remote = rows?.[0];
  if (!remote) {
    const { error } = await client.from('user_collections').insert({
      user_id: user.id, name, collection_data: localCollection,
    });
    if (error) throw error;
    return { direction: 'uploaded', collection: localCollection };
  }

  // Additive merge avoids losing checkmarks when two devices have changed independently.
  // Explicitly clearing a flag across devices needs per-flag change tracking in a later sync revision.
  const merged = { ...(remote.collection_data || {}) };
  for (const [pokemonId, flags] of Object.entries(localCollection || {})) {
    const old = merged[pokemonId] || {};
    merged[pokemonId] = { ...old, ...flags };
    for (const flag of ['owned', 'wanted']) {
      merged[pokemonId][flag] = Boolean(old[flag] || flags?.[flag]);
    }
  }
  const { error } = await client.from('user_collections').update({
    name, collection_data: merged, updated_at: new Date().toISOString(),
  }).eq('id', remote.id).eq('user_id', user.id);
  if (error) throw error;
  return { direction: 'merged', collection: merged };
}

export async function getUsername(userId) {
  const client = await getClient();
  const { data, error } = await client.from('user_profiles').select('username').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.username || null;
}

export async function saveUsername(username) {
  const client = await getClient();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in first.');
  const clean = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(clean)) {
    throw new Error('Username must be 3–20 characters using letters, numbers or underscores.');
  }
  const { data, error } = await client.from('user_profiles').upsert({
    user_id: user.id, username: clean, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' }).select('username').single();
  if (error) {
    if (error.code === '23505') throw new Error('That username is already taken. Please choose another.');
    throw error;
  }
  return data.username;
}

export async function saveCloudBinder(localBinder) {
  const client = await getClient();
  const user = await currentUser();
  if (!user) throw new Error('Sign in to back up binder photos and pages.');
  const binder = structuredClone(localBinder);
  for (const page of binder.pages || []) for (const slot of page.slots || []) if (slot) delete slot.photoUrl;
  for (let pageIndex = 0; pageIndex < (binder.pages || []).length; pageIndex++) {
    const page = binder.pages[pageIndex];
    for (let slotIndex = 0; slotIndex < (page.slots || []).length; slotIndex++) {
      const slot = page.slots[slotIndex];
      if (!slot || slot.type !== 'card') continue;
      const safeBinderId = String(binder.id).replace(/[^A-Za-z0-9_-]/g, '_');
      const safeItemId = String(slot.collectionItemId || (pageIndex + '-' + slotIndex)).replace(/[^A-Za-z0-9_-]/g, '_');
      const targetPath = user.id + '/' + safeBinderId + '/' + safeItemId + '.jpg';
      if (slot.data && slot.data.startsWith('data:') && slot.photoPath !== targetPath) {
        const response = await fetch(slot.data);
        const blob = await response.blob();
        const { error: uploadError } = await client.storage.from('binder-photos').upload(targetPath, blob, {
          contentType: 'image/jpeg', upsert: true, cacheControl: '3600',
        });
        if (uploadError) throw uploadError;
        slot.photoPath = targetPath;
        delete slot.data;
      } else if (slot.data && slot.photoPath === targetPath) {
        // Already uploaded. Keep the local copy in IndexedDB, but not in cloud JSON.
        delete slot.data;
      } else if (slot.photoPath && slot.photoPath !== targetPath) {
        const { data: oldPhoto, error: downloadError } = await client.storage.from('binder-photos').download(slot.photoPath);
        if (downloadError) throw downloadError;
        const { error: copyError } = await client.storage.from('binder-photos').upload(targetPath, oldPhoto, {
          contentType: 'image/jpeg', upsert: true, cacheControl: '3600',
        });
        if (copyError) throw copyError;
        slot.photoPath = targetPath;
      }
    }
  }
  const { data, error } = await client.from('binders').upsert({
    user_id: user.id,
    local_id: String(localBinder.id),
    name: binder.name,
    pages: binder.pages,
    collection_items: binder.collectionItems || [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,local_id' }).select('id,local_id,name,pages,collection_items,updated_at').single();
  if (error) throw error;
  // Keep removed photo objects for now: a binder-only removal may still belong to the collection inventory.
  return { ...binder, cloudId: data.id, updatedAt: data.updated_at };
}

export async function loadCloudBinders() {
  const client = await getClient();
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await client.from('binders')
    .select('id,local_id,name,pages,collection_items,updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return Promise.all((data || []).map(async (row) => {
    const binder = { id: row.local_id || row.id, cloudId: row.id, name: row.name, pages: row.pages || [], updatedAt: row.updated_at, collectionItems: row.collection_items || [] };
    for (const page of binder.pages) for (const slot of page.slots || []) {
      if (slot?.type === 'card' && slot.photoPath) {
        try {
          const { data: signed, error: signedError } = await client.storage.from('binder-photos').createSignedUrl(slot.photoPath, 3600);
          if (!signedError && signed?.signedUrl) slot.photoUrl = signed.signedUrl;
        } catch { /* Keep the saved storage path; retry URL generation on next load. */ }
      }
    }
    return binder;
  }));
}

export async function getBinderPhotoUrl(path) {
  const client = await getClient();
  const { data, error } = await client.storage.from('binder-photos').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteCloudBinder(localId) {
  const client = await getClient();
  const user = await currentUser();
  if (!user) return;
  const { data: rows, error: readError } = await client.from('binders').select('id,pages')
    .eq('user_id', user.id).eq('local_id', String(localId));
  if (readError) throw readError;
  for (const row of rows || []) {
    const paths = [];
    for (const page of row.pages || []) for (const slot of page.slots || []) if (slot?.photoPath) paths.push(slot.photoPath);
    if (paths.length) {
      const { error } = await client.storage.from('binder-photos').remove([...new Set(paths)]);
      if (error) throw error;
    }
    const { error } = await client.from('binders').delete().eq('id', row.id).eq('user_id', user.id);
    if (error) throw error;
  }
}
