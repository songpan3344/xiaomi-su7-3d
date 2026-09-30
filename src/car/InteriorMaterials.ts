import * as THREE from 'three';

export interface InteriorDetail {
  material: THREE.MeshPhysicalMaterial;
  normal: THREE.DataTexture;
  surface: THREE.DataTexture;
}

function matchAtlas(texture: THREE.Texture, reference: THREE.Texture) {
  texture.flipY = reference.flipY;
  texture.channel = reference.channel;
  texture.offset.copy(reference.offset);
  texture.repeat.copy(reference.repeat);
  texture.center.copy(reference.center);
  texture.rotation = reference.rotation;
  texture.wrapS = reference.wrapS;
  texture.wrapT = reference.wrapT;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
}

// These regions are the sill strips in the bundled interior2 atlas, in image coordinates.
// Replace reused branding with neutral brushed trim; do not invent a Xiaomi badge.
const SILL_REGIONS = [[0.013, 0.002, 0.039, 0.450], [0.085, 0.124, 0.111, 0.446], [0.143, 0.281, 0.177, 0.441]];

function isSill(name: string, u: number, v: number) {
  return name.startsWith('interior2') && SILL_REGIONS.some(([x0, y0, x1, y1]) => u >= x0 && u <= x1 && v >= y0 && v <= y1);
}

function grain(x: number, y: number): number {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

/** Add conservative surface detail to existing UVs; this does not reconstruct geometry. */
export function enhanceInterior(original: THREE.MeshStandardMaterial): InteriorDetail | null {
  if (!original.map?.image) return null;
  const source = original.map;
  const image = source.image as CanvasImageSource & { width: number; height: number };
  const material = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(material, original);
  material.defines = { STANDARD: '', PHYSICAL: '' };
  material.name = original.name;
  material.metalness = 1; // Multiplied by the blue channel of the surface map.
  material.roughness = 1; // Multiplied by the green channel of the surface map.
  material.specularIntensity = 0.8;
  material.ior = 1.45;
  material.envMapIntensity = 0.8;

  if (original.name.startsWith('interior2')) {
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = image.width;
    colorCanvas.height = image.height;
    const colorContext = colorCanvas.getContext('2d')!;
    colorContext.drawImage(image, 0, 0);
    for (const [x0, y0, x1, y1] of SILL_REGIONS) {
      const x = x0 * colorCanvas.width;
      const width = (x1 - x0) * colorCanvas.width;
      const gradient = colorContext.createLinearGradient(x, 0, x + width, 0);
      gradient.addColorStop(0, '#34363a');
      gradient.addColorStop(0.5, '#72767b');
      gradient.addColorStop(1, '#34363a');
      colorContext.fillStyle = gradient;
      colorContext.fillRect(x, y0 * colorCanvas.height, width, (y1 - y0) * colorCanvas.height);
    }
    const neutralColor = new THREE.CanvasTexture(colorCanvas);
    neutralColor.colorSpace = source.colorSpace;
    matchAtlas(neutralColor, source);
    material.map = neutralColor;
  }

  // Fine grain is generated separately from baked color/shadows. Keep it small on mobile.
  const size = original.name.startsWith('interior4') ? 1024 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(material.map!.image as CanvasImageSource, 0, 0, size, size);
  const colors = context.getImageData(0, 0, size, size).data;
  const normalData = new Uint8Array(size * size * 4);
  const surfaceData = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = colors[i], g = colors[i + 1], b = colors[i + 2];
      const leather = r > 45 && r > g * 1.12 && g > b * 1.08;
      const metal = isSill(original.name, x / size, y / size);
      const strength = metal ? 0.008 : leather ? 0.16 : 0.055;
      const nx = (grain(x - 1, y) - grain(x + 1, y)) * strength;
      const ny = (grain(x, y - 1) - grain(x, y + 1)) * strength;
      const length = Math.sqrt(nx * nx + ny * ny + 1);
      normalData[i] = Math.round((nx / length * 0.5 + 0.5) * 255);
      normalData[i + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      normalData[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      normalData[i + 3] = 255;
      const roughness = (metal ? 0.32 : leather ? 0.56 : 0.78) + (grain(x, y) - 0.5) * 0.05;
      surfaceData[i] = 255; // No synthetic AO inferred from baked color.
      surfaceData[i + 1] = Math.round(roughness * 255);
      surfaceData[i + 2] = metal ? 230 : 0;
      surfaceData[i + 3] = 255;
    }
  }
  const normal = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  const surface = new THREE.DataTexture(surfaceData, size, size, THREE.RGBAFormat);
  normal.name = `${original.name}-micrograin`;
  surface.name = `${original.name}-surface`;
  matchAtlas(normal, source);
  matchAtlas(surface, source);
  material.normalMap = normal;
  material.normalScale.set(0.6, 0.6);
  material.roughnessMap = surface;
  material.metalnessMap = surface;
  return { material, normal, surface };
}
