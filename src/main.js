import { Stage } from './stage.js';
import { MenuScene } from './menuScene.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { Net, normalizeWsUrl } from './net.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { mechOf } from '../shared/mechs.js';

const LS_PROFILE = 'overload.profile.v1';
const LS_SETTINGS = 'overload.settings.v1';
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
const settings = loadJSON(LS_SETTINGS, { volume: 70, quality: 'high', shake: true, hints: true });

const canvas = document.getElementById('stage');
const stage = new Stage(canvas);
stage.setQuality(settings.quality);
const audio = new AudioSys();
audio.setVolume(settings.volume / 100);
const menuScene = new MenuScene(stage);
const colorHex = (id) => PLAYER_COLORS.find((c) => c.id === id)?.hex || PLAYER_COLORS[0].hex;
menuScene.setMech(profile.mech, colorHex(profile.colorId));

let view = 'menu';
let lobbyOpen = false;
let session = null;
try { session = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null'); } catch {}

const ui = new UI({
  audio,
  handlers: {
    onQuick: () => startQuickplay(),
    onCreate: () => createRoom(),
    onJoinOpen: () => { ui.openModal('modal-join'); net.send({ type: 'rooms' }); },
    onJoinCode: (code) => joinRoom(code),
    onJoinRoom: (code) => joinRoom(code),
    onRefreshRooms: () => net.send({ type: 'rooms' }),
    onConnectWs: (url) => connectServer(url),
    onStart: () => net.send({ type: 'start' }),
    onReady: (ready) => net.send({ type: 'setReady', ready }),
    onLeave: () => leaveRoom(),
    onRematch: () => net.send({ type: 'rematch' }),
    onToLobby: () => { lobbyOpen = true; net.send({ type: 'toLobby' }); },
    onChat: (text) => net.send({ type: 'chat', text }),
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
      stage.setQuality(settings.quality);
      ui.applySettings(settings);
      audio.setVolume(settings.volume / 100);
      if (game.running) {
        game.stage?.setQuality(settings.quality);
        game.arenaView?.setQuality(settings.quality);
        game.fx?.setQuality(settings.quality);
      }
    },
    onToggleAudio: () => ui.toggleAudio(),
    onResume: () => resumeSession(),
  },
});
ui.applyProfile(profile);
ui.applySettings(settings);
ui.setMechanic(profile.mech, true);
ui.showLoading();
ui.setConnection('offline', '正在连接主机');
ui.setServerUrl(Net.defaultUrl());
if (session?.token) ui.setResumeAvailable(true);

const game = new Game({
  stage, audio, ui,
  send: (msg) => net.send(msg),
});

// ------------------------------------------------------------------ network
const net = new Net({
  onMessage: (msg) => handleMessage(msg),
  onStatus: (status, extra) => {
    if (status === 'open') {
      ui.setConnection('online', '主机在线');
      ui.showDisconnect(false);
      if (wasConnected) {
        ui.toast('已重新连接主机', 'ok');
        if (session?.token) net.send({ type: 'resume', token: session.token });
      }
      net.send({ type: 'rooms' });
    } else if (status === 'connecting') {
      ui.setConnection('offline', '正在连接主机');
    } else if (status === 'retrying') {
      ui.setConnection('offline', '信号中断，重连中');
      if (view === 'game') ui.showDisconnect(true, `第 ${net.retry} 次重试…`);
    } else if (status === 'closed') {
      ui.setConnection('offline', '主机离线');
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

// never trap the player on the loading screen if the host is unreachable
setTimeout(() => {
  if (ui.screenLoading && !ui.screenLoading.classList.contains('hidden')) {
    ui.hideLoading();
    ui.toast('未连上主机 · 可在“加入房间”里填写主机地址', 'err');
  }
}, 6500);

// expose for menu-scene quality etc.
window.__overload = { net, game, ui, stage, menuScene };

// ------------------------------------------------------------------ messages
function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome': {
      if (msg.rooms) ui.setRooms(msg.rooms);
      ui.setConnection('online', '主机在线');
      onFirstConnect();
      net.send({ type: 'hello', profile });
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
      game.start(msg);
      ui.setResumeAvailable(true);
      break;
    }
    case 'snapshot': {
      game.onSnapshot(msg.snap, msg.you);
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
function startQuickplay() {
  audio.resume();
  if (!net.connected) { net.connect(); ui.toast('正在连接主机…'); return; }
  if (ui.currentRoom) net.send({ type: 'leave' });
  clearSession();
  ui.fade(true);
  setTimeout(() => ui.fade(false), 380);
  net.send({
    type: 'createRoom',
    autoStart: true,
    profile,
    settings: { mode: 'ffa', bots: 3, eventRate: 'med', heatRate: 'standard', difficulty: 'normal', mapSize: 'auto' },
  });
  ui.toast('正在接线 · 一场混战即将开始');
}

function createRoom() {
  audio.resume();
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
  audio.resume();
  if (!net.connected) { net.connect(); ui.toast('正在连接主机…'); return; }
  if (!code) return;
  ui.closeModal('modal-join');
  lobbyOpen = true;
  if (ui.currentRoom) net.send({ type: 'leave' });
  net.send({ type: 'join', code: String(code).toUpperCase(), profile });
}

function leaveRoom() {
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
let fpsFrames = 0, fpsTime = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (view === 'menu' || view === 'lobby') {
    menuScene.update(dt);
    // keep the game scene alive behind results only; menu has no game
  } else if (game.scene) {
    game.update(dt);
  } else {
    menuScene.update(dt);
  }
  stage.render(dt);
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
