import * as THREE from 'three';

export type QualityMode = 'auto' | 'performance' | 'balanced' | 'high';
export interface QualityProfile {
  maxPixelRatio: number;
  maxPixels: number;
  anisotropy: number;
  shadowSize: number;
  interiorDetail: boolean;
  displayScale: 1 | 2;
}

const PROFILES: Record<Exclude<QualityMode, 'auto'>, QualityProfile> = {
  performance: { maxPixelRatio: 1, maxPixels: 2_000_000, anisotropy: 2, shadowSize: 1024, interiorDetail: false, displayScale: 1 },
  balanced: { maxPixelRatio: 1.5, maxPixels: 4_500_000, anisotropy: 8, shadowSize: 2048, interiorDetail: true, displayScale: 1 },
  high: { maxPixelRatio: 2, maxPixels: 8_000_000, anisotropy: 16, shadowSize: 2048, interiorDetail: true, displayScale: 2 }
};
const STORAGE_KEY = 'su7-quality';

export class QualityManager {
  public mode: QualityMode = 'auto';
  private listeners = new Set<(profile: QualityProfile) => void>();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'auto' || saved === 'performance' || saved === 'balanced' || saved === 'high') this.mode = saved;
    } catch { /* Rendering still works when storage is unavailable. */ }
    this.apply();
  }

  public get profile(): QualityProfile {
    if (this.mode !== 'auto') return PROFILES[this.mode];
    const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    if (device.connection?.saveData || (device.deviceMemory !== undefined && device.deviceMemory <= 2)) return PROFILES.performance;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (coarsePointer || (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4)) return PROFILES.balanced;
    return PROFILES.high;
  }

  public setMode(mode: QualityMode) {
    if (mode !== 'auto' && mode !== 'performance' && mode !== 'balanced' && mode !== 'high') return;
    this.mode = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Optional preference. */ }
    this.listeners.forEach(listener => listener(this.profile));
    this.apply();
  }

  public onChange(listener: (profile: QualityProfile) => void) {
    this.listeners.add(listener);
    listener(this.profile);
  }

  public resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const profile = this.profile;
    const ratio = Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio, Math.sqrt(profile.maxPixels / (width * height)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
  }

  /** Refresh after loading the model or rebuilding a display texture. */
  public apply() {
    this.resize();
    const profile = this.profile;
    const anisotropy = Math.min(profile.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(material => {
          Object.values(material).forEach(value => {
            if (value instanceof THREE.Texture) textures.add(value);
          });
        });
      }
      const light = object as THREE.DirectionalLight;
      if (light.isLight && light.shadow && light.castShadow && light.shadow.mapSize.x !== profile.shadowSize) {
        light.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
        light.shadow.map?.dispose();
        light.shadow.map = null;
        light.shadow.needsUpdate = true;
      }
    });
    textures.forEach(texture => {
      if (texture.anisotropy === anisotropy) return;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    });
    this.renderer.shadowMap.needsUpdate = true;
  }
}
