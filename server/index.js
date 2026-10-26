import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager, DEFAULT_SETTINGS, cryptoToken } from './rooms.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { MECHS } from '../shared/mechs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
};

const clients = new Map(); // clientId -> ws
const clientSeq = { n: 0 };
let roomManager;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') {
    return json(res, { ok: true, uptime: process.uptime(), clients: clients.size, rooms: roomManager.listPublic().length });
  }
  if (url.pathname === '/api/rooms') {
    return json(res, { rooms: roomManager.listPublic(), version: 1 });
  }
  if (url.pathname === '/api/log') {
    if (req.method === 'POST') {
      readBody(req).then((body) => {
        let payload = {};
        try { payload = JSON.parse(body); } catch { payload = { raw: body.slice(0, 400) }; }
        dlog('client-log', JSON.stringify(payload).slice(0, 1200));
        json(res, { ok: true });
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(debugLog.slice(-200).join('\n'));
  }
  if (url.pathname === '/api/config') {
    return json(res, {
      colors: PLAYER_COLORS,
      mechs: Object.values(MECHS).map((m) => ({ id: m.id, name: m.name, role: m.role, skill: m.skill, passive: m.passive, blurb: m.blurb, stats: m.stats, hull: m.hull, accent: m.accent })),
      defaults: DEFAULT_SETTINGS,
    });
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!path.extname(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404');
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

const debugLog = [];
function dlog(...args) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${args.join(' ')}`;
  console.log(line);
  debugLog.push(line);
  if (debugLog.length > 600) debugLog.shift();
}
globalThis.__dlog = dlog;

function readBody(req, limit = 16384) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > limit) { data = data.slice(0, limit); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

function json(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

const io = {
  send(clientId, msg) {
    const ws = clients.get(clientId);
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(msg)); } catch {}
    }
  },
  broadcastRoom(room) {
    const payload = JSON.stringify({ type: 'room', room: room.publicInfo() });
    for (const m of room.members.values()) {
      if (m.bot || !m.clientId) continue;
      const ws = clients.get(m.clientId);
      if (ws && ws.readyState === 1) { try { ws.send(payload); } catch {} }
    }
  },
  broadcastRoomChat(room, msg) {
    const payload = JSON.stringify({ type: 'chat', ...msg });
    for (const m of room.members.values()) {
      if (m.bot || !m.clientId) continue;
      const ws = clients.get(m.clientId);
      if (ws && ws.readyState === 1) { try { ws.send(payload); } catch {} }
    }
  },
};

roomManager = new RoomManager(io);
setInterval(() => roomManager.tick(), 1000);

wss.on('connection', (ws, req) => {
  const clientId = 'p' + (++clientSeq.n) + '_' + Math.random().toString(36).slice(2, 7);
  ws.clientId = clientId;
  clients.set(clientId, ws);
  ws.msgCount = 0;
  ws.windowStart = Date.now();
  ws.profile = { name: '废土客' };
  dlog('ws open', clientId, (req.headers['user-agent'] || '').slice(0, 70));

  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    version: 1,
    rooms: roomManager.listPublic(),
  }));

  ws.on('message', (raw) => {
    // simple rate limit: 200 messages / second
    const now = Date.now();
    if (now - ws.windowStart > 1000) { ws.windowStart = now; ws.msgCount = 0; }
    if (++ws.msgCount > 200) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type !== 'input' && msg.type !== 'ping') {
      const extra = msg.type === 'createRoom' ? `autoStart=${!!msg.autoStart} mode=${msg.settings?.mode} bots=${msg.settings?.bots}`
        : msg.type === 'join' ? `code=${msg.code}` : msg.type === 'chat' ? `text=${String(msg.text || '').slice(0, 30)}` : '';
      dlog('recv', clientId, msg.type, extra);
    }
    try {
      handleMessage(ws, clientId, msg);
    } catch (e) {
      dlog('ERROR handling', msg.type, e && e.message, (e && e.stack || '').split('\n').slice(0, 3).join(' | '));
      io.send(clientId, { type: 'error', message: '服务器处理失败: ' + (e && e.message) });
    }
  });

  ws.on('close', () => {
    dlog('ws close', clientId);
    clients.delete(clientId);
    const room = roomManager.roomOf(clientId);
    if (room) {
      const member = [...room.members.values()].find((m) => m.clientId === clientId);
      if (member && room.status === 'playing' && room.sim) {
        const p = room.sim.players.get(member.playerId);
        if (p) {
          p.disconnected = true;
          p.bot = true;
          p.reconnectUntil = room.sim.t + 30;
          p.input.fire = false;
        }
        member.connected = false;
      } else if (member) {
        room.removeMember(member.key);
      }
      if (room.members.size === 0) {
        room.dispose();
        roomManager.rooms.delete(room.code);
      } else {
        // hand the host badge to a connected human if needed
        if (room.host === clientId) {
          const next = [...room.members.values()].find((m) => !m.bot && m.connected);
          room.host = next ? next.clientId : null;
        }
        io.broadcastRoom(room);
      }
    }
    roomManager.clientRoom.delete(clientId);
    roomManager.clientTokens.delete(clientId);
  });
});

function sanitizeProfile(profile = {}, fallbackName = '废土客') {
  const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 12) : fallbackName;
  const colorId = PLAYER_COLORS.some((c) => c.id === profile.colorId) ? profile.colorId : null;
  const color = colorId ? PLAYER_COLORS.find((c) => c.id === colorId).hex : null;
  const mech = profile.mech in MECHS ? profile.mech : 'assault';
  return { name, colorId, color: color ? [color] : null, mech };
}

function handleMessage(ws, clientId, msg) {
  const room = roomManager.roomOf(clientId);
  switch (msg.type) {
    case 'hello': {
      ws.profile = sanitizeProfile(msg.profile, msg.profile?.name || '废土客');
      ws.send(JSON.stringify({ type: 'helloAck', you: clientId, name: ws.profile.name }));
      break;
    }
    case 'rooms': {
      ws.send(JSON.stringify({ type: 'rooms', rooms: roomManager.listPublic() }));
      break;
    }
    case 'createRoom': {
      if (room) roomManager.leave(clientId);
      const profile = sanitizeProfile(msg.profile, ws.profile.name);
      ws.profile = profile;
      const token = msg.token || cryptoToken();
      const { room: newRoom, token: tk } = roomManager.createRoom(clientId, profile, token);
      const member = newRoom.members.get('c' + clientId);
      if (member) member.token = tk;
      newRoom.tokens.set(tk, 'c' + clientId);
      if (msg.settings) newRoom.applySettings(msg.settings);
      newRoom.syncBots();
      io.send(clientId, { type: 'joined', code: newRoom.code, token: tk, you: clientId });
      io.broadcastRoom(newRoom);
      if (msg.autoStart) {
        try { newRoom.startGame(); } catch (e) { io.send(clientId, { type: 'error', message: e.message }); }
      }
      break;
    }
    case 'join': {
      if (room) roomManager.leave(clientId);
      const profile = sanitizeProfile(msg.profile, ws.profile.name);
      ws.profile = profile;
      const code = String(msg.code || '').toUpperCase().slice(0, 6);
      const token = msg.token || cryptoToken();
      try {
        const target = roomManager.rooms.get(code);
        if (!target) throw new Error('房间不存在，检查房间码');
        if (target.status !== 'lobby') throw new Error('对局已开始，无法加入');
        const member = target.addHuman(clientId, profile, token);
        member.ready = !!msg.ready;
        target.tokens.set(token, member.key);
        roomManager.clientRoom.set(clientId, code);
        roomManager.tokens.set(token, code);
        io.send(clientId, { type: 'joined', code, token, you: clientId });
        io.broadcastRoom(target);
      } catch (e) {
        io.send(clientId, { type: 'error', message: e.message });
      }
      break;
    }
    case 'resume': {
      const token = String(msg.token || '');
      const code = roomManager.tokens && roomManager.tokens.get(token);
      const target = code ? roomManager.rooms.get(code) : null;
      if (!target) { io.send(clientId, { type: 'error', message: '重连失败：房间已关闭', fatal: true }); break; }
      const member = [...target.members.values()].find((m) => m.token === token);
      if (!member) { io.send(clientId, { type: 'error', message: '重连失败：席位已释放', fatal: true }); break; }
      if (member.connected && member.clientId && member.clientId !== clientId) {
        const old = clients.get(member.clientId);
        if (old && old.readyState === 1) { io.send(clientId, { type: 'error', message: '该席位已有连接' }); break; }
      }
      if (member.clientId) roomManager.clientRoom.delete(member.clientId);
      member.clientId = clientId;
      member.connected = true;
      member.key = 'c' + clientId;
      roomManager.clientRoom.set(clientId, target.code);
      roomManager.tokens.set(token, target.code);
      if (target.status === 'playing' && target.sim && member.playerId) {
        const p = target.sim.players.get(member.playerId);
        if (p) { p.disconnected = false; p.bot = false; p.reconnectUntil = 0; p.lastInputAt = target.sim.t; }
        io.send(clientId, {
          type: 'start',
          resumed: true,
          arena: target.arenaSummary,
          settings: target.settings,
          seed: target.seed,
          duration: target.settings.duration,
          you: member.playerId,
          players: [...target.members.values()].map((m) => ({
            id: m.playerId, name: m.name, color: m.color, colorId: m.colorId,
            mech: m.mech, team: m.team || 0, bot: m.bot, isHost: m.clientId === target.host,
          })),
          spawns: target.sim.spawnState(),
          matchCount: target.matchCount,
        });
        const snap = target.sim.snapshot();
        io.send(clientId, { type: 'snapshot', snap, you: member.playerId });
      } else if (target.status === 'results' && target.sim) {
        io.send(clientId, {
          type: 'start', resumed: true, arena: target.arenaSummary, settings: target.settings,
          seed: target.seed, duration: target.settings.duration, you: member.playerId,
          players: [], matchCount: target.matchCount,
        });
        io.send(clientId, { type: 'matchEnd', result: target.sim.result, room: target.publicInfo() });
      } else {
        io.send(clientId, { type: 'joined', code: target.code, token, you: clientId });
      }
      io.broadcastRoom(target);
      break;
    }
    case 'leave': {
      if (room) {
        roomManager.leave(clientId);
        io.broadcastRoom(room);
      }
      break;
    }
    case 'profile': {
      if (room) {
        room.updateProfile(clientId, msg.profile || msg);
        io.broadcastRoom(room);
      } else {
        ws.profile = sanitizeProfile(msg.profile || msg, ws.profile.name);
      }
      break;
    }
    case 'setReady': {
      if (room) { room.setReady(clientId, msg.ready); io.broadcastRoom(room); }
      break;
    }
    case 'settings': {
      if (room && room.host === clientId) {
        room.applySettings(msg.settings || {});
        io.broadcastRoom(room);
      }
      break;
    }
    case 'start': {
      if (room && room.host === clientId) {
        try { room.startGame(); } catch (e) { io.send(clientId, { type: 'error', message: e.message }); }
      }
      break;
    }
    case 'rematch': {
      if (room && room.host === clientId) {
        room.backToLobby();
        room.syncBots();
        try { room.startGame(); } catch (e) { io.send(clientId, { type: 'error', message: e.message }); }
      }
      break;
    }
    case 'toLobby': {
      if (room && room.host === clientId) {
        room.backToLobby();
        io.broadcastRoom(room);
      }
      break;
    }
    case 'input': {
      if (room && room.sim && room.status === 'playing') {
        const member = [...room.members.values()].find((m) => m.clientId === clientId);
        if (!member || !member.playerId) break;
        const p = room.sim.players.get(member.playerId);
        if (p) room.sim.applyInput(p.id, msg);
      }
      break;
    }
    case 'chat': {
      if (room) {
        const text = String(msg.text || '').slice(0, 80).trim();
        if (!text) break;
        const member = [...room.members.values()].find((m) => m.clientId === clientId);
        if (!member) break;
        io.broadcastRoomChat(room, { name: member.name, color: member.color, text });
      }
      break;
    }
    case 'ping': {
      io.send(clientId, { type: 'pong', t: msg.t, now: Date.now() });
      break;
    }
    default: break;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  console.log('=====================================');
  console.log('  废土过载 OVERLOAD — 服务器已启动');
  console.log(`  本机:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  局域网: http://${ip}:${PORT}   （朋友用这个地址加入）`);
  console.log(`  房间发现端口回退: IP 直连即可`);
  console.log('=====================================');
});

process.on('SIGINT', () => { console.log('\nbye'); process.exit(0); });
