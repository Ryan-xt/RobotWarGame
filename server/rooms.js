import { buildArena, arenaSummary } from '../shared/arena.js';
import { PLAYER_COLORS, BOT_NAMES, MECH_IDS, makeRng, hashStr, MATCH_DURATION } from '../shared/constants.js';
import { MatchSim } from './sim.js';
import { MECHS } from '../shared/mechs.js';

const MAX_PLAYERS = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_SETTINGS = {
  mode: 'ffa',
  bots: 3,
  eventRate: 'med',
  heatRate: 'standard',
  difficulty: 'normal',
  mapSize: 'auto',
  duration: MATCH_DURATION,
  friendlyFire: false,
};

const BOT_LINES = [
  '过载了，撤！', '别拉我——', '这波不亏！', '我还能打！', '短路吧你！',
  '谁在打我的冷却罐？', '这反弹也太阴了', '散热区我先占了', '机械臂又夹我！', '再来一局，这次我不蓄力了',
];

export class Room {
  constructor(code, host, io) {
    this.code = code;
    this.host = host; // clientId
    this.io = io; // { send(clientId,msg), broadcast(code,msg) }
    this.members = new Map(); // playerKey (clientId or bot:name) -> member
    this.settings = { ...DEFAULT_SETTINGS };
    this.status = 'lobby';
    this.sim = null;
    this.arena = null;
    this.seed = 0;
    this.loop = null;
    this.resultsAt = 0;
    this.matchCount = 0;
    this.createdAt = Date.now();
    this.emptySince = 0;
    this.botChatAt = 0;
    this.tokens = new Map();
    this.nextPlayerId = 1;
    this.arenaSummary = null;
  }

  summary() {
    const humans = [...this.members.values()].filter((m) => !m.bot).length;
    return {
      code: this.code, host: this.host, status: this.status,
      players: [...this.members.values()].filter((m) => !m.bot).length,
      bots: [...this.members.values()].filter((m) => m.bot).length,
      max: MAX_PLAYERS, mode: this.settings.mode, settings: this.settings,
      mapSize: this.arena ? this.arena.size : null,
    };
  }

  publicInfo() {
    return {
      code: this.code,
      status: this.status,
      settings: this.settings,
      host: this.host,
      players: [...this.members.values()].map((m) => ({
        key: m.key, id: m.playerId, clientId: m.bot ? null : m.clientId,
        name: m.name, colorId: m.colorId, color: m.color, mech: m.mech,
        ready: m.ready, bot: m.bot, isHost: m.clientId === this.host, connected: m.connected,
      })),
    };
  }

  addHuman(clientId, profile, token = null) {
    const humans = [...this.members.values()].filter((m) => !m.bot);
    if (this.status !== 'lobby') throw new Error('对局已开始，无法加入');
    const cap = maxForMode(this.settings.mode);
    if (this.members.size >= cap) throw new Error(cap < MAX_PLAYERS ? `该模式最多 ${cap} 人` : '房间已满');
    const member = {
      key: 'c' + clientId, clientId, name: profile.name, colorId: profile.colorId,
      color: colorHex(profile.colorId),
      mech: profile.mech in MECHS ? profile.mech : 'assault', ready: false, bot: false,
      connected: true, token, playerId: null,
    };
    this.members.set(member.key, member);
    this.tokens.set(token, member.key);
    return member;
  }

  addBot(profile) {
    if (this.members.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.members.values()].map((m) => m.name));
    const rng = makeRng(hashStr(this.code) + this.members.size * 977 + this.matchCount);
    let name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
    for (let i = 0; i < 20 && used.has(name); i++) name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
    const color = PLAYER_COLORS[this.members.size % PLAYER_COLORS.length];
    const mech = MECH_IDS[Math.floor(rng() * MECH_IDS.length)];
    const member = {
      key: 'bot' + this.members.size + ':' + name, clientId: null, name, colorId: color.id, color: color.hex,
      mech, ready: true, bot: true, connected: true, token: null, playerId: null,
      difficulty: this.settings.difficulty,
    };
    this.members.set(member.key, member);
    return member;
  }

  removeMember(key) {
    const m = this.members.get(key);
    if (!m) return;
    this.members.delete(key);
    if (m.token) this.tokens.delete(m.token);
    if (this.status === 'playing' && this.sim && m.playerId) {
      const p = this.sim.players.get(m.playerId);
      if (p) {
        p.alive = false;
        p.respawnAt = Infinity;
        p.disconnected = true;
        p.bot = false;
        p.score -= 0;
      }
    }
    if (this.host === m.clientId) {
      const next = [...this.members.values()].find((x) => !x.bot);
      this.host = next ? next.clientId : null;
    }
  }

  setReady(clientId, ready) {
    const m = this.members.get('c' + clientId);
    if (m) m.ready = !!ready;
  }

  updateProfile(clientId, profile) {
    const m = this.members.get('c' + clientId);
    if (!m || this.status !== 'lobby') return;
    if (typeof profile.name === 'string' && profile.name.trim()) m.name = profile.name.trim().slice(0, 12);
    if (profile.colorId) { m.colorId = profile.colorId; m.color = colorHex(profile.colorId); }
    if (profile.mech in MECHS) m.mech = profile.mech;
  }

  applySettings(settings) {
    if (this.status !== 'lobby') return;
    const s = this.settings;
    if (settings.mode && ['ffa', '2v2', '3v3', '4v4'].includes(settings.mode)) s.mode = settings.mode;
    if (settings.bots != null) s.bots = Math.max(0, Math.min(7, settings.bots | 0));
    if (['low', 'med', 'high'].includes(settings.eventRate)) s.eventRate = settings.eventRate;
    if (['slow', 'standard', 'fast'].includes(settings.heatRate)) s.heatRate = settings.heatRate;
    if (['easy', 'normal', 'hard'].includes(settings.difficulty)) s.difficulty = settings.difficulty;
    if (['auto', 20, 30, 40].includes(settings.mapSize)) s.mapSize = settings.mapSize;
    if (settings.friendlyFire != null) s.friendlyFire = !!settings.friendlyFire;
    if (settings.duration != null) s.duration = Math.max(60, Math.min(300, settings.duration | 0));
    // trim bots if the new mode / headcount can't hold them
    while (this.members.size > maxForMode(s.mode)) {
      const bots = [...this.members.values()].filter((m) => m.bot);
      if (!bots.length) break;
      this.members.delete(bots[bots.length - 1].key);
    }
    this.syncBots();
  }

  syncBots() {
    const humans = [...this.members.values()].filter((m) => !m.bot).length;
    const cap = maxForMode(this.settings.mode);
    const desired = Math.min(this.settings.bots, Math.max(0, cap - humans));
    let bots = [...this.members.values()].filter((m) => m.bot);
    while (bots.length > desired) {
      const b = bots.pop();
      this.members.delete(b.key);
    }
    while (bots.length < desired) {
      const b = this.addBot();
      if (!b) break;
      bots.push(b);
    }
  }

  startGame() {
    if (this.status === 'playing') return;
    this.syncBots();
    this.status = 'playing';
    this.matchCount++;
    const members = [...this.members.values()];
    const humanCount = members.filter((m) => !m.bot).length;
    if (humanCount === 0) throw new Error('房间没有真人玩家');
    const headcount = members.length;
    const autoSize = headcount <= 2 ? 20 : headcount <= 4 ? 30 : 40;
    const size = this.settings.mapSize === 'auto' ? autoSize : this.settings.mapSize;
    this.seed = (Math.random() * 1e9) | 0;
    this.arena = buildArena(size, this.seed);
    this.arenaSummary = arenaSummary(this.arena);
    const mode = this.settings.mode;
    const teamSize = mode === 'ffa' ? 0 : Number(mode[0]);
    const order = members.slice().sort((a, b) => (a.bot === b.bot ? 0 : a.bot ? 1 : -1));
    const infos = order.map((m, i) => {
      let team;
      if (mode === 'ffa') team = i;
      else {
        const half = Math.ceil(order.length / 2);
        team = i < half ? 0 : 1;
        // snake within teams is unnecessary for 2 teams
      }
      m.playerId = this.nextPlayerId++;
      m.team = team;
      if (m.bot) m.difficulty = this.settings.difficulty;
      return {
        id: m.playerId, name: m.name, color: m.color, colorId: m.colorId,
        mech: m.mech, team, bot: m.bot, isHost: m.clientId === this.host,
        difficulty: m.difficulty || 'normal',
      };
    });
    const settings = { ...this.settings, duration: this.settings.duration || MATCH_DURATION };
    this.sim = new MatchSim({
      arena: this.arena, players: infos, settings, seed: this.seed,
    });
    this.sim.onEnd = (result) => { this.finishMatch(result); this.resultsAt = Date.now(); };
    this.botChatAt = Date.now() + 12000;
    const summary = this.arenaSummary;
    for (const m of members) {
      if (m.bot || !m.clientId) continue;
      this.io.send(m.clientId, {
        type: 'start',
        roomCode: this.code,
        arena: summary,
        settings,
        seed: this.seed,
        duration: settings.duration,
        you: m.playerId,
        players: infos,
        matchCount: this.matchCount,
      });
    }
    this.lastSnapshotAt = 0;
    this.startLoop();
    this.io.broadcastRoom(this);
  }

  startLoop() {
    if (this.loop) return;
    const dt = 1 / 60;
    let last = performance.now();
    let acc = 0;
    this.loop = setInterval(() => {
      if (!this.sim) return;
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      let steps = 0;
      while (acc >= dt && steps < 5) {
        this.sim.step(dt);
        acc -= dt; steps++;
      }
      const sim = this.sim;
      if (sim.phase === 'over') {
        if (this.status === 'playing') {
          // onEnd already broadcast the result; mark results and stop the sim loop
          this.status = 'results';
          this.stopLoop();
          return;
        }
      }
      const interval = 1 / 20;
      if (sim.t - this.lastSnapshotAt >= interval || sim.tick < 3) {
        this.lastSnapshotAt = sim.t;
        const snap = sim.snapshot();
        for (const m of this.members.values()) {
          if (m.bot || !m.clientId) continue;
          const p = m.playerId ? sim.players.get(m.playerId) : null;
          if (!p) continue;
          this.io.send(m.clientId, { type: 'snapshot', snap, you: m.playerId });
        }
        this.maybeBotChat();
      }
    }, 8);
  }

  maybeBotChat() {
    if (Date.now() < this.botChatAt) return;
    this.botChatAt = Date.now() + 22000 + Math.random() * 20000;
    const bots = [...this.members.values()].filter((m) => m.bot);
    if (!bots.length) return;
    const b = bots[Math.floor(Math.random() * bots.length)];
    const text = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
    this.io.broadcastRoomChat(this, { name: b.name, color: b.color, text, bot: true });
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  finishMatch(result) {
    const payload = {
      type: 'matchEnd',
      result,
      room: this.publicInfo(),
      settings: this.settings,
      arenaSize: this.arena ? this.arena.size : null,
    };
    for (const m of this.members.values()) {
      if (m.bot || !m.clientId) continue;
      this.io.send(m.clientId, payload);
    }
  }

  backToLobby() {
    this.stopLoop();
    this.status = 'lobby';
    this.sim = null;
    this.arena = null;
    for (const m of this.members.values()) {
      m.playerId = null;
      if (!m.bot) m.ready = false;
    }
  }

  dispose() {
    this.stopLoop();
    this.sim = null;
    this.members.clear();
  }
}

export function maxForMode(mode) {
  if (mode === 'ffa') return 8;
  const n = Number(String(mode)[0]) || 4;
  return Math.min(8, n * 2);
}

function colorHex(colorId) {
  const c = PLAYER_COLORS.find((x) => x.id === colorId);
  return c ? c.hex : PLAYER_COLORS[0].hex;
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.clientRoom = new Map(); // clientId -> code
    this.clientTokens = new Map();
    this.tokens = new Map(); // reconnect token -> room code
  }

  createRoom(hostClientId, profile, token = cryptoToken()) {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, hostClientId, this.io);
    this.rooms.set(code, room);
    const member = this.joinRoom(code, hostClientId, profile, token);
    return { room, token, member };
  }

  joinRoom(code, clientId, profile, token = null) {
    const room = this.rooms.get(String(code).toUpperCase());
    if (!room) throw new Error('房间不存在，检查房间码');
    const tk = token || cryptoToken();
    const member = room.addHuman(clientId, profile, tk);
    this.clientRoom.set(clientId, room.code);
    this.tokens.set(tk, room.code);
    return member;
  }

  roomOf(clientId) {
    const code = this.clientRoom.get(clientId);
    return code ? this.rooms.get(code) : null;
  }

  leave(clientId) {
    const room = this.roomOf(clientId);
    if (!room) return;
    const member = [...room.members.values()].find((m) => m.clientId === clientId);
    if (member) {
      if (room.status === 'playing' && room.sim && member.playerId) {
        const p = room.sim.players.get(member.playerId);
        if (p) { p.disconnected = true; p.bot = true; p.reconnectUntil = room.sim.t + 30; p.tokenKey = member.key; }
        member.connected = false;
        member.pendingLeave = true;
      } else {
        room.removeMember(member.key);
      }
    }
    this.clientRoom.delete(clientId);
    if (room.members.size === 0) {
      room.dispose();
      this.rooms.delete(room.code);
    }
    return room;
  }

  tick() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.members.size === 0) { room.dispose(); this.rooms.delete(code); continue; }
      // reconnect window for players that dropped mid-match
      if (room.sim && room.status === 'playing') {
        for (const m of room.members.values()) {
          if (!m.bot && !m.connected && m.playerId) {
            const p = room.sim.players.get(m.playerId);
            if (p && p.reconnectUntil && room.sim.t > p.reconnectUntil) {
              room.removeMember(m.key);
            }
          }
        }
      }
      if (room.status === 'results' && room.resultsAt && now - room.resultsAt > 10 * 60 * 1000) {
        room.backToLobby();
      }
    }
  }

  listPublic() {
    return [...this.rooms.values()]
      .filter((r) => r.status === 'lobby')
      .map((r) => r.summary());
  }
}

export function cryptoToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
