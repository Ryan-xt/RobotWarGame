import re

# ============================================================ public/index.html
p = 'public/index.html'
s = open(p).read()

# 1) diag button on the menu button row
if 'id="btn-diag"' not in s:
    s = s.replace("""          <button id="btn-settings" class="btn ghost small">设置</button>""",
"""          <button id="btn-settings" class="btn ghost small">设置</button>
          <button id="btn-diag" class="btn ghost small">诊断</button>""")

# 2) click ripple + diagnostic panel script (after the boot guard block)
if 'id="click-ripple"' not in s:
    s = s.replace('</body>', '''<script>
  /* ---- click feedback + self diagnostic panel ---------------------------- */
  (function () {
    var clicks = 0;
    var lastClick = '';
    var lastErr = '';

    window.addEventListener('error', function (e) { lastErr = (e && e.message) || lastErr; });

    document.addEventListener('click', function (e) {
      clicks++;
      var t = e.target || {};
      lastClick = (t.id || t.className || t.tagName || '?') + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY);
      var d = document.createElement('div');
      d.className = 'click-ripple';
      d.style.left = e.clientX + 'px';
      d.style.top = e.clientY + 'px';
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 520);
    }, true);

    function lines() {
      var app = window.__overload || {};
      var net = app.net || {};
      var stage = app.stage || {};
      var ui = app.ui || {};
      var gl = null, glErr = '';
      try {
        var c = document.createElement('canvas');
        gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      } catch (err) { glErr = err.message; }
      var screens = ['loading', 'menu', 'lobby', 'game', 'results'].filter(function (n) {
        var el = document.getElementById('screen-' + n);
        return el && !el.classList.contains('hidden');
      }).join(',') || '(none)';
      return [
        '脚本启动 __bootOK      : ' + (window.__bootOK ? '是' : '否 ← 说明 app.js 没跑起来'),
        '游戏对象 __overload    : ' + (window.__overload ? '已创建' : '未创建'),
        '渲染模式               : ' + (stage.is3D === false ? 'Canvas2D 兼容模式' : (stage.is3D ? 'WebGL 3D' : '未知')),
        'WebGL 上下文           : ' + (gl ? '可用' : '不可用 ' + glErr),
        '画质档位               : ' + (stage.quality || '-'),
        'WebSocket 已连接       : ' + (net.connected ? '是' : '否'),
        'WebSocket 地址         : ' + (net.url || '-'),
        '重连次数               : ' + (net.retry || 0),
        '当前屏幕               : ' + screens,
        '房间码                 : ' + ((ui.currentRoom && ui.currentRoom.code) || '-'),
        '对局运行中             : ' + (app.game && app.game.running ? '是' : '否'),
        '点击次数               : ' + clicks + '  最近: ' + (lastClick || '-'),
        '窗口尺寸 / DPR         : ' + window.innerWidth + '×' + window.innerHeight + ' @' + (window.devicePixelRatio || 1),
        '最后脚本错误           : ' + (lastErr || '无'),
        '页面地址               : ' + location.href,
        'UA                     : ' + navigator.userAgent,
      ].join('\\n');
    }

    function showDiag() {
      var box = document.getElementById('boot-error');
      if (!box) return;
      box.classList.remove('hidden');
      document.getElementById('boot-error-title').textContent = '运行诊断';
      document.getElementById('boot-error-detail').textContent = lines();
      document.getElementById('boot-error-stack').textContent = '';
      try {
        fetch('/api/log', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'diag', msg: lines().slice(0, 3000), where: 'diag' }),
        }).catch(function () {});
      } catch (e) {}
    }
    window.__diag = showDiag;
    window.__diagLines = lines;

    var btn = document.getElementById('btn-diag');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); showDiag(); });

    /* Escape hatch: ?diag=1 opens the panel immediately. */
    if (/[?&]diag=1/.test(location.search)) setTimeout(showDiag, 1500);
  })();
</script>
</body>''')
open(p, 'w').write(s)
print('diag panel added')

# ============================================================ style additions
p = 'public/style.css'
s = open(p).read()
if '.click-ripple' not in s:
    s += '''
/* --------------------------------------------------------- click feedback */
.click-ripple {
  position: fixed; z-index: 300; width: 8px; height: 8px; margin: -4px 0 0 -4px;
  border-radius: 50%; border: 1px solid rgba(255, 210, 140, .95);
  background: rgba(255, 200, 120, .35);
  pointer-events: none; animation: clickPulse .5s ease-out forwards;
}
@keyframes clickPulse {
  0% { transform: scale(.6); opacity: 1; }
  100% { transform: scale(4.2); opacity: 0; }
}
'''
open(p, 'w').write(s)
print('click ripple css added')
