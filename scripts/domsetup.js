// Shared linkedom bootstrap for the headless DOM smoke tests.
// Install with: npm i --no-save linkedom
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

function fakeContext2D() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (['createLinearGradient', 'createRadialGradient', 'createPattern'].includes(k)) return () => grad;
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export function setupDOM() {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const { window, document } = parseHTML(html);

  window.HTMLCanvasElement.prototype.getContext = function () { return fakeContext2D(); };
  window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,iVBORw0KGgo='; };
  window.HTMLElement.prototype.animate = function () { return { cancel() {}, finished: Promise.resolve() }; };
  // linkedom does not implement <select>.value
  const selProto = window.HTMLSelectElement && window.HTMLSelectElement.prototype;
  if (selProto) {
    Object.defineProperty(selProto, 'value', {
      configurable: true,
      get() {
        const opts = [...this.querySelectorAll('option')];
        const sel = opts.find((o) => o.hasAttribute('selected')) || opts[0];
        return sel ? sel.getAttribute('value') : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if (o.getAttribute('value') === String(v)) o.setAttribute('selected', ''); else o.removeAttribute('selected');
        }
      },
    });
  }
  if (!window.navigator.clipboard) window.navigator.clipboard = { writeText: () => Promise.resolve() };
  for (const c of document.querySelectorAll('canvas')) {
    c.getContext = window.HTMLCanvasElement.prototype.getContext;
    c.toDataURL = window.HTMLCanvasElement.prototype.toDataURL;
  }

  globalThis.window = window;
  globalThis.document = document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Image = window.Image || class {};
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 8);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const store = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  window.localStorage = globalThis.localStorage;
  window.sessionStorage = globalThis.sessionStorage;
  window.innerWidth = 1600;
  window.innerHeight = 900;
  document.body.clientWidth = 1600;
  return { window, document };
}

export const fakeAudio = () => ({
  sfx() {}, setVolume() {}, resume() {}, updateAlarm() {},
  toggle() { return true; }, get enabled() { return true; },
});

export function trackConsoleErrors() {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); orig(...a); };
  return errors;
}
