// Minimal reconnectable WebSocket client for the host-authoritative game server.
export class Net {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.url = null;
    this.manualClose = false;
    this.retry = 0;
    this.pingTimer = null;
    this.rtt = 0;
    this.clientId = null;
    this.connected = false;
  }

  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const qs = new URLSearchParams(location.search).get('ws');
    return qs || `${proto}://${location.host}/ws`;
  }

  connect(url = this.url) {
    if (!url) url = Net.defaultUrl();
    this.url = url;
    this.manualClose = false;
    this.onStatus?.('connecting');
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.onStatus?.('closed', e.message);
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.onStatus?.('open');
      this.startPing();
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') this.clientId = msg.clientId;
      if (msg.type === 'pong') {
        this.rtt = Math.max(0, Date.now() - msg.t);
      }
      this.onMessage?.(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.stopPing();
      this.onStatus?.('closed');
      if (!this.manualClose) this.scheduleReconnect();
    };
    this.ws.onerror = () => { /* close follows */ };
  }

  scheduleReconnect() {
    if (this.manualClose) return;
    this.retry = Math.min(6, this.retry + 1);
    const delay = Math.min(8000, 700 * Math.pow(1.6, this.retry));
    this.onStatus?.('retrying', delay);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.manualClose) this.connect(this.url);
    }, delay);
  }

  startPing() {
    this.stopPing();
    const tick = () => {
      if (this.connected) this.send({ type: 'ping', t: Date.now() });
    };
    tick();
    this.pingTimer = setInterval(tick, 2500);
  }

  stopPing() { clearInterval(this.pingTimer); this.pingTimer = null; }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch {}
      return true;
    }
    return false;
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    try { this.ws?.close(1000, 'leave'); } catch {}
    this.connected = false;
  }
}

export function normalizeWsUrl(input) {
  let s = (input || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(s)) s = 'ws://' + s;
  if (!/\/ws\/?$/.test(s)) s = s.replace(/\/$/, '') + '/ws';
  return s;
}
