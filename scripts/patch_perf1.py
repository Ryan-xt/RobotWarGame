import re

# =============================================================== src/game.js
p = 'src/game.js'
s = open(p).read()

# 1) reusable math temporaries (no per-frame allocation in the hot path)
s = s.replace("""const lerpAngle = (a, b, k) => a + angleDiff(b, a) * k;""",
"""const lerpAngle = (a, b, k) => a + angleDiff(b, a) * k;

// Reused every frame: allocating Raycaster/Vector/Plane objects at 60 fps was
// producing megabytes of garbage per match (and periodic GC hitches).
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
const _aimHit = new THREE.Vector3();""")

s = s.replace("""  updateAim() {
    if (!this.camera) return;
    const ndc = new THREE.Vector2(
      (this.mouse.x / window.innerWidth) * 2 - 1,
      -(this.mouse.y / window.innerHeight) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    const hit = new THREE.Vector3();
    const got = ray.ray.intersectPlane(plane, hit);
    const v = this.selfVisual;
    if (!v) return;
    if (got) {
      const sx = v.rx ?? v.predicted?.x ?? v.x;
      const sz = v.rz ?? v.predicted?.z ?? v.z;
      this.localAim = Math.atan2(hit.z - sz, hit.x - sx);
    }
  }""",
"""  updateAim() {
    if (!this.camera) return;
    // The camera moves slowly and the mouse only changes on events, so the
    // projected aim point is refreshed at most 30 times per second.
    const now = this.time;
    if (this._aimAt && now - this._aimAt < 1 / 30 && this._aimMouse === this.mouse.x + ':' + this.mouse.y) return;
    this._aimAt = now;
    this._aimMouse = this.mouse.x + ':' + this.mouse.y;
    _ndc.set(
      (this.mouse.x / window.innerWidth) * 2 - 1,
      -(this.mouse.y / window.innerHeight) * 2 + 1,
    );
    _ray.setFromCamera(_ndc, this.camera);
    const got = _ray.ray.intersectPlane(_aimPlane, _aimHit);
    const v = this.selfVisual;
    if (!v) return;
    if (got) {
      const sx = v.rx ?? v.predicted?.x ?? v.x;
      const sz = v.rz ?? v.predicted?.z ?? v.z;
      this.localAim = Math.atan2(_aimHit.z - sz, _aimHit.x - sx);
    }
  }""")

# 2) stepwise adaptive quality + quality helper
s = s.replace("""      if (this.fps < 36 && this.ui.settings.quality === 'high') {
        this.lowFpsTime += 0.5;
        if (this.lowFpsTime > 4 && !this.degraded) {
          this.degraded = true;
          this.stage.setQuality('low');
          this.fx?.setQuality('low');
          this.ui.toast('帧率偏低 · 已自动降低特效');
        }
      } else this.lowFpsTime = 0;""",
"""      // Step the preset down one notch at a time (high -> med -> low) so a
      // weak GPU keeps a playable frame rate without nuking the look at once.
      const tiers = ['high', 'med', 'low'];
      const current = this.ui.settings.quality || 'high';
      const idx = tiers.indexOf(current);
      if (this.fps < 40 && idx >= 0 && idx < tiers.length - 1) {
        this.lowFpsTime += 0.5;
        const limit = current === 'high' ? 3 : 4;
        if (this.lowFpsTime >= limit) {
          this.lowFpsTime = 0;
          const next = tiers[idx + 1];
          this.ui.settings.quality = next;
          this.applyQuality(next);
          try { this.ui.syncQualitySelect?.(next); } catch {}
          this.ui.toast(`帧率 ${this.fps} · 已自动降到「${next === 'med' ? '中' : '低'}」画质`, 'err');
          this.autoDegrades = (this.autoDegrades || 0) + 1;
        }
      } else {
        this.lowFpsTime = Math.max(0, this.lowFpsTime - 0.25);
      }""")

s = s.replace("""  setRoomCode(code) { this.currentRoomCode = code; }""",
"""  setRoomCode(code) { this.currentRoomCode = code; }

  /** Push a graphics preset through every layer that owns visual density. */
  applyQuality(quality, renderScale) {
    const q = quality || this.ui.settings.quality || 'high';
    const scale = renderScale ?? this.ui.settings.renderScale ?? 1;
    try { this.stage?.setQuality(q, scale); } catch (err) { console.warn('[quality] stage', err); }
    try { this.fx?.setQuality(q); } catch (err) { console.warn('[quality] fx', err); }
    try { this.arenaView?.setQuality(q); } catch (err) { console.warn('[quality] arena', err); }
    // CSS switches off the expensive full-screen blend/backdrop filters
    document.body.dataset.quality = q;
    this.quality = q;
    this.minimapInterval = q === 'low' ? 1 / 4 : q === 'med' ? 1 / 6 : 1 / 10;
    return q;
  }""")

# 3) apply quality on match start instead of hardcoding stage quality
s = s.replace("""    this.stage.setQuality(this.ui.settings.quality);
    this.degraded = false;
    this.lowFpsTime = 0;""",
"""    this.applyQuality(this.ui.settings.quality, this.ui.settings.renderScale);
    this.lowFpsTime = 0;
    this.autoDegrades = 0;""")

# 4) throttle the crosshair DOM writes
s = s.replace("""    // crosshair follows mouse & local charge
    if (this.running) {
      this.ui.setCrosshair(this.mouse.x, this.mouse.y, {
        charging: this.mouse.down && this.localCharge > 0.05,
        charge: this.localCharge,
        heat: this.selfData?.heat || 0,
      });
    }""",
"""    // crosshair follows mouse & local charge (30 Hz, only when it changed)
    if (this.running) {
      this.crossAt = (this.crossAt || 0) + dt;
      const charging = !!(this.mouse.down && this.localCharge > 0.05);
      const hot = (this.selfData?.heat || 0) >= 70;
      const sig = `${Math.round(this.mouse.x)},${Math.round(this.mouse.y)},${Math.round(this.localCharge * 12)},${charging},${hot}`;
      if (this.crossAt >= 1 / 30 && sig !== this.crossSig) {
        this.crossAt = 0;
        this.crossSig = sig;
        this.ui.setCrosshair(this.mouse.x, this.mouse.y, {
          charging,
          charge: this.localCharge,
          heat: this.selfData?.heat || 0,
        });
      }
    }""")

# 5) minimap interval from the preset
s = s.replace("""    const now = performance.now();
    if (this.snap && now - this.lastMinimap > 100) {
      this.lastMinimap = now;
      this.ui.drawMinimap(this.snap, this.myId, this.arena);
    }""",
"""    const now = performance.now();
    const mmEvery = (this.minimapInterval || 0.1) * 1000;
    if (this.snap && now - this.lastMinimap > mmEvery) {
      this.lastMinimap = now;
      this.ui.drawMinimap(this.snap, this.myId, this.arena);
    }""")

# 6) arena ambient animation is the only per-frame CPU work in the view layer;
#    run it at 30 Hz when the preset is low.
s = s.replace("""    if (this.fx) this.fx.update(dt);
    if (this.arenaView) this.arenaView.update(dt, this.time, this.snap);""",
"""    if (this.fx) this.fx.update(dt);
    if (this.arenaView) {
      const ambEvery = this.quality === 'low' ? 2 : 1;
      this.ambFrame = (this.ambFrame || 0) + 1;
      if (this.ambFrame % ambEvery === 0) {
        this.arenaView.update(dt * ambEvery, this.time, this.snap);
      }
    }""")

open(p, 'w').write(s)
print('game.js patched')

# =============================================================== src/ui.js
p = 'src/ui.js'
s = open(p).read()

# settings: renderScale support
s = s.replace("""  loadSettingsToUI() {
    $('set-quality').value = this.settings.quality;
    $('set-volume').value = this.settings.volume;
    $('set-shake').checked = this.settings.shake;
    $('set-hints').checked = this.settings.hints;
  }""",
"""  loadSettingsToUI() {
    const q = $('set-quality');
    if (q) q.value = this.settings.quality;
    const rs = $('set-res');
    if (rs) rs.value = String(this.settings.renderScale ?? 1);
    $('set-volume').value = this.settings.volume;
    $('set-shake').checked = this.settings.shake;
    $('set-hints').checked = this.settings.hints;
  }

  /** Keep the settings dropdown in sync when quality auto-degrades mid-match. */
  syncQualitySelect(quality) {
    const q = $('set-quality');
    if (q) q.value = quality;
  }""")

s = s.replace("""  saveSettings() {
    this.settings.quality = $('set-quality').value;
    this.settings.volume = Number($('set-volume').value);""",
"""  saveSettings() {
    this.settings.quality = $('set-quality').value;
    const rs = $('set-res');
    if (rs) this.settings.renderScale = Number(rs.value) || 1;
    this.settings.volume = Number($('set-volume').value);""")

s = s.replace("""    $('set-quality').addEventListener('change', () => { this.settings.quality = $('set-quality').value; });""",
"""    $('set-quality').addEventListener('change', () => { this.settings.quality = $('set-quality').value; });
    const resSel = $('set-res');
    if (resSel) resSel.addEventListener('change', () => { this.settings.renderScale = Number(resSel.value) || 1; });""")

# HUD dirty checks ------------------------------------------------------------
s = s.replace("""  updateHUD(snap, self, ctx = {}) {
    if (!snap) return;
    this.lastSnapshot = snap;
    const timeLeft = snap.timeLeft ?? 0;
    $('hud-time').textContent = fmtTime(timeLeft);
    const warn = timeLeft <= 30;
    $('hud-time').className = 'time' + (timeLeft <= 10 ? ' danger' : warn ? ' warn' : '');
    const phase = snap.phase === 'countdown' ? '核心同步' : snap.storm ? '电磁风暴' : timeLeft <= 30 ? '最后 30 秒' : '混战进行中';
    $('hud-phase').textContent = phase;
    if (snap.teamScores) {
      const el = $('hud-teamscore');
      el.classList.remove('hidden');
      el.innerHTML = `<i style=\"color:var(--cyan)\">蓝队 ${(snap.teamScores[0] || 0).toFixed(1)}</i><i style=\"color:var(--amber)\">橙队 ${(snap.teamScores[1] || 0).toFixed(1)}</i>`;
    } else {
      $('hud-teamscore').classList.add('hidden');
    }""",
"""  updateHUD(snap, self, ctx = {}) {
    if (!snap) return;
    this.lastSnapshot = snap;
    const timeLeft = snap.timeLeft ?? 0;
    // DOM writes are the most expensive part of the HUD: skip unchanged nodes.
    const timeText = fmtTime(timeLeft);
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
    const phase = snap.phase === 'countdown' ? '核心同步' : snap.storm ? '电磁风暴' : timeLeft <= 30 ? '最后 30 秒' : '混战进行中';
    if (phase !== this._phaseText) {
      this._phaseText = phase;
      $('hud-phase').textContent = phase;
    }
    if (snap.teamScores) {
      const el = $('hud-teamscore');
      el.classList.remove('hidden');
      const html = `<i style=\"color:var(--cyan)\">蓝队 ${(snap.teamScores[0] || 0).toFixed(1)}</i><i style=\"color:var(--amber)\">橙队 ${(snap.teamScores[1] || 0).toFixed(1)}</i>`;
      if (html !== this._teamHtml) { this._teamHtml = html; el.innerHTML = html; }
    } else if (this._teamHtml !== null) {
      this._teamHtml = null;
      $('hud-teamscore').classList.add('hidden');
    }""")

s = s.replace("""    const color = heat >= 90 ? '#ff4b3a' : heat >= 70 ? '#ff7a2e' : heat >= 40 ? '#ffcf5a' : '#46d9ff';
    document.documentElement.style.setProperty('--heat', color);
    $('heat-value').textContent = Math.round(heat);
    $('heat-state').textContent = state;
    $('heat-fill').style.width = heat + '%';""",
"""    const color = heat >= 90 ? '#ff4b3a' : heat >= 70 ? '#ff7a2e' : heat >= 40 ? '#ffcf5a' : '#46d9ff';
    if (color !== this._heatColor) {
      this._heatColor = color;
      document.documentElement.style.setProperty('--heat', color);
    }
    const shown = Math.round(heat);
    if (shown !== this._heatShown) { this._heatShown = shown; $('heat-value').textContent = shown; }
    if (state !== this._heatState) { this._heatState = state; $('heat-state').textContent = state; }
    $('heat-fill').style.width = heat + '%';""")

open(p, 'w').write(s)
print('ui.js HUD patched')
