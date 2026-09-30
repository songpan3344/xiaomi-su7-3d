import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as TWEEN from '@tweenjs/tween.js';
import { sound } from '../audio/SoundEngine';
import { enhanceInterior, InteriorDetail } from './InteriorMaterials';
import { extractCabinDisplays, CabinDisplays } from './CabinDisplays';

export interface CarColorPreset {
  id: string;
  name: string;
  enName: string;
  hex: string;
  desc: string;
}

export const SU7_COLORS: CarColorPreset[] = [
  { id: 'gulf-blue', name: '海湾蓝', enName: 'Gulf Blue', hex: '#167694', desc: '首发主打色，汲取海平面初醒时的纯粹蓝光' },
  { id: 'elegant-grey', name: '雅灰', enName: 'Elegant Grey', hex: '#52565b', desc: '高级耐看，深邃内敛的极简都市格调' },
  { id: 'olive-green', name: '橄榄绿', enName: 'Olive Green', hex: '#354337', desc: '沉稳优雅，映照大自然旷野的生命力' },
  { id: 'radiant-purple', name: '霞光紫', enName: 'Radiant Purple', hex: '#483549', desc: '浪漫渐变，晚霞落日时的梦幻微光' },
  { id: 'lava-orange', name: '熔岩橙', enName: 'Lava Orange', hex: '#ca4319', desc: '澎湃激情，高饱和度超跑运动本色' },
  { id: 'pearl-white', name: '珍珠白', enName: 'Pearl White', hex: '#e8ebeb', desc: '温润如玉，光线下折射珍珠般细腻虹彩' },
  { id: 'diamond-black', name: '钻石黑', enName: 'Diamond Black', hex: '#151619', desc: '黑武士气场，高亮金属漆质感' },
  { id: 'meteor-blue', name: '流星蓝', enName: 'Meteor Blue', hex: '#20344b', desc: '深海幽蓝，科技感与优雅完美相融' },
  { id: 'cambrian-grey', name: '寒武岩灰', enName: 'Cambrian Grey', hex: '#32363a', desc: '硬核深灰，源自远古地层的岩石质感' }
];

export type DoorId = 'FL' | 'FR' | 'RL' | 'RR';

export class CarController {
  public rootGroup: THREE.Group;
  public carInnerGroup: THREE.Group;
  
  // Materials
  private paintMaterials: THREE.MeshPhysicalMaterial[] = [];
  private frontLightMat: THREE.MeshStandardMaterial | null = null;
  private backLightMat: THREE.MeshStandardMaterial | null = null;
  private interiorLight: THREE.PointLight | null = null;
  private cabinViewLight: THREE.PointLight | null = null;
  private interiorDetails: InteriorDetail[] = [];
  private interiorDetailEnabled = true;
  private headLightSpots: THREE.SpotLight[] = [];

  // Wheel components
  private wheelFL: THREE.Mesh | null = null;
  private wheelFR: THREE.Mesh | null = null;
  private wheelRL: THREE.Mesh | null = null;
  private wheelRR: THREE.Mesh | null = null;
  private steerPivotFL: THREE.Group | null = null;
  private steerPivotFR: THREE.Group | null = null;

  // Door pivots & states
  private doorPivots: Record<DoorId, THREE.Group | null> = {
    FL: null,
    FR: null,
    RL: null,
    RR: null
  };
  private doorStates: Record<DoorId, boolean> = {
    FL: false,
    FR: false,
    RL: false,
    RR: false
  };

  // State flags
  public isLightsOn: boolean = false;
  public isBraking: boolean = false;
  public isHazardFlashing: boolean = false;
  public hazardInterval: number | null = null;
  public spoilerAngle: number = 0; // 0, 5, 12, 25 degrees
  public activeSpoilerGroup: THREE.Group | null = null;
  public currentColor: string = SU7_COLORS[0].hex;

  // Aerodynamics Wind Tunnel Lines
  public airflowGroup: THREE.Group | null = null;
  public isAirflowVisible: boolean = false;

  // LiDAR wave ring
  public lidarRing: THREE.Mesh | null = null;
  public isLidarActive: boolean = false;

  // 16.1" Xiaomi HyperOS Central Screen & Digital Cluster
  public cockpitScreenGroup: THREE.Group | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenCtx: CanvasRenderingContext2D | null = null;
  private screenTexture: THREE.CanvasTexture | null = null;
  private screenMesh: THREE.Mesh | null = null;
  private hudCanvas: HTMLCanvasElement | null = null;
  private hudCtx: CanvasRenderingContext2D | null = null;
  private hudTexture: THREE.CanvasTexture | null = null;
  private hudMesh: THREE.Mesh | null = null;
  private screenClockSec: number = 0;
  private displayScale: 1 | 2 = 1;
  private lastHudSpeed = -1;
  private lastHudMoving = false;
  private hudSpeedKmH = 0;
  private cabinDisplays: CabinDisplays = {};

  // Ground plane & bounds
  public readonly carLength = 4.997; // meters
  public readonly wheelRadius = 0.352; // meters

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'SU7_Car_Root';

    this.carInnerGroup = new THREE.Group();
    this.carInnerGroup.name = 'SU7_Car_Inner';
    this.rootGroup.add(this.carInnerGroup);
  }

  public async load(scene: THREE.Scene, onProgress?: (pct: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    return new Promise((resolve, reject) => {
      // Support both root and subpath deployments
      const modelUrl = new URL('models/su7.glb', window.location.href).href;
      loader.load(
        modelUrl,
        (gltf) => {
          const rawModel = gltf.scene;

          // 1. Upright & orientation transformation:
          // The GLTF model is in meters (length ~5.237m, height 1.465m, width 2.100m).
          // Scale to SU7 exact official dimensions (length 4.997m):
          const scale = 4.997 / 5.23715;
          rawModel.scale.set(scale, scale, scale);

          // Rotate around Y by +90 degrees:
          // Raw model faces +X -> now faces -Z (forward into the distance).
          // Left side (-Z) -> now faces -X (left).
          // Right side (+Z) -> now faces +X (right).
          // Height +Y -> stays +Y (up).
          rawModel.rotation.y = Math.PI / 2;

          // Ground offset:
          // Lowest point of tires is at Y = -0.0297 * scale.
          // Lifting rawModel by 0.0297 * scale aligns tire contact patches perfectly with floor Y = 0.0.
          rawModel.position.set(0, 0.0297 * scale, 0);

          this.carInnerGroup.add(rawModel);
          this.cabinDisplays = extractCabinDisplays(rawModel);

          // 2. Setup materials, wheels, doors, lights
          this.setupMaterials(rawModel);
          this.setupWheels(rawModel);
          this.setupDoors(rawModel);
          this.setupLights(scene);
          this.setupSpoiler(rawModel);
          this.setupAirflow();
          this.setupLidar();
          this.setupCockpitScreen();

          // Set initial paint color
          this.setCarColor(this.currentColor, true);

          scene.add(this.rootGroup);
          resolve();
        },
        (xhr) => {
          if (xhr.total && onProgress) {
            onProgress(Math.round((xhr.loaded / xhr.total) * 100));
          }
        },
        (err) => {
          console.error('Failed to load SU7 3D model:', err);
          reject(err);
        }
      );
    });
  }

  /**
   * Configure physical materials for ultra-realistic automotive look
   */
  private setupMaterials(model: THREE.Object3D) {
    this.paintMaterials = [];
    this.interiorDetails = [];
    const interiorCache = new Map<THREE.Material, InteriorDetail>();

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.Material;
        if (!mat) return;

        // Enhance car body paint
        if (mat.name === 'Car_body') {
          const physicalMat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(this.currentColor),
            metalness: 0.82,
            roughness: 0.16,
            clearcoat: 1.0,
            clearcoatRoughness: 0.06,
            aoMap: (mat as THREE.MeshStandardMaterial).aoMap,
            aoMapIntensity: (mat as THREE.MeshStandardMaterial).aoMapIntensity,
            roughnessMap: (mat as THREE.MeshStandardMaterial).roughnessMap,
            envMapIntensity: 1.4,
            reflectivity: 0.95
          });
          mesh.material = physicalMat;
          this.paintMaterials.push(physicalMat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }

        // Tinted panoramic glass canopy & windows
        else if (mat.name === 'Car_window') {
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x8296a5),
            metalness: 0,
            roughness: 0.06,
            transparent: true,
            opacity: 0.28,
            side: mat.side,
            depthWrite: false,
            clearcoat: 1.0,
            clearcoatRoughness: 0.03,
            envMapIntensity: 0.8
          });
          mesh.castShadow = false;
        }

        // Glossy black aerodynamic trim, diffuser & skirts
        else if (mat.name === 'M_BODY_black.004') {
          mesh.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x111317),
            metalness: 0.25,
            roughness: 0.2
          });
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }

        // Chrome badges & emblem
        else if (mat.name === 'M_LOGO.004') {
          mesh.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0xffffff),
            metalness: 0.95,
            roughness: 0.08
          });
        }

        // Front Headlights
        else if (mat.name === 'Car_frontlight') {
          const frontMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0xddffff),
            emissive: new THREE.Color(0x000000),
            emissiveIntensity: 0,
            metalness: 0.2,
            roughness: 0.1
          });
          mesh.material = frontMat;
          this.frontLightMat = frontMat;
        }

        // Rear Halo Taillights (光环贯穿式尾灯)
        else if (mat.name === 'Car_backlight') {
          const backMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x880000),
            emissive: new THREE.Color(0x000000),
            emissiveIntensity: 0,
            metalness: 0.1,
            roughness: 0.2
          });
          mesh.material = backMat;
          this.backLightMat = backMat;
        }

        // Headlight protective outer glass
        else if (mat.name === 'Car_lightglass') {
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0xffffff),
            transparent: true,
            opacity: 0.18,
            roughness: 0.03,
            transmission: 0.95,
            ior: 1.5
          });
        }

        // Brake calipers and wheel iron
        else if (mat.name === 'M_IRON.004') {
          const ironMat = mesh.material as THREE.MeshStandardMaterial;
          ironMat.metalness = 0.95;
          ironMat.roughness = 0.25;
        }

        // Interior materials
        else if (mat.name.startsWith('interior')) {
          let detail = interiorCache.get(mat);
          if (!detail) {
            detail = enhanceInterior(mat as THREE.MeshStandardMaterial) ?? undefined;
            if (detail) {
              interiorCache.set(mat, detail);
              this.interiorDetails.push(detail);
            }
          }
          if (detail) mesh.material = detail.material;
          mesh.receiveShadow = true;
        }
      }
    });
    this.applyInteriorDetail();
  }

  private applyInteriorDetail() {
    for (const detail of this.interiorDetails) {
      const material = detail.material;
      const normal = this.interiorDetailEnabled ? detail.normal : null;
      if (material.normalMap === normal && material.roughnessMap === (this.interiorDetailEnabled ? detail.surface : null)) continue;
      material.normalMap = normal;
      material.roughnessMap = this.interiorDetailEnabled ? detail.surface : null;
      material.metalnessMap = this.interiorDetailEnabled ? detail.surface : null;
      material.roughness = this.interiorDetailEnabled ? 1 : 0.72;
      material.metalness = this.interiorDetailEnabled ? 1 : 0;
      material.needsUpdate = true;
    }
  }

  public setVisualQuality(interiorDetail: boolean, displayScale: 1 | 2) {
    this.interiorDetailEnabled = interiorDetail;
    this.applyInteriorDetail();
    if (this.displayScale === displayScale) return;
    this.displayScale = displayScale;
    if (!this.screenCanvas || !this.hudCanvas || !this.screenMesh || !this.hudMesh) return;
    this.screenCanvas.width = 1024 * displayScale;
    this.screenCanvas.height = 640 * displayScale;
    this.hudCanvas.width = 512 * displayScale;
    this.hudCanvas.height = 200 * displayScale;
    this.drawHyperOsCanvas();
    this.drawHudCanvas(this.hudSpeedKmH);
    // Texture dimensions are immutable after upload: replace and dispose on quality changes.
    this.screenTexture?.dispose();
    this.hudTexture?.dispose();
    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.hudTexture = new THREE.CanvasTexture(this.hudCanvas);
    this.screenTexture.colorSpace = this.hudTexture.colorSpace = THREE.SRGBColorSpace;
    const screenMaterial = this.screenMesh.material as THREE.MeshBasicMaterial;
    const hudMaterial = this.hudMesh.material as THREE.MeshBasicMaterial;
    screenMaterial.map = this.screenTexture;
    hudMaterial.map = this.hudTexture;
  }

  public setCockpitView(active: boolean) {
    if (this.cabinViewLight) this.cabinViewLight.intensity = active ? 0.3 : 0;
  }

  /**
   * Split the combined wheel mesh into 4 independent spinning wheels with steering pivots
   */
  private setupWheels(model: THREE.Object3D) {
    // Fast path: Check for reconstructed wheel nodes in GLB
    const wheelFL = model.getObjectByName('Wheel_FL') as THREE.Mesh | undefined;
    const wheelFR = model.getObjectByName('Wheel_FR') as THREE.Mesh | undefined;
    const wheelRL = model.getObjectByName('Wheel_RL') as THREE.Mesh | undefined;
    const wheelRR = model.getObjectByName('Wheel_RR') as THREE.Mesh | undefined;
    const steerFL = model.getObjectByName('SteerPivot_FL') as THREE.Group | undefined;
    const steerFR = model.getObjectByName('SteerPivot_FR') as THREE.Group | undefined;

    if (wheelFL && wheelFR && wheelRL && wheelRR && steerFL && steerFR) {
      this.wheelFL = wheelFL;
      this.wheelFR = wheelFR;
      this.wheelRL = wheelRL;
      this.wheelRR = wheelRR;
      this.steerPivotFL = steerFL;
      this.steerPivotFR = steerFR;
      this.wheelFL.castShadow = true;
      this.wheelFR.castShadow = true;
      this.wheelRL.castShadow = true;
      this.wheelRR.castShadow = true;
      return;
    }

    let originalWheelMesh: THREE.Mesh | null = null;

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material && (mesh.material as THREE.Material).name === 'M_Wheel_ALL.002') {
          originalWheelMesh = mesh;
        }
      }
    });

    if (!originalWheelMesh) {
      console.warn('Wheel mesh not found in model');
      return;
    }

    const geo = (originalWheelMesh as THREE.Mesh).geometry;
    if (!geo.index) return;

    const indices = geo.index.array;
    const positions = geo.attributes.position.array;
    const normals = geo.attributes.normal?.array;
    const uvs = geo.attributes.uv?.array;

    // Group triangles into 4 wheel quadrants:
    // Model space: negative Y is front, positive Y is rear; negative X is left, positive X is right
    const quadrants: Record<DoorId, number[]> = {
      FL: [],
      FR: [],
      RL: [],
      RR: []
    };

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      const cy = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
      const cx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;

      const isFront = cy < 0;
      const isLeft = cx < 0;

      const key: DoorId = isFront ? (isLeft ? 'FL' : 'FR') : (isLeft ? 'RL' : 'RR');
      quadrants[key].push(i0, i1, i2);
    }

    // Hide original merged wheel mesh
    (originalWheelMesh as THREE.Mesh).visible = false;
    const parent = (originalWheelMesh as THREE.Mesh).parent || model;
    const mat = (originalWheelMesh as THREE.Mesh).material;

    // Helper to create a wheel mesh with localized center
    const createWheelMesh = (quadIndices: number[]) => {
      const uniqueVerts = Array.from(new Set(quadIndices));
      const oldToNew = new Map<number, number>();
      uniqueVerts.forEach((oldIdx, newIdx) => oldToNew.set(oldIdx, newIdx));

      // Calculate centroid of this wheel
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      uniqueVerts.forEach((v) => {
        const x = positions[v * 3];
        const y = positions[v * 3 + 1];
        const z = positions[v * 3 + 2];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      });

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      // Wheel axle is at Z = -33.78
      const centerZ = (minZ + maxZ) / 2;

      const newPos = new Float32Array(uniqueVerts.length * 3);
      const newNorm = normals ? new Float32Array(uniqueVerts.length * 3) : null;
      const newUv = uvs ? new Float32Array(uniqueVerts.length * 2) : null;

      uniqueVerts.forEach((oldIdx, newIdx) => {
        // Translate vertices relative to wheel center
        newPos[newIdx * 3] = positions[oldIdx * 3] - centerX;
        newPos[newIdx * 3 + 1] = positions[oldIdx * 3 + 1] - centerY;
        newPos[newIdx * 3 + 2] = positions[oldIdx * 3 + 2] - centerZ;

        if (newNorm && normals) {
          newNorm[newIdx * 3] = normals[oldIdx * 3];
          newNorm[newIdx * 3 + 1] = normals[oldIdx * 3 + 1];
          newNorm[newIdx * 3 + 2] = normals[oldIdx * 3 + 2];
        }
        if (newUv && uvs) {
          newUv[newIdx * 2] = uvs[oldIdx * 2];
          newUv[newIdx * 2 + 1] = uvs[oldIdx * 2 + 1];
        }
      });

      const newIndices = quadIndices.map((idx) => oldToNew.get(idx)!);

      const newGeo = new THREE.BufferGeometry();
      newGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
      if (newNorm) newGeo.setAttribute('normal', new THREE.BufferAttribute(newNorm, 3));
      if (newUv) newGeo.setAttribute('uv', new THREE.BufferAttribute(newUv, 2));
      newGeo.setIndex(newIndices);

      const mesh = new THREE.Mesh(newGeo, mat);
      mesh.castShadow = true;

      return { mesh, center: new THREE.Vector3(centerX, centerY, centerZ) };
    };

    // 1. FL Wheel
    const fl = createWheelMesh(quadrants.FL);
    this.wheelFL = fl.mesh;
    this.steerPivotFL = new THREE.Group();
    this.steerPivotFL.position.copy(fl.center);
    this.steerPivotFL.add(fl.mesh);
    parent.add(this.steerPivotFL);

    // 2. FR Wheel
    const fr = createWheelMesh(quadrants.FR);
    this.wheelFR = fr.mesh;
    this.steerPivotFR = new THREE.Group();
    this.steerPivotFR.position.copy(fr.center);
    this.steerPivotFR.add(fr.mesh);
    parent.add(this.steerPivotFR);

    // 3. RL Wheel
    const rl = createWheelMesh(quadrants.RL);
    this.wheelRL = rl.mesh;
    this.wheelRL.position.copy(rl.center);
    parent.add(this.wheelRL);

    // 4. RR Wheel
    const rr = createWheelMesh(quadrants.RR);
    this.wheelRR = rr.mesh;
    this.wheelRR.position.copy(rr.center);
    parent.add(this.wheelRR);
  }

  /**
   * Setup 4 door pivot groups for natural door swing animations
   */
  private setupDoors(model: THREE.Object3D) {
    // Fast path: Check for native door pivots in reconstructed model
    const doorKeys: DoorId[] = ['FL', 'FR', 'RL', 'RR'];
    let allPivotsFound = true;
    for (const id of doorKeys) {
      const pivot = model.getObjectByName(`Pivot_${id}`) as THREE.Group | undefined;
      if (pivot) {
        this.doorPivots[id] = pivot;
        pivot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.userData = { isDoorPart: true, doorId: id };
          }
        });
      } else {
        allPivotsFound = false;
      }
    }
    if (allPivotsFound) return;

    // Model coordinates hinge pivot offsets:
    // DOOR1_8 (Left Front): Hinge near front edge Y=-98.3, X=-89.3, Z=-56.2
    // DOOR3_10 (Right Front): Hinge near front edge Y=-98.3, X=89.3, Z=-56.2
    // DOOR2_9 (Left Rear): Hinge near B-pillar Y=16.3, X=-91.3, Z=-58.2
    // DOOR4_11 (Right Rear): Hinge near B-pillar Y=16.3, X=91.4, Z=-57.8
    const hinges: Record<DoorId, { nodeName: string; pivot: THREE.Vector3 }> = {
      FL: { nodeName: 'DOOR1_8', pivot: new THREE.Vector3(-89.3, -98.3, -56.2) },
      FR: { nodeName: 'DOOR3_10', pivot: new THREE.Vector3(89.3, -98.3, -56.2) },
      RL: { nodeName: 'DOOR2_9', pivot: new THREE.Vector3(-91.3, 16.3, -58.2) },
      RR: { nodeName: 'DOOR4_11', pivot: new THREE.Vector3(91.4, 16.3, -57.8) }
    };

    (Object.keys(hinges) as DoorId[]).forEach((id) => {
      const config = hinges[id];
      const doorNode = model.getObjectByName(config.nodeName);
      if (doorNode) {
        // Create pivot group inside doorNode at the hinge point
        const pivotGroup = new THREE.Group();
        pivotGroup.name = `Pivot_${id}`;
        pivotGroup.position.copy(config.pivot);

        // Reparent doorNode's children into pivotGroup and offset by -config.pivot
        const children = [...doorNode.children];
        children.forEach((child) => {
          child.position.sub(config.pivot);
          pivotGroup.add(child);

          if ((child as THREE.Mesh).isMesh) {
            child.userData = { isDoorPart: true, doorId: id };
          }
          child.traverse((sub) => {
            if ((sub as THREE.Mesh).isMesh) {
              sub.userData = { isDoorPart: true, doorId: id };
            }
          });
        });

        doorNode.add(pivotGroup);
        this.doorPivots[id] = pivotGroup;
      }
    });
  }

  /**
   * Setup spotlights & interior ambient light
   */
  private setupLights(scene: THREE.Scene) {
    // 64-color smart interior ambient light
    this.interiorLight = new THREE.PointLight(0x00e5ff, 0, 3.0);
    this.interiorLight.position.set(0, 0.95, -0.15);
    this.rootGroup.add(this.interiorLight);

    // Neutral inspection light makes the dashboard readable without changing the ambient color.
    this.cabinViewLight = new THREE.PointLight(0xfff3df, 0, 2.0, 2);
    this.cabinViewLight.position.set(0, 1.23, 0.08);
    this.rootGroup.add(this.cabinViewLight);

    // Front high beam projection spots
    const leftSpot = new THREE.SpotLight(0xf0faff, 0, 30, Math.PI / 6, 0.4, 1.2);
    leftSpot.position.set(-0.68, 0.67, -2.2);
    leftSpot.target.position.set(-0.68, 0.0, -20);
    this.rootGroup.add(leftSpot);
    this.rootGroup.add(leftSpot.target);
    this.headLightSpots.push(leftSpot);

    const rightSpot = new THREE.SpotLight(0xf0faff, 0, 30, Math.PI / 6, 0.4, 1.2);
    rightSpot.position.set(0.68, 0.67, -2.2);
    rightSpot.target.position.set(0.68, 0.0, -20);
    this.rootGroup.add(rightSpot);
    this.rootGroup.add(rightSpot.target);
    this.headLightSpots.push(rightSpot);
  }

  /**
   * Setup electric active rear spoiler (SU7 Max signature feature)
   */
  private setupSpoiler(model: THREE.Object3D) {
    const spoilerGroup = new THREE.Group();
    spoilerGroup.name = 'SU7_Active_Spoiler';
    
    // In upright coordinates: car rear is +Z, boot lip is at Z = +2.24, Y = +1.155
    spoilerGroup.position.set(0, 1.155, 2.24);

    // Create realistic carbon-fiber aerofoil wing blade
    const wingGeo = new THREE.BoxGeometry(1.26, 0.02, 0.16);
    const wingMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x18181b),
      metalness: 0.9,
      roughness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05
    });
    const wingMesh = new THREE.Mesh(wingGeo, wingMat);
    wingMesh.position.set(0, 0.015, 0.04);
    wingMesh.castShadow = true;
    spoilerGroup.add(wingMesh);

    // Dual active electric strut brackets
    [-0.32, 0.32].forEach((x) => {
      const strutGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.07);
      const strutMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.9, roughness: 0.2 });
      const strut = new THREE.Mesh(strutGeo, strutMat);
      strut.position.set(x, -0.02, 0.02);
      spoilerGroup.add(strut);
    });

    this.activeSpoilerGroup = spoilerGroup;
    this.carInnerGroup.add(spoilerGroup);
  }

  /**
   * Aerodynamic Wind Tunnel Airflow Streamlines (Cd 0.195)
   */
  private setupAirflow() {
    this.airflowGroup = new THREE.Group();
    this.airflowGroup.name = 'Airflow_Streamlines';
    this.airflowGroup.visible = false;

    const count = 48;
    const curvePointsCount = 50;

    for (let i = 0; i < count; i++) {
      // Spread across width
      const x = (Math.random() - 0.5) * 1.8;
      const heightOffset = (Math.random() - 0.5) * 0.15;

      // Realistic SU7 aerodynamic coupe contour points
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= curvePointsCount; j++) {
        const t = j / curvePointsCount;
        const z = -4.0 + t * 8.0; // from front to back
        
        let y = 0.3;
        // Nose dip
        if (z < -2.2) y = 0.4 + (z + 2.2) * 0.05;
        // Hood slope
        else if (z < -1.2) y = 0.45 + (z + 2.2) * 0.28;
        // Windshield rake
        else if (z < 0.2) y = 0.73 + (z + 1.2) * 0.45;
        // Canopy peak
        else if (z < 1.0) y = 1.36 - Math.pow(z - 0.2, 2) * 0.1;
        // Fastback rear slope
        else if (z < 2.3) y = 1.28 - (z - 1.0) * 0.4;
        // Diffuser wake
        else y = 0.76 - (z - 2.3) * 0.18;

        y += heightOffset;
        points.push(new THREE.Vector3(x, y, z));
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, 40, 0.005, 4, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x38bdf8),
        transparent: true,
        opacity: 0.35 + Math.random() * 0.3,
        blending: THREE.AdditiveBlending
      });

      const streamMesh = new THREE.Mesh(tubeGeo, tubeMat);
      this.airflowGroup.add(streamMesh);
    }

    this.rootGroup.add(this.airflowGroup);
  }

  /**
   * Roof Pebble LiDAR holographic scan pulse wave
   */
  private setupLidar() {
    const ringGeo = new THREE.RingGeometry(0.1, 0.15, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x00f2fe),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    this.lidarRing = new THREE.Mesh(ringGeo, ringMat);
    // Roof LiDAR position:
    this.lidarRing.position.set(0, 1.38, -0.40);
    this.rootGroup.add(this.lidarRing);
  }

  // ==================== INTERACTIVE ACTIONS ====================

  /**
   * Change car paint color with smooth transition
   */
  public setCarColor(hexColor: string, immediate: boolean = false) {
    this.currentColor = hexColor;
    const targetColor = new THREE.Color(hexColor);

    this.paintMaterials.forEach((mat) => {
      if (immediate) {
        mat.color.copy(targetColor);
      } else {
        new TWEEN.Tween(mat.color, true)
          .to({ r: targetColor.r, g: targetColor.g, b: targetColor.b }, 400)
          .easing(TWEEN.Easing.Cubic.Out)
          .start();
      }
    });

    this.updateCockpitScreen();
  }

  /**
   * Toggle a specific car door
   */
  public toggleDoor(id: DoorId) {
    const pivot = this.doorPivots[id];
    if (!pivot) return;

    this.doorStates[id] = !this.doorStates[id];
    const isOpen = this.doorStates[id];

    if (isOpen) {
      sound.playDoorOpen();
    } else {
      sound.playDoorClose();
    }

    // Door swing angle in model local coordinate space (around Z axis):
    // Left doors open with positive rotation, right doors with negative rotation
    const baseAngle = id === 'FL' || id === 'FR' ? Math.PI / 4.0 : Math.PI / 4.2;
    const sign = id === 'FL' || id === 'RL' ? 1 : -1;
    const targetZ = isOpen ? sign * baseAngle : 0;

    new TWEEN.Tween(pivot.rotation, true)
      .to({ z: targetZ }, 700)
      .easing(TWEEN.Easing.Cubic.Out)
      .start();

    this.updateCockpitScreen();
  }

  /**
   * Open / close all doors simultaneously
   */
  public toggleAllDoors() {
    const shouldOpen = !Object.values(this.doorStates).some((v) => v);
    (Object.keys(this.doorStates) as DoorId[]).forEach((id) => {
      if (this.doorStates[id] !== shouldOpen) {
        this.toggleDoor(id);
      }
    });
  }

  public areAnyDoorsOpen(): boolean {
    return Object.values(this.doorStates).some((v) => v);
  }

  public getDoorState(id: DoorId): boolean {
    return this.doorStates[id];
  }

  /**
   * Toggle Headlights & Taillights
   */
  public toggleLights(): boolean {
    this.isLightsOn = !this.isLightsOn;

    if (this.frontLightMat) {
      this.frontLightMat.emissive.setHex(this.isLightsOn ? 0xffffff : 0x000000);
      this.frontLightMat.emissiveIntensity = this.isLightsOn ? 8.0 : 0.0;
    }

    if (this.backLightMat) {
      this.backLightMat.emissive.setHex(this.isLightsOn ? 0xff1522 : 0x000000);
      this.backLightMat.emissiveIntensity = this.isLightsOn ? 6.0 : 0.0;
    }

    this.headLightSpots.forEach((spot) => {
      spot.intensity = this.isLightsOn ? 18.0 : 0.0;
    });

    if (this.interiorLight) {
      this.interiorLight.intensity = this.isLightsOn ? 3.0 : 0.0;
    }

    sound.playUiClick();
    this.updateCockpitScreen();
    return this.isLightsOn;
  }

  /**
   * Brake light intensity boost
   */
  public setBraking(braking: boolean) {
    this.isBraking = braking;
    if (this.backLightMat) {
      if (braking) {
        this.backLightMat.emissive.setHex(0xff0011);
        this.backLightMat.emissiveIntensity = 22.0;
      } else {
        this.backLightMat.emissive.setHex(this.isLightsOn ? 0xff1522 : 0x000000);
        this.backLightMat.emissiveIntensity = this.isLightsOn ? 6.0 : 0.0;
      }
    }
  }

  /**
   * Hazard warning flasher (双闪警示灯)
   */
  public toggleHazard() {
    this.isHazardFlashing = !this.isHazardFlashing;
    if (this.isHazardFlashing) {
      let flash = false;
      this.hazardInterval = window.setInterval(() => {
        flash = !flash;
        if (this.frontLightMat) {
          this.frontLightMat.emissive.setHex(flash ? 0xf59e0b : (this.isLightsOn ? 0xffffff : 0x000000));
          this.frontLightMat.emissiveIntensity = flash ? 10.0 : (this.isLightsOn ? 8.0 : 0);
        }
      }, 400);
    } else if (this.hazardInterval) {
      clearInterval(this.hazardInterval);
      this.hazardInterval = null;
      if (this.frontLightMat) {
        this.frontLightMat.emissive.setHex(this.isLightsOn ? 0xffffff : 0x000000);
        this.frontLightMat.emissiveIntensity = this.isLightsOn ? 8.0 : 0;
      }
    }
  }

  /**
   * Set interior ambient light color (64-color ambient light)
   */
  public setAmbientColor(colorHex: string) {
    if (this.interiorLight) {
      this.interiorLight.color.set(colorHex);
      if (!this.isLightsOn) {
        this.interiorLight.intensity = 2.5;
      }
    }
  }

  /**
   * Adjust active rear spoiler angle (0, 5, 12, 25 degrees)
   */
  public setSpoilerAngle(degrees: number) {
    this.spoilerAngle = degrees;
    if (!this.activeSpoilerGroup) return;

    const rad = (degrees * Math.PI) / 180;
    // Elevate and pitch rear wing
    const baseY = 1.155;
    const baseZ = 2.24;
    const targetY = baseY + (degrees / 25) * 0.07;
    const targetZ = baseZ + (degrees / 25) * 0.03;

    new TWEEN.Tween(this.activeSpoilerGroup.rotation, true)
      .to({ x: -rad }, 600)
      .easing(TWEEN.Easing.Cubic.Out)
      .start();

    new TWEEN.Tween(this.activeSpoilerGroup.position, true)
      .to({ y: targetY, z: targetZ }, 600)
      .easing(TWEEN.Easing.Cubic.Out)
      .start();

    sound.playUiClick();
    this.updateCockpitScreen();
  }

  /**
   * Toggle Aerodynamic Airflow Streamlines
   */
  public toggleAirflow(): boolean {
    this.isAirflowVisible = !this.isAirflowVisible;
    if (this.airflowGroup) {
      this.airflowGroup.visible = this.isAirflowVisible;
    }
    sound.playUiClick();
    return this.isAirflowVisible;
  }

  /**
   * Trigger roof LiDAR pulse animation
   */
  public triggerLidarPulse() {
    if (!this.lidarRing) return;
    this.isLidarActive = true;
    this.lidarRing.scale.set(1, 1, 1);
    (this.lidarRing.material as THREE.MeshBasicMaterial).opacity = 0.85;

    new TWEEN.Tween(this.lidarRing.scale, true)
      .to({ x: 35, y: 35, z: 35 }, 1800)
      .easing(TWEEN.Easing.Cubic.Out)
      .start();

    new TWEEN.Tween(this.lidarRing.material, true)
      .to({ opacity: 0 }, 1800)
      .easing(TWEEN.Easing.Cubic.Out)
      .onComplete(() => {
        this.isLidarActive = false;
      })
      .start();

    sound.playLockChime();
  }

  /**
   * Update wheel rotation and steering in driving mode
   * @param speedKmH current vehicle speed in km/h
   * @param steerRatio steering input [-1.0 left to +1.0 right]
   * @param dt delta time in seconds
   */
  public updatePhysics(speedKmH: number, steerRatio: number, dt: number) {
    if (speedKmH === 0 && steerRatio === 0) return;

    // Linear velocity v (m/s)
    const v = (speedKmH / 3.6);
    // Angular velocity ω = v / r
    const angularSpeed = v / this.wheelRadius;
    const deltaAngle = angularSpeed * dt;

    // Spin all 4 wheels around X axis
    if (this.wheelFL) this.wheelFL.rotation.x += deltaAngle;
    if (this.wheelFR) this.wheelFR.rotation.x += deltaAngle;
    if (this.wheelRL) this.wheelRL.rotation.x += deltaAngle;
    if (this.wheelRR) this.wheelRR.rotation.x += deltaAngle;

    // Front wheels steering angle (max ±28 degrees)
    const maxSteerAngle = (28 * Math.PI) / 180;
    const targetSteer = steerRatio * maxSteerAngle;

    // In model space, steering rotates around Z axis (vertical in raw coordinates)
    if (this.steerPivotFL) {
      this.steerPivotFL.rotation.z = THREE.MathUtils.lerp(this.steerPivotFL.rotation.z, targetSteer, 0.15);
    }
    if (this.steerPivotFR) {
      this.steerPivotFR.rotation.z = THREE.MathUtils.lerp(this.steerPivotFR.rotation.z, targetSteer, 0.15);
    }

    // Subtle vehicle body roll / suspension tilt when turning
    const bodyRoll = -steerRatio * (speedKmH / 265) * 0.035;
    this.carInnerGroup.rotation.z = THREE.MathUtils.lerp(this.carInnerGroup.rotation.z, bodyRoll, 0.1);

    this.updateHud(speedKmH);
  }

  /**
   * Setup 16.1" Xiaomi HyperOS Central Touchscreen and 7.1" Instrument Cluster
   */
  private setupCockpitScreen() {
    this.cockpitScreenGroup = new THREE.Group();
    this.cockpitScreenGroup.name = 'Cockpit_Screen_Group';

    // 1. Central 16.1" Touchscreen (16:10 aspect ratio)
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 1024 * this.displayScale;
    this.screenCanvas.height = 640 * this.displayScale;
    this.screenCtx = this.screenCanvas.getContext('2d');
    this.drawHyperOsCanvas();

    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;

    // Check for native screens in reconstructed model
    const nativeScreen = this.carInnerGroup.getObjectByName('Screen_Center') as THREE.Mesh | undefined;
    const nativeCluster = this.carInnerGroup.getObjectByName('Screen_Cluster') as THREE.Mesh | undefined;

    // Self-lit display keeps UI contrast independent of the studio reflections.
    const screenMat = new THREE.MeshBasicMaterial({
      map: this.screenTexture,
      toneMapped: false,
      side: THREE.DoubleSide
    });

    // 2. Driver 7.1" Flip Digital Instrument Cluster (HUD)
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = 512 * this.displayScale;
    this.hudCanvas.height = 200 * this.displayScale;
    this.hudCtx = this.hudCanvas.getContext('2d');
    this.drawHudCanvas(0);

    this.hudTexture = new THREE.CanvasTexture(this.hudCanvas);
    this.hudTexture.colorSpace = THREE.SRGBColorSpace;

    const hudMat = new THREE.MeshBasicMaterial({
      map: this.hudTexture,
      toneMapped: false,
      side: THREE.DoubleSide
    });

    if (nativeScreen && nativeCluster) {
      nativeScreen.material = screenMat;
      nativeScreen.userData = { isCockpitScreen: true };
      this.screenMesh = nativeScreen;

      nativeCluster.material = hudMat;
      this.hudMesh = nativeCluster;
      this.carInnerGroup.add(this.cockpitScreenGroup);
      return;
    }

    // Bezel frame (16.1 inch, thickness 8mm)
    const bezelGeo = new THREE.BoxGeometry(0.354, 0.224, 0.008);
    const bezelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x15181f),
      metalness: 0.85,
      roughness: 0.25
    });
    const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);

    const screenGeo = this.cabinDisplays.screen ?? new THREE.PlaneGeometry(0.346, 0.216);
    this.screenMesh = new THREE.Mesh(screenGeo, screenMat);
    this.screenMesh.position.set(0, 0, this.cabinDisplays.screen ? 0 : 0.0045);
    this.screenMesh.userData = { isCockpitScreen: true };

    // Metal pedestal stand
    const standGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.06, 16);
    const standMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x2d323b),
      metalness: 0.9,
      roughness: 0.2
    });
    const standMesh = new THREE.Mesh(standGeo, standMat);
    standMesh.position.set(0, -0.11, -0.015);
    standMesh.rotation.x = 0.2;

    const mainScreenAssembly = new THREE.Group();
    mainScreenAssembly.add(bezelMesh);
    mainScreenAssembly.add(this.screenMesh);
    mainScreenAssembly.add(standMesh);

    // Position in cabin: Centered at X = 0, Y = 0.865, Z = -0.385, tilted back by ~9 degrees
    mainScreenAssembly.position.set(0, 0.865, -0.385);
    mainScreenAssembly.rotation.x = -0.16;
    if (this.cabinDisplays.screen) {
      this.cockpitScreenGroup.add(this.screenMesh);
      bezelGeo.dispose();
      standGeo.dispose();
      standMat.dispose();
    } else {
      this.cockpitScreenGroup.add(mainScreenAssembly);
    }

    const hudBezelGeo = new THREE.BoxGeometry(0.186, 0.076, 0.006);
    const hudBezelMesh = new THREE.Mesh(hudBezelGeo, bezelMat);

    const hudScreenGeo = this.cabinDisplays.cluster ?? new THREE.PlaneGeometry(0.180, 0.070);
    this.hudMesh = new THREE.Mesh(hudScreenGeo, hudMat);
    this.hudMesh.position.set(0, 0, this.cabinDisplays.cluster ? 0 : 0.0035);

    const hudAssembly = new THREE.Group();
    hudAssembly.add(hudBezelMesh);
    hudAssembly.add(this.hudMesh);
    // Position directly in front of steering wheel: X = -0.40, Y = 0.860, Z = -0.62
    hudAssembly.position.set(-0.40, 0.860, -0.62);
    hudAssembly.rotation.x = -0.18;
    if (this.cabinDisplays.cluster) {
      this.cockpitScreenGroup.add(this.hudMesh);
      hudBezelGeo.dispose();
      if (this.cabinDisplays.screen) bezelMat.dispose();
    } else {
      this.cockpitScreenGroup.add(hudAssembly);
    }

    this.carInnerGroup.add(this.cockpitScreenGroup);
  }

  private drawHyperOsCanvas() {
    if (!this.screenCtx || !this.screenCanvas) return;
    const ctx = this.screenCtx;
    ctx.setTransform(this.displayScale, 0, 0, this.displayScale, 0, 0);
    const w = 1024;
    const h = 640;

    const roundRect = (x: number, y: number, rw: number, rh: number, r: number) => {
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, rw, rh, r);
      } else {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + rw - r, y);
        ctx.quadraticCurveTo(x + rw, y, x + rw, y + r);
        ctx.lineTo(x + rw, y + rh - r);
        ctx.quadraticCurveTo(x + rw, y + rh, x + rw - r, y + rh);
        ctx.lineTo(x + r, y + rh);
        ctx.quadraticCurveTo(x, y + rh, x, y + rh - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }
    };

    // 1. Background
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, '#0c1017');
    bgGrad.addColorStop(0.5, '#0a0d14');
    bgGrad.addColorStop(1, '#06080d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Accent ambient glow on top right
    const glowGrad = ctx.createRadialGradient(850, 100, 10, 850, 100, 400);
    glowGrad.addColorStop(0, 'rgba(0, 180, 255, 0.08)');
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Top Status Bar (height: 38px)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(0, 0, w, 38);

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(timeStr, 76, 25);

    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Xiaomi HyperOS', 130, 24);

    // Status icons (right)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('5G  |  Wi-Fi  |  24°C', w - 170, 24);

    // Battery badge
    ctx.fillStyle = '#22c55e';
    roundRect(w - 150, 12, 42, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('88%', w - 114, 25);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '12px sans-serif';
    ctx.fillText('685 km', w - 24, 24);

    // 3. Left Navigation Dock (x: 0 -> 64)
    ctx.fillStyle = 'rgba(15, 20, 28, 0.95)';
    ctx.fillRect(0, 0, 64, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(64, h);
    ctx.stroke();

    const dockIcons = ['🏠', '🧭', '🎵', '🚗', '❄️', '⚏'];
    dockIcons.forEach((icon, idx) => {
      const y = 60 + idx * 80;
      if (idx === 3) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
        roundRect(10, y - 20, 44, 44, 10);
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = idx === 3 ? '#38bdf8' : '#64748b';
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(icon, 32, y + 8);
    });

    // 4. Main Left Card: 3D Vehicle Interactive Status (x: 80, y: 52, w: 450, h: 510)
    ctx.fillStyle = 'rgba(18, 24, 35, 0.85)';
    roundRect(80, 52, 450, 510, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Vehicle header
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Xiaomi SU7 Max', 104, 88);

    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('双电机全轮驱动 · 673 PS · 2.78s', 104, 110);

    // Car silhouette / preview box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(104, 126, 402, 190, 12);
    ctx.fill();

    // Draw stylized sleek SU7 side contour
    ctx.save();
    ctx.translate(305, 220);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.ellipse(0, 40, 140, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.currentColor;
    ctx.beginPath();
    ctx.moveTo(-130, 25);
    ctx.quadraticCurveTo(-120, -5, -80, -12);
    ctx.quadraticCurveTo(-40, -38, 20, -38);
    ctx.quadraticCurveTo(80, -32, 115, 12);
    ctx.quadraticCurveTo(130, 28, 130, 32);
    ctx.lineTo(120, 35);
    ctx.quadraticCurveTo(90, 35, 80, 25);
    ctx.lineTo(-60, 25);
    ctx.quadraticCurveTo(-75, 35, -95, 35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#0a1018';
    ctx.beginPath();
    ctx.moveTo(-60, -10);
    ctx.lineTo(-30, -34);
    ctx.lineTo(25, -34);
    ctx.lineTo(75, -12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(-80, 28, 18, 0, Math.PI * 2);
    ctx.arc(95, 28, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(-80, 28, 10, 0, Math.PI * 2);
    ctx.arc(95, 28, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Doors Status Pills
    const doors = [
      { label: '左前门', open: this.doorStates.FL, x: 104, y: 330 },
      { label: '右前门', open: this.doorStates.FR, x: 208, y: 330 },
      { label: '左后门', open: this.doorStates.RL, x: 312, y: 330 },
      { label: '右后门', open: this.doorStates.RR, x: 416, y: 330 }
    ];

    doors.forEach((d) => {
      ctx.fillStyle = d.open ? 'rgba(239, 68, 68, 0.18)' : 'rgba(34, 197, 94, 0.15)';
      roundRect(d.x, d.y, 90, 36, 8);
      ctx.fill();
      ctx.strokeStyle = d.open ? '#ef4444' : '#22c55e';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = d.open ? '#f87171' : '#4ade80';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${d.label}: ${d.open ? '开启' : '关闭'}`, d.x + 45, d.y + 22);
    });

    // Lights and Spoiler status
    const spoilerLabel = this.spoilerAngle === 0 ? '收起 (0°)' : `${this.spoilerAngle}° (下压力MAX)`;
    const lightLabel = this.isLightsOn ? '水滴大灯: 开启' : '水滴大灯: 关闭';

    ctx.fillStyle = this.isLightsOn ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.05)';
    roundRect(104, 380, 195, 38, 8);
    ctx.fill();
    ctx.fillStyle = this.isLightsOn ? '#facc15' : '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`💡 ${lightLabel}`, 104 + 97, 404);

    ctx.fillStyle = this.spoilerAngle > 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)';
    roundRect(311, 380, 195, 38, 8);
    ctx.fill();
    ctx.fillStyle = this.spoilerAngle > 0 ? '#38bdf8' : '#94a3b8';
    ctx.fillText(`🏎️ 尾翼: ${spoilerLabel}`, 311 + 97, 404);

    // Drive mode badge
    ctx.fillStyle = 'rgba(202, 67, 25, 0.2)';
    roundRect(104, 432, 402, 42, 8);
    ctx.fill();
    ctx.strokeStyle = '#ca4319';
    ctx.stroke();
    ctx.fillStyle = '#ff7a45';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('⚡ 驾驶模式: SPORT+ 极速竞赛模式 (0.195 Cd 超低风阻)', 305, 458);

    // 5. Right Top Card: Amap Auto Navigation (x: 546, y: 52, w: 450, h: 245)
    ctx.fillStyle = 'rgba(18, 24, 35, 0.85)';
    roundRect(546, 52, 450, 245, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('高德地图车机版', 570, 84);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('↱ 500m 驶入亦庄高架', 570, 120);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('目的地: 小米汽车超级工厂 · 剩余 18km / 22分钟', 570, 146);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 570; x < 970; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 165); ctx.lineTo(x, 275); ctx.stroke();
    }
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(580, 260);
    ctx.lineTo(680, 240);
    ctx.quadraticCurveTo(750, 240, 800, 190);
    ctx.lineTo(950, 180);
    ctx.stroke();

    // 6. Right Bottom Card: Xiaomi HyperOS Dolby Atmos Music (x: 546, y: 312, w: 450, h: 250)
    ctx.fillStyle = 'rgba(18, 24, 35, 0.85)';
    roundRect(546, 312, 450, 250, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.fillStyle = '#1e1b4b';
    roundRect(570, 336, 90, 90, 10);
    ctx.fill();
    ctx.fillStyle = '#818cf8';
    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎵', 615, 395);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('晴天 - 周杰伦', 676, 365);
    ctx.fillStyle = '#a5b4fc';
    ctx.font = '13px sans-serif';
    ctx.fillText('杜比全景声 7.1.4 · 25 扬声器超奢声场', 676, 392);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.fillText('叶惠美 · 豪华车载专属母带音质', 676, 414);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    roundRect(570, 445, 402, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#ff6900';
    roundRect(570, 445, 230, 6, 3);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText('02:45', 570, 468);
    ctx.textAlign = 'right';
    ctx.fillText('04:29', 972, 468);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '22px sans-serif';
    ctx.fillText('⏮', 720, 520);
    ctx.fillText('⏸', 771, 522);
    ctx.fillText('⏭', 822, 520);

    // 7. Bottom Climate Control Bar (y: 574, h: 56)
    ctx.fillStyle = 'rgba(12, 16, 24, 0.96)';
    ctx.fillRect(64, 574, w - 64, 66);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(64, 574);
    ctx.lineTo(w, 574);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('主驾: 22.0°C', 104, 612);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.font = '14px sans-serif';
    ctx.fillText('❄️ AUTO 智能空调 · 双区恒温 · 座椅通风开启', 535, 612);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('副驾: 22.0°C', 972, 612);
  }

  private drawHudCanvas(speedKmH: number = 0) {
    if (!this.hudCtx || !this.hudCanvas) return;
    const ctx = this.hudCtx;
    ctx.setTransform(this.displayScale, 0, 0, this.displayScale, 0, 0);
    const w = 512;
    const h = 200;

    ctx.fillStyle = '#06080d';
    ctx.fillRect(0, 0, w, h);

    // Center Speed display
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px -apple-system, sans-serif';
    ctx.fillText(Math.round(speedKmH).toString(), w / 2, 100);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('km/h', w / 2, 130);

    // Gear indicator
    const isDrive = speedKmH > 0;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = isDrive ? '#64748b' : '#38bdf8';
    ctx.fillText(isDrive ? 'P' : '[P]', w / 2 - 60, 40);
    ctx.fillStyle = '#64748b';
    ctx.fillText('R', w / 2 - 20, 40);
    ctx.fillText('N', w / 2 + 20, 40);
    ctx.fillStyle = isDrive ? '#22c55e' : '#64748b';
    ctx.fillText(isDrive ? '[D]' : 'D', w / 2 + 60, 40);

    // Battery / Range (left)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('⚡ 88%', 24, 90);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '14px sans-serif';
    ctx.fillText('685 km', 24, 115);

    // Drive Mode / Energy (right)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff6900';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('SPORT+', w - 24, 90);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('胎压 2.5 bar', w - 24, 115);

    // Bottom accent line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 80, 150);
    ctx.lineTo(w / 2 + 80, 150);
    ctx.stroke();
  }

  public updateCockpitScreen() {
    this.drawHyperOsCanvas();
    if (this.screenTexture) {
      this.screenTexture.needsUpdate = true;
    }
  }

  public updateHud(speedKmH: number) {
    this.hudSpeedKmH = speedKmH;
    const speed = Math.round(speedKmH);
    const moving = speedKmH > 0;
    if (speed === this.lastHudSpeed && moving === this.lastHudMoving) return;
    this.lastHudSpeed = speed;
    this.lastHudMoving = moving;
    this.drawHudCanvas(speedKmH);
    if (this.hudTexture) {
      this.hudTexture.needsUpdate = true;
    }
  }

  /**
   * Frame-by-frame updates for screen clock and animations
   */
  public update(dt: number) {
    this.screenClockSec += dt;
    if (this.screenClockSec >= 1.0) {
      this.screenClockSec = 0;
      this.updateCockpitScreen();
    }
  }

  /**
   * Raycast check for clicking doors and cockpit screen directly in 3D
   */
  public handleRaycast(raycaster: THREE.Raycaster): boolean {
    const intersects = raycaster.intersectObjects(this.rootGroup.children, true);
    for (const hit of intersects) {
      if (hit.object.userData && hit.object.userData.isDoorPart) {
        const doorId = hit.object.userData.doorId as DoorId;
        this.toggleDoor(doorId);
        return true;
      }
      if (hit.object.userData && hit.object.userData.isCockpitScreen) {
        this.toggleLights();
        return true;
      }
    }
    return false;
  }
}
