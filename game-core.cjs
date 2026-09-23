const crypto = require('node:crypto');

const STARTS = [0, 13, 27, 40, 0, 26];
const COLORS = ['coral', 'teal', 'gold', 'blue', 'violet', 'pink'];
const SAFE = [0, 13, 27, 40];
const ARROWS = [5, 6, 18, 19];
const BONUS = [11, 32];

function newRoom(code) {
  return { code, players: [], chat: [], started: false, turn: 0, die: null, sixStreak: 0, winner: null, updatedAt: Date.now() };
}

function snapshot(room) {
  return { type: 'state', room: { code: room.code, started: room.started, turn: room.turn, die: room.die, sixStreak: room.sixStreak, players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, tokens: p.tokens })), chat: room.chat.slice(-40), winner: room.winner } };
}

function join(room, msg) {
  if (room.started || room.players.length >= 6) return { error: 'This room is full or the game has started.' };
  const player = { id: crypto.randomUUID(), name: (msg.name || 'Player').trim().slice(0, 18) || 'Player', color: COLORS[room.players.length], tokens: [-1, -1, -1, -1] };
  room.players.push(player);
  room.updatedAt = Date.now();
  return { type: 'joined', id: player.id, code: room.code, state: snapshot(room) };
}

function next(room) {
  room.turn = (room.turn + 1) % room.players.length;
  room.die = null;
  room.sixStreak = 0;
}

function apply(room, playerId, msg) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { error: 'You are not in this room. Rejoin with the room code.' };
  if (msg.type === 'chat') {
    const text = (msg.text || '').trim().slice(0, 240);
    if (!text) return { state: snapshot(room), changed: false };
    room.chat.push({ name: player.name, color: player.color, text, time: Date.now() });
    room.chat = room.chat.slice(-100);
  } else if (msg.type === 'start') {
    if (room.players[0]?.id !== playerId) return { error: 'Only the room host can start the game.' };
    if (room.players.length < 2) return { error: 'At least two players are needed to start.' };
    room.started = true;
    room.turn = 0;
  } else {
    if (!room.started || room.players[room.turn]?.id !== playerId || room.winner) return { error: 'It is not your turn.' };
    if (msg.type === 'roll' && room.die === null) {
      if (room.sixStreak >= 3) room.sixStreak = 0;
      room.die = 1 + Math.floor(Math.random() * 6);
      room.sixStreak = room.die === 6 ? room.sixStreak + 1 : 0;
    } else if (msg.type === 'pass' && room.die !== null) {
      next(room);
    } else if (msg.type === 'move' && room.die !== null) {
      const i = Number(msg.token), pos = player.tokens[i], die = room.die;
      if (!Number.isInteger(i) || i < 0 || i > 3 || !(pos === -1 ? die === 6 : pos + die <= 57)) return { error: 'That token cannot move.' };
      player.tokens[i] = pos === -1 ? 0 : pos + die;
      const playerIndex = room.players.indexOf(player);
      const track = (player.tokens[i] + STARTS[playerIndex]) % 52;
      for (const other of room.players) if (other !== player) {
        const offset = STARTS[room.players.indexOf(other)];
        other.tokens = other.tokens.map(token => {
          if (token < 0 || token >= 52 || SAFE.includes((token + offset) % 52)) return token;
          return (token + offset) % 52 === track ? -1 : token;
        });
      }
      let bonus = false;
      if (ARROWS.includes(track)) { player.tokens[i] = Math.min(57, player.tokens[i] + 4); bonus = true; }
      if (BONUS.includes(track)) bonus = true;
      if (player.tokens.every(token => token === 57)) room.winner = player.id;
      const rolledSix = die === 6;
      room.die = null;
      if (!rolledSix && !bonus) next(room);
    } else return { error: 'That move is not available.' };
  }
  room.updatedAt = Date.now();
  return { state: snapshot(room), changed: true };
}

module.exports = { newRoom, snapshot, join, apply };
