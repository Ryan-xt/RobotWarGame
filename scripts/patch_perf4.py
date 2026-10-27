import re

p = 'src/ui.js'
s = open(p).read()

# ------------------------------------------------------------------ cached DOM lookup
s = s.replace("""const $ = (id) => document.getElementById(id);""",
"""// Memoised lookups: the HUD touches ~40 nodes twenty times per second, and
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
};""")

s = s.replace("""    const block = document.querySelector('.heat-block');""", """    const block = q('.heat-block');""")

s = s.replace("""  updateAbilities(self, snap) {
    const mech = mechOf(self.mech);
    const skillCd = self.skillCd || 0;
    const p = clamp(100 - (skillCd / (this.skillMax || 1)) * 100, 0, 100);
    $('ab-skill').querySelector('.ab-ring').style.setProperty('--p', p);
    $('ab-skill').querySelector('.ab-ring').style.setProperty('--c', skillCd > 0 ? '#7a7568' : 'var(--amber)');
    $('ab-skill-name').textContent = skillCd > 0.3 ? `${mech.skill.name} ${skillCd.toFixed(1)}` : mech.skill.name;
    const dashCd = self.dashCd || 0;
    $('ab-dash').querySelector('.ab-ring').style.setProperty('--p', clamp(100 - (dashCd / 1.2) * 100, 0, 100));
    $('ab-dash').querySelector('.ab-ring').style.setProperty('--c', dashCd > 0 ? '#7a7568' : 'var(--text)');
    this.setItemState(self.item);
    $('ab-item').classList.toggle('empty', !self.item);
  }""",
"""  updateAbilities(self, snap) {
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
  }""")

s = s.replace("""      $('ab-item').querySelector('.ab-ring').style.setProperty('--c', it.color);""",
"""      q('#ab-item .ab-ring')?.style.setProperty('--c', it.color);""")
s = s.replace("""      $('ab-item').querySelector('.ab-ring').style.setProperty('--c', '#5a5a52');""",
"""      q('#ab-item .ab-ring')?.style.setProperty('--c', '#5a5a52');""")

# ammo pips: cache the node list + only toggle when the values change
s = s.replace("""  updateAmmo(self) {
    const pips = $('ammo-pips').children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.toggle('on', i < (self.ammo || 0));
      pips[i].classList.toggle('hot', !!self.reloading && i % 2 === 0);
    }
    const reloading = (self.reloading || 0) > 0;
    $('reload-bar').classList.toggle('active', reloading);
    if (reloading) $('reload-bar').firstElementChild.style.width = clamp((1 - self.reloading / 1.25) * 100, 0, 100) + '%';
    $('ammo-label').textContent = reloading ? '换弹中' : `${self.ammo}/${BULLET.magSize}`;
  }""",
"""  updateAmmo(self) {
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
  }""")

# buff row: skip identical HTML
s = s.replace("""    $('buff-row').innerHTML = buffs.join('');""",
"""    const html = buffs.join('');
    if (html !== this._buffHtml) {
      this._buffHtml = html;
      $('buff-row').innerHTML = html;
    }""")

# crosshair: skip identical writes
s = s.replace("""  setCrosshair(x, y, state = {}) {
    if (!this.screenGame.classList.contains('active')) return;
    const ch = $('crosshair');
    ch.style.left = x + 'px';
    ch.style.top = y + 'px';
    ch.classList.toggle('charging', !!state.charging);
    ch.classList.toggle('hot', (state.heat || 0) >= 70);
    const charge = clamp(state.charge || 0, 0, 1);
    ch.querySelector('.ch-charge').style.setProperty('--c', charge * 100);
  }""",
"""  setCrosshair(x, y, state = {}) {
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
  }""")

# reset the caches whenever a match begins (teams/ammo/buffs change)
s = s.replace("""    this.setItemState(null);
    this.showScreen('game');""",
"""    this.setItemState(null);
    this._ammoKey = null;
    this._buffHtml = null;
    this._heatShown = null;
    this._heatState = null;
    this._skillLabel = null;
    this._skillP = null;
    this._dashP = null;
    this._timeText = null;
    this.showScreen('game');""")
open(p, 'w').write(s)
print('ui.js perf patched')

# ------------------------------------------------------------------ test fix
p = 'scripts/perftest.js'
s = open(p).read()
s = s.replace("""ok(game.ui.settings.quality === 'med', 'low FPS steps high → med', game.ui.settings.quality);""",
"""const ladder = stage.qualityCalls.slice(before);
ok(ladder[0] === 'med', 'low FPS steps high → med first', ladder.join('→'));
game.ui.settings.quality = 'med';
game.lowFpsTime = 0;""")
open(p, 'w').write(s)
print('perftest fixed')
