import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import game from '../../game-core.cjs';

const rooms = getStore({ name: 'ludo-rooms', consistency: 'strong' });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function createRoom(name) {
  for (let tries = 0; tries < 8; tries++) {
    const code = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
    const room = game.newRoom(code);
    const result = game.join(room, { name });
    const saved = await rooms.setJSON(code, room, { onlyIfNew: true });
    if (saved.modified) return { ...result, state: game.snapshot(room) };
  }
  throw new Error('Could not create a unique room code. Please try again.');
}

async function updateRoom(code, action, playerId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await rooms.getWithMetadata(code, { consistency: 'strong', type: 'json' });
    if (!entry?.data) return { error: 'Room not found. Check the code and try again.', status: 404 };
    const room = entry.data;
    const result = action.type === 'join' ? game.join(room, action) : game.apply(room, playerId, action);
    if (result.error) return { error: result.error, status: 409 };
    if (!result.changed && action.type !== 'join') return result;
    const saved = await rooms.setJSON(code, room, { onlyIfMatch: entry.etag });
    if (saved.modified) return result;
  }
  return { error: 'The room changed at the same time. Please try that action again.', status: 409 };
}

export default async (request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const code = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const playerId = url.searchParams.get('player');
    if (!code) return json({ error: 'Enter a room code.' }, 400);
    const entry = await rooms.getWithMetadata(code, { consistency: 'strong', type: 'json' });
    if (!entry?.data) return json({ error: 'Room not found. Check the code and try again.' }, 404);
    if (!entry.data.players.some(player => player.id === playerId)) return json({ error: 'You are not in this room. Rejoin with the room code.' }, 403);
    return json(game.snapshot(entry.data));
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const action = await request.json();
    if (action.type === 'join') {
      if (action.create) return json(await createRoom(action.name || 'Player'));
      const code = (action.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (!code) return json({ error: 'Enter a room code.' }, 400);
      const result = await updateRoom(code, action, null);
      return json(result, result.status || 200);
    }
    const code = (action.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!code) return json({ error: 'Enter a room code.' }, 400);
    const playerId = String(action.playerId || '');
    if (!playerId) return json({ error: 'Your room session expired. Rejoin with the room code.' }, 401);
    const result = await updateRoom(code, action, playerId);
    return json(result, result.status || 200);
  } catch (error) {
    console.error('Game function error:', error);
    return json({ error: error.message || 'The game service is temporarily unavailable.' }, 500);
  }
};
