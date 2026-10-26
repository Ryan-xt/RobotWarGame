import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Stage2D } from './stage2d.js';

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.Camera());
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.6, 0.78);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.scene = null;
    this.camera = null;
    this.quality = 'high';
    this.bloomEnabled = true;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    window.addEventListener('resize', () => this.resize());
  }

  setActive(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(1, window.devicePixelRatio) : Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.bloomEnabled = q !== 'low';
    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.bloom.setSize(this.width, this.height);
    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }
  }

  render(dt) {
    if (!this.scene || !this.camera) return;
    if (this.bloomEnabled && this.quality !== 'low') {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// ---------------------------------------------------------------------------- 
// Factory: prefer WebGL (3D), fall back to the Canvas2D renderer when the
// browser/preview refuses a WebGL context. Both share the Stage API.
export function createStage(canvas, quality = 'high') {
  try {
    const stage = new Stage(canvas);
    stage.setQuality(quality);
    return stage;
  } catch (err) {
    if (!err || !err.webglFailure) throw err;
    console.warn('[stage] WebGL unavailable, using the 2D fallback renderer:', err.message);
    const stage = new Stage2D(canvas);
    stage.setQuality('low');
    stage.fallbackReason = err.message;
    return stage;
  }
}
