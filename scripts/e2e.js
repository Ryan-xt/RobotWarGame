// Full-stack browser-ish test: real server + real UI/Game/net modules, fake WebGL.
// Usage: npm i --no-save linkedom && node scripts/e2e.js
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import WebSocketClient from 'ws';
import { setupDOM, trackConsoleErrors } from './domsetup.js';

const PORT = 3122;
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => null);
      if (res && res.ok) return;
      const r2 = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null);
      if (r2 && r2.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start\n' + serverLog);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, ms = 8000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await sleep(40);
  }
  const diag = typeof errors !== 'undefined' && errors.length ? '\nconsole: ' + errors.join('\n') : '';
  const netState = globalThis.window?.__overload?.net;
  throw new Error('timeout waiting for ' + label + diag + (netState ? `\nnet: connected=${netState.connected} url=${netState.url} retry=${netState.retry}` : ''));
}

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); } else console.log('  ✓', label);
};

await waitForServer();

// ---------------------------------------------------------------- dom + net
const { window, document } = setupDOM();
Object.defineProperty(globalThis, 'location', { value: { protocol: 'http:', host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, search: '' }, configurable: true });
Object.defineProperty(window, 'location', { value: globalThis.location, configurable: true });
globalThis.WebSocket = WebSocketClient;
globalThis.fetch = fetch;
const errors = trackConsoleErrors();

// bundle main.js with a stubbed WebGL stage
await build({
  entryPoints: ['src/main.js'],
  bundle: true, format: 'esm', target: ['es2022'], outfile: '/tmp/overload-e2e.mjs',
  logLevel: 'warning',
  plugins: [{
    name: 'stage-stub',
    setup(b) {
      b.onResolve({ filter: /(^|\/)stage\.js$/ }, () => ({ path: 'stage-stub', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: `export class Stage {
          constructor(canvas) { this.canvas = canvas; this.quality = 'high'; this.scene = null; }
          setActive(scene, camera) { this.scene = scene; this.camera = camera; }
          setQuality(q) { this.quality = q; }
          resize() {}
          render() {}
        }
        export function createStage() { return new Stage(); }`,
        loader: 'js',
      }));
    },
  }],
});

await import('/tmp/overload-e2e.mjs');
const app = window.__overload;
ok(!!app, 'main.js boots and exposes the app');
ok(!!app.ui && !!app.game && !!app.net, 'ui/game/net constructed');
await waitUntil(() => app.net.connected, 5000, 'websocket connection');
ok(app.net.connected, 'websocket connects through Net');
await waitUntil(() => document.getElementById('screen-menu') && !document.getElementById('screen-menu').classList.contains('hidden'), 5000, 'menu screen');
ok(!document.getElementById('screen-menu').classList.contains('hidden'), 'loading hands over to the menu');

// ---------------------------------------------------------------- quickplay
document.getElementById('input-name').value = 'E2E机甲';
document.getElementById('input-name').dispatchEvent(new window.Event('input'));
app.ui.handlers.onQuick();
await waitUntil(() => app.game.running, 8000, 'match start');
ok(app.game.running, 'quickplay creates a room and starts the match');
ok(!!app.ui.currentRoom, 'room state is known to the client', app.ui.currentRoom?.code);
ok(!document.getElementById('screen-game').classList.contains('hidden'), 'game screen visible');
ok(app.game.players.size >= 2, 'mech visuals created', String(app.game.players.size));
await waitUntil(() => app.game.snap, 4000, 'first snapshot');
ok(!!app.game.snap, 'snapshots reach the game layer');

// run the real loop for ~2.5s with movement + fire
let minimapDraws = 0;
const origDrawMinimap = app.ui.drawMinimap.bind(app.ui);
app.ui.drawMinimap = (...a) => { minimapDraws++; return origDrawMinimap(...a); };
app.game.mouse.down = true;
app.game.keys.add('d');
app.game.keys.add('w');
await sleep(2600);
ok(minimapDraws > 0, 'minimap is redrawn during play', String(minimapDraws));
ok(/^\d+:\d\d$/.test(document.getElementById('hud-time').textContent), 'HUD clock updates', document.getElementById('hud-time').textContent);
ok(document.getElementById('ammo-pips').children.length > 0, 'ammo pips rendered');

// chat round trip (server echo)
app.net.send({ type: 'chat', text: 'E2E聊天消息' });
await waitUntil(() => document.getElementById('chat-mini').innerHTML.includes('E2E聊天消息') || document.getElementById('chat-log').innerHTML.includes('E2E聊天消息'), 4000, 'chat echo');
ok(document.getElementById('chat-mini').innerHTML.includes('E2E聊天消息') || document.getElementById('chat-log').innerHTML.includes('E2E聊天消息'), 'chat message round-trips');

// reconnect: new socket, resume token, rejoin the same match
const oldClient = app.net.clientId;
const oldSnapAt = app.game.snapAt || 0;
app.net.close();
await sleep(600);
ok(!app.net.connected, 'socket closed before reconnect');
app.net.connect();
await waitUntil(() => app.net.connected && app.net.clientId && app.net.clientId !== oldClient, 6000, 'reconnect');
ok(app.net.connected, 'Net reconnects');
await waitUntil(() => app.game.running && (app.game.snapAt || 0) > oldSnapAt, 8000, 'resume match');
ok(app.game.running && app.game.snap !== null, 'resume rebuilds the match and snapshots resume');
ok(!document.getElementById('screen-game').classList.contains('hidden'), 'resumed game screen is visible');
ok(document.getElementById('disconnect-overlay').classList.contains('hidden'), 'disconnect overlay cleared after resume');
await sleep(700);

// leave back to menu
app.ui.handlers.onLeave();
await waitUntil(() => !app.ui.screenMenu.classList.contains('hidden'), 4000, 'back to menu');
ok(!app.ui.screenMenu.classList.contains('hidden'), 'leave returns to the menu');
ok(app.game.scene === null, 'game world disposed on leave');

// ---------------------------------------------------------------- 新手教程
app.ui.handlers.onTutorial();
await waitUntil(() => app.tutorial.active, 4000, 'tutorial start');
ok(app.tutorial.active, 'the tutorial button starts a local tutorial');
ok(app.game.running, 'the tutorial runs a local match');
ok(!!document.querySelector('#tut-steps .tut-step.active'), 'the tutorial panel shows the active step');
ok(/^1 \/ \d+$/.test(document.getElementById('tut-count').textContent), 'step counter starts at 1', document.getElementById('tut-count').textContent);
await waitUntil(() => app.tutorial.sim?.phase === 'live', 6000, 'tutorial goes live');
app.game.keys.add('d');
await sleep(700);
app.game.keys.clear();
ok(app.tutorial.watch.moved > 2, 'walking counts towards the first step', app.tutorial.watch.moved.toFixed(1));
const stepBefore = app.tutorial.stepIndex;
const activeBefore = document.querySelector('#tut-steps .tut-step.active .tut-body b').textContent;
document.getElementById('btn-tut-skip').onclick({ target: document.getElementById('btn-tut-skip') });
const activeAfter = document.querySelector('#tut-steps .tut-step.active .tut-body b').textContent;
ok(app.tutorial.stepIndex === stepBefore + 1 && activeAfter !== activeBefore,
  '跳过这一步 advances the panel', `${activeBefore} → ${activeAfter}`);
app.ui.handlers.onLeave();
await waitUntil(() => !app.ui.screenMenu.classList.contains('hidden'), 4000, 'menu after tutorial');
ok(!app.tutorial.active && app.game.scene === null, '退出教程 returns to the menu and disposes the world');

// ---------------------------------------------------------------- 进阶训练
app.ui.handlers.onTraining();
await waitUntil(() => app.tutorial.active && app.tutorial.mode === 'advanced', 4000, 'training start');
ok(app.tutorial.mode === 'advanced', '进阶训练按钮启动进阶模式');
ok(!!document.querySelector('#tut-steps .tut-step.active'), '进阶训练面板显示目标');
ok(app.tutorial.steps.length === 5, '五步教学目标', String(app.tutorial.steps.length));
ok(app.game.players.size === 3, '1 人 + 2 台 AI', String(app.game.players.size));
document.getElementById('btn-tut-exit').onclick({ target: document.getElementById('btn-tut-exit') });
await waitUntil(() => !app.ui.screenMenu.classList.contains('hidden'), 4000, 'menu after training');
ok(!app.tutorial.active, '退出进阶训练回到菜单');

// ---------------------------------------------------------------- 射击训练
app.ui.handlers.onShooting();
await waitUntil(() => app.tutorial.active && app.tutorial.mode === 'shooting', 4000, 'shooting start');
ok(app.tutorial.mode === 'shooting', '射击训练按钮启动射击篇');
ok(app.tutorial.steps.length === 5, '射击篇五步', String(app.tutorial.steps.length));
ok(document.getElementById('hud-mode').textContent === '射击训练', 'HUD 显示「射击训练」',
  document.getElementById('hud-mode').textContent);
ok(app.game.players.size === 5, '玩家 + 3 个靶 + 1 台实战靶机', String(app.game.players.size));
ok(!!app.tutorial.sim.players.get('tgt2') && app.tutorial.sim.players.get('tgt2').dummy, '移动靶是木头靶');
document.getElementById('btn-tut-exit').onclick({ target: document.getElementById('btn-tut-exit') });
await waitUntil(() => !app.ui.screenMenu.classList.contains('hidden'), 4000, 'menu after shooting');
ok(!app.tutorial.active, '退出射击训练回到菜单');

// ---------------------------------------------------------------- 机体专训
document.getElementById('btn-mech-train').onclick({ target: document.getElementById('btn-mech-train') });
ok(!document.getElementById('modal-mech-train').classList.contains('hidden'), '机体专训弹窗打开');
const cards = document.querySelectorAll('#mech-train-grid .mech-train-card');
ok(cards.length === 6, '六台机体各一张卡', String(cards.length));
const lessonBtns = document.querySelectorAll('#mech-train-grid .mech-lesson-btn');
ok(lessonBtns.length === 12, '每台机体两套课 = 12 个入口', String(lessonBtns.length));
const sniperBtn = document.querySelector('#mech-train-grid .mech-lesson-btn[data-mech="sniper"][data-level="advanced"]');
ok(!!sniperBtn, '长钉的进阶玩法入口在');
app.ui.handlers.onMechTrain('sniper', 'advanced');
await waitUntil(() => app.tutorial.active && app.tutorial.mode === 'mech', 4000, 'mech lesson start');
ok(app.tutorial.mode === 'mech' && app.tutorial.mechId === 'sniper' && app.tutorial.level === 'advanced',
  '从菜单直接进入「长钉 · 进阶玩法」',
  `${app.tutorial.mechId}/${app.tutorial.level}`);
ok(app.tutorial.sim.players.get('you').mech === 'sniper', '课程用的就是这台机体');
ok(app.tutorial.steps.length === 3, '进阶玩法三步', String(app.tutorial.steps.length));
ok(document.getElementById('modal-mech-train').classList.contains('hidden'), '开课后机体专训弹窗自动收起');
ok(document.getElementById('hud-mode').textContent === '长钉 · 进阶玩法', 'HUD 显示课程名',
  document.getElementById('hud-mode').textContent);
ok(document.querySelectorAll('#tut-panel .tut-tip').length === 1, '面板显示提示行');
document.getElementById('btn-tut-exit').onclick({ target: document.getElementById('btn-tut-exit') });
await waitUntil(() => !app.ui.screenMenu.classList.contains('hidden'), 4000, 'menu after mech lesson');
ok(!app.tutorial.active, '退出机体专训回到菜单');

// ---------------------------------------------------------------- 战场图鉴
document.getElementById('btn-fieldguide').onclick({ target: document.getElementById('btn-fieldguide') });
ok(!document.getElementById('modal-field').classList.contains('hidden'), '战场图鉴弹窗打开');
ok(document.querySelectorAll('#modal-field .help-item').length >= 10, '图鉴列出环境要素',
  String(document.querySelectorAll('#modal-field .help-item').length));
app.ui.closeModal('modal-field');

// ---------------------------------------------------------------- lobby flow
app.ui.handlers.onCreate();
await waitUntil(() => !document.getElementById('screen-lobby').classList.contains('hidden'), 5000, 'lobby screen');
ok(!document.getElementById('screen-lobby').classList.contains('hidden'), 'create room opens the lobby');
ok(document.getElementById('lobby-code').textContent.length >= 4, 'lobby shows a room code', document.getElementById('lobby-code').textContent);
ok(document.querySelectorAll('#lobby-players .player-row').length >= 2, 'lobby lists players + bots');
ok(document.getElementById('btn-start').disabled === false, 'host can start the match');
app.ui.handlers.onStart();
await waitUntil(() => app.game.running, 6000, 'host start');
ok(app.game.running, 'host start begins the match');
ok(document.getElementById('hud-room').textContent.includes(document.getElementById('lobby-code').textContent), 'HUD shows the room code');
app.ui.handlers.onLeave();
await waitUntil(() => !app.ui.screenMenu.classList.contains('hidden'), 4000, 'menu after lobby match');
ok(!app.ui.screenMenu.classList.contains('hidden'), 'leaving the lobby match returns to menu');

// ---------------------------------------------------------------- results
app.menuScene && app.menuScene.update(0.016);
ok(['high', 'med', 'low'].includes(app.stage.quality), 'stage quality tracks settings', app.stage.quality);
// in-game quality cycle button (high -> med -> low -> high)
const qBefore = app.stage.quality;
const qBtn = document.getElementById('btn-hud-quality');
qBtn.onclick({ target: qBtn });
const qAfter = app.stage.quality;
ok(qAfter !== qBefore, 'HUD quality button switches presets', `${qBefore} → ${qAfter}`);
ok(document.body.dataset.quality === qAfter, 'body reflects the preset for CSS', document.body.dataset.quality);
ok(/画质/.test(document.getElementById('btn-hud-quality').textContent), 'HUD quality button shows the preset label', document.getElementById('btn-hud-quality').textContent);
qBtn.onclick({ target: qBtn });
qBtn.onclick({ target: qBtn });
ok(app.stage.quality === qBefore, 'three clicks cycle back to the original preset', `${qBefore} → ${qAfter} → ${app.stage.quality}`);

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'E2E OK' : `E2E FAILED (${failures})`);
server.kill('SIGTERM');
await sleep(300);
process.exit(pass ? 0 : 1);
