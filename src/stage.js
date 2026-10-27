import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Stage2D } from './stage2d.js';

// Graphics presets. `low` is meant for integrated GPUs / high-DPI laptops:
// no shadows, no bloom, and the canvas is rendered at CSS resolution.
export const QUALITY_PRESETS = {
  high: {
    dprCap: 1.5, shadows: true, shadowSize: 1024, shadowType: THREE.PCFSoftShadowMap,
    bloom: true, bloomScale: 0.5, bloomStrength: 0.55, bloomRadius: 0.6, bloomThreshold: 0.8,
  },
  med: {
    dprCap: 1.15, shadows: true, shadowSize: 512, shadowType: THREE.PCFShadowMap,
    bloom: true, bloomScale: 0.33, bloomStrength: 0.4, bloomRadius: 0.5, bloomThreshold: 0.86,
  },
  low: {
    dprCap: 1, shadows: false, shadowSize: 512, shadowType: THREE.BasicShadowMap,
    bloom: false, bloomScale: 0.25, bloomStrength: 0.3, bloomRadius: 0.4, bloomThreshold: 0.9,
  },
};

export function presetFor(quality) {
  return QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.is3D = true;
    // Some embedded previews / blocklisted GPUs reject WebGL; try a couple of
    // option sets before giving up so we can fall back to the 2D renderer.
    const attempts = [
      { antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false },
      { antialias: false, powerPreference: 'default', alpha: false, stencil: false, failIfMajorPerformanceCaveat: false },
      { antialias: false, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: false },
    ];
    let renderer = null;
    let lastErr = null;
    for (const opts of attempts) {
      try {
        renderer = new THREE.WebGLRenderer({ canvas, ...opts });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!renderer) {
      const reason = (lastErr && lastErr.message) || 'WebGL 不可用';
      const err = new Error('WebGL 初始化失败: ' + reason);
      err.webglFailure = true;
      throw err;
    }
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // static shadows only refresh when lights/geometry change (see setQuality)
    this.renderer.shadowMap.autoUpdate = true;

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.Camera());
    this.composer.addPass(this.renderPass);
    // Bloom runs at a fraction of the framebuffer resolution: by far the
    // cheapest way to keep the glow without paying full-res blur cost.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.78);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.scene = null;
    this.camera = null;
    this.quality = 'high';
    this.renderScale = 1;
    this.bloomEnabled = true;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.adapterInfo = this.readAdapterInfo();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  readAdapterInfo() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown';
      return gl.getParameter(gl.RENDERER) || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  setActive(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  /**
   * @param {'high'|'med'|'low'} q graphics preset
   * @param {number} [renderScale] extra resolution multiplier (0.5 - 1)
   */
  setQuality(q, renderScale = this.renderScale) {
    const preset = presetFor(q);
    this.quality = preset === QUALITY_PRESETS.high ? 'high' : preset === QUALITY_PRESETS.med ? 'med' : 'low';
    this.renderScale = Math.max(0.5, Math.min(1, Number(renderScale) || 1));
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, preset.dprCap) * this.renderScale);
    this.renderer.shadowMap.enabled = preset.shadows;
    if (preset.shadows && this.renderer.shadowMap.type !== preset.shadowType) {
      this.renderer.shadowMap.type = preset.shadowType;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.bloomEnabled = preset.bloom;
    this.bloom.strength = preset.bloomStrength;
    this.bloom.radius = preset.bloomRadius;
    this.bloom.threshold = preset.bloomThreshold;
    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    // updateStyle=false: the canvas is absolutely positioned by CSS, so
    // skipping style writes avoids a layout pass on every resize.
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    const preset = presetFor(this.quality);
    if (preset.bloom) {
      const s = preset.bloomScale;
      this.bloom.setSize(
        Math.max(64, Math.floor(this.width * s)),
        Math.max(64, Math.floor(this.height * s)),
      );
    }
    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }
  }

  render(dt) {
    if (!this.scene || !this.camera) return;
    // Shadow maps are re-rendered from scratch every frame by default — on the
    // big map that is hundreds of casters drawn a second time for a shadow
    // nobody can tell is one frame old. Refreshing them every other frame
    // (every third on 'med') halves that cost with no visible difference in a
    // top-down view.
    this.frame = (this.frame || 0) + 1;
    if (this.renderer.shadowMap.enabled) {
      const every = this.quality === 'high' ? 2 : 3;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = this.frame % every === 0;
    } else {
      this.renderer.shadowMap.autoUpdate = true;
    }
    if (this.bloomEnabled) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Renderer counters for the in-game diagnostics panel. */
  getStats() {
    const info = this.renderer.info;
    const gl = this.renderer.getContext();
    let px = [0, 0];
    try {
      const size = new THREE.Vector2();
      this.renderer.getDrawingBufferSize(size);
      px = [Math.round(size.x), Math.round(size.y)];
    } catch {}
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
      pixelRatio: Number(this.renderer.getPixelRatio().toFixed(2)),
      buffer: px.join('×'),
      shadows: this.renderer.shadowMap.enabled,
      bloom: this.bloomEnabled,
      maxTexture: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
      adapter: this.adapterInfo,
    };
  }
}

// ----------------------------------------------------------------------------
// Factory: prefer WebGL (3D), fall back to the Canvas2D renderer when the
// browser/preview refuses a WebGL context. Both share the Stage API.
export function createStage(canvas, quality = 'high', renderScale = 1) {
  try {
    const stage = new Stage(canvas);
    stage.setQuality(quality, renderScale);
    return stage;
  } catch (err) {
    if (!err || !err.webglFailure) throw err;
    console.warn('[stage] WebGL unavailable, using the 2D fallback renderer:', err.message);
    const stage = new Stage2D(canvas);
    stage.setQuality('low', 1);
    stage.fallbackReason = err.message;
    return stage;
  }
}
