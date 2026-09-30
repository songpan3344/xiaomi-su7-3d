import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as TWEEN from '@tweenjs/tween.js';

export type CameraPreset = 'hero' | 'side' | 'rear' | 'wheel' | 'cockpit' | 'drive' | 'free';

export interface PresetConfig {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  minDist?: number;
  maxDist?: number;
  maxPolar?: number;
}

export class CameraManager {
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;
  public isAutoOrbit: boolean = false;
  public currentPreset: CameraPreset = 'hero';
  public onPresetChange?: (preset: CameraPreset) => void;
  private transitionTweens: TWEEN.Tween<THREE.Vector3>[] = [];

  private presets: Record<CameraPreset, PresetConfig> = {
    // Front 45° iconic hero shot
    hero: {
      pos: new THREE.Vector3(-3.8, 1.45, -3.8),
      target: new THREE.Vector3(0, 0.72, 0),
      minDist: 1.5,
      maxDist: 14,
      maxPolar: Math.PI / 2 - 0.04
    },
    // Pure side silhouette
    side: {
      pos: new THREE.Vector3(-5.4, 1.15, 0),
      target: new THREE.Vector3(0, 0.72, 0),
      minDist: 1.5,
      maxDist: 14,
      maxPolar: Math.PI / 2 - 0.04
    },
    // Rear halo lights & active spoiler focus
    rear: {
      pos: new THREE.Vector3(2.8, 1.45, 3.8),
      target: new THREE.Vector3(0, 0.82, 1.2),
      minDist: 1.5,
      maxDist: 14,
      maxPolar: Math.PI / 2 - 0.04
    },
    // Wheel, tire & Brembo caliper close-up
    wheel: {
      pos: new THREE.Vector3(-2.1, 0.52, -1.8),
      target: new THREE.Vector3(-0.85, 0.35, -1.5),
      minDist: 0.8,
      maxDist: 8,
      maxPolar: Math.PI / 2 - 0.02
    },
    // Driver seat perspective (inside Xiaomi HyperOS cockpit)
    cockpit: {
      pos: new THREE.Vector3(-0.36, 1.00, 0.10),
      target: new THREE.Vector3(-0.08, 0.86, -0.65),
      minDist: 0.1,
      maxDist: 2.2,
      maxPolar: Math.PI - 0.08
    },
    // Dynamic chase camera for driving simulation
    drive: {
      pos: new THREE.Vector3(0, 1.65, 5.4),
      target: new THREE.Vector3(0, 0.85, -1.2),
      minDist: 3.0,
      maxDist: 12,
      maxPolar: Math.PI / 2 - 0.02
    },
    // Free orbit mode
    free: {
      pos: new THREE.Vector3(-4.2, 1.6, -4.2),
      target: new THREE.Vector3(0, 0.75, 0),
      minDist: 1.5,
      maxDist: 15,
      maxPolar: Math.PI / 2 - 0.02
    }
  };

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    const initial = this.presets.hero;
    this.camera.position.copy(initial.pos);

    this.controls = new OrbitControls(this.camera, container);
    this.controls.target.copy(initial.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = initial.minDist!;
    this.controls.maxDistance = initial.maxDist!;
    this.controls.maxPolarAngle = initial.maxPolar!;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 1.0;
  }

  /**
   * Smooth cinematic glide transition to camera preset
   */
  public setPreset(preset: CameraPreset, durationMs: number = 1000) {
    const config = this.presets[preset];
    if (!config) return;
    this.currentPreset = preset;
    this.transitionTweens.forEach(tween => { tween.stop(); TWEEN.remove(tween); });
    this.camera.near = preset === 'cockpit' ? 0.025 : 0.1;
    this.camera.updateProjectionMatrix();
    this.onPresetChange?.(preset);

    // Pause auto orbit during transition
    this.controls.autoRotate = false;

    // Update constraints
    if (config.minDist !== undefined) this.controls.minDistance = config.minDist;
    if (config.maxDist !== undefined) this.controls.maxDistance = config.maxDist;
    if (config.maxPolar !== undefined) this.controls.maxPolarAngle = config.maxPolar;

    const positionTween = new TWEEN.Tween(this.camera.position, true)
      .to({ x: config.pos.x, y: config.pos.y, z: config.pos.z }, durationMs)
      .easing(TWEEN.Easing.Cubic.InOut)
      .start();

    const targetTween = new TWEEN.Tween(this.controls.target, true)
      .to({ x: config.target.x, y: config.target.y, z: config.target.z }, durationMs)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onComplete(() => {
        this.controls.autoRotate = this.isAutoOrbit && preset !== 'cockpit' && preset !== 'drive';
        this.transitionTweens = [];
      })
      .start();
    this.transitionTweens = [positionTween, targetTween];
  }

  /**
   * Toggle 360° automatic slow showroom showcase orbit
   */
  public toggleAutoOrbit(): boolean {
    this.isAutoOrbit = !this.isAutoOrbit;
    this.controls.autoRotate = this.isAutoOrbit;
    return this.isAutoOrbit;
  }

  public update() {
    this.controls.update();
  }

  public onResize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
