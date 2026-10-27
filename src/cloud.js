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
