import * as THREE from 'three';

const cache = new Map();

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  return c;
}

function tex(canvas, opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const rnd = (seedObj) => {
  seedObj.s = (seedObj.s * 16807) % 2147483647;
  return (seedObj.s - 1) / 2147483646;
};

export function groundTexture() {
  if (cache.has('ground')) return cache.get('ground');
  const seed = { s: 20285 };
  const c = makeCanvas(1024, 1024, (g, w, h) => {
    g.fillStyle = '#4a4038';
    g.fillRect(0, 0, w, h);
    // large steel deck plates
    const cell = 256;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const v = 0.85 + rnd(seed) * 0.3;
        g.fillStyle = `rgb(${Math.round(68 * v)},${Math.round(60 * v)},${Math.round(52 * v)})`;
        g.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        // plate scratches
        g.strokeStyle = 'rgba(25,20,17,0.35)';
        g.lineWidth = 2;
        g.strokeRect(x + 6, y + 6, cell - 12, cell - 12);
        g.strokeStyle = 'rgba(180,168,148,0.13)';
        g.lineWidth = 1;
        g.strokeRect(x + 10, y + 10, cell - 20, cell - 20);
        // bolt corners
        g.fillStyle = 'rgba(20,17,14,0.6)';
        for (const [bx, by] of [[x + 16, y + 16], [x + cell - 16, y + 16], [x + 16, y + cell - 16], [x + cell - 16, y + cell - 16]]) {
          g.beginPath(); g.arc(bx, by, 3.2, 0, 7); g.fill();
        }
        // rust patches
        for (let i = 0; i < 5; i++) {
          const rx = x + rnd(seed) * cell, ry = y + rnd(seed) * cell;
          const rr = 12 + rnd(seed) * 70;
          const grad = g.createRadialGradient(rx, ry, 0, rx, ry, rr);
          grad.addColorStop(0, `rgba(${110 + rnd(seed) * 30},${45 + rnd(seed) * 25},${20},${0.18 + rnd(seed) * 0.2})`);
          grad.addColorStop(1, 'rgba(70,35,15,0)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(rx, ry, rr, 0, 7); g.fill();
        }
        // dark stains
        for (let i = 0; i < 4; i++) {
          const rx = x + rnd(seed) * cell, ry = y + rnd(seed) * cell;
          g.fillStyle = `rgba(15,14,12,${0.06 + rnd(seed) * 0.1})`;
          g.beginPath();
          g.ellipse(rx, ry, 20 + rnd(seed) * 60, 8 + rnd(seed) * 30, rnd(seed) * 3, 0, 7);
          g.fill();
        }
      }
    }
    // worn hazard stripe band across one panel
    g.save();
    g.translate(512, 764);
    g.rotate(-0.06);
    for (let i = -6; i < 6; i++) {
      g.fillStyle = i % 2 ? 'rgba(198,156,55,0.5)' : 'rgba(28,25,21,0.55)';
      g.beginPath();
      g.moveTo(i * 46, -22); g.lineTo(i * 46 + 30, -22); g.lineTo(i * 46 + 8, 22); g.lineTo(i * 46 - 22, 22); g.closePath(); g.fill();
    }
    g.restore();
    // cracks
    g.strokeStyle = 'rgba(12,10,9,0.55)';
    for (let n = 0; n < 18; n++) {
      g.beginPath();
      let x = rnd(seed) * w, y = rnd(seed) * h;
      g.moveTo(x, y);
      const segs = 4 + Math.floor(rnd(seed) * 6);
      for (let i = 0; i < segs; i++) {
        x += (rnd(seed) - 0.5) * 90; y += (rnd(seed) - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.lineWidth = 1 + rnd(seed) * 2;
      g.stroke();
    }
    // sand drift
    for (let i = 0; i < 60; i++) {
      const x = rnd(seed) * w, y = rnd(seed) * h, r = 30 + rnd(seed) * 120;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(168,143,105,${0.05 + rnd(seed) * 0.08})`);
      grad.addColorStop(1, 'rgba(168,143,105,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // vignette-ish dark patches
    for (let i = 0; i < 20; i++) {
      const x = rnd(seed) * w, y = rnd(seed) * h, r = 80 + rnd(seed) * 180;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(20,18,16,0.10)');
      grad.addColorStop(1, 'rgba(20,18,16,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
  const t = tex(c);
  cache.set('ground', t);
  return t;
}

export function metalTexture() {
  if (cache.has('metal')) return cache.get('metal');
  const seed = { s: 77031 };
  const c = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#5a5a55';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const y = rnd(seed) * h;
      g.fillStyle = `rgba(${30 + rnd(seed) * 80},${28 + rnd(seed) * 60},${25 + rnd(seed) * 45},${0.05 + rnd(seed) * 0.12})`;
      g.fillRect(0, y, w, 1 + rnd(seed) * 4);
    }
    // rust streaks
    for (let i = 0; i < 26; i++) {
      const x = rnd(seed) * w, y = rnd(seed) * h * 0.7, len = 40 + rnd(seed) * 220, wd = 2 + rnd(seed) * 12;
      const grad = g.createLinearGradient(x, y, x, y + len);
      grad.addColorStop(0, `rgba(130,55,24,${0.25 + rnd(seed) * 0.35})`);
      grad.addColorStop(1, 'rgba(130,55,24,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, wd, len);
    }
    // panel seams
    g.strokeStyle = 'rgba(20,20,18,0.7)'; g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(0, 256); g.lineTo(w, 256); g.moveTo(256, 0); g.lineTo(256, h); g.stroke();
    g.strokeStyle = 'rgba(220,215,200,0.12)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 259); g.lineTo(w, 259); g.moveTo(259, 0); g.lineTo(259, h); g.stroke();
    // rivets
    for (let x = 20; x < w; x += 64) {
      for (const y of [20, 236, 276, h - 20]) {
        g.fillStyle = 'rgba(20,18,16,0.8)'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
        g.fillStyle = 'rgba(190,185,170,0.25)'; g.beginPath(); g.arc(x - 1, y - 1, 1.6, 0, 7); g.fill();
      }
    }
    // scratches
    for (let i = 0; i < 80; i++) {
      g.strokeStyle = `rgba(${200 + rnd(seed) * 40},${195 + rnd(seed) * 40},${180 + rnd(seed) * 40},${0.05 + rnd(seed) * 0.1})`;
      g.lineWidth = 0.6 + rnd(seed);
      const x = rnd(seed) * w, y = rnd(seed) * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd(seed) - 0.5) * 90, y + (rnd(seed) - 0.5) * 20); g.stroke();
    }
  });
  const t = tex(c);
  cache.set('metal', t);
  return t;
}

export function hazardTexture() {
  if (cache.has('hazard')) return cache.get('hazard');
  const c = makeCanvas(256, 64, (g, w, h) => {
    g.fillStyle = '#171512'; g.fillRect(0, 0, w, h);
    for (let i = -3; i < 9; i++) {
      g.fillStyle = '#d7a62f';
      g.beginPath();
      g.moveTo(i * 32, 0); g.lineTo(i * 32 + 18, 0); g.lineTo(i * 32 - 14, h); g.lineTo(i * 32 - 32, h); g.closePath(); g.fill();
    }
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }
  });
  const t = tex(c, { repeat: [4, 1] });
  cache.set('hazard', t);
  return t;
}

export function glowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const c = makeCanvas(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  const t = tex(c, { srgb: true });
  cache.set('glow', t);
  return t;
}

export function smokeTexture() {
  if (cache.has('smoke')) return cache.get('smoke');
  const c = makeCanvas(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) {
      const x = w / 2 + (Math.random() - 0.5) * 50, y = h / 2 + (Math.random() - 0.5) * 50, r = 14 + Math.random() * 32;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.08 + Math.random() * 0.09})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
  const t = tex(c, { srgb: false });
  cache.set('smoke', t);
  return t;
}

export function sparkTexture() {
  if (cache.has('spark')) return cache.get('spark');
  const c = makeCanvas(64, 64, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,240,210,0.9)');
    grad.addColorStop(0.6, 'rgba(255,190,80,0.35)');
    grad.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  const t = tex(c);
  cache.set('spark', t);
  return t;
}

export function ringTexture() {
  if (cache.has('ring')) return cache.get('ring');
  const c = makeCanvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 10;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 14, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 22;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 14, 0, 7); g.stroke();
  });
  const t = tex(c);
  cache.set('ring', t);
  return t;
}

export function skyTexture() {
  if (cache.has('sky')) return cache.get('sky');
  const c = makeCanvas(1024, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a1216');
    grad.addColorStop(0.35, '#25333a');
    grad.addColorStop(0.58, '#7a5a3f');
    grad.addColorStop(0.72, '#c67b3c');
    grad.addColorStop(0.8, '#5a3a28');
    grad.addColorStop(1, '#191512');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    // dust clouds
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w, y = h * (0.3 + Math.random() * 0.4), rw = 120 + Math.random() * 300, rh = 12 + Math.random() * 40;
      const rg = g.createRadialGradient(x, y, 0, x, y, rw);
      rg.addColorStop(0, `rgba(${150 + Math.random() * 60},${110 + Math.random() * 40},70,${0.03 + Math.random() * 0.06})`);
      rg.addColorStop(1, 'rgba(120,90,60,0)');
      g.fillStyle = rg;
      g.beginPath(); g.ellipse(x, y, rw, rh, 0, 0, 7); g.fill();
    }
    // sun
    const sx = w * 0.7, sy = h * 0.56;
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, 150);
    sun.addColorStop(0, 'rgba(255,220,160,0.65)');
    sun.addColorStop(0.35, 'rgba(255,160,80,0.25)');
    sun.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = sun; g.beginPath(); g.arc(sx, sy, 150, 0, 7); g.fill();
  });
  const t = tex(c);
  cache.set('sky', t);
  return t;
}

export function noiseTexture(size = 256) {
  const key = 'noise' + size;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size, size, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  const t = tex(c, { srgb: false });
  cache.set(key, t);
  return t;
}

export function iconTexture(kind, color = '#ffffff') {
  const key = 'icon:' + kind + color;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    const cx = w / 2, cy = h / 2;
    if (kind === 'coolant') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38); g.stroke();
        g.beginPath(); g.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
        g.lineTo(cx + Math.cos(a + 0.5) * 34, cy + Math.sin(a + 0.5) * 34); g.stroke();
      }
      g.fillRect(cx - 6, cy - 50, 12, 20);
    } else if (kind === 'grenade') {
      g.beginPath(); g.arc(cx, cy + 6, 34, 0, 7); g.stroke();
      g.fillRect(cx - 10, cy - 46, 20, 12);
      g.beginPath(); g.moveTo(cx + 24, cy - 24); g.lineTo(cx + 40, cy - 40); g.stroke();
      g.fillRect(cx - 30, cy - 2, 60, 8);
    } else if (kind === 'plate') {
      g.strokeRect(cx - 36, cy - 36, 72, 72);
      g.beginPath(); g.moveTo(cx - 36, cy - 36); g.lineTo(cx + 36, cy + 36); g.stroke();
      g.globalAlpha = 0.4; g.fillRect(cx - 26, cy - 26, 52, 52);
    } else if (kind === 'overclock') {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i / 6 * Math.PI * 2;
        const x = cx + Math.cos(a) * 42, y = cy + Math.sin(a) * 42;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
      g.beginPath(); g.arc(cx, cy, 12, 0, 7); g.fill();
      g.beginPath(); g.moveTo(cx, cy - 30); g.lineTo(cx, cy + 30); g.stroke();
    } else if (kind === 'grapple') {
      g.beginPath(); g.arc(cx - 10, cy - 18, 26, -0.4, Math.PI * 1.3); g.stroke();
      g.beginPath(); g.moveTo(cx + 16, cy + 14); g.lineTo(cx + 36, cy + 34); g.stroke();
      g.beginPath(); g.moveTo(cx + 30, cy + 34); g.lineTo(cx + 44, cy + 20); g.stroke();
      g.beginPath(); g.moveTo(cx + 44, cy + 40); g.lineTo(cx + 30, cy + 46); g.stroke();
    } else if (kind === 'purge') {
      g.beginPath(); g.arc(cx, cy, 40, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(cx - 20, cy - 20); g.lineTo(cx + 20, cy + 20);
      g.moveTo(cx + 20, cy - 20); g.lineTo(cx - 20, cy + 20); g.stroke();
    } else if (kind === 'hazard') {
      g.beginPath(); g.moveTo(cx, cy - 42); g.lineTo(cx + 42, cy + 32); g.lineTo(cx - 42, cy + 32); g.closePath(); g.stroke();
      g.fillRect(cx - 4, cy - 18, 8, 28);
      g.beginPath(); g.arc(cx, cy + 20, 4, 0, 7); g.fill();
    } else if (kind === 'box') {
      g.strokeRect(cx - 34, cy - 34, 68, 68);
      g.beginPath(); g.moveTo(cx - 34, cy - 8); g.lineTo(cx + 34, cy - 8); g.moveTo(cx, cy - 34); g.lineTo(cx, cy + 34); g.stroke();
    } else if (kind === 'wind') {
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.moveTo(cx - 36, cy - 20 + i * 20); g.bezierCurveTo(cx + 10, cy - 32 + i * 20, cx + 26, cy - 6 + i * 20, cx + 38, cy - 14 + i * 20); g.stroke();
      }
    } else if (kind === 'claw') {
      g.lineWidth = 10;
      g.beginPath(); g.moveTo(cx, cy - 42); g.lineTo(cx, cy + 4); g.stroke();
      g.beginPath(); g.moveTo(cx, cy + 4); g.quadraticCurveTo(cx - 30, cy + 10, cx - 30, cy + 34); g.stroke();
      g.beginPath(); g.moveTo(cx, cy + 4); g.quadraticCurveTo(cx + 30, cy + 10, cx + 30, cy + 34); g.stroke();
    } else if (kind === 'bolt') {
      g.beginPath(); g.moveTo(cx + 10, cy - 44); g.lineTo(cx - 22, cy + 8); g.lineTo(cx - 2, cy + 8); g.lineTo(cx - 12, cy + 44); g.lineTo(cx + 26, cy - 10); g.lineTo(cx + 4, cy - 10); g.closePath(); g.fill();
    } else if (kind === 'heat') {
      g.beginPath(); g.moveTo(cx, cy - 40);
      g.bezierCurveTo(cx + 30, cy - 6, cx + 20, cy + 36, cx, cy + 38);
      g.bezierCurveTo(cx - 22, cy + 36, cx - 30, cy - 2, cx, cy - 40);
      g.fill();
    } else {
      g.beginPath(); g.arc(cx, cy, 30, 0, 7); g.stroke();
    }
  });
  const t = tex(c);
  cache.set(key, t);
  return t;
}

export function nameTexture(name, color) {
  const c = makeCanvas(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '700 58px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(name, w / 2 + 3, h / 2 + 3);
    g.fillStyle = color;
    g.fillText(name, w / 2, h / 2);
  });
  return tex(c);
}

export function scorchTexture() {
  if (cache.has('scorch')) return cache.get('scorch');
  const c = makeCanvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = w / 2 + (Math.random() - 0.5) * 90, y = h / 2 + (Math.random() - 0.5) * 90, r = 30 + Math.random() * 80;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(8,7,6,${0.25 + Math.random() * 0.3})`);
      grad.addColorStop(1, 'rgba(8,7,6,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(20,15,10,0.5)';
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + (Math.random() - 0.5) * 220, h / 2 + (Math.random() - 0.5) * 220);
      g.lineWidth = 2 + Math.random() * 5; g.stroke();
    }
  });
  const t = tex(c);
  cache.set('scorch', t);
  return t;
}

export function signTexture(text, sub = '', color = '#d7a62f') {
  const c = makeCanvas(512, 256, (g, w, h) => {
    g.fillStyle = '#171512'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a352c'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? '#d7a62f' : '#1b1814';
      g.save(); g.translate(0, h - 46); g.transform(1, 0, -1.2, 1, 0, 0);
      g.fillRect(i * 110, 0, 70, 34); g.restore();
    }
    g.font = '900 88px "Arial Black", "Noto Sans SC", sans-serif';
    g.textAlign = 'center'; g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 - 6);
    if (sub) {
      g.font = '600 30px "Noto Sans SC", sans-serif';
      g.fillStyle = 'rgba(220,210,190,0.7)';
      g.fillText(sub, w / 2, h / 2 + 62);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 60; i++) g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 10, 1 + Math.random() * 3);
  });
  return tex(c);
}

export function smallIconTexture(kind, color) {
  return iconTexture(kind, color);
}
