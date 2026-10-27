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
  const { data, error } = await client.auth.signUp({ email, password });
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
