import { createStage } from './stage.js';
import { MenuScene } from './menuScene.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { Net, normalizeWsUrl } from './net.js';
import { Tutorial } from './tutorial.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { mechOf } from '../shared/mechs.js';

const LS_PROFILE = 'overload.profile.v1';
const LS_SETTINGS = 'overload.settings.v1';
const LS_TUTORIAL = 'overload.tutorial.v1';
const LS_TRAINING = 'overload.training.v1';
const LS_SHOOTING = 'overload.shooting.v1';
const LS_MECH = 'overload.mechlessons.v1';
const SS_SESSION = 'overload.session.v1';

function loadJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function saveJSON(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch {} }

const colorIds = PLAYER_COLORS.map((c) => c.id);
const profile = loadJSON(LS_PROFILE, {
  name: '废土客' + Math.floor(10 + Math.random() * 89),
  colorId: colorIds[Math.floor(Math.random() * colorIds.length)],
  mech: 'assault',
});
if (!colorIds.includes(profile.colorId)) profile.colorId = 'orange';
const settings = loadJSON(LS_SETTINGS, { volume: 70, quality: 'med', renderScale: 1, maxFps: 60, shake: true, hints: true });
if (!['high', 'med', 'low'].includes(settings.quality)) settings.quality = 'med';
if (typeof settings.renderScale !== 'number') settings.renderScale = 1;
if (typeof settings.maxFps !== 'number') settings.maxFps = 60;

// URL overrides for weak machines / preview panels:
//   ?quality=low  ?scale=0.7  ?noaudio=1
const params = new URLSearchParams(location.search);
const qParam = params.get('quality');
if (qParam && ['high', 'med', 'low'].includes(qParam)) settings.quality = qParam;
const sParam = Number(params.get('scale'));
if (sParam && sParam >= 0.4 && sParam <= 1) settings.renderScale = sParam;

const canvas = document.getElementById('stage');
let stage;
try {
  stage = createStage(canvas, settings.quality, settings.renderScale);
} catch (err) {
  window.__bootShowError?.('渲染器初始化失败', err.message, err.stack);
  throw err;
}
const is2D = stage.is3D === false;
if (is2D) { settings.quality = 'low'; settings.renderScale = 1; }
document.body.dataset.quality = settings.quality;
const audio = new AudioSys();
// Escape hatch for machines with broken audio drivers: ?noaudio=1
if (/[?&]noaudio=1/.test(location.search)) audio.enabled = false;
audio.setVolume(settings.volume / 100);
const menuScene = is2D
  ? { setMech() {}, update() {}, dispose() {}, hero: null, scene: null }
  : new MenuScene(stage);
const colorHex = (id) => PLAYER_COLORS.find((c) => c.id === id)?.hex || PLAYER_COLORS[0].hex;
menuScene.setMech(profile.mech, colorHex(profile.colorId));

let view = 'menu';
let lobbyOpen = false;
let pendingAction = null;

function reportClient(kind, err, extra = {}) {
  const payload = {
    kind,
    msg: String(err && err.message || err || '').slice(0, 300),
    stack: String(err && err.stack || '').split('\n').slice(0, 6).join(' | ').slice(0, 900),
    where: extra.where || '',
    view, connected: !!(net && net.connected),
    ua: navigator.userAgent.slice(0, 120),
    ...extra,
  };
  try {
    const base = (typeof location !== 'undefined' && location.origin) || '';
    fetch(base + '/api/log', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {}
  return payload;
}
let session = null;
try { session = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null'); } catch {}

function guard(name, fn) {
  if (!fn) return fn;
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      reportClient('handler-fail', err, { where: name });
      try { ui.toast('操作失败: ' + (err.message || name), 'err'); } catch {}
      console.error('[handler]', name, err);
    }
  };
}

const ui = new UI({
  audio,
  handlers: {
    onQuick: guard('onQuick', () => startQuickplay()),
    onTutorial: guard('onTutorial', () => startTutorial('basic')),
    onTraining: guard('onTraining', () => startTutorial('advanced')),
    onShooting: guard('onShooting', () => startTutorial('shooting')),
    onMechTrain: guard('onMechTrain', (mechId, level) => startTutorial('mech', { mechId, level })),
    onTutorialSkip: guard('onTutorialSkip', () => tutorial.skipStep()),
    onTutorialExit: guard('onTutorialExit', () => exitTutorial()),
    onTutorialFight: guard('onTutorialFight', () => { exitTutorial(); startQuickplay(); }),
    onTutorialMenu: guard('onTutorialMenu', () => exitTutorial()),
    onCreate: guard('onCreate', () => createRoom()),
    onJoinOpen: guard('onJoinOpen', () => { ui.openModal('modal-join'); net.send({ type: 'rooms' }); }),
    onJoinCode: guard('onJoinCode', (code) => joinRoom(code)),
    onJoinRoom: guard('onJoinRoom', (code) => joinRoom(code)),
    onRefreshRooms: guard('onRefreshRooms', () => net.send({ type: 'rooms' })),
    onConnectWs: guard('onConnectWs', (url) => connectServer(url)),
    onStart: guard('onStart', () => net.send({ type: 'start' })),
    onReady: guard('onReady', (ready) => net.send({ type: 'setReady', ready })),
    onLeave: guard('onLeave', () => leaveRoom()),
    onRematch: guard('onRematch', () => net.send({ type: 'rematch' })),
    onToLobby: guard('onToLobby', () => { lobbyOpen = true; net.send({ type: 'toLobby' }); }),
    onChat: guard('onChat', (text) => net.send({ type: 'chat', text })),
    onProfileChange: (p) => {
      Object.assign(profile, p);
      saveJSON(LS_PROFILE, profile);
      if (net.connected && ui.currentRoom) net.send({ type: 'profile', profile });
    },
    onMechChange: (id) => {
      profile.mech = id;
      saveJSON(LS_PROFILE, profile);
      menuScene.setMech(id, colorHex(profile.colorId));
      if (net.connected && ui.currentRoom) net.send({ type: 'profile', profile });
    },
    onColorChange: (hex) => {
      menuScene.setMech(profile.mech, hex);
    },
    onSettingsChange: (patch) => {
      if (!net.connected) return;
      net.send({ type: 'settings', settings: patch });
    },
    onSettingsSave: (s) => {
      Object.assign(settings, s);
      saveJSON(LS_SETTINGS, settings);
      stage.setQuality(is2D ? 'low' : settings.quality, settings.renderScale);
      if (game.running) game.applyQuality(settings.quality, settings.renderScale);
      ui.applySettings(settings);
      document.body.dataset.quality = settings.quality;
      audio.setVolume(settings.volume / 100);
      if (game.running) {
        game.stage?.setQuality(is2D ? 'low' : settings.quality);
        game.arenaView?.setQuality(settings.quality);
        game.fx?.setQuality(settings.quality);
      }
    },
    onToggleAudio: guard('onToggleAudio', () => ui.toggleAudio()),
    onCycleQuality: guard('onCycleQuality', () => cycleQuality()),
    onResume: guard('onResume', () => resumeSession()),
  },
});
ui.applyProfile(profile);
ui.applySettings(settings);
ui.setQualityLabel(settings.quality);
document.body.dataset.quality = settings.quality;
ui.setMechanic(profile.mech, true);
ui.showLoading();
setLoaderStatus('正在连接 ' + Net.defaultUrl());
ui.setConnection('offline', '正在连接主机');
ui.setServerUrl(Net.defaultUrl());
if (session?.token) ui.setResumeAvailable(true);

window.addEventListener('error', (e) => {
  reportClient('window-error', e.error || e.message, { where: `${e.filename || ''}:${e.lineno || 0}` });
  try { ui.toast('脚本错误: ' + (e.message || 'unknown'), 'err'); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  reportClient('unhandled-rejection', e.reason);
  try { ui.toast('异常: ' + String(e.reason && e.reason.message || e.reason), 'err'); } catch {}
});

const game = new Game({
  stage, audio, ui,
  send: (msg) => net.send(msg),
});

// 新手教程：本地跑一份 MatchSim，不连服务器（见 src/tutorial.js）
const tutorial = new Tutorial({ game, ui, audio, profile });
if (is2D) {
  stage.attach({
    game,
    getMode: () => view,
    getProfile: () => ({ mech: profile.mech, color: colorHex(profile.colorId) }),
  });
  setTimeout(() => ui.toast('显卡/预览不支持 WebGL · 已切换到 2D 俯视模式', 'err'), 1200);
}

// ------------------------------------------------------------------ network
const net = new Net({
  onMessage: (msg) => handleMessage(msg),
  onStatus: (status, extra) => {
    if (status === 'open') {
      setLoaderStatus('主机已连接 · 正在同步房间');
      ui.setConnection('online', '主机在线');
      ui.showDisconnect(false);
      setNetBanner(false);
      if (wasConnected) {
        ui.toast('已重新连接主机', 'ok');
        if (session?.token) net.send({ type: 'resume', token: session.token });
      }
      net.send({ type: 'rooms' });
    } else if (status === 'connecting') {
      ui.setConnection('offline', '正在连接主机');
      if (view === 'menu') setNetBanner(true, '正在连接主机 ' + (net.url || '') + ' …');
    } else if (status === 'retrying') {
      setLoaderStatus('连不上主机，正在重试（' + net.retry + '）', true);
      ui.setConnection('offline', '信号中断，重连中');
      if (view === 'menu') setNetBanner(true, '信号中断，正在重连（第 ' + net.retry + ' 次）…');
      if (view === 'game') ui.showDisconnect(true, `第 ${net.retry} 次重试…`);
    } else if (status === 'closed') {
      setLoaderStatus('无法连接 ' + (net.url || '') + ' · 检查主机或点重试', true);
      ui.setConnection('offline', '主机离线');
      if (view !== 'game') setNetBanner(true, '连不上 ' + (net.url || '') + ' · 点重试，或确认服务已启动');
      if (view === 'game') ui.showDisconnect(true, '检查主机是否仍在运行');
    }
  },
});
let wasConnected = false;

function onFirstConnect() {
  wasConnected = true;
  setTimeout(() => {
    if (ui.screenLoading && !ui.screenLoading.classList.contains('hidden')) ui.hideLoading();
  }, 650);
}

ui.setConnection('offline', '正在连接主机');
net.connect(Net.defaultUrl());
const loaderRetry = document.getElementById('loader-retry');
if (loaderRetry) {
  loaderRetry.classList.remove('hidden');
  loaderRetry.onclick = () => {
    setLoaderStatus('正在重试连接…');
    net.close(); net.retry = 0; net.connect(Net.defaultUrl());
  };
}
const retryBtn = document.getElementById('btn-net-retry');
if (retryBtn) retryBtn.onclick = () => { setNetBanner(true, '正在重试…'); net.close(); net.retry = 0; net.connect(Net.defaultUrl()); };

// never trap the player on the loading screen if the host is unreachable
setTimeout(() => {
  if (ui.screenLoading && !ui.screenLoading.classList.contains('hidden')) {
    ui.hideLoading();
    if (!net.connected) ui.toast('未连上主机 · 可在“加入房间”里填写主机地址', 'err');
  }
}, 2600);

// first visit: point a new player at the tutorial once the menu is on screen
nudgeTutorial();
refreshTrainingBadge();

// expose for menu-scene quality etc.
window.__bootOK = true;
window.__overload = { net, game, ui, stage, menuScene, is2D, tutorial };

// ------------------------------------------------------------------ messages
function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome': {
      if (msg.rooms) ui.setRooms(msg.rooms);
      ui.setConnection('online', '主机在线');
      onFirstConnect();
      net.send({ type: 'hello', profile });
      reportClient('connected', null, { where: 'welcome', renderer: is2D ? '2d' : 'webgl', quality: stage.quality });
      if (pendingAction) { const a = pendingAction; pendingAction = null; setTimeout(() => runPending(a), 80); }
      break;
    }
    case 'rooms': {
      ui.setRooms(msg.rooms);
      break;
    }
    case 'joined': {
      session = { token: msg.token, code: msg.code };
      try { sessionStorage.setItem(SS_SESSION, JSON.stringify(session)); } catch {}
      ui.setResumeAvailable(true);
      ui.setServerUrl(net.url);
      break;
    }
    case 'room': {
      ui.currentRoom = msg.room;
      ui.you = net.clientId;
      const isHost = msg.room.host === net.clientId;
      game.isHost = isHost;
      if (lobbyOpen && msg.room.status === 'lobby' && view === 'menu') {
        view = 'lobby';
        ui.showLobby(msg.room, net.clientId);
      } else if (msg.room.status === 'lobby') {
        ui.updateLobby(msg.room, net.clientId);
        if (view === 'game' || (ui.screenResults && !ui.screenResults.classList.contains('hidden'))) {
          view = 'lobby';
          ui.showScreen('lobby');
          game.disposeWorld();
          ui.showDisconnect(false);
        }
      }
      break;
    }
    case 'start': {
      lobbyOpen = false;
      view = 'game';
      ui.currentRoom = ui.currentRoom || null;
      game.setRoomCode(msg.roomCode || ui.currentRoom?.code || '----');
      game.isHost = ui.currentRoom ? ui.currentRoom.host === net.clientId : game.isHost;
      ui.showDisconnect(false);
      try {
        game.start(msg);
        reportClient('match-started', null, { where: 'start', arena: msg.arena?.size, players: msg.players?.length });
      } catch (err) {
        reportClient('start-fail', err, { where: 'game.start' });
        ui.showError('进入战场失败: ' + err.message);
        console.error(err);
      }
      ui.setResumeAvailable(true);
      break;
    }
    case 'snapshot': {
      try {
        game.onSnapshot(msg.snap, msg.you);
      } catch (err) {
        reportClient('snapshot-fail', err, { where: 'game.onSnapshot' });
        console.error(err);
      }
      break;
    }
    case 'matchEnd': {
      ui.currentRoom = msg.room || ui.currentRoom;
      const isHost = ui.currentRoom ? ui.currentRoom.host === net.clientId : false;
      game.finish(msg.result, ui.currentRoom, isHost);
      break;
    }
    case 'chat': {
      ui.addChat(msg);
      break;
    }
    case 'pong': break;
    case 'error': {
      ui.showError(msg.message || '操作失败');
      if (msg.fatal) {
        clearSession();
        ui.setResumeAvailable(false);
      }
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ actions
// A first-time player gets one nudge towards the tutorial (and never again).
function tutorialDone() {
  return !!loadJSON(LS_TUTORIAL, {}).done;
}

function nudgeTutorial() {
  ui.setTutorialButtonDone?.(tutorialDone());
  if (tutorialDone()) return;
  setTimeout(() => {
    const onMenu = view === 'menu' && ui.screenMenu && !ui.screenMenu.classList.contains('hidden');
    if (onMenu) ui.toast('第一次来？点「新手教程」，2 分钟学会怎么打', 'ok');
  }, 2200);
}
// In-game quality switch: one click cycles 高 → 中 → 低 → 高 and persists.
function cycleQuality() {
  const order = ['high', 'med', 'low'];
  const current = settings.quality || 'med';
  const next = order[(order.indexOf(current) + 1) % order.length];
  settings.quality = next;
  if (next !== 'low' && stage.is3D !== false) settings.renderScale = 1;
  saveJSON(LS_SETTINGS, settings);
  ui.applySettings(settings);
  if (game.running) game.applyQuality(next, settings.renderScale);
  else stage.setQuality(is2D ? 'low' : next, settings.renderScale);
  ui.setQualityLabel(next);
  ui.toast(`画质已切换为「${{ high: '高', med: '中', low: '低' }[next]}」`, 'ok');
}

function setLoaderStatus(text, isErr = false) {
  const el = document.getElementById('loader-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
}

function setNetBanner(on, text = '') {
  const el = document.getElementById('net-banner');
  if (!el) return;
  el.classList.toggle('hidden', !on);
  if (text) document.getElementById('net-banner-text').textContent = text;
}

function runPending(action) {
  if (action === 'quick') startQuickplay();
}

function safeAudio() {
  try { audio.resume(); } catch (e) { reportClient('audio-fail', e); }
}

function startTutorial(mode = 'basic', opts = {}) {
  safeAudio();
  if (view === 'game' && tutorial.active) return;
  if (ui.currentRoom) { net.send({ type: 'leave' }); ui.currentRoom = null; }
  clearSession();
  ui.fade(true);
  setTimeout(() => ui.fade(false), 380);
  view = 'game';
  ui.showScreen('game');
  const advanced = mode === 'advanced';
  const shooting = mode === 'shooting';
  const mech = mode === 'mech';
  const mechId = opts.mechId || profile?.mech || 'assault';
  const level = opts.level || 'tutorial';
  try {
    tutorial.start({
      mode,
      mechId,
      level,
      onFinish: () => {
        if (mech) {
          const all = loadJSON(LS_MECH, {});
          all[mechId] = { ...(all[mechId] || {}), [level]: true };
          saveJSON(LS_MECH, all);
          ui.setMechProgress?.(all);
          reportClient('mech-lesson-done:' + mechId + ':' + level);
          return;
        }
        const key = shooting ? LS_SHOOTING : advanced ? LS_TRAINING : LS_TUTORIAL;
        const prev = loadJSON(key, {});
        saveJSON(key, { done: true, at: Date.now(), times: (prev.times || 0) + 1 });
        if (shooting) ui.setShootingButtonDone?.(true);
        else if (advanced) ui.setTrainingButtonDone?.(true);
        else ui.setTutorialButtonDone?.(true);
        reportClient(shooting ? 'shooting-done' : advanced ? 'training-done' : 'tutorial-done');
      },
      onExit: () => {},
    });
    reportClient(mech ? `mech-lesson-start:${mechId}:${level}`
      : shooting ? 'shooting-start' : advanced ? 'training-start' : 'tutorial-start');
  } catch (err) {
    reportClient('tutorial-fail', err);
    ui.showError('教程启动失败: ' + (err.message || err));
    console.error(err);
    exitTutorial();
  }
}

// mark the advanced-training button once it has been cleared
function refreshTrainingBadge() {
  ui.setTutorialButtonDone?.(tutorialDone());
  ui.setTrainingButtonDone?.(!!loadJSON(LS_TRAINING, {}).done);
  ui.setShootingButtonDone?.(!!loadJSON(LS_SHOOTING, {}).done);
  ui.setMechProgress?.(loadJSON(LS_MECH, {}));
}

function exitTutorial() {
  const wasActive = tutorial.active;
  if (wasActive) tutorial.exit();
  ui.hideTutorial?.();
  game.disposeWorld();
  view = 'menu';
  ui.showScreen('menu');
  menuScene.setMech(profile.mech, colorHex(profile.colorId));
  if (wasActive) reportClient('tutorial-exit');
}

function startQuickplay() {
  safeAudio();
  if (!net.connected) {
    pendingAction = 'quick';
    ui.toast('正在连接主机 · 连上后自动开战…');
    ui.setConnection('offline', '正在连接主机');
    net.connect();
    return;
  }
  if (ui.currentRoom) net.send({ type: 'leave' });
  clearSession();
  ui.fade(true);
  setTimeout(() => ui.fade(false), 380);
  net.send({
    type: 'createRoom',
    autoStart: true,
    profile,
    settings: { mode: 'ffa', bots: 3, eventRate: 'med', heatRate: 'standard', difficulty: 'easy', mapSize: 'auto' },
  });
  ui.toast('正在接线 · 一场混战即将开始');
  reportClient('quickplay-sent');
}

function createRoom() {
  safeAudio();
  if (!net.connected) { net.connect(); ui.toast('正在连接主机…'); return; }
  if (ui.currentRoom) net.send({ type: 'leave' });
  lobbyOpen = true;
  net.send({
    type: 'createRoom',
    profile,
    settings: { mode: 'ffa', bots: 3, eventRate: 'med', heatRate: 'standard', difficulty: 'normal', mapSize: 'auto' },
  });
}

function joinRoom(code) {
  safeAudio();
  if (!net.connected) { net.connect(); ui.toast('正在连接主机…'); return; }
  if (!code) return;
  ui.closeModal('modal-join');
  lobbyOpen = true;
  if (ui.currentRoom) net.send({ type: 'leave' });
  net.send({ type: 'join', code: String(code).toUpperCase(), profile });
}

function leaveRoom() {
  if (tutorial.active) { exitTutorial(); return; }
  net.send({ type: 'leave' });
  lobbyOpen = false;
  session = null;
  try { sessionStorage.removeItem(SS_SESSION); } catch {}
  ui.setResumeAvailable(false);
  ui.showDisconnect(false);
  ui.showScreen('menu');
  view = 'menu';
  game.disposeWorld();
  ui.currentRoom = null;
  net.send({ type: 'rooms' });
}

function resumeSession() {
  if (!session?.token) { ui.toast('没有可恢复的对局'); return; }
  ui.fade(true);
  setTimeout(() => ui.fade(false), 350);
  net.send({ type: 'resume', token: session.token });
}

function clearSession() {
  session = null;
  try { sessionStorage.removeItem(SS_SESSION); } catch {}
}

function connectServer(input) {
  const url = normalizeWsUrl(input);
  if (!url) { ui.showError('输入主机地址，例如 192.168.1.10:3000'); return; }
  net.close();
  wasConnected = false;
  ui.setConnection('offline', '正在连接 ' + url);
  net.connect(url);
  setTimeout(() => {
    if (net.connected) { ui.toast('已连接：' + url, 'ok'); ui.closeModal('modal-join'); net.send({ type: 'hello', profile }); net.send({ type: 'rooms' }); }
    else ui.showError('连接失败，检查主机 IP 和防火墙');
  }, 1800);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let frameAcc = 0;
let fpsFrames = 0, fpsTime = 0;
function frame(now) {
  const raw = (now - last) / 1000;
  last = now;
  // Frame cap: 144 Hz panels were rendering this game at 144 fps for no
  // visual benefit and 2.4× the GPU cost.
  const cap = Math.max(0, Number(settings.maxFps) || 60);
  const minFrame = cap > 0 ? 1 / cap : 0;
  frameAcc += raw;
  if (minFrame > 0 && frameAcc < minFrame - 0.0025) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.05, frameAcc);
  frameAcc = 0;
  try {
    if (view === 'menu' || view === 'lobby') {
      menuScene.update(dt);
    } else if (game.scene) {
      if (tutorial.active) tutorial.update(dt);
      game.update(dt);
    } else {
      menuScene.update(dt);
    }
    stage.render(dt);
  } catch (err) {
    if (!window.__frameErrAt || performance.now() - window.__frameErrAt > 3000) {
      window.__frameErrAt = performance.now();
      reportClient('frame-fail', err, { where: 'frame' });
      try { ui.toast('渲染出错: ' + err.message, 'err'); } catch {}
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ misc
window.addEventListener('beforeunload', () => { try { net.send({ type: 'leave' }); } catch {} });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.keys?.clear();
    game.mouse.down = false;
  }
});
// ping readout
setInterval(() => {
  if (net.connected) ui.setPing(net.rtt || 0);
}, 2000);

// swipe through mechs with A/D on the menu (when not typing)
window.addEventListener('keydown', (e) => {
  if (view !== 'menu' && view !== 'lobby') return;
  if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
    const list = ['assault', 'grappler', 'guardian', 'miner', 'sniper', 'furnace'];
    const i = list.indexOf(profile.mech);
    ui.setMechanic(list[(i - 1 + list.length) % list.length]);
  }
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
    const list = ['assault', 'grappler', 'guardian', 'miner', 'sniper', 'furnace'];
    const i = list.indexOf(profile.mech);
    ui.setMechanic(list[(i + 1) % list.length]);
  }
});
