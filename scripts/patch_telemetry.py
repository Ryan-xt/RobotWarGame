import re

# ---------------------------------------------------------------- boot guard: click telemetry
p = 'public/index.html'
s = open(p).read()
if 'click-report' not in s:
    s = s.replace("""    window.__bootShowError = show;""",
"""    window.__bootShowError = show;
    /* Click telemetry: proves whether the DOM receives clicks at all. */
    var clicks = 0;
    document.addEventListener('click', function (e) {
      if (clicks++ > 25) return;
      var t = e.target;
      var id = (t && t.id) || (t && t.closest && (t.closest('button') || t.closest('[id]') || {}).id) || '';
      var cls = (t && t.className && String(t.className).slice(0, 40)) || '';
      send('click-report', 'id=' + id + ' cls=' + cls + ' tag=' + (t && t.tagName) + ' bootOK=' + !!window.__bootOK);
    }, true);""")
    open(p, 'w').write(s)
    print('click telemetry added')

# ---------------------------------------------------------------- main.js robustness
p = 'src/main.js'
s = open(p).read()

# never let audio creation break a UI action
s = s.replace("""function startQuickplay() {
  try { audio.resume(); } catch (e) { reportClient('audio-fail', e); }""",
"""function safeAudio() {
  try { audio.resume(); } catch (e) { reportClient('audio-fail', e); }
}

function startQuickplay() {
  safeAudio();""")
s = s.replace("""function createRoom() {
  audio.resume();""", """function createRoom() {
  safeAudio();""")
s = s.replace("""function joinRoom(code) {
  audio.resume();""", """function joinRoom(code) {
  safeAudio();""")

# wrap every handler body so an exception can never look like a dead button
s = s.replace("""const ui = new UI({
  audio,
  handlers: {""",
"""function guard(name, fn) {
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
  handlers: {""")

import re as _re
# wrap each handler entry  onX: (...) => ...  -> onX: guard('onX', (...) => ...)
def wrap(m):
    name = m.group(1)
    body = m.group(2)
    if body.strip().startswith('guard('):
        return m.group(0)
    return f"{name}: guard('{name}', {body})"

# handler object spans from 'handlers: {' to the first '\n  },\n});'
start = s.index('handlers: {')
end = s.index('\n  },\n});', start)
block = s[start:end]
block2 = _re.sub(r"(on[A-Z][A-Za-z]*): ((?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{[^{}]*\}|[^\n]*))", lambda m: m.group(0), block)
# simpler: handle the specific shapes used in this file
block2 = block2.replace("onQuick: () => startQuickplay(),", "onQuick: guard('onQuick', () => startQuickplay()),")
block2 = block2.replace("onCreate: () => createRoom(),", "onCreate: guard('onCreate', () => createRoom()),")
block2 = block2.replace("onJoinOpen: () => { ui.openModal('modal-join'); net.send({ type: 'rooms' }); },",
                        "onJoinOpen: guard('onJoinOpen', () => { ui.openModal('modal-join'); net.send({ type: 'rooms' }); }),")
block2 = block2.replace("onJoinCode: (code) => joinRoom(code),", "onJoinCode: guard('onJoinCode', (code) => joinRoom(code)),")
block2 = block2.replace("onJoinRoom: (code) => joinRoom(code),", "onJoinRoom: guard('onJoinRoom', (code) => joinRoom(code)),")
block2 = block2.replace("onRefreshRooms: () => net.send({ type: 'rooms' }),", "onRefreshRooms: guard('onRefreshRooms', () => net.send({ type: 'rooms' })),")
block2 = block2.replace("onConnectWs: (url) => connectServer(url),", "onConnectWs: guard('onConnectWs', (url) => connectServer(url)),")
block2 = block2.replace("onStart: () => net.send({ type: 'start' }),", "onStart: guard('onStart', () => net.send({ type: 'start' })),")
block2 = block2.replace("onReady: (ready) => net.send({ type: 'setReady', ready }),", "onReady: guard('onReady', (ready) => net.send({ type: 'setReady', ready })),")
block2 = block2.replace("onLeave: () => leaveRoom(),", "onLeave: guard('onLeave', () => leaveRoom()),")
block2 = block2.replace("onRematch: () => net.send({ type: 'rematch' }),", "onRematch: guard('onRematch', () => net.send({ type: 'rematch' })),")
block2 = block2.replace("onToLobby: () => { lobbyOpen = true; net.send({ type: 'toLobby' }); },", "onToLobby: guard('onToLobby', () => { lobbyOpen = true; net.send({ type: 'toLobby' }); }),")
block2 = block2.replace("onChat: (text) => net.send({ type: 'chat', text }),", "onChat: guard('onChat', (text) => net.send({ type: 'chat', text })),")
block2 = block2.replace("onToggleAudio: () => ui.toggleAudio(),", "onToggleAudio: guard('onToggleAudio', () => ui.toggleAudio()),")
block2 = block2.replace("onResume: () => resumeSession(),", "onResume: guard('onResume', () => resumeSession()),")
s = s[:start] + block2 + s[end:]

# hide the loading screen quickly even when the socket is slow
s = s.replace("""setTimeout(() => {
  if (ui.screenLoading && !ui.screenLoading.classList.contains('hidden')) {
    ui.hideLoading();
    ui.toast('未连上主机 · 可在“加入房间”里填写主机地址', 'err');
  }
}, 6500);""",
"""setTimeout(() => {
  if (ui.screenLoading && !ui.screenLoading.classList.contains('hidden')) {
    ui.hideLoading();
    if (!net.connected) ui.toast('未连上主机 · 可在“加入房间”里填写主机地址', 'err');
  }
}, 2600);""")

open(p, 'w').write(s)
print('main.js hardened')
