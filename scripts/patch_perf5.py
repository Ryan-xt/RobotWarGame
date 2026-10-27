import re

# ---------------------------------------------------------------- index.html
p = 'public/index.html'
s = open(p).read()

if 'btn-hud-quality' not in s:
    s = s.replace('''          <button id="btn-hud-leave" class="chip dark danger">退出战场</button>''',
'''          <button id="btn-hud-quality" class="chip tiny" title="切换画质（高 / 中 / 低）">画质 中</button>
          <button id="btn-hud-leave" class="chip dark danger">退出战场</button>''')

# fps warning text now depends on the preset
s = s.replace('''<div id="fps-warning" class="fps-warning hidden">帧率偏低 · 已自动降低特效</div>''',
'''<div id="fps-warning" class="fps-warning hidden">帧率偏低 · 已自动降低画质（设置里可调回）</div>''')
open(p, 'w').write(s)
print('hud quality button added')

# ---------------------------------------------------------------- ui.js
p = 'src/ui.js'
s = open(p).read()

s = s.replace("""    tap('btn-hud-leave', () => h.onLeave?.());""",
"""    tap('btn-hud-leave', () => h.onLeave?.());
    tap('btn-hud-quality', () => h.onCycleQuality?.());""")

s = s.replace("""  setFps(fps) {""",
"""  setQualityLabel(quality) {
    const el = $('btn-hud-quality');
    if (!el) return;
    const label = { high: '高', med: '中', low: '低' }[quality] || '中';
    if (el.textContent !== '画质 ' + label) el.textContent = '画质 ' + label;
    el.dataset.quality = quality;
  }

  setFps(fps) {""")
open(p, 'w').write(s)
print('ui quality label added')

# ---------------------------------------------------------------- main.js
p = 'src/main.js'
s = open(p).read()

s = s.replace("""    onToggleAudio: guard('onToggleAudio', () => ui.toggleAudio()),""",
"""    onToggleAudio: guard('onToggleAudio', () => ui.toggleAudio()),
    onCycleQuality: guard('onCycleQuality', () => cycleQuality()),""")

s = s.replace("""function setLoaderStatus(text, isErr = false) {""",
"""// In-game quality switch: one click cycles 高 → 中 → 低 → 高 and persists.
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

function setLoaderStatus(text, isErr = false) {""")

s = s.replace("""ui.applySettings(settings);
document.body.dataset.quality = settings.quality;""",
"""ui.applySettings(settings);
ui.setQualityLabel(settings.quality);
document.body.dataset.quality = settings.quality;""")
open(p, 'w').write(s)
print('main cycleQuality added')
