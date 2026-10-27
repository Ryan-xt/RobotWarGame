import { MECHS, MECH_LIST, mechOf } from '../shared/mechs.js';
import { PLAYER_COLORS, ITEM_TYPES, EVENT_META, BULLET } from '../shared/constants.js';
import { iconTexture } from './textures.js';
import { MECH_LESSONS, LESSON_META, LESSON_LEVELS, lessonTitle } from './mechlessons.js';

// Memoised lookups: the HUD touches ~40 nodes twenty times per second, and
// getElementById/querySelector showed up as the largest cost in the profiler.
const _elCache = new Map();
const $ = (id) => {
  let el = _elCache.get(id);
  if (el !== undefined && (el === null || el.isConnected !== false)) return el;
  el = document.getElementById(id);
  if (el) _elCache.set(id, el);
  return el;
};
const _qCache = new Map();
const q = (sel) => {
  let el = _qCache.get(sel);
  if (el !== undefined && (el === null || el.isConnected !== false)) return el;
  el = document.querySelector(sel);
  if (el) _qCache.set(sel, el);
  return el;
};
const modeLabel = (m) => ({ ffa: '自由混战', '2v2': '2v2 队伍', '3v3': '3v3 队伍', '4v4': '4v4 队伍' }[m] || m);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// simple angular mech sigils for the DOM (silhouette by role)
export function mechSVG(shape, cls = '') {
  const common = `fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;
  const parts = {
    assault: `<path d="M16 30 L14 20 L22 16 L42 16 L50 20 L48 30 L44 26 L20 26 Z" ${common}/><rect x="24" y="26" width="16" height="12" rx="1" ${common}/><path d="M18 38 L14 56 M46 38 L50 56 M27 38 L27 56 M37 38 L37 56" ${common}/><path d="M32 18 L32 12" ${common}/><path d="M22 44 L42 44" ${common}/>`,
    grappler: `<path d="M20 34 L18 20 L26 14 L38 14 L46 20 L44 34" ${common}/><rect x="26" y="32" width="12" height="18" rx="1" ${common}/><path d="M22 36 L16 52 M42 36 L48 52 M32 50 L32 58" ${common}/><path d="M44 20 L54 12 L58 20 M54 12 L54 6" ${common}/><circle cx="32" cy="24" r="3" ${common}/>`,
    guardian: `<path d="M14 28 L18 18 L46 18 L50 28 L46 34 L18 34 Z" ${common}/><rect x="24" y="34" width="16" height="18" ${common}/><path d="M18 40 L12 56 M46 40 L52 56 M28 52 L28 58 M36 52 L36 58" ${common}/><path d="M50 22 C58 26 58 34 50 38" ${common}/><circle cx="32" cy="26" r="4" ${common}/>`,
    miner: `<path d="M18 32 L16 24 L24 18 L40 18 L48 24 L46 32" ${common}/><rect x="24" y="32" width="16" height="12" ${common}/><path d="M20 40 L12 56 M44 40 L52 56 M26 44 L26 58 M38 44 L38 58" ${common}/><circle cx="32" cy="26" r="3" ${common}/><path d="M14 22 L6 16 M50 22 L58 16" ${common}/>`,
    sniper: `<path d="M22 32 L20 18 L28 14 L36 14 L44 18 L42 32" ${common}/><rect x="27" y="32" width="10" height="20" ${common}/><path d="M24 38 L18 56 M40 38 L46 56 M32 52 L32 58" ${common}/><path d="M44 20 L58 14" ${common}/><rect x="28" y="20" width="8" height="5" ${common}/>`,
    furnace: `<circle cx="32" cy="28" r="13" ${common}/><path d="M17 34 L14 52 M47 34 L50 52 M26 52 L26 58 M38 52 L38 58" ${common}/><path d="M32 16 L32 10 M24 20 L20 15 M40 20 L44 15" ${common}/><path d="M32 22 L28 30 L33 30 L29 38 L37 28 L32 28 Z" ${common}/>`,
  };
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">${parts[shape] || parts.assault}</svg>`;
}

const TUTORIAL_TITLES = { basic: '新手教程', advanced: '进阶训练', shooting: '射击训练', mech: '机体专训' };

export class UI {
  constructor({ audio, handlers } = {}) {
    this.audio = audio;
    this.handlers = handlers || {};
    this.profile = { name: '废土客', colorId: 'orange', mech: 'assault' };
    this.rooms = [];
    this.currentRoom = null;
    this.you = null;
    this.match = null;
    this.arena = null;
    this.youId = null;
    this.killer = null;
    this.killerColor = null;
    this.eventKey = null;
    this.eventTimer = 0;
    this.tutorialTimer = 0;
    this.lobbyChat = [];
    this.gameChat = [];
    this.settings = { volume: 70, quality: 'med', renderScale: 1, maxFps: 60, shake: true, hints: true };
    this.scoreboardOpen = false;
    this.resultData = null;
    this.deathActive = false;
    this.lastSnapshot = null;
    this.ping = 0;
    this.fps = 0;
    this.init();
  }

  // Sound must never be able to swallow a click: the action always runs.
  click() {
    try { this.audio?.sfx('ui'); } catch (err) { console.warn('[ui] click sfx failed', err); }
  }

  init() {
    this.screenLoading = $('screen-loading');
    this.screenMenu = $('screen-menu');
    this.screenLobby = $('screen-lobby');
    this.screenGame = $('screen-game');
    this.screenResults = $('screen-results');
    this.buildSwatches();
    this.buildMechRail();
    this.buildArchive();
    this.buildAmmoPips();
    this.bind();
    this.setMechanic('assault', true);
  }

  buildSwatches() {
    const wrap = $('color-swatches');
    wrap.innerHTML = '';
    for (const c of PLAYER_COLORS) {
      const s = document.createElement('button');
      s.className = 'swatch';
      s.style.background = c.hex;
      s.title = c.name;
      s.dataset.color = c.id;
      s.onclick = () => { this.click(); this.setColor(c.id); };
      wrap.appendChild(s);
    }
    this.refreshSwatches();
  }

  refreshSwatches() {
    document.querySelectorAll('.swatch').forEach((el) => {
      el.classList.toggle('active', el.dataset.color === this.profile.colorId);
    });
  }

  buildMechRail() {
    const rail = $('mech-rail');
    rail.innerHTML = '';
    for (const m of MECH_LIST) {
      const b = document.createElement('button');
      b.className = 'mech-card';
      b.dataset.mech = m.id;
      b.innerHTML = `${mechSVG(m.shape)}<b>${m.name}</b><small>${m.role}</small>`;
      b.onclick = () => { this.click(); this.setMechanic(m.id); };
      rail.appendChild(b);
    }
  }

  buildArchive() {
    const wrap = $('mech-archive');
    wrap.innerHTML = '';
    for (const m of MECH_LIST) {
      const el = document.createElement('div');
      el.className = 'archive-item';
      el.innerHTML = `
        <h4>${m.name} <span style="color:var(--faint);font-size:9px">${m.en}</span></h4>
        <div class="ar-role">${m.role}</div>
        <p>${m.blurb}</p>
        <div class="ar-skill">右键 · ${m.skill.name}：${m.skill.desc}</div>
        <div class="ar-skill" style="color:var(--amber)">被动 · ${m.passive.name}：${m.passive.desc}</div>`;
      wrap.appendChild(el);
    }
  }

  /**
   * 机体训练中心：六台机体 × 两套课（专属教程 / 进阶玩法）。
   * 卡片直接由 shared/mechs.js + mechlessons.js 生成，加机体不用改 HTML。
   */
  buildMechTrain(progress = this.mechProgress || {}) {
    this.mechProgress = progress;
    const wrap = $('mech-train-grid');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const m of MECH_LIST) {
      const lessons = MECH_LESSONS[m.id] || { tutorial: [], advanced: [] };
      const meta = LESSON_META[m.id] || {};
      const done = progress[m.id] || {};
      const card = document.createElement('div');
      card.className = 'mech-train-card';
      card.dataset.mech = m.id;
      const buttons = LESSON_LEVELS.map((lv) => {
        const steps = lessons[lv.id] || [];
        const ok = !!done[lv.id];
        return `<button class="btn ghost tiny mech-lesson-btn${ok ? ' done' : ''}"
          data-mech="${m.id}" data-level="${lv.id}">
          <b>${ok ? '✓ ' : ''}${lv.label}</b><small>${steps.length} 步 · ${lv.desc}</small>
        </button>`;
      }).join('');
      card.innerHTML = `
        <div class="mt-head">
          <span class="mt-dot" style="background:${m.glow || m.accent}"></span>
          <h4>${m.name}<span class="mt-en">${m.en}</span></h4>
          <span class="mt-role">${m.role}</span>
        </div>
        <p class="mt-play">${meta.playstyle || m.blurb}</p>
        <div class="mt-skill"><b>右键 · ${m.skill.name}</b>${m.skill.desc}</div>
        <div class="mt-passive"><b>被动 · ${m.passive.name}</b>${m.passive.desc}</div>
        <div class="mt-actions">${buttons}</div>`;
      wrap.appendChild(card);
    }
  }

  /** Refresh the ✓ marks after finishing a lesson. */
  setMechProgress(progress) {
    this.buildMechTrain(progress || {});
  }

  buildAmmoPips() {
    const pips = $('ammo-pips');
    pips.innerHTML = '';
    for (let i = 0; i < BULLET.magSize; i++) pips.appendChild(document.createElement('i'));
  }

  bind() {
    const h = this.handlers;
    const tap = (id, fn) => {
      const el = $(id);
      if (!el) return;
      el.onclick = (ev) => {
        try { this.click(); } catch (err) { console.warn('[ui] sfx failed', err); }
        try { fn && fn(ev); } catch (err) {
          console.error('[ui] handler failed for', id, err);
          this.toast('操作失败: ' + (err && err.message || id), 'err');
        }
      };
    };
    tap('btn-quick', () => h.onQuick?.());
    tap('btn-hud-help', () => this.openModal('modal-help'));
    tap('btn-tutorial', () => h.onTutorial?.());
    tap('btn-training', () => h.onTraining?.());
    tap('btn-shooting', () => this.handlers.onShooting?.());
    tap('btn-mech-train', () => {
      this.buildMechTrain(this.mechProgress || {});
      this.openModal('modal-mech-train');
    });
    const grid = $('mech-train-grid');
    if (grid) {
      grid.onclick = (ev) => {
        const btn = ev.target?.closest?.('.mech-lesson-btn');
        if (!btn) return;
        try { this.click(); } catch {}
        const mechId = btn.dataset.mech;
        const level = btn.dataset.level;
        try { this.handlers.onMechTrain?.(mechId, level); } catch (err) {
          console.error('[ui] mech lesson failed', err);
          this.toast('课程启动失败: ' + (err && err.message || ''), 'err');
        }
      };
    }
    tap('btn-fieldguide', () => this.openModal('modal-field'));
    tap('btn-fieldguide-2', () => this.openModal('modal-field'));
    tap('btn-tut-skip', () => h.onTutorialSkip?.());
    tap('btn-tut-exit', () => h.onTutorialExit?.());
    tap('btn-tut-fight', () => h.onTutorialFight?.());
    tap('btn-tut-menu', () => h.onTutorialMenu?.());
    tap('btn-create', () => h.onCreate?.());
    tap('btn-join', () => h.onJoinOpen?.());
    tap('btn-help', () => this.openModal('modal-help'));
    tap('btn-settings', () => this.openModal('modal-settings'));
    tap('btn-audio', () => h.onToggleAudio?.());
    tap('btn-resume', () => h.onResume?.());
    tap('btn-copy-code', () => this.copyRoomCode());
    tap('btn-leave-lobby', () => h.onLeave?.());
    tap('btn-ready', () => h.onReady?.(!this.myReady));
    tap('btn-start', () => h.onStart?.());
    tap('btn-chat-send', () => this.sendChat());
    tap('btn-refresh-rooms', () => h.onRefreshRooms?.());
    tap('btn-join-code', () => {
      const code = $('join-code').value.trim().toUpperCase();
      if (code) h.onJoinCode?.(code);
    });
    tap('btn-connect-ws', () => h.onConnectWs?.($('ws-url').value.trim()));
    tap('btn-save-settings', () => { this.saveSettings(); });
    tap('btn-hud-leave', () => h.onLeave?.());
    tap('btn-hud-quality', () => h.onCycleQuality?.());
    tap('btn-rematch', () => h.onRematch?.());
    tap('btn-to-lobby', () => h.onToLobby?.());
    tap('btn-results-leave', () => h.onLeave?.());

    $('join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const code = $('join-code').value.trim().toUpperCase(); if (code) h.onJoinCode?.(code); }
    });
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); }
    });
    document.querySelectorAll('.quick-chat button').forEach((b) => {
      b.onclick = () => this.sendChat(b.dataset.phrase);
    });
    document.querySelectorAll('.modal-x').forEach((b) => {
      b.onclick = () => { this.click(); this.closeModal(b.dataset.close); };
    });
    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('mousedown', (e) => { if (e.target === m) this.closeModal(m.id); });
    });

    $('input-name').addEventListener('input', (e) => {
      const v = e.target.value.trim().slice(0, 10);
      this.profile.name = v || '废土客';
      h.onProfileChange?.({ ...this.profile });
    });
    $('input-name').addEventListener('change', () => { if (!this.profile.name) $('input-name').value = '废土客'; });

    const settingsMap = { 'set-mode': 'mode', 'set-bots': 'bots', 'set-map': 'mapSize', 'set-event': 'eventRate', 'set-heat': 'heatRate', 'set-difficulty': 'difficulty' };
    for (const [id, key] of Object.entries(settingsMap)) {
      $(id).addEventListener('change', () => {
        const v = $(id).value;
        h.onSettingsChange?.({ [key]: key === 'bots' ? Number(v) : key === 'mapSize' && v !== 'auto' ? Number(v) : v });
      });
    }
    $('set-quality').addEventListener('change', () => { this.settings.quality = $('set-quality').value; });
    const resSel = $('set-res');
    if (resSel) resSel.addEventListener('change', () => { this.settings.renderScale = Number(resSel.value) || 1; });
    const fpsSel = $('set-fps');
    if (fpsSel) fpsSel.addEventListener('change', () => { this.settings.maxFps = Number(fpsSel.value); });
    $('set-volume').addEventListener('input', () => { this.settings.volume = Number($('set-volume').value); this.audio?.setVolume(this.settings.volume / 100); });
    $('set-shake').addEventListener('change', () => { this.settings.shake = $('set-shake').checked; });
    $('set-hints').addEventListener('change', () => { this.settings.hints = $('set-hints').checked; });

    document.addEventListener('pointerdown', () => { this.audio?.resume(); }, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach((m) => this.closeModal(m.id));
      }
    });
  }

  sendChat(text = null) {
    const input = $('chat-input');
    const msg = (text ?? input.value).trim();
    if (!msg) return;
    this.handlers.onChat?.(msg.slice(0, 60));
    if (text == null) input.value = '';
    input.blur();
  }

  copyRoomCode() {
    const code = this.currentRoom?.code || '';
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => this.toast('房间码已复制：' + code, 'ok')).catch(() => this.toast('房间码：' + code));
  }

  // ------------------------------------------------------------- profile/menu
  applyProfile(profile) {
    this.profile = { ...this.profile, ...profile };
    $('input-name').value = this.profile.name;
    this.refreshSwatches();
    this.setMechanic(this.profile.mech, true);
  }

  setColor(colorId) {
    const c = PLAYER_COLORS.find((x) => x.id === colorId);
    if (!c) return;
    this.profile.colorId = c.id;
    this.refreshSwatches();
    this.handlers.onProfileChange?.({ ...this.profile });
    this.handlers.onColorChange?.(c.hex);
  }

  setMechanic(id, silent = false) {
    const mech = mechOf(id);
    this.profile.mech = mech.id;
    document.querySelectorAll('.mech-card').forEach((el) => el.classList.toggle('active', el.dataset.mech === mech.id));
    $('menu-mech-name').textContent = mech.name;
    $('menu-mech-role').textContent = `${mech.role} · ${mech.en}`;
    $('menu-mech-blurb').textContent = mech.blurb;
    $('menu-skill-name').textContent = mech.skill.name;
    $('menu-skill-cd').textContent = 'CD ' + mech.skill.cd + 's';
    $('menu-skill-desc').textContent = mech.skill.desc;
    $('menu-passive-name').textContent = mech.passive.name;
    $('menu-passive-desc').textContent = mech.passive.desc;
    $('mc-sigil').innerHTML = mechSVG(mech.shape);
    const stats = [
      ['机动', (1.25 - mech.stats.speed) / 0.4],
      ['抗热', (1.25 - mech.stats.heat) / 0.4],
      ['火力', (mech.stats.power - 0.85) / 0.45],
      ['操控', (mech.stats.control - 0.8) / 0.45],
    ];
    $('menu-stats').innerHTML = stats.map(([k, v]) =>
      `<div class="statbar"><span>${k}</span><i style="--v:${clamp(Math.round(v * 100), 18, 100)}%"></i></div>`).join('');
    $('menu-mech-tip').textContent = this.tipFor(mech.id);
    if (!silent) {
      this.handlers.onProfileChange?.({ ...this.profile });
      this.handlers.onMechChange?.(mech.id);
    }
  }

  tipFor(id) {
    return {
      assault: '冲撞可以穿过弹幕；撞到人后立刻掏枪，击退会让你刚好在射程内。',
      grappler: '钩爪能把人从散热区拖出来。钩墙逃跑时，记得墙后可能有人等你。',
      guardian: '电磁盾能反弹弹道；站在散热区举盾，是废土最气人的姿势。',
      miner: '地雷可以被敌人打爆——也能被你自己打爆，用来逼走位。',
      sniper: '蓄力时的慢速就是代价。让队友先交火，再从侧面钉人。',
      furnace: '引信点燃后会吸引所有人跑开。假装要炸，往往比真的炸更赚。',
    }[id] || '';
  }

  setConnection(state, text) {
    const el = $('conn-status');
    el.className = 'conn ' + state;
    el.innerHTML = `<i></i>${text}`;
  }

  setResumeAvailable(on) { $('btn-resume').classList.toggle('hidden', !on); }

  setServerUrl(url) { const el = $('ws-url'); if (el && !el.value) el.placeholder = url; }

  // ---------------------------------------------------------------- screens
  showScreen(name) {
    const map = {
      loading: this.screenLoading, menu: this.screenMenu, lobby: this.screenLobby,
      game: this.screenGame, results: this.screenResults,
    };
    for (const [k, el] of Object.entries(map)) el.classList.toggle('hidden', k !== name);
    if (name === 'game') {
      // 从「机体专训」弹窗里直接开课：弹窗必须先收起来，不然会盖住教程面板
      this.closeAllModals?.();
      this.screenGame.classList.add('active');
      document.body.classList.add('in-game');
      document.body.style.cursor = 'none';
    } else {
      this.screenGame.classList.remove('active');
      document.body.classList.remove('in-game');
      document.body.style.cursor = '';
    }
    if (name === 'menu') {
      this.closeAllModals();
      this.screenResults.classList.add('hidden');
    }
    if (name !== 'game') this.hideCrosshair();
  }

  showLoading() { this.showScreen('loading'); }
  hideLoading() { this.screenLoading.classList.add('hidden'); this.showScreen('menu'); }

  openModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.remove('hidden');
    if (id === 'modal-join') this.handlers.onRefreshRooms?.();
    if (id === 'modal-settings') this.loadSettingsToUI();
  }
  closeModal(id) { $(id)?.classList.add('hidden'); }
  closeAllModals() { document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); }

  loadSettingsToUI() {
    const q = $('set-quality');
    if (q) q.value = this.settings.quality;
    const rs = $('set-res');
    if (rs) rs.value = String(this.settings.renderScale ?? 1);
    const fp = $('set-fps');
    if (fp) fp.value = String(this.settings.maxFps ?? 60);
    $('set-volume').value = this.settings.volume;
    $('set-shake').checked = this.settings.shake;
    $('set-hints').checked = this.settings.hints;
  }

  /** Keep the settings dropdown in sync when quality auto-degrades mid-match. */
  syncQualitySelect(quality) {
    const q = $('set-quality');
    if (q) q.value = quality;
  }

  saveSettings() {
    this.settings.quality = $('set-quality').value;
    const rs = $('set-res');
    if (rs) this.settings.renderScale = Number(rs.value) || 1;
    const fp = $('set-fps');
    if (fp) this.settings.maxFps = Number(fp.value);
    this.settings.volume = Number($('set-volume').value);
    this.settings.shake = $('set-shake').checked;
    this.settings.hints = $('set-hints').checked;
    this.audio?.setVolume(this.settings.volume / 100);
    this.handlers.onSettingsSave?.({ ...this.settings });
    this.closeModal('modal-settings');
    this.toast('设置已保存');
  }

  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.loadSettingsToUI();
    document.body.dataset.quality = this.settings.quality || 'med';
  }

  toggleAudio() {
    const muted = !this.audio?.enabled;
    if (this.audio) {
      this.audio.enabled = muted;
      this.audio.setVolume(muted ? this.settings.volume / 100 : 0);
    }
    $('btn-audio').textContent = muted ? '🔊' : '🔇';
    this.toast(muted ? '声音已开启' : '已静音');
  }

  setRooms(rooms) {
    this.rooms = rooms || [];
    const list = $('room-list');
    if (!this.rooms.length) {
      list.innerHTML = '<div class="room-empty">当前没有公开房间。<br>创建一个，或者直接快速开战。</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of this.rooms) {
      const b = document.createElement('button');
      b.className = 'room-item';
      b.innerHTML = `<span class="rc">${r.code}</span><span class="rm">${modeLabel(r.mode)}${r.settings?.bots ? ' · AI ' + r.settings.bots : ''}</span><span class="rp">${r.players} 人 · 点击加入</span>`;
      b.onclick = () => { this.click(); this.handlers.onJoinCode?.(r.code); };
      list.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- lobby
  showLobby(room, you) {
    this.currentRoom = room;
    this.you = you;
    this.showScreen('lobby');
    this.updateLobby(room, you);
  }

  updateLobby(room, you = this.you) {
    this.currentRoom = room;
    if (room) this.you = you;
    if (!room) return;
    const isHost = room.host === you;
    $('lobby-code').textContent = room.code;
    const me = room.players.find((p) => p.clientId === you);
    this.myReady = !!me?.ready;
    const humans = room.players.filter((p) => !p.bot);
    $('lobby-count').textContent = `${room.players.length} / ${room.settings.mode === 'ffa' ? 8 : Number(room.settings.mode[0]) * 2}`;
    const list = $('lobby-players');
    list.innerHTML = '';
    for (const p of room.players) {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.clientId === you ? ' you' : '');
      row.innerHTML = `
        <span class="player-dot" style="background:${p.color};color:${p.color}"></span>
        <span class="player-name">${escapeHtml(p.name)}${p.isHost ? ' 👑' : ''}</span>
        <span class="player-mech">${mechOf(p.mech).name} · ${mechOf(p.mech).role}</span>
        ${p.bot ? '<span class="player-badge bot">AI</span>' : ''}
        ${p.isHost ? '<span class="player-badge">房主</span>' : ''}
        <span class="player-ready ${p.ready ? '' : 'no'}">${p.bot ? '待命' : p.ready ? '就绪' : '未准备'}</span>`;
      list.appendChild(row);
    }
    $('btn-ready').textContent = this.myReady ? '取消准备' : '准备';
    $('btn-ready').disabled = isHost;
    $('btn-start').disabled = !isHost;
    $('btn-start').textContent = isHost ? '开始战斗' : '等待房主';
    $('settings-host-tag').textContent = isHost ? '你是房主 · 可修改' : '仅房主可改';
    for (const id of ['set-mode', 'set-bots', 'set-map', 'set-event', 'set-heat', 'set-difficulty']) $(id).disabled = !isHost;
    const s = room.settings;
    $('set-mode').value = s.mode;
    $('set-bots').value = String(s.bots);
    $('set-map').value = String(s.mapSize);
    $('set-event').value = s.eventRate;
    $('set-heat').value = s.heatRate;
    $('set-difficulty').value = s.difficulty;
    $('lobby-note').textContent = isHost
      ? '你是房主。设定完战场后直接开战；AI 会补齐空位，朋友可以随时加入等待。'
      : '等待房主开始。可以先在聊天里商量好谁去抢中央的清空过载。';
    this.renderLobbyChat();
  }

  renderLobbyChat() {
    const log = $('chat-log');
    log.innerHTML = this.lobbyChat.map((c) =>
      `<div class="chat-line ${c.sys ? 'sys' : ''}">${c.sys ? '' : `<b style="color:${c.color || 'var(--amber)'}">${escapeHtml(c.name || '')}</b>`}${escapeHtml(c.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  addChat({ name, color, text, sys = false }) {
    if (sys) {
      this.lobbyChat.push({ text, sys });
      this.gameChat.push({ text, sys });
    } else {
      this.lobbyChat.push({ name, color, text });
      this.gameChat.push({ name, color, text });
    }
    if (this.lobbyChat.length > 40) this.lobbyChat.shift();
    if (this.gameChat.length > 4) this.gameChat.shift();
    this.renderLobbyChat();
    const mini = $('chat-mini');
    mini.innerHTML = this.gameChat.map((c) =>
      `<div class="cm">${c.sys ? '' : `<b style="color:${c.color || 'var(--amber)'}">${escapeHtml(c.name)}</b>`} ${escapeHtml(c.text)}</div>`).join('');
  }

  // ---------------------------------------------------------------- match
  beginMatch(info, arena) {
    this.match = info;
    this.arena = arena;
    this.youId = info.you;
    this.killer = null;
    this.killerColor = null;
    this.eventKey = null;
    this.deathActive = false;
    this.scoreboardOpen = false;
    $('scoreboard').classList.add('hidden');
    $('death-overlay').classList.add('hidden');
    $('countdown').classList.remove('hidden');
    $('tutorial').classList.toggle('hidden', !this.settings.hints);
    this.tutorialTimer = 26;
    $('event-banner').classList.add('hidden');
    $('killfeed').innerHTML = '';
    $('chat-mini').innerHTML = '';
    this.gameChat = [];
    $('hud-room').textContent = 'ROOM ' + (info.roomCode || this.currentRoom?.code || '----');
    $('hud-mode').textContent = modeLabel(info.settings?.mode || 'ffa');
    $('hud-time').textContent = fmtTime(info.duration || 180);
    $('hud-time').className = 'time';
    $('hud-phase').textContent = '核心同步';
    $('hud-teamscore').classList.add('hidden');
    $('storm-overlay').classList.remove('on');
    $('sandstorm-overlay').classList.remove('on');
    $('damage-vignette').style.opacity = 0;
    $('reload-bar').classList.remove('active');
    $('buff-row').innerHTML = '';
    const mech = mechOf(info.players?.find((p) => p.id === info.you)?.mech || this.profile.mech);
    $('hud-mech-name').textContent = mech.name;
    $('hud-mech-role').textContent = mech.role;
    $('hud-sigil').innerHTML = mechSVG(mech.shape);
    $('ab-skill-name').textContent = mech.skill.name;
    $('ab-skill-glyph').textContent = { assault: '➤', grappler: '⛓', guardian: '⛨', miner: '✳', sniper: '✛', furnace: '☢' }[mech.id] || '⚡';
    $('ab-skill').classList.remove('empty');
    this.skillMax = mech.skill.cd;
    $('minimap-size').textContent = arena ? arena.size + 'm' : '';
    if (arena) this.drawMinimap(null, null, arena);
    this.setItemState(null);
    this._ammoKey = null;
    this._buffHtml = null;
    this._heatShown = null;
    this._heatState = null;
    this._skillLabel = null;
    this._skillP = null;
    this._dashP = null;
    this._timeText = null;
    this.showScreen('game');
  }

  updateHUD(snap, self, ctx = {}) {
    if (!snap) return;
    this.lastSnapshot = snap;
    const timeLeft = snap.timeLeft ?? 0;
    // DOM writes are the most expensive part of the HUD: skip unchanged nodes.
    const timeText = this.tutorialMode ? '训练' : fmtTime(timeLeft);
    if (timeText !== this._timeText) {
      this._timeText = timeText;
      $('hud-time').textContent = timeText;
    }
    const warn = timeLeft <= 30;
    const timeClass = 'time' + (timeLeft <= 10 ? ' danger' : warn ? ' warn' : '');
    if (timeClass !== this._timeClass) {
      this._timeClass = timeClass;
      $('hud-time').className = timeClass;
    }
    const phase = this.tutorialMode
      ? (this.tutorialKind === 'advanced' ? '进阶训练' : this.tutorialKind === 'shooting' ? '射击训练' : '训练场')
      : snap.phase === 'countdown' ? '核心同步' : snap.storm ? '电磁风暴' : timeLeft <= 30 ? '最后 30 秒' : '混战进行中';
    if (phase !== this._phaseText) {
      this._phaseText = phase;
      $('hud-phase').textContent = phase;
    }
    if (snap.teamScores) {
      const el = $('hud-teamscore');
      el.classList.remove('hidden');
      const html = `<i style="color:var(--cyan)">蓝队 ${(snap.teamScores[0] || 0).toFixed(1)}</i><i style="color:var(--amber)">橙队 ${(snap.teamScores[1] || 0).toFixed(1)}</i>`;
      if (html !== this._teamHtml) { this._teamHtml = html; el.innerHTML = html; }
    } else if (this._teamHtml !== null) {
      this._teamHtml = null;
      $('hud-teamscore').classList.add('hidden');
    }
    if (self) {
      this.updateHeat(self);
      this.updateAmmo(self);
      this.updateAbilities(self, snap);
      this.updateBuffs(self);
      this.updateDeath(self, snap);
      $('hud-spectate').classList.toggle('hidden', self.alive);
      if (!self.alive) {
        const killed = snap.scores?.find((s) => s.id === self.id);
        $('hud-spectate').textContent = this.killer ? `观战 · ${this.killer}` : '核心离线 · 等待重启';
      }
      this.audio?.updateAlarm(self.alive && self.heat >= 70, ctx.dt || 0.05);
    }
    if (snap.phase === 'countdown') {
      const n = Math.ceil(snap.countdown || 0);
      $('countdown').classList.remove('hidden');
      const num = $('countdown').querySelector('.cd-num');
      const txt = n > 0 ? String(n) : 'GO';
      if (num.textContent !== txt) { num.textContent = txt; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = ''; }
      $('countdown').querySelector('.cd-label').textContent = '核心同步 · 准备接线';
    } else {
      if (!$('countdown').classList.contains('hidden') && snap.phase === 'live') {
        setTimeout(() => $('countdown').classList.add('hidden'), 250);
      }
      if (snap.phase === 'over') $('countdown').classList.add('hidden');
    }
    this.updateEventBanner(snap);
    $('storm-overlay').classList.toggle('on', !!snap.storm);
    if (snap.sandstorm > 0) $('sandstorm-overlay').classList.add('on');
    else $('sandstorm-overlay').classList.remove('on');
    if (this.tutorialTimer !== null && this.tutorialTimer > 0) {
      this.tutorialTimer -= ctx.dt || 0.05;
      if (this.tutorialTimer <= 0) $('tutorial').classList.add('hidden');
    }
    if (this.scoreboardOpen) this.renderScoreboard(snap, this.youId);
  }

  updateHeat(self) {
    const heat = clamp(self.heat || 0, 0, 100);
    const state = heat >= 90 ? '临界' : heat >= 70 ? '危险' : heat >= 40 ? '升温' : '安全';
    const color = heat >= 90 ? '#ff4b3a' : heat >= 70 ? '#ff7a2e' : heat >= 40 ? '#ffcf5a' : '#46d9ff';
    if (color !== this._heatColor) {
      this._heatColor = color;
      document.documentElement.style.setProperty('--heat', color);
    }
    const shown = Math.round(heat);
    if (shown !== this._heatShown) { this._heatShown = shown; $('heat-value').textContent = shown; }
    if (state !== this._heatState) { this._heatState = state; $('heat-state').textContent = state; }
    $('heat-fill').style.width = heat + '%';
    const block = q('.heat-block');
    block.classList.toggle('critical', heat >= 90);
    block.classList.toggle('warm', heat >= 70 && heat < 90);
    $('heat-note').textContent = heat >= 90 ? '短路倒计时 · 立刻冲刺去散热区或按 E 冷却'
      : heat >= 70 ? '你已成为全场集火目标 · 注意电流声'
        : heat >= 40 ? '机甲开始发热 · 移动略微变慢'
          : self.inCooler ? '散热区 · 正在快速降温' : '温度正常 · 保持移动';
    const vig = $('damage-vignette');
    vig.style.opacity = heat >= 90 ? (0.22 + Math.sin(performance.now() / 120) * 0.09) : heat >= 70 ? 0.1 : 0;
  }

  updateAmmo(self) {
    if (!this._pips) this._pips = [...$('ammo-pips').children];
    const ammo = self.ammo || 0;
    const reloading = (self.reloading || 0) > 0;
    const key = `${ammo}:${reloading}`;
    if (key !== this._ammoKey) {
      this._ammoKey = key;
      for (let i = 0; i < this._pips.length; i++) {
        this._pips[i].classList.toggle('on', i < ammo);
        this._pips[i].classList.toggle('hot', reloading && i % 2 === 0);
      }
      $('reload-bar').classList.toggle('active', reloading);
      $('ammo-label').textContent = reloading ? '换弹中' : `${ammo}/${BULLET.magSize}`;
    }
    if (reloading) $('reload-bar').firstElementChild.style.width = clamp((1 - self.reloading / 1.25) * 100, 0, 100) + '%';
  }

  updateAbilities(self, snap) {
    const mech = mechOf(self.mech);
    const skillCd = self.skillCd || 0;
    const p = Math.round(clamp(100 - (skillCd / (this.skillMax || 1)) * 100, 0, 100));
    if (p !== this._skillP) {
      this._skillP = p;
      q('#ab-skill .ab-ring')?.style.setProperty('--p', p);
      q('#ab-skill .ab-ring')?.style.setProperty('--c', skillCd > 0 ? '#7a7568' : 'var(--amber)');
    }
    const skillLabel = skillCd > 0.3 ? `${mech.skill.name} ${skillCd.toFixed(1)}` : mech.skill.name;
    if (skillLabel !== this._skillLabel) {
      this._skillLabel = skillLabel;
      $('ab-skill-name').textContent = skillLabel;
    }
    const dashCd = self.dashCd || 0;
    const dp = Math.round(clamp(100 - (dashCd / 1.2) * 100, 0, 100));
    if (dp !== this._dashP) {
      this._dashP = dp;
      q('#ab-dash .ab-ring')?.style.setProperty('--p', dp);
      q('#ab-dash .ab-ring')?.style.setProperty('--c', dashCd > 0 ? '#7a7568' : 'var(--text)');
    }
    this.setItemState(self.item);
    if (this._itemEmpty !== !self.item) {
      this._itemEmpty = !self.item;
      $('ab-item').classList.toggle('empty', !self.item);
    }
  }

  setItemState(type) {
    if (type === this._itemType) return;
    this._itemType = type;
    if (type && ITEM_TYPES[type]) {
      const it = ITEM_TYPES[type];
      $('item-icon').src = iconDataUrl(it.icon || type, it.color);
      $('item-name').textContent = it.name;
      q('#ab-item .ab-ring')?.style.setProperty('--c', it.color);
    } else {
      $('item-icon').src = iconDataUrl('box', '#5a5a52');
      $('item-name').textContent = '空槽';
      q('#ab-item .ab-ring')?.style.setProperty('--c', '#5a5a52');
    }
  }

  updateBuffs(self) {
    const buffs = [];
    if (self.overclock > 0) buffs.push(`<span class="buff overclock">超载核心 ${Math.ceil(self.overclock)}s</span>`);
    if (self.shield > 0) buffs.push(`<span class="buff shield">电磁盾 ${self.shield.toFixed(1)}s</span>`);
    if (self.invuln > 0 && !self.alive) buffs.push(`<span class="buff invuln">重启保护</span>`);
    if (self.invuln > 0 && self.alive) buffs.push(`<span class="buff invuln">无敌 ${self.invuln.toFixed(1)}s</span>`);
    if (self.channel > 0) buffs.push(`<span class="buff cooling">冷却中 ${self.channel.toFixed(1)}s</span>`);
    if (self.stunned) buffs.push('<span class="buff stun">短路麻痹</span>');
    if (self.fuse > 0) buffs.push(`<span class="buff overclock">引信 ${self.fuse.toFixed(1)}s</span>`);
    const html = buffs.join('');
    if (html !== this._buffHtml) {
      this._buffHtml = html;
      $('buff-row').innerHTML = html;
    }
  }

  updateDeath(self, snap) {
    const dead = !self.alive && snap.phase === 'live';
    const overlay = $('death-overlay');
    if (dead) {
      overlay.classList.remove('hidden');
      $('death-killer').textContent = this.killer || '自己的温度';
      $('respawn-time').textContent = Math.ceil(self.respawnIn || 0);
      $('hud-spectate').classList.remove('hidden');
      $('crosshair').classList.add('dead');
    } else {
      overlay.classList.add('hidden');
      $('crosshair').classList.remove('dead');
    }
  }

  updateEventBanner(snap) {
    const ev = snap.event;
    if (ev) {
      const key = ev.type + ':' + Math.round(ev.until || 0);
      if (key !== this.eventKey) {
        this.eventKey = key;
        $('event-banner').classList.remove('hidden');
        $('ev-icon').textContent = ev.icon || EVENT_META[ev.type]?.icon || '⚠';
        $('ev-name').textContent = ev.name || EVENT_META[ev.type]?.name || '随机事件';
        $('ev-desc').textContent = ev.desc || EVENT_META[ev.type]?.desc || '';
        $('event-banner').classList.toggle('danger', ev.type === 'claw' || ev.type === 'emstorm');
        $('event-banner').classList.toggle('storm', ev.type === 'sandstorm' || ev.type === 'leak');
        clearTimeout(this.eventTimer);
        this.eventTimer = setTimeout(() => $('event-banner').classList.add('hidden'), 3600);
      }
    }
  }

  setPing(ms) { this.ping = ms; $('hud-ping').textContent = ms + ' ms'; }
  setQualityLabel(quality) {
    const el = $('btn-hud-quality');
    if (!el) return;
    const label = { high: '高', med: '中', low: '低' }[quality] || '中';
    if (el.textContent !== '画质 ' + label) el.textContent = '画质 ' + label;
    el.dataset.quality = quality;
  }

  setFps(fps) {
    this.fps = fps;
    $('hud-fps').textContent = fps + ' FPS';
    $('fps-warning').classList.toggle('hidden', fps >= 45 || !this.screenGame.classList.contains('active'));
  }

  setCrosshair(x, y, state = {}) {
    if (!this.screenGame.classList.contains('active')) return;
    const ch = $('crosshair') || q('.crosshair');
    if (!ch) return;
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx !== this._chX || ry !== this._chY) {
      this._chX = rx; this._chY = ry;
      ch.style.left = rx + 'px';
      ch.style.top = ry + 'px';
    }
    const charging = !!state.charging;
    const hot = (state.heat || 0) >= 70;
    if (charging !== this._chCharging) { this._chCharging = charging; ch.classList.toggle('charging', charging); }
    if (hot !== this._chHot) { this._chHot = hot; ch.classList.toggle('hot', hot); }
    const charge = Math.round(clamp(state.charge || 0, 0, 1) * 100);
    if (charge !== this._chCharge) {
      this._chCharge = charge;
      const el = this._chChargeEl || (this._chChargeEl = q('.ch-charge'));
      el?.style.setProperty('--c', charge);
    }
  }
  hideCrosshair() { $('crosshair').classList.remove('charging', 'hot', 'dead'); }

  hitmarker(kill = false) {
    const el = $('hitmarker');
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  float(x, y, text, cls = '') {
    const layer = $('floating-layer');
    if (layer.children.length > 28) layer.firstElementChild?.remove();
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 980);
  }

  killfeed(attacker, victim, tag = '') {
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = `${attacker ? `<b style="color:${attacker.color}">${escapeHtml(attacker.name)}</b>` : '<b style="color:var(--faint)">环境</b>'}<span class="kf-arrow">➤</span><b style="color:${victim?.color || 'var(--dim)'}">${escapeHtml(victim?.name || '???')}</b>${tag ? `<span class="kf-tag">${tag}</span>` : ''}`;
    const feed = $('killfeed');
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastElementChild.remove();
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 550); }, 5200);
  }

  setKiller(name, color) {
    this.killer = name;
    this.killerColor = color;
  }

  toggleScoreboard(show) {
    this.scoreboardOpen = show ?? !this.scoreboardOpen;
    $('scoreboard').classList.toggle('hidden', !this.scoreboardOpen);
    if (this.scoreboardOpen && this.lastSnapshot) this.renderScoreboard(this.lastSnapshot, this.youId);
  }

  renderScoreboard(snap, youId) {
    const rows = (snap.scores || []).slice();
    const html = `<table class="sb-table"><thead><tr><th>#</th><th>竞技者</th><th>机体</th><th>比分</th><th>击杀</th><th>短路</th><th>过载</th></tr></thead><tbody>` +
      rows.map((p, i) => {
        const m = mechOf(p.mech);
        const heat = clamp(p.heat, 0, 100);
        const st = heat >= 90 ? '#ff4b3a' : heat >= 70 ? '#ff7a2e' : heat >= 40 ? '#ffcf5a' : '#46d9ff';
        return `<tr class="${p.id === youId ? 'you' : ''}">
          <td>${i + 1}</td>
          <td><span class="sb-dot" style="background:${p.color}"></span><span class="sb-name">${escapeHtml(p.name)}</span>${p.bot ? '<span class="sb-bot">AI</span>' : ''}</td>
          <td style="color:var(--faint);font-size:10px">${m.name}</td>
          <td style="color:var(--amber);font-weight:600">${p.score}</td>
          <td>${p.kills}</td>
          <td class="${p.alive ? '' : 'sb-dead'}">${p.alive ? p.deaths : '短路 ' + Math.ceil(p.respawnIn)}\u00a0s</td>
          <td><span class="sb-heat"><i style="width:${heat}%;background:${st}"></i></span>${Math.round(heat)}</td>
        </tr>`;
      }).join('') + '</tbody></table>';
    $('scoreboard-body').innerHTML = html;
  }

  setSandstorm(on) { $('sandstorm-overlay').classList.toggle('on', on); }
  setStorm(on) { $('storm-overlay').classList.toggle('on', on); }

  showDisconnect(on, text = '') {
    $('disconnect-overlay').classList.toggle('hidden', !on);
    $('dc-hint').textContent = text || '';
  }

  toggleTutorial(on) {
    $('tutorial').classList.toggle('hidden', !on);
    this.tutorialTimer = on ? 14 : 0;
  }

  // ------------------------------------------------------- 新手教程 (单机)
  /** Menu button subtitle after the tutorial has been cleared once. */
  setTutorialButtonDone(done) {
    const btn = $('btn-tutorial');
    if (!btn) return;
    let small = btn.querySelector('small');
    if (!small) {
      small = document.createElement('small');
      btn.appendChild(small);
    }
    small.textContent = done ? '已通关 · 想再练一次也可以' : '2 分钟学会五个按键 · 单机';
    btn.classList.toggle('done', !!done);
  }

  /** Menu badge for 进阶训练 (cleared once). */
  setTrainingButtonDone(done) {
    const btn = $('btn-training');
    if (btn) {
      const small = btn.querySelector('small');
      if (small) small.textContent = done ? '已通关 · 可以再来练手感' : '和 2 台会还手的 AI 练走位 · 练完就能打赢';
      btn.classList.toggle('done', !!done);
    }
  }

  setShootingButtonDone(done) {
    const btn = $('btn-shooting');
    if (!btn) return;
    const small = btn.querySelector('small');
    if (small) small.textContent = done ? '已通关 · 可以回来练手感' : '固定靶 / 移动靶 / 远靶 / 点射 / 实战靶机';
    btn.classList.toggle('done', !!done);
  }

  setTutorialMode(on, mode = 'basic') {
    this.tutorialMode = !!on;
    this.tutorialKind = mode;
    const title = document.querySelector('#tut-panel .tut-title');
    if (title) title.textContent = TUTORIAL_TITLES[mode] || '新手教程';
    this._timeText = null;
    this._phaseText = null;
    this._timeClass = null;
  }

  /** Render the step list and highlight step `index`. */
  showTutorial(steps, index = 0, title = '新手教程', mode = null) {
    const panel = $('tut-panel');
    if (!panel) return;
    const kind = mode || (title.includes('射击') ? 'shooting' : title.includes('进阶') ? 'advanced' : 'basic');
    this.setTutorialMode(true, kind);
    // 机体课程：面板标题直接用「破阵 · 专属教程」这种具体名字
    if (kind === 'mech') {
      const t = document.querySelector('#tut-panel .tut-title');
      if (t) t.textContent = title;
    }
    $('hud-room').textContent = kind === 'mech' ? 'ROOM MECH LAB'
      : kind === 'advanced' ? 'ROOM TRAINING' : kind === 'shooting' ? 'ROOM RANGE' : 'ROOM TUTORIAL';
    $('hud-mode').textContent = title;
    // the 10-second hint box would sit on top of the tutorial panel
    $('tutorial')?.classList.add('hidden');
    this.tutorialTimer = 0;
    const list = $('tut-steps');
    list.innerHTML = '';
    steps.forEach((st, i) => {
      const li = document.createElement('li');
      li.className = 'tut-step' + (i < index ? ' done' : i === index ? ' active' : '');
      const mark = document.createElement('span');
      mark.className = 'tut-mark';
      mark.textContent = i < index ? '✓' : String(i + 1);
      const body = document.createElement('span');
      body.className = 'tut-body';
      const title = document.createElement('b');
      title.textContent = st.title;
      const keys = document.createElement('em');
      keys.textContent = st.keys;
      body.appendChild(title);
      body.appendChild(keys);
      li.appendChild(mark);
      li.appendChild(body);
      list.appendChild(li);
    });
    const st = steps[Math.min(index, steps.length - 1)];
    const cur = $('tut-current');
    if (cur && st) {
      cur.innerHTML = '';
      const t = document.createElement('p');
      t.className = 'tut-text';
      t.textContent = st.text;
      const g = document.createElement('p');
      g.className = 'tut-goal';
      g.textContent = '目标：' + st.goal;
      cur.appendChild(t);
      cur.appendChild(g);
      if (st.tip) {
        const tip = document.createElement('p');
        tip.className = 'tut-tip';
        tip.textContent = '提示：' + st.tip;
        cur.appendChild(tip);
      }
    }
    const count = $('tut-count');
    if (count) count.textContent = `${Math.min(index + 1, steps.length)} / ${steps.length}`;
    $('tut-done').classList.add('hidden');
    panel.classList.remove('hidden');
    // make sure the scoreboard/hints do not cover it
    this.hideScoreboard?.();
  }

  /** One-line live readout under the current step (射击篇: 命中率 / 热量). */
  setTutorialStat(text) {
    const cur = $('tut-current');
    if (!cur) return;
    let el = cur.querySelector('.tut-stat');
    if (!el) {
      el = document.createElement('p');
      el.className = 'tut-stat';
      cur.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }

  /** `info` 用来给机体专训换一张结课卡（默认是新手教程那张） */
  completeTutorial(info = null) {
    $('tut-panel')?.classList.add('hidden');
    const done = $('tut-done');
    if (!done) return;
    const title = $('tut-done-title');
    const sub = $('tut-done-sub');
    if (title) title.textContent = info?.title || '教程完成';
    if (sub) sub.textContent = info?.sub || '五个按键，就这么多。剩下的是角度和运气。';
    done.classList.remove('hidden');
  }

  hideTutorial() {
    $('tut-panel')?.classList.add('hidden');
    $('tut-done')?.classList.add('hidden');
    this.setTutorialMode(false);
  }

  hideScoreboard() {
    if (!this.scoreboardOpen) return;
    this.scoreboardOpen = false;
    $('scoreboard')?.classList.add('hidden');
  }

  // ---------------------------------------------------------------- minimap
  drawMinimap(snap, youId, arena = this.arena) {
    if (!arena) return;
    const c = $('minimap');
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const W = c.width, H = c.height;
    const pad = 12;
    const half = arena.half || arena.size / 2;
    const k = (W - pad * 2) / (half * 2);
    const px = (x) => W / 2 + x * k;
    const pz = (z) => H / 2 + z * k;

    // ---- static layer: rendered once per arena/canvas size, then blitted.
    const key = `${arena.seed || 0}:${arena.size}:${W}x${H}`;
    let base = this._mmBase;
    if (!base || this._mmKey !== key) {
      base = document.createElement('canvas');
      base.width = W; base.height = H;
      const b = base.getContext('2d');
      if (b) {
        b.fillStyle = '#0a0d0d'; b.fillRect(0, 0, W, H);
        b.strokeStyle = 'rgba(201,186,154,0.08)'; b.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          b.beginPath(); b.moveTo(pad + (W - pad * 2) * i / 4, pad); b.lineTo(pad + (W - pad * 2) * i / 4, H - pad); b.stroke();
          b.beginPath(); b.moveTo(pad, pad + (H - pad * 2) * i / 4); b.lineTo(W - pad, pad + (H - pad * 2) * i / 4); b.stroke();
        }
        b.strokeStyle = 'rgba(255,176,46,0.35)'; b.lineWidth = 1.5;
        b.strokeRect(px(-half), pz(-half), half * 2 * k, half * 2 * k);
        for (const a of arena.acids) {
          b.fillStyle = 'rgba(120,220,50,0.16)'; b.strokeStyle = 'rgba(157,255,87,0.5)';
          b.beginPath(); b.arc(px(a.x), pz(a.z), a.r * k, 0, 7); b.fill(); b.stroke();
        }
        for (const a of arena.coolers) {
          b.fillStyle = 'rgba(70,217,255,0.14)'; b.strokeStyle = 'rgba(70,217,255,0.55)';
          b.beginPath(); b.arc(px(a.x), pz(a.z), a.r * k, 0, 7); b.fill(); b.stroke();
        }
        b.strokeStyle = 'rgba(70,217,255,0.65)'; b.lineWidth = 1;
        for (const p of arena.plates) {
          b.beginPath(); b.arc(px(p.x), pz(p.z), p.r * k, 0, 7); b.stroke();
        }
        for (const t of arena.towers) {
          b.strokeStyle = 'rgba(255,208,90,0.35)';
          b.beginPath(); b.arc(px(t.x), pz(t.z), t.zapR * k, 0, 7); b.stroke();
        }
        for (const p of arena.pads) {
          b.fillStyle = p.center ? 'rgba(255,91,200,0.6)' : 'rgba(255,176,46,0.4)';
          b.beginPath(); b.arc(px(p.x), pz(p.z), 2, 0, 7); b.fill();
        }
      }
      this._mmBase = base;
      this._mmKey = key;
    }

    g.clearRect(0, 0, W, H);
    if (base) g.drawImage(base, 0, 0);

    // ---- dynamic layer -----------------------------------------------------
    const wallState = new Map((snap?.walls || []).map((w) => [w.id, w]));
    for (const w of arena.walls) {
      const st = wallState.get(w.id);
      const alive = st ? st.alive : 1;
      g.fillStyle = alive ? 'rgba(210,196,160,0.4)' : 'rgba(90,80,70,0.25)';
      g.fillRect(px(w.x - w.w / 2), pz(w.z - w.h / 2), w.w * k, w.h * k);
    }
    for (const t of arena.towers) {
      const ts = snap?.towers?.find((x) => x.id === t.id);
      g.fillStyle = ts?.charge > 0.2 ? '#ffd05a' : '#8a7a55';
      g.beginPath(); g.arc(px(t.x), pz(t.z), Math.max(2, t.r * k), 0, 7); g.fill();
    }
    for (const it of snap?.items || []) {
      g.fillStyle = ITEM_TYPES[it.type]?.color || '#ffb02e';
      g.beginPath(); g.arc(px(it.x), pz(it.z), 2.6, 0, 7); g.fill();
    }
    for (const z of snap?.zones || []) {
      g.strokeStyle = z.type === 'storm' ? 'rgba(90,220,255,0.8)' : 'rgba(157,255,87,0.55)';
      g.fillStyle = z.type === 'storm' ? 'rgba(70,217,255,0.1)' : 'rgba(120,220,50,0.08)';
      g.beginPath(); g.arc(px(z.x), pz(z.z), z.r * k, 0, 7); g.fill(); g.stroke();
    }
    for (const m of snap?.markers || []) {
      g.strokeStyle = '#ff4b3a'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(px(m.x), pz(m.z), m.r * k, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(px(m.x) - 4, pz(m.z)); g.lineTo(px(m.x) + 4, pz(m.z)); g.stroke();
    }
    for (const p of snap?.players || []) {
      const x = px(p.x), z = pz(p.z);
      if (!p.alive) {
        g.strokeStyle = 'rgba(255,75,58,0.6)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x - 3, z - 3); g.lineTo(x + 3, z + 3); g.moveTo(x + 3, z - 3); g.lineTo(x - 3, z + 3); g.stroke();
        continue;
      }
      const heat = clamp(p.heat, 0, 100);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(x, z, p.id === youId ? 4.5 : 3.6, 0, 7); g.fill();
      g.strokeStyle = heat >= 70 ? `rgba(255,${Math.round(120 - heat * 0.8)},60,0.95)` : 'rgba(255,255,255,0.18)';
      g.lineWidth = heat >= 70 ? 2 : 1;
      g.beginPath(); g.arc(x, z, p.id === youId ? 7 : 6, 0, 7); g.stroke();
      if (p.id === youId) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, z, 8.5, 0, 7); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.beginPath(); g.moveTo(x, z); g.lineTo(x + Math.cos(p.aim) * 9, z + Math.sin(p.aim) * 9); g.stroke();
      }
    }
    if (snap?.airdrop) {
      g.strokeStyle = '#ff5bc8'; g.setLineDash([3, 3]);
      g.beginPath(); g.arc(px(snap.airdrop.x), pz(snap.airdrop.z), 10, 0, 7); g.stroke();
      g.setLineDash([]);
    }
    this._mmDraws = (this._mmDraws || 0) + 1;
  }

  showResults(result, youId, room, isHost = false) {
    if (!result) return;
    this.resultData = result;
    this.scoreboardOpen = false;
    $('scoreboard').classList.add('hidden');
    $('hud-spectate').classList.add('hidden');
    $('death-overlay').classList.add('hidden');
    $('countdown').classList.add('hidden');
    const board = result.board || [];
    const rank = board.findIndex((p) => p.id === youId) + 1;
    const mode = modeLabel(result.mode || room?.settings?.mode);
    $('result-mode').textContent = mode;
    $('result-meta').textContent = `${fmtTime(result.duration || 0)} · ${result.arenaSize || '?'} × ${result.arenaSize || '?'} 米 · ${board.length} 台机体`;
    const myRow = board.find((p) => p.id === youId);
    $('result-myrank').textContent = rank ? `你的排名 #${rank}${myRow?.title ? ' · ' + myRow.title : ''}` : '';
    const maxScore = Math.max(...board.map((p) => p.score), 0);
    const table = $('result-table');
    table.innerHTML = `<div class="res-row head"><span>#</span><span></span><span>竞技者</span><span style="text-align:right">比分</span><span style="text-align:right">击杀</span><span style="text-align:right">短路</span><span style="text-align:right">反弹</span></div>` +
      board.map((p, i) => `
        <div class="res-row ${p.id === youId ? 'you' : ''} ${p.score === maxScore && maxScore > 0 ? 'win' : ''}">
          <span class="res-rank">${i + 1}</span>
          <span class="res-dot" style="background:${p.color}"></span>
          <span class="res-name">${escapeHtml(p.name)} <small>${mechOf(p.mech).name}${p.bot ? ' · AI' : ''}</small>${p.title ? `<em class="res-title">「${escapeHtml(p.title)}」</em>` : ''}</span>
          <span class="res-score">${p.score}</span>
          <span class="res-kd">${p.kills}</span>
          <span class="res-kd">${p.deaths}</span>
          <span class="res-kd">${p.bounceHits ?? 0}</span>
        </div>`).join('');
    const awardMeta = {
      shortCircuit: { n: '爆炸波及王', ico: '💥', unit: '次波及' },
      bounceKing: { n: '最佳反弹凶手', ico: '↺', unit: '次反弹命中' },
      clawed: { n: '最惨被夹机甲', ico: '🦾', unit: '次被夹' },
      coolerCamper: { n: '散热区钉子户', ico: '❄', unit: '秒散热' },
      demoArtist: { n: '自爆艺术家', ico: '☢', unit: '次自爆击杀' },
      hotShot: { n: '最高输出', ico: '🔥', unit: '点伤害' },
    };
    const awards = result.awards || {};
    const keys = ['shortCircuit', 'bounceKing', 'clawed', 'coolerCamper', 'demoArtist', 'hotShot'];
    const aw = $('result-awards');
    aw.innerHTML = keys.map((k) => {
      const meta = awardMeta[k];
      const a = awards[k];
      const val = a ? (k === 'coolerCamper' ? Math.round(a.value) : Math.round(a.value)) + ' ' + meta.unit : '—';
      return `<div class="award ${a ? '' : 'none'}">
        <span class="aw-ico">${meta.ico}</span>
        <span class="aw-copy"><b>${meta.n}</b><span>${val}</span></span>
        <span class="aw-who" style="color:${a ? a.color : 'var(--faint)'}">${a ? escapeHtml(a.name) : '无人获得'}<small>${a ? mechOf(a.mech).name : ''}</small></span>
      </div>`;
    }).join('');
    const totalBounce = board.reduce((s, p) => s + (p.bounceHits || 0), 0);
    const topHeat = Math.round(result.duration || 0);
    $('result-highlight').textContent = `本局共打出 ${totalBounce} 次反弹命中；${board.length} 台机甲在 ${fmtTime(result.duration || 0)} 内互相把对方加热到短路。${result.duration > 0 ? '废土广播网对本次节目的可看性表示满意。' : ''}`;
    $('btn-rematch').classList.toggle('hidden', !isHost);
    $('btn-to-lobby').classList.toggle('hidden', !isHost);
    $('result-wait').classList.toggle('hidden', isHost);
    $('btn-results-leave').textContent = room ? '离开房间' : '返回菜单';
    this.showScreen('results');
  }

  // ---------------------------------------------------------------- toasts
  toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('fade'); setTimeout(() => t.remove(), 420); }, 2600);
  }

  fade(on) { $('screen-fade').classList.toggle('on', on); }

  showError(msg) { this.toast(msg, 'err'); }
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const iconCache = new Map();
function iconDataUrl(kind, color) {
  const key = kind + color;
  if (iconCache.has(key)) return iconCache.get(key);
  const tex = iconTexture(kind, color);
  const canvas = tex.image;
  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}
