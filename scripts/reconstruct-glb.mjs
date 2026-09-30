#!/usr/bin/env node
/**
 * Xiaomi SU7 3D GLB Offline Model Reconstruction Script
 * 
 * Performs offline automated reconstruction on su7.glb:
 * 1. Splits the merged wheel mesh (Object_56) into 4 standalone wheels (FL, FR, RL, RR)
 *    with localized centers, creating SteerPivot_FL / SteerPivot_FR for front wheels.
 * 2. Restructures the 4 car doors with native Pivot_FL / Pivot_FR / Pivot_RL / Pivot_RR
 *    hinge nodes positioned at physical hinge points.
 * 3. Extracts central touchscreen (Screen_Center) and cluster display (Screen_Cluster)
 *    with normalized [0, 1] UV coordinates, avoiding runtime mesh slicing.
 * 4. Optimizes geometry buffers, prunes dead accessors, and applies Meshopt compression.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, reorder, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const INPUT_PATH = path.join(ROOT_DIR, 'public/models/su7.glb');
const RAW_BACKUP_PATH = path.join(ROOT_DIR, 'models_source/su7_raw.glb');
const OUTPUT_PATH = path.join(ROOT_DIR, 'public/models/su7.glb');

async function reconstruct() {
  console.log('=== Starting Xiaomi SU7 GLB Model Reconstruction ===');

  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Input model not found at ${INPUT_PATH}`);
  }

  // 0. Backup original model if not already backed up
  if (!fs.existsSync(RAW_BACKUP_PATH)) {
    console.log(`Backing up original raw model to ${RAW_BACKUP_PATH}...`);
    fs.copyFileSync(INPUT_PATH, RAW_BACKUP_PATH);
  }

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  console.log(`Reading source model from ${RAW_BACKUP_PATH}...`);
  const doc = await io.read(RAW_BACKUP_PATH);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] || doc.createBuffer();

  // =========================================================================
  // 1. SPLIT WHEELS: Object_56 -> Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR
  // =========================================================================
  console.log('1. Splitting merged wheel mesh into 4 independent wheel assemblies...');
  const wheelParentNode = root.listNodes().find(n => n.getName() === 'Wheel1.001_12');
  if (!wheelParentNode) {
    throw new Error('Wheel1.001_12 node not found in model');
  }

  const origWheelMeshNode = wheelParentNode.listChildren().find(c => c.getName() === 'Object_56') || wheelParentNode.listChildren()[0];
  const origWheelMesh = origWheelMeshNode.getMesh();
  const origWheelPrim = origWheelMesh.listPrimitives()[0];
  const origWheelMat = origWheelPrim.getMaterial();

  const posAcc = origWheelPrim.getAttribute('POSITION');
  const normAcc = origWheelPrim.getAttribute('NORMAL');
  const tanAcc = origWheelPrim.getAttribute('TANGENT');
  const uv0Acc = origWheelPrim.getAttribute('TEXCOORD_0');
  const uv1Acc = origWheelPrim.getAttribute('TEXCOORD_1');
  const uv2Acc = origWheelPrim.getAttribute('TEXCOORD_2');
  const uv3Acc = origWheelPrim.getAttribute('TEXCOORD_3');
  const idxAcc = origWheelPrim.getIndices();

  const origPos = posAcc.getArray();
  const origNorm = normAcc ? normAcc.getArray() : null;
  const origTan = tanAcc ? tanAcc.getArray() : null;
  const origUv0 = uv0Acc ? uv0Acc.getArray() : null;
  const origUv1 = uv1Acc ? uv1Acc.getArray() : null;
  const origUv2 = uv2Acc ? uv2Acc.getArray() : null;
  const origUv3 = uv3Acc ? uv3Acc.getArray() : null;
  const origIdx = idxAcc.getArray();

  // Quadrant classification:
  // Model local coordinates: negative Y = front, positive Y = rear; negative X = left, positive X = right
  const wheelTris = { FL: [], FR: [], RL: [], RR: [] };
  for (let i = 0; i < origIdx.length; i += 3) {
    const i0 = origIdx[i], i1 = origIdx[i + 1], i2 = origIdx[i + 2];
    const cy = (origPos[i0 * 3 + 1] + origPos[i1 * 3 + 1] + origPos[i2 * 3 + 1]) / 3;
    const cx = (origPos[i0 * 3] + origPos[i1 * 3] + origPos[i2 * 3]) / 3;
    const isFront = cy < 0;
    const isLeft = cx < 0;
    const key = isFront ? (isLeft ? 'FL' : 'FR') : (isLeft ? 'RL' : 'RR');
    wheelTris[key].push(i0, i1, i2);
  }

  // Create independent wheel nodes & meshes
  const wheelKeys = ['FL', 'FR', 'RL', 'RR'];
  for (const key of wheelKeys) {
    const tris = wheelTris[key];
    const uniqueVerts = Array.from(new Set(tris));
    const oldToNew = new Map();
    uniqueVerts.forEach((oldIdx, newIdx) => oldToNew.set(oldIdx, newIdx));

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of uniqueVerts) {
      const x = origPos[v * 3];
      const y = origPos[v * 3 + 1];
      const z = origPos[v * 3 + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const vertCount = uniqueVerts.length;
    const newPos = new Float32Array(vertCount * 3);
    const newNorm = origNorm ? new Float32Array(vertCount * 3) : null;
    const newTan = origTan ? new Float32Array(vertCount * 4) : null;
    const newUv0 = origUv0 ? new Float32Array(vertCount * 2) : null;
    const newUv1 = origUv1 ? new Float32Array(vertCount * 2) : null;
    const newUv2 = origUv2 ? new Float32Array(vertCount * 2) : null;
    const newUv3 = origUv3 ? new Float32Array(vertCount * 2) : null;

    uniqueVerts.forEach((oldIdx, newIdx) => {
      newPos[newIdx * 3] = origPos[oldIdx * 3] - centerX;
      newPos[newIdx * 3 + 1] = origPos[oldIdx * 3 + 1] - centerY;
      newPos[newIdx * 3 + 2] = origPos[oldIdx * 3 + 2] - centerZ;

      if (newNorm && origNorm) {
        newNorm[newIdx * 3] = origNorm[oldIdx * 3];
        newNorm[newIdx * 3 + 1] = origNorm[oldIdx * 3 + 1];
        newNorm[newIdx * 3 + 2] = origNorm[oldIdx * 3 + 2];
      }
      if (newTan && origTan) {
        newTan[newIdx * 4] = origTan[oldIdx * 4];
        newTan[newIdx * 4 + 1] = origTan[oldIdx * 4 + 1];
        newTan[newIdx * 4 + 2] = origTan[oldIdx * 4 + 2];
        newTan[newIdx * 4 + 3] = origTan[oldIdx * 4 + 3];
      }
      if (newUv0 && origUv0) {
        newUv0[newIdx * 2] = origUv0[oldIdx * 2];
        newUv0[newIdx * 2 + 1] = origUv0[oldIdx * 2 + 1];
      }
      if (newUv1 && origUv1) {
        newUv1[newIdx * 2] = origUv1[oldIdx * 2];
        newUv1[newIdx * 2 + 1] = origUv1[oldIdx * 2 + 1];
      }
      if (newUv2 && origUv2) {
        newUv2[newIdx * 2] = origUv2[oldIdx * 2];
        newUv2[newIdx * 2 + 1] = origUv2[oldIdx * 2 + 1];
      }
      if (newUv3 && origUv3) {
        newUv3[newIdx * 2] = origUv3[oldIdx * 2];
        newUv3[newIdx * 2 + 1] = origUv3[oldIdx * 2 + 1];
      }
    });

    const newIndices = new Uint16Array(tris.map(idx => oldToNew.get(idx)));

    const newPosAcc = doc.createAccessor(`pos_wheel_${key}`).setType('VEC3').setArray(newPos).setBuffer(buffer);
    const newIdxAcc = doc.createAccessor(`idx_wheel_${key}`).setType('SCALAR').setArray(newIndices).setBuffer(buffer);

    const newPrim = doc.createPrimitive()
      .setAttribute('POSITION', newPosAcc)
      .setIndices(newIdxAcc)
      .setMaterial(origWheelMat);

    if (newNorm) newPrim.setAttribute('NORMAL', doc.createAccessor(`norm_wheel_${key}`).setType('VEC3').setArray(newNorm).setBuffer(buffer));
    if (newTan) newPrim.setAttribute('TANGENT', doc.createAccessor(`tan_wheel_${key}`).setType('VEC4').setArray(newTan).setBuffer(buffer));
    if (newUv0) newPrim.setAttribute('TEXCOORD_0', doc.createAccessor(`uv0_wheel_${key}`).setType('VEC2').setArray(newUv0).setBuffer(buffer));
    if (newUv1) newPrim.setAttribute('TEXCOORD_1', doc.createAccessor(`uv1_wheel_${key}`).setType('VEC2').setArray(newUv1).setBuffer(buffer));
    if (newUv2) newPrim.setAttribute('TEXCOORD_2', doc.createAccessor(`uv2_wheel_${key}`).setType('VEC2').setArray(newUv2).setBuffer(buffer));
    if (newUv3) newPrim.setAttribute('TEXCOORD_3', doc.createAccessor(`uv3_wheel_${key}`).setType('VEC2').setArray(newUv3).setBuffer(buffer));

    const newMesh = doc.createMesh(`Mesh_Wheel_${key}`).addPrimitive(newPrim);
    const wheelNode = doc.createNode(`Wheel_${key}`).setMesh(newMesh);

    if (key === 'FL' || key === 'FR') {
      // Front wheels are wrapped inside a Steering Pivot node
      const steerPivot = doc.createNode(`SteerPivot_${key}`)
        .setTranslation([centerX, centerY, centerZ])
        .addChild(wheelNode);
      wheelParentNode.addChild(steerPivot);
    } else {
      // Rear wheels are directly positioned at axle center
      wheelNode.setTranslation([centerX, centerY, centerZ]);
      wheelParentNode.addChild(wheelNode);
    }

    console.log(`  -> Built Wheel_${key}: ${tris.length / 3} triangles, center=[${centerX.toFixed(2)}, ${centerY.toFixed(2)}, ${centerZ.toFixed(2)}]`);
  }

  // Remove original combined wheel node and mesh
  wheelParentNode.removeChild(origWheelMeshNode);
  origWheelMeshNode.dispose();
  origWheelMesh.dispose();

  // =========================================================================
  // 2. RESTRUCTURE DOORS: DOOR1_8..DOOR4_11 -> Pivot_FL, Pivot_FR, Pivot_RL, Pivot_RR
  // =========================================================================
  console.log('2. Restructuring 4 doors with native hinge pivot hierarchy...');
  const hinges = {
    FL: { nodeName: 'DOOR1_8', pivot: [-89.3, -98.3, -56.2] },
    FR: { nodeName: 'DOOR3_10', pivot: [89.3, -98.3, -56.2] },
    RL: { nodeName: 'DOOR2_9', pivot: [-91.3, 16.3, -58.2] },
    RR: { nodeName: 'DOOR4_11', pivot: [91.4, 16.3, -57.8] }
  };

  for (const id of ['FL', 'FR', 'RL', 'RR']) {
    const config = hinges[id];
    const doorNode = root.listNodes().find(n => n.getName() === config.nodeName);
    if (!doorNode) {
      console.warn(`Door node ${config.nodeName} not found`);
      continue;
    }

    const pivotNode = doc.createNode(`Pivot_${id}`).setTranslation(config.pivot);
    const existingChildren = [...doorNode.listChildren()];

    for (const child of existingChildren) {
      doorNode.removeChild(child);
      const currT = child.getTranslation();
      child.setTranslation([
        currT[0] - config.pivot[0],
        currT[1] - config.pivot[1],
        currT[2] - config.pivot[2]
      ]);
      child.setExtras({ isDoorPart: true, doorId: id });
      pivotNode.addChild(child);
    }

    doorNode.addChild(pivotNode);
    console.log(`  -> Door ${id} (${config.nodeName}): Pivot_${id} at [${config.pivot.join(', ')}] with ${existingChildren.length} parts`);
  }

  // =========================================================================
  // 3. EXTRACT CABIN DISPLAYS: Screen_Center & Screen_Cluster
  // =========================================================================
  console.log('3. Extracting central touchscreen and HUD instrument cluster...');
  const insideNode = root.listNodes().find(n => n.getName() === 'Object_4');
  if (insideNode) {
    const interiorMesh = insideNode.getMesh();
    const interiorPrim = interiorMesh.listPrimitives()[0];
    const origInteriorIndices = interiorPrim.getIndices().getArray();
    const origInteriorPos = interiorPrim.getAttribute('POSITION').getArray();
    const origInteriorNorm = interiorPrim.getAttribute('NORMAL').getArray();
    const origInteriorUv = interiorPrim.getAttribute('TEXCOORD_0').getArray();

    const displayRegions = [
      { key: 'Center', name: 'Screen_Center', bounds: [0.875, 0.930, 0.988, 0.998] },
      { key: 'Cluster', name: 'Screen_Cluster', bounds: [0.875, 0.878, 0.988, 0.928] }
    ];

    const extractedTriIndices = new Set();

    for (const region of displayRegions) {
      const [x0, y0, x1, y1] = region.bounds;
      const matchedTris = [];

      for (let i = 0; i < origInteriorIndices.length; i += 3) {
        const v0 = origInteriorIndices[i];
        const v1 = origInteriorIndices[i + 1];
        const v2 = origInteriorIndices[i + 2];

        const u0 = origInteriorUv[v0 * 2], u1 = origInteriorUv[v1 * 2], u2 = origInteriorUv[v2 * 2];
        const v_0 = origInteriorUv[v0 * 2 + 1], v_1 = origInteriorUv[v1 * 2 + 1], v_2 = origInteriorUv[v2 * 2 + 1];

        if (
          u0 >= x0 && u0 <= x1 && u1 >= x0 && u1 <= x1 && u2 >= x0 && u2 <= x1 &&
          v_0 >= y0 && v_0 <= y1 && v_1 >= y0 && v_1 <= y1 && v_2 >= y0 && v_2 <= y1
        ) {
          matchedTris.push(i);
          extractedTriIndices.add(i);
        }
      }

      if (matchedTris.length === 0) {
        console.warn(`No triangles matched for display ${region.name}`);
        continue;
      }

      // Collect vertices and re-normalize UVs
      const vertIndices = matchedTris.flatMap(i => [
        origInteriorIndices[i],
        origInteriorIndices[i + 1],
        origInteriorIndices[i + 2]
      ]);
      const uniqueVerts = Array.from(new Set(vertIndices));
      const oldToNew = new Map();
      uniqueVerts.forEach((oldIdx, newIdx) => oldToNew.set(oldIdx, newIdx));

      const uArr = uniqueVerts.map(v => origInteriorUv[v * 2]);
      const vArr = uniqueVerts.map(v => origInteriorUv[v * 2 + 1]);
      const minU = Math.min(...uArr), maxU = Math.max(...uArr);
      const minV = Math.min(...vArr), maxV = Math.max(...vArr);

      const vertCount = uniqueVerts.length;
      const newPos = new Float32Array(vertCount * 3);
      const newNorm = new Float32Array(vertCount * 3);
      const newUv = new Float32Array(vertCount * 2);

      uniqueVerts.forEach((oldIdx, newIdx) => {
        newPos[newIdx * 3] = origInteriorPos[oldIdx * 3];
        newPos[newIdx * 3 + 1] = origInteriorPos[oldIdx * 3 + 1];
        newPos[newIdx * 3 + 2] = origInteriorPos[oldIdx * 3 + 2];

        newNorm[newIdx * 3] = origInteriorNorm[oldIdx * 3];
        newNorm[newIdx * 3 + 1] = origInteriorNorm[oldIdx * 3 + 1];
        newNorm[newIdx * 3 + 2] = origInteriorNorm[oldIdx * 3 + 2];

        // Normalized [0, 1] UV with flipY orientation matching CanvasTexture
        const rawU = origInteriorUv[oldIdx * 2];
        const rawV = origInteriorUv[oldIdx * 2 + 1];
        newUv[newIdx * 2] = (rawU - minU) / (maxU - minU);
        newUv[newIdx * 2 + 1] = 1 - (rawV - minV) / (maxV - minV);
      });

      const newIndices = new Uint16Array(vertIndices.map(idx => oldToNew.get(idx)));

      const displayMat = doc.createMaterial(`Material_${region.name}`)
        .setRoughnessFactor(0.2)
        .setMetallicFactor(0.1);

      const displayPrim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor(`pos_${region.name}`).setType('VEC3').setArray(newPos).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor(`norm_${region.name}`).setType('VEC3').setArray(newNorm).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', doc.createAccessor(`uv_${region.name}`).setType('VEC2').setArray(newUv).setBuffer(buffer))
        .setIndices(doc.createAccessor(`idx_${region.name}`).setType('SCALAR').setArray(newIndices).setBuffer(buffer))
        .setMaterial(displayMat);

      const displayMesh = doc.createMesh(`Mesh_${region.name}`).addPrimitive(displayPrim);
      const displayNode = doc.createNode(region.name).setMesh(displayMesh);

      const parentGroup = insideNode.getParentNode();
      parentGroup.addChild(displayNode);

      console.log(`  -> Extracted ${region.name}: ${matchedTris.length} triangles, normalized UVs in [0, 1]`);
    }

    // Remove extracted triangles from original interior primitive
    const remainingIndices = [];
    for (let i = 0; i < origInteriorIndices.length; i += 3) {
      if (!extractedTriIndices.has(i)) {
        remainingIndices.push(origInteriorIndices[i], origInteriorIndices[i + 1], origInteriorIndices[i + 2]);
      }
    }
    const cleanInteriorIndices = new Uint32Array(remainingIndices);
    interiorPrim.getIndices().setArray(cleanInteriorIndices);
    console.log(`  -> Interior geometry updated: remaining triangles = ${cleanInteriorIndices.length / 3} (removed ${extractedTriIndices.size})`);
  }

  // =========================================================================
  // 4. OPTIMIZE & COMPRESS: Prune, Dedup, Reorder & Meshopt
  // =========================================================================
  console.log('4. Optimizing geometry buffers and applying Meshopt compression...');
  await doc.transform(
    prune({ keepAttributes: true }),
    dedup(),
    reorder({ encoder: MeshoptEncoder }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );

  console.log(`Writing reconstructed model to ${OUTPUT_PATH}...`);
  const finalBinary = await io.writeBinary(doc);
  fs.writeFileSync(OUTPUT_PATH, Buffer.from(finalBinary));

  const origSizeMb = (fs.statSync(RAW_BACKUP_PATH).size / (1024 * 1024)).toFixed(2);
  const newSizeMb = (finalBinary.byteLength / (1024 * 1024)).toFixed(2);
  console.log(`=== Reconstruction Complete! ===`);
  console.log(`Original size:      ${origSizeMb} MB`);
  console.log(`Reconstructed size: ${newSizeMb} MB (saved ${(((1 - finalBinary.byteLength / fs.statSync(RAW_BACKUP_PATH).size) * 100)).toFixed(1)}%)`);
  console.log(`Saved to: ${OUTPUT_PATH}`);
}

reconstruct().catch(err => {
  console.error('Reconstruction failed:', err);
  process.exit(1);
});
