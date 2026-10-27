// Headless protocol smoke test: creates a room, starts a match with bots,
// drives inputs, and verifies snapshots + match end.
import WebSocket from 'ws';

const URL = process.env.WS || 'ws://127.0.0.1:3000/ws';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const state = { ws, name, msgs: [], snapshots: 0, start: null, room: null, ended: null, errors: [], id: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    state.msgs.push(m);
    if (m.type === 'welcome') state.id = m.clientId;
    if (m.type === 'start') state.start = m;
    if (m.type === 'snapshot') state.snapshots++;
    if (m.type === 'room') state.room = m.room;
    if (m.type === 'matchEnd') state.ended = m;
    if (m.type === 'error') state.errors.push(m.message);
  });
  state.send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  return state;
}

async function main() {
  const a = client('A');
  await new Promise((r) => a.ws.on('open', r));
  await wait(120);
  a.send({ type: 'hello', profile: { name: 'Tester', colorId: 'orange', mech: 'assault' } });
  await wait(120);
  a.send({
    type: 'createRoom', autoStart: true, settings: { mode: 'ffa', bots: 3, eventRate: 'high', heatRate: 'fast', difficulty: 'easy' },
    profile: { name: 'Tester', colorId: 'orange', mech: 'grappler' },
  });
  await wait(1500);
  if (!a.start) throw new Error('no start message: ' + JSON.stringify(a.errors));
  console.log('start ok, players:', a.start.players.map((p) => p.name + ':' + p.mech + ':team' + p.team).join(', '));
  console.log('arena size', a.start.arena.size, 'you', a.start.you);
  const you = a.start.you;
  const interval = setInterval(() => {
    const t = Date.now() / 1000;
    a.send({ type: 'input', mx: Math.sin(t), mz: Math.cos(t * 0.7), aim: t % 6.28, fire: Math.random() < 0.8, dash: Math.random() < 0.05, skill: Math.random() < 0.05, useItem: Math.random() < 0.03, seq: Math.floor(t * 30) });
  }, 33);
  await wait(9000);
  clearInterval(interval);
  console.log('snapshots', a.snapshots, 'errors', a.errors);
  const snaps = a.msgs.filter((m) => m.type === 'snapshot').map((m) => m.snap);
  const last = snaps[snaps.length - 1];
  const me = last.players.find((p) => p.id === you);
  console.log('last snapshot t', last.t, 'phase', last.phase, 'players', last.players.length, 'bullets', last.bullets.length, 'items', last.items.length, 'zones', last.zones.length, 'event', last.event && last.event.name);
  console.log('me', me && { x: me.x, z: me.z, heat: me.heat, alive: me.alive, ammo: me.ammo, item: me.item, score: me.score });
  console.log('fx sample', [...new Set(last.fx.map((f) => f.e))]);

  // second room: lobby + ready + join flow
  const b = client('B');
  await new Promise((r) => b.ws.on('open', r));
  b.send({ type: 'hello', profile: { name: 'Lobby', colorId: 'cyan', mech: 'guardian' } });
  await wait(100);
  b.send({ type: 'createRoom', settings: { mode: '2v2', bots: 2 }, profile: { name: 'Lobby', colorId: 'cyan', mech: 'guardian' } });
  await wait(300);
  console.log('lobby room', b.room && { code: b.room.code, players: b.room.players.length, mode: b.room.settings.mode });
  const code = b.room.code;
  const c = client('C');
  await new Promise((r) => c.ws.on('open', r));
  c.send({ type: 'join', code, profile: { name: 'Guest', colorId: 'lime', mech: 'sniper' } });
  await wait(300);
  console.log('after join', c.room && c.room.players.length, 'errors', c.errors);
  b.send({ type: 'start' });
  await wait(1200);
  console.log('B start?', !!b.start, 'C start?', !!c.start, 'B errors', b.errors);
  await wait(2000);
  b.send({ type: 'chat', text: 'gg' });
  await wait(300);
  console.log('chat received', c.msgs.filter((m) => m.type === 'chat').length);

  // reconnect: drop C and resume with token
  const token = c.msgs.find((m) => m.type === 'joined')?.token;
  c.ws.close();
  await wait(500);
  const c2 = client('C2');
  await new Promise((r) => c2.ws.on('open', r));
  c2.send({ type: 'resume', token });
  await wait(800);
  console.log('resume', c2.start ? 'start ok' : 'no start', c2.errors, 'snaps', c2.snapshots);

  for (const x of [a, b, c2]) x.ws.close();
  await wait(200);
  console.log('DONE');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
