import * as THREE from 'three';

export interface CabinDisplays {
  screen?: THREE.BufferGeometry;
  cluster?: THREE.BufferGeometry;
}

/** Reuse the two display surfaces in the bundled atlas instead of adding duplicate screens. */
export function extractCabinDisplays(model: THREE.Object3D): CabinDisplays {
  if (model.getObjectByName('Screen_Center')) {
    return {};
  }
  const result: CabinDisplays = {};
  const regions = [
    { key: 'screen' as const, bounds: [0.875, 0.930, 0.988, 0.998] },
    { key: 'cluster' as const, bounds: [0.875, 0.878, 0.988, 0.928] }
  ];
  model.updateMatrixWorld(true);
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.name !== 'interior1.001') return;
    const geometry = mesh.geometry;
    const index = geometry.index;
    const uv = geometry.getAttribute('uv');
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    if (!index || !uv || !position || !normal) return;
    const remaining = new Set<number>();
    for (let i = 0; i < index.count; i += 3) remaining.add(i);
    for (const { key, bounds: [x0, y0, x1, y1] } of regions) {
      if (result[key]) continue;
      const triangles: number[] = [];
      for (const i of remaining) {
        const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        if (vertices.every(v => uv.getX(v) >= x0 && uv.getX(v) <= x1 && uv.getY(v) >= y0 && uv.getY(v) <= y1)) triangles.push(i);
      }
      // Atlas mapping is specific to this asset. A different model uses the existing fallback.
      if (triangles.length < 2 || triangles.length > 32) continue;
      const vertices = triangles.flatMap(i => [index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
      const u0 = Math.min(...vertices.map(v => uv.getX(v)));
      const u1 = Math.max(...vertices.map(v => uv.getX(v)));
      const v0 = Math.min(...vertices.map(v => uv.getY(v)));
      const v1 = Math.max(...vertices.map(v => uv.getY(v)));
      if (u1 - u0 < 0.01 || v1 - v0 < 0.01) continue;
      const positions: number[] = [], normals: number[] = [], coordinates: number[] = [];
      const vector = new THREE.Vector3();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (const v of vertices) {
        vector.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
        positions.push(vector.x, vector.y, vector.z);
        vector.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix).normalize();
        normals.push(vector.x, vector.y, vector.z);
        // glTF image V points down; CanvasTexture uses the conventional upward UV.
        coordinates.push((uv.getX(v) - u0) / (u1 - u0), 1 - (uv.getY(v) - v0) / (v1 - v0));
      }
      const surface = new THREE.BufferGeometry();
      surface.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      surface.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      surface.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
      result[key] = surface;
      triangles.forEach(i => remaining.delete(i));
    }
    const kept = [...remaining].flatMap(i => [index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
    geometry.setIndex(kept);
  });
  return result;
}
