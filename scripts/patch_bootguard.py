import re

p = 'public/index.html'
s = open(p).read()

# 1) boot-error overlay markup (just after <body>)
if 'id="boot-error"' not in s:
    m = re.search(r'<body[^>]*>', s)
    overlay = '''
  <!-- ======================== BOOT GUARD / ERRORS ======================== -->
  <div id="boot-error" class="hidden">
    <div class="be-card">
      <div class="be-head"><span class="be-mark">!</span><b id="boot-error-title">启动失败</b></div>
      <p id="boot-error-detail"></p>
      <pre id="boot-error-stack"></pre>
      <div class="be-actions">
        <button id="boot-error-reload" class="btn primary">重新加载</button>
        <button id="boot-error-close" class="btn ghost">先看看菜单</button>
      </div>
      <div class="be-hint">若多次失败：确认预览面板指向 3000 端口，或按 F12 在控制台看第一条红色报错。</div>
    </div>
  </div>
'''
    s = s[:m.end()] + overlay + s[m.end():]

guard = '''<script>
  /* Runs before app.js: turns a dead boot into a readable message. */
  (function () {
    var shown = false;
    function el(id) { return document.getElementById(id); }
    function send(kind, msg, stack) {
      try {
        var body = JSON.stringify({ kind: kind, msg: String(msg || '').slice(0, 400), stack: String(stack || '').slice(0, 900), where: 'boot-guard', ua: navigator.userAgent.slice(0, 120), href: location.href });
        fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).catch(function () {});
      } catch (e) {}
    }
    function show(title, detail, stack) {
      if (shown) return;
      shown = true;
      var box = el('boot-error');
      if (!box) return;
      box.classList.remove('hidden');
      el('boot-error-title').textContent = title;
      el('boot-error-detail').textContent = detail || '';
      el('boot-error-stack').textContent = stack || '';
      var reload = el('boot-error-reload');
      if (reload) reload.onclick = function () { location.reload(); };
      var close = el('boot-error-close');
      if (close) close.onclick = function () { box.classList.add('hidden'); };
    }
    window.__bootShowError = show;
    window.addEventListener('error', function (e) {
      if (e && e.target && e.target.tagName === 'SCRIPT') {
        show('脚本加载失败', 'app.js 没能加载：' + (e.target.src || ''), '检查 /app.js 是否可访问（HTTP 200）。');
        send('script-load-fail', e.target.src);
        return;
      }
      if (!e) return;
      show('启动时出错', (e.message || 'unknown') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0), e.error && e.error.stack);
      send('boot-error', e.message, e.error && e.error.stack);
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      show('运行异常', String((r && r.message) || r), r && r.stack);
      send('boot-rejection', (r && r.message) || r, r && r.stack);
    });
    setTimeout(function () {
      if (!window.__bootOK && !shown) {
        show('游戏脚本没有运行', '页面已加载，但 app.js 6 秒内没有启动。多半是 WebGL 初始化失败，或脚本被拦截。', location.href);
        send('boot-timeout', 'no __bootOK after 6s', location.href);
      }
    }, 6000);
  })();
</script>
'''

# 2) boot guard before the module script (replace any previous copy)
s = re.sub(r'<script>\s*/\* Runs before app\.js[\s\S]*?</script>\n?', '', s)
s = s.replace('<script type="module" src="/app.js?v=3"></script>', '<script type="module" src="/app.js"></script>')
s = s.replace('<script type="module" src="/app.js?v=4"></script>', '<script type="module" src="/app.js"></script>')
if 'window.__bootShowError' not in s:
    s = s.replace('<script type="module" src="/app.js"></script>', guard + '<script type="module" src="/app.js?v=5"></script>')
s = s.replace('<script type="module" src="/app.js?v=5"></script>', '<script type="module" src="/app.js?v=5"></script>')

# 3) loading screen live status line
if 'id="loader-status"' not in s:
    s = s.replace('''      <div class="loader-tip">被击中不会掉血。掉的是理智。</div>''',
'''      <div class="loader-tip">被击中不会掉血。掉的是理智。</div>
      <div id="loader-status" class="loader-status">正在连接主机…</div>
      <button id="loader-retry" class="btn small hidden">重试连接</button>''')

open(p, 'w').write(s)
print('html patched')
