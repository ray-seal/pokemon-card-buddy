import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://ojnpdosscasvolfhsreh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-I4mu6G34EOY6BxGuDZU6w_cmG-xn9T';
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  return data.user || null;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function syncCollection(name, localCollection) {
  const user = await currentUser();
  if (!user) throw new Error('Please sign in first.');
  const { data: rows, error: readError } = await supabase
    .from('user_collections')
    .select('id,name,collection_data,updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (readError) throw readError;

  const remote = rows?.[0];
  if (!remote) {
    const { error } = await supabase.from('user_collections').insert({
      user_id: user.id, name, collection_data: localCollection,
    });
    if (error) throw error;
    return { direction: 'uploaded', collection: localCollection };
  }

  // Merge flags conservatively: a true owned/wanted flag from either device is retained.
  const merged = { ...(remote.collection_data || {}) };
  for (const [pokemonId, flags] of Object.entries(localCollection || {})) {
    const old = merged[pokemonId] || {};
    merged[pokemonId] = { ...old, ...flags };
    for (const flag of ['owned', 'wanted']) {
      merged[pokemonId][flag] = Boolean(old[flag] || flags?.[flag]);
    }
  }
  const { error } = await supabase.from('user_collections').update({
    name, collection_data: merged, updated_at: new Date().toISOString(),
  }).eq('id', remote.id).eq('user_id', user.id);
  if (error) throw error;
  return { direction: 'merged', collection: merged };
}
