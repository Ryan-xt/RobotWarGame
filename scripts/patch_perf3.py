import re

# ============================================================ public/index.html
p = 'public/index.html'
s = open(p).read()

old_quality = '''<label class="row-setting">画质 <select id="set-quality"><option value="high">高（辉光 / 阴影）</option><option value="low">低（省电 / 集显）</option></select></label>'''
new_quality = '''<label class="row-setting">画质 <select id="set-quality"><option value="high">高（辉光 / 阴影 1024）</option><option value="med">中（半分辨率辉光 · 推荐）</option><option value="low">低（关辉光/阴影 · 集显）</option></select></label>
        <label class="row-setting">渲染分辨率 <select id="set-res"><option value="1">100%（清晰）</option><option value="0.85">85%（省力）</option><option value="0.7">70%（高性能）</option><option value="0.55">55%（最流畅）</option></select></label>'''
if old_quality in s:
    s = s.replace(old_quality, new_quality)
elif 'id="set-res"' not in s:
    s = re.sub(r'<label class="row-setting">画质.*?</label>', new_quality, s, count=1)

# hint text under the settings panel
s = s.replace('''<div><b>控制</b><p>WASD 移动''',
'''<div><b>性能</b><p>卡顿时把「画质」调到中/低，或把「渲染分辨率」降到 85% / 70%；帧率低于 40 会自动降档。对局中也生效。</p></div>
          <div><b>控制</b><p>WASD 移动''')

# diag panel: renderer stats
if 'renderer stats' not in s:
    s = s.replace("""      return [
        '脚本启动 __bootOK      : ' + (window.__bootOK ? '是' : '否 ← 说明 app.js 没跑起来'),""",
"""      var stats = null;
      try { stats = stage.getStats ? stage.getStats() : null; } catch (e) {}
      var fpsLine = (app.game && app.game.fps) ? app.game.fps + ' FPS' : '-';
      return [
        '脚本启动 __bootOK      : ' + (window.__bootOK ? '是' : '否 ← 说明 app.js 没跑起来'),""")
    s = s.replace("""        'UA                     : ' + navigator.userAgent,
      ].join('\\n');""",
"""        'UA                     : ' + navigator.userAgent,
        '— 渲染统计 (renderer stats) —',
        'FPS / 画质             : ' + fpsLine + ' / ' + (stage.quality || '-') + (stats && stats.mode === '2d' ? ' (2D)' : ''),
        '分辨率倍率 / 缓冲      : ' + (stats ? (stats.pixelRatio || stats.dpr || '-') + ' / ' + (stats.buffer || '-') : '-'),
        '绘制调用 draw calls    : ' + (stats && stats.calls != null ? stats.calls : '-'),
        '三角面 / 点            : ' + (stats && stats.triangles != null ? stats.triangles + ' / ' + stats.points : '-'),
        '几何体 / 纹理 / 着色器 : ' + (stats && stats.geometries != null ? stats.geometries + ' / ' + stats.textures + ' / ' + stats.programs : '-'),
        '阴影 / 辉光            : ' + (stats ? (stats.shadows ? '开' : '关') + ' / ' + (stats.bloom ? '开' : '关') : '-'),
        'GPU                    : ' + (stats ? (stats.adapter || '-') : '-'),
        '自动降档次数           : ' + ((app.game && app.game.autoDegrades) || 0),
      ].join('\\n');""")
open(p, 'w').write(s)
print('index.html patched')

# ============================================================ public/style.css
p = 'public/style.css'
s = open(p).read()
if 'data-quality' not in s:
    s += '''
/* ------------------------------------------------- graphics presets (CSS side)
   Full-screen blend modes and backdrop-filter blur cost real GPU time on
   integrated chips; the low preset turns them off for good. */
body[data-quality="low"] #grain { display: none; }
body[data-quality="low"] .menu-scan,
body[data-quality="low"] .sandstorm-overlay { mix-blend-mode: normal; }
body[data-quality="low"] .death-overlay,
body[data-quality="low"] .disconnect,
body[data-quality="low"] .modal,
body[data-quality="low"] #boot-error,
body[data-quality="low"] #screen-fade { backdrop-filter: none; }
body[data-quality="low"] .hud-clock .time,
body[data-quality="low"] .heat-value { text-shadow: none; }
body[data-quality="med"] #grain { opacity: .03; }
body[data-quality="med"] .death-overlay,
body[data-quality="med"] .disconnect,
body[data-quality="med"] .modal { backdrop-filter: blur(2px); }
/* never animate overlays that are idle */
body[data-quality="low"] .countdown { background: rgba(0,0,0,.35); }
'''
open(p, 'w').write(s)
print('style.css patched')

# ============================================================ src/main.js
p = 'src/main.js'
s = open(p).read()

s = s.replace("""const settings = loadJSON(LS_SETTINGS, { volume: 70, quality: 'high', shake: true, hints: true });""",
"""const settings = loadJSON(LS_SETTINGS, { volume: 70, quality: 'med', renderScale: 1, shake: true, hints: true });
if (!['high', 'med', 'low'].includes(settings.quality)) settings.quality = 'med';
if (typeof settings.renderScale !== 'number') settings.renderScale = 1;

// URL overrides for weak machines / preview panels:
//   ?quality=low  ?scale=0.7  ?noaudio=1
const params = new URLSearchParams(location.search);
const qParam = params.get('quality');
if (qParam && ['high', 'med', 'low'].includes(qParam)) settings.quality = qParam;
const sParam = Number(params.get('scale'));
if (sParam && sParam >= 0.4 && sParam <= 1) settings.renderScale = sParam;""")

s = s.replace("""  stage = createStage(canvas, settings.quality);""",
"""  stage = createStage(canvas, settings.quality, settings.renderScale);""")

s = s.replace("""const is2D = stage.is3D === false;
if (is2D) settings.quality = 'low';""",
"""const is2D = stage.is3D === false;
if (is2D) { settings.quality = 'low'; settings.renderScale = 1; }
document.body.dataset.quality = settings.quality;""")

s = s.replace("""      stage.setQuality(is2D ? 'low' : settings.quality);""",
"""      stage.setQuality(is2D ? 'low' : settings.quality, settings.renderScale);
      if (game.running) game.applyQuality(settings.quality, settings.renderScale);""")

s = s.replace("""    onSettingsSave: (s) => {
      Object.assign(settings, s);
      saveJSON(LS_SETTINGS, settings);
      stage.setQuality(is2D ? 'low' : settings.quality, settings.renderScale);
      ui.applySettings(settings);
      audio.setVolume(settings.volume / 100);
      if (game.running) {
        game.stage?.setQuality(is2D ? 'low' : settings.quality);
        game.arenaView?.setQuality(settings.quality);
        game.fx?.setQuality(settings.quality);
      }
    },""",
"""    onSettingsSave: (s) => {
      Object.assign(settings, s);
      saveJSON(LS_SETTINGS, settings);
      stage.setQuality(is2D ? 'low' : settings.quality, settings.renderScale);
      ui.applySettings(settings);
      audio?.setVolume(settings.volume / 100);
      if (game.running) game.applyQuality(settings.quality, settings.renderScale);
      else document.body.dataset.quality = settings.quality;
    },""")

# quality-level body class whenever the game degrades on its own
s = s.replace("""ui.applySettings(settings);""",
"""ui.applySettings(settings);
document.body.dataset.quality = settings.quality;""")
open(p, 'w').write(s)
print('main.js patched')

# ============================================================ src/ui.js default
p = 'src/ui.js'
s = open(p).read()
s = s.replace("this.settings = { volume: 70, quality: 'high', shake: true, hints: true };",
              "this.settings = { volume: 70, quality: 'med', renderScale: 1, shake: true, hints: true };")
# reflect quality preset on body whenever settings are applied
s = s.replace("""  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.loadSettingsToUI();
  }""",
"""  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.loadSettingsToUI();
    document.body.dataset.quality = this.settings.quality || 'med';
  }""")
open(p, 'w').write(s)
print('ui.js defaults patched')
