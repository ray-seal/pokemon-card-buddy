import { getSupabaseClient } from './cloud.js';

const AVATARS = {
  pokeball: '🔴',
  pikachu: '⚡',
  eevee: '🦊',
  bulbasaur: '🌱',
  charmander: '🔥',
  squirtle: '💧',
  snorlax: '💤',
  gengar: '👻',
  psyduck: '🦆',
};

export const PRESET_AVATARS = AVATARS;

async function signedInUser() {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data.session?.user || null;
  if (!user) throw new Error('Sign in to your CardBuddy account first.');
  return { client, user };
}

export async function getMyFriendProfile() {
  const { client, user } = await signedInUser();
  const { data, error } = await client.from('user_profiles')
    .select('user_id,username,friend_code,avatar_id')
    .eq('user_id', user.id).single();
  if (error) throw error;
  return data;
}

export async function updateMyAvatar(avatarId) {
  if (!Object.hasOwn(AVATARS, avatarId)) throw new Error('Choose one of the preset avatars.');
  const { client, user } = await signedInUser();
  const { data, error } = await client.from('user_profiles')
    .update({ avatar_id: avatarId, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .select('user_id,username,friend_code,avatar_id').single();
  if (error) throw error;
  return data;
}

export async function requestFriendByCode(code) {
  const { client } = await signedInUser();
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(normalized)) {
    throw new Error('Enter the 12-character friend code exactly as shown.');
  }
  const { data, error } = await client.rpc('request_friend_by_code', { requested_code: normalized });
  if (error) throw error;
  const messages = {
    sign_in_required: 'Sign in to add friends.',
    rate_limited: 'Too many code attempts. Please wait an hour before trying again.',
    not_found: 'That friend code was not found. Check it and try again.',
    cannot_add_self: 'That is your own friend code.',
  };
  if (data?.error) throw new Error(messages[data.error] || 'Could not send friend request.');
  return data;
}

export async function loadFriendHub() {
  const { client, user } = await signedInUser();
  const [friendshipsResult, profileResult, collectionsResult, sharesResult] = await Promise.all([
    client.from('friendships').select('id,user_a,user_b,requested_by,status,created_at').order('created_at', { ascending: false }),
    client.from('user_profiles').select('user_id,username,friend_code,avatar_id').eq('user_id', user.id).maybeSingle(),
    client.from('user_collections').select('id,name,collection_data,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }),
    client.from('collection_shares').select('collection_id,friend_id').eq('owner_id', user.id),
  ]);
  for (const result of [friendshipsResult, profileResult, collectionsResult, sharesResult]) {
    if (result.error) throw result.error;
  }

  const friendships = friendshipsResult.data || [];
  const relatedIds = [...new Set(friendships.map((f) => f.user_a === user.id ? f.user_b : f.user_a))];
  let profiles = [];
  if (relatedIds.length) {
    const result = await client.from('user_profiles').select('user_id,username,avatar_id').in('user_id', relatedIds);
    if (result.error) throw result.error;
    profiles = result.data || [];
  }
  const profileById = Object.fromEntries(profiles.map((p) => [p.user_id, p]));
  const friends = friendships
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const friendId = f.user_a === user.id ? f.user_b : f.user_a;
      return { id: friendId, friendshipId: f.id, ...(profileById[friendId] || {}) };
    })
    .filter((f) => f.username);
  const incoming = friendships
    .filter((f) => f.status === 'pending' && f.requested_by !== user.id)
    .map((f) => {
      const requesterId = f.requested_by;
      return { id: f.id, userId: requesterId, ...(profileById[requesterId] || {}) };
    });
  const outgoing = friendships
    .filter((f) => f.status === 'pending' && f.requested_by === user.id)
    .map((f) => {
      const recipientId = f.user_a === user.id ? f.user_b : f.user_a;
      return { id: f.id, userId: recipientId, ...(profileById[recipientId] || {}) };
    });

  return {
    userId: user.id,
    profile: profileResult.data,
    friends,
    incoming,
    outgoing,
    collections: collectionsResult.data || [],
    shares: sharesResult.data || [],
  };
}

export async function respondToFriendRequest(requestId, accept) {
  const { client, user } = await signedInUser();
  const { data, error } = await client.from('friendships')
    .update({ status: accept ? 'accepted' : 'declined', updated_at: new Date().toISOString() })
    .eq('id', requestId).eq('status', 'pending')
    .neq('requested_by', user.id)
    .select('id,status').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('That request has already changed. Refresh and try again.');
  return data;
}

export async function removeFriend(friendshipId) {
  const { client } = await signedInUser();
  const { error } = await client.from('friendships').delete().eq('id', friendshipId).eq('status', 'accepted');
  if (error) throw error;
}

export async function setCollectionPermission(collectionId, friendId, allowed) {
  const { client, user } = await signedInUser();
  if (allowed) {
    const { error } = await client.from('collection_shares').insert({
      collection_id: collectionId, owner_id: user.id, friend_id: friendId,
    });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await client.from('collection_shares').delete()
      .eq('collection_id', collectionId).eq('owner_id', user.id).eq('friend_id', friendId);
    if (error) throw error;
  }
}

export async function loadFriendCollections(friendId) {
  const { client } = await signedInUser();
  const { data, error } = await client.from('user_collections')
    .select('id,name,collection_data,updated_at')
    .eq('user_id', friendId).order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
