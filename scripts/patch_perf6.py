import re

# ---------------------------------------------------------------- arenaView decor
p = 'src/arenaView.js'
s = open(p).read()

s = s.replace("""    this.buildPads();
    this.buildProps();
    this.buildBoundary();""",
"""    this.buildPads();
    // Decorative meshes (barrels, pipes, floodlight towers) are the first
    // thing to drop when the player needs frames back.
    const beforeDecor = new Set(this.group.children);
    this.buildProps();
    this.group.children.forEach((c) => { if (!beforeDecor.has(c)) beforeDecor.add(c); });
    this.decor = this.group.children.filter((c) => c.isGroup && !beforeDecor.has(c));
    this.buildBoundary();""")

s = s.replace("""  setQuality(q) {
    this.quality = q;
    // ambient dust is pure decoration: skip it entirely on the low preset
    if (this.dust) this.dust.visible = q !== 'low';
    if (this.centerGlow) this.centerGlow.visible = q !== 'low';""",
"""  setQuality(q) {
    this.quality = q;
    // ambient dust and rim props are pure decoration: skip them on low
    if (this.dust) this.dust.visible = q !== 'low';
    if (this.centerGlow) this.centerGlow.visible = q !== 'low';
    for (const g of this.decor || []) g.visible = q !== 'low';""")
open(p, 'w').write(s)
print('arenaView decor toggling')

# ---------------------------------------------------------------- frame cap
p = 'src/main.js'
s = open(p).read()

s = s.replace("""let last = performance.now();
let fpsFrames = 0, fpsTime = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;""",
"""let last = performance.now();
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
  frameAcc = 0;""")

s = s.replace("""  settings = loadJSON(LS_SETTINGS""", """  settings = loadJSON(LS_SETTINGS""")
open(p, 'w').write(s)
print('frame cap')
