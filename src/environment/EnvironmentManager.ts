import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type EnvironmentTheme = 'studio' | 'cyberpunk' | 'sunset' | 'minimal' | 'rainy';

export class EnvironmentManager {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  private pmremGenerator: THREE.PMREMGenerator;

  // Lighting
  private dirLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private fillLight: THREE.DirectionalLight;

  // Showroom components
  private showroomGroup: THREE.Group;
  private showroomFloor: THREE.Mesh;
  private lightRingOuter: THREE.Mesh;
  private lightRingInner: THREE.Mesh;
  private gridHelper: THREE.GridHelper;

  // Rain Weather system
  private rainGroup: THREE.Group;
  private rainInstancedMesh: THREE.InstancedMesh | null = null;
  private rainData: Array<{ x: number; y: number; z: number; speed: number; len: number }> = [];
  private rainDummy: THREE.Object3D = new THREE.Object3D();

  // Highway / Driving components
  private highwayGroup: THREE.Group;
  private roadMesh: THREE.Mesh;
  private roadMaterial: THREE.MeshStandardMaterial;
  private roadTexture: THREE.CanvasTexture;
  private streetLampsGroup: THREE.Group;

  // State
  public currentTheme: EnvironmentTheme = 'studio';
  public isDrivingMode: boolean = false;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);

    // Initial background & environment
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.environment = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // Lights
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.dirLight.position.set(-6, 10, -5);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 30;
    this.dirLight.shadow.camera.left = -6;
    this.dirLight.shadow.camera.right = 6;
    this.dirLight.shadow.camera.top = 6;
    this.dirLight.shadow.camera.bottom = -6;
    this.dirLight.shadow.bias = -0.0001;
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight(0x90b0e0, 1.2);
    this.fillLight.position.set(6, 6, 6);
    this.scene.add(this.fillLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    // Groups
    this.showroomGroup = new THREE.Group();
    this.showroomGroup.name = 'Showroom_Group';
    this.scene.add(this.showroomGroup);

    this.highwayGroup = new THREE.Group();
    this.highwayGroup.name = 'Highway_Group';
    this.highwayGroup.visible = false;
    this.scene.add(this.highwayGroup);

    this.rainGroup = new THREE.Group();
    this.rainGroup.name = 'Rain_Group';
    this.rainGroup.visible = false;
    this.scene.add(this.rainGroup);

    // Build subcomponents
    this.buildShowroom();
    this.buildRain();
    this.buildHighway();
    this.setTheme('studio');
  }

  /**
   * High-end automotive studio platform
   */
  private buildShowroom() {
    // 1. High-gloss dark reflective floor
    const floorGeo = new THREE.CircleGeometry(16, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f1115,
      metalness: 0.85,
      roughness: 0.22,
      envMapIntensity: 1.0
    });
    this.showroomFloor = new THREE.Mesh(floorGeo, floorMat);
    this.showroomFloor.rotation.x = -Math.PI / 2;
    this.showroomFloor.position.y = -0.005;
    this.showroomFloor.receiveShadow = true;
    this.showroomGroup.add(this.showroomFloor);

    // 2. Concentric Neon Light Rings
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });

    const outerRingGeo = new THREE.RingGeometry(5.8, 5.86, 96);
    this.lightRingOuter = new THREE.Mesh(outerRingGeo, ringMat);
    this.lightRingOuter.rotation.x = -Math.PI / 2;
    this.lightRingOuter.position.y = 0.001;
    this.showroomGroup.add(this.lightRingOuter);

    const innerRingGeo = new THREE.RingGeometry(3.6, 3.64, 96);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25
    });
    this.lightRingInner = new THREE.Mesh(innerRingGeo, innerRingMat);
    this.lightRingInner.rotation.x = -Math.PI / 2;
    this.lightRingInner.position.y = 0.001;
    this.showroomGroup.add(this.lightRingInner);

    // 3. Subtle background radial grid
    this.gridHelper = new THREE.GridHelper(36, 36, 0x1f2937, 0x111827);
    this.gridHelper.position.y = -0.01;
    this.showroomGroup.add(this.gridHelper);
  }

  /**
   * Procedural dynamic highway with lane dividers and streetlamps
   */
  private buildHighway() {
    // Generate highway texture procedurally using HTML5 Canvas (high-res 1024x2048)
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    // Asphalt surface
    ctx.fillStyle = '#181b20';
    ctx.fillRect(0, 0, 512, 1024);

    // Asphalt noise grain
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 1024;
      const shade = Math.floor(Math.random() * 25 + 20);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Yellow solid edge lines
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(30, 0, 8, 1024);
    ctx.fillRect(474, 0, 8, 1024);

    // White dashed center line
    ctx.fillStyle = '#f8fafc';
    for (let y = 0; y < 1024; y += 96) {
      ctx.fillRect(252, y, 8, 54);
    }

    this.roadTexture = new THREE.CanvasTexture(canvas);
    this.roadTexture.wrapS = THREE.RepeatWrapping;
    this.roadTexture.wrapT = THREE.RepeatWrapping;
    this.roadTexture.repeat.set(1, 10);

    const roadGeo = new THREE.PlaneGeometry(10, 120);
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      roughness: 0.6,
      metalness: 0.1
    });

    this.roadMesh = new THREE.Mesh(roadGeo, this.roadMaterial);
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.set(0, -0.005, 0);
    this.roadMesh.receiveShadow = true;
    this.highwayGroup.add(this.roadMesh);

    // Streetlamps on both sides of highway
    this.streetLampsGroup = new THREE.Group();
    const lampCount = 12;
    const lampSpacing = 16;

    for (let i = 0; i < lampCount; i++) {
      const z = -60 + i * lampSpacing;
      [-5.5, 5.5].forEach((x) => {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.08, 6),
          new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 })
        );
        pole.position.set(x, 3, z);

        // Lamp arm & head
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.1, 0.6),
          new THREE.MeshBasicMaterial({ color: 0xfffbeb })
        );
        head.position.set(x > 0 ? -0.4 : 0.4, 3, 0);
        pole.add(head);

        this.streetLampsGroup.add(pole);
      });
    }

    this.highwayGroup.add(this.streetLampsGroup);
  }

  /**
   * Procedural Cyberpunk Rain particle system with 3D InstancedMesh streaks (雨夜展厅)
   */
  private buildRain() {
    const rainCount = 1200;
    const geo = new THREE.CylinderGeometry(0.005, 0.005, 0.45, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    this.rainInstancedMesh = new THREE.InstancedMesh(geo, mat, rainCount);
    this.rainData = [];

    for (let i = 0; i < rainCount; i++) {
      const x = (Math.random() - 0.5) * 22;
      const y = Math.random() * 12 + 0.5;
      const z = (Math.random() - 0.5) * 22;
      const speed = 16 + Math.random() * 12;
      const len = 0.8 + Math.random() * 0.6;

      this.rainData.push({ x, y, z, speed, len });

      this.rainDummy.position.set(x, y, z);
      this.rainDummy.scale.set(1, len, 1);
      this.rainDummy.updateMatrix();
      this.rainInstancedMesh.setMatrixAt(i, this.rainDummy.matrix);
    }

    this.rainInstancedMesh.instanceMatrix.needsUpdate = true;
    this.rainGroup.add(this.rainInstancedMesh);
  }

  /**
   * Switch between lighting theme presets
   */
  public setTheme(theme: EnvironmentTheme) {
    this.currentTheme = theme;

    // Reset default floor properties
    (this.showroomFloor.material as THREE.MeshStandardMaterial).color.setHex(0x0f1115);
    (this.showroomFloor.material as THREE.MeshStandardMaterial).roughness = 0.22;
    (this.showroomFloor.material as THREE.MeshStandardMaterial).metalness = 0.85;

    switch (theme) {
      case 'studio':
        this.scene.background = new THREE.Color(0x0a0c10);
        this.dirLight.color.setHex(0xffffff);
        this.dirLight.intensity = 2.6;
        this.dirLight.position.set(-6, 10, -5);
        this.fillLight.color.setHex(0x90b0e0);
        this.fillLight.intensity = 1.3;
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.6;
        (this.lightRingOuter.material as THREE.MeshBasicMaterial).color.setHex(0x00e5ff);
        break;

      case 'cyberpunk':
        this.scene.background = new THREE.Color(0x040508);
        this.dirLight.color.setHex(0x38bdf8);
        this.dirLight.intensity = 3.2;
        this.dirLight.position.set(-8, 8, -6);
        this.fillLight.color.setHex(0xf43f5e);
        this.fillLight.intensity = 2.5;
        this.fillLight.position.set(8, 4, 6);
        this.ambientLight.color.setHex(0x1e1b4b);
        this.ambientLight.intensity = 0.8;
        (this.lightRingOuter.material as THREE.MeshBasicMaterial).color.setHex(0xf43f5e);
        break;

      case 'sunset':
        this.scene.background = new THREE.Color(0x1a0f1d);
        this.dirLight.color.setHex(0xfb923c);
        this.dirLight.intensity = 3.5;
        this.dirLight.position.set(-10, 4, -8);
        this.fillLight.color.setHex(0xc084fc);
        this.fillLight.intensity = 1.8;
        this.ambientLight.color.setHex(0x3b1836);
        this.ambientLight.intensity = 0.7;
        (this.lightRingOuter.material as THREE.MeshBasicMaterial).color.setHex(0xf97316);
        break;

      case 'minimal':
        this.scene.background = new THREE.Color(0xf1f5f9);
        this.dirLight.color.setHex(0xffffff);
        this.dirLight.intensity = 2.2;
        this.dirLight.position.set(-4, 10, -4);
        this.fillLight.color.setHex(0xe2e8f0);
        this.fillLight.intensity = 1.0;
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 1.2;
        (this.lightRingOuter.material as THREE.MeshBasicMaterial).color.setHex(0x94a3b8);
        (this.showroomFloor.material as THREE.MeshStandardMaterial).color.setHex(0xe2e8f0);
        break;

      case 'rainy':
        this.scene.background = new THREE.Color(0x050711);
        this.dirLight.color.setHex(0x38bdf8);
        this.dirLight.intensity = 2.4;
        this.dirLight.position.set(-8, 9, -6);
        this.fillLight.color.setHex(0x818cf8);
        this.fillLight.intensity = 2.0;
        this.ambientLight.color.setHex(0x0f172a);
        this.ambientLight.intensity = 0.9;
        (this.lightRingOuter.material as THREE.MeshBasicMaterial).color.setHex(0x00d2ff);
        (this.showroomFloor.material as THREE.MeshStandardMaterial).color.setHex(0x06080d);
        (this.showroomFloor.material as THREE.MeshStandardMaterial).roughness = 0.05;
        (this.showroomFloor.material as THREE.MeshStandardMaterial).metalness = 0.95;
        break;
    }

    if (this.rainGroup) {
      this.rainGroup.visible = (theme === 'rainy' && !this.isDrivingMode);
    }
  }

  /**
   * Switch between Showroom and Dynamic Drive modes
   */
  public setDrivingMode(driving: boolean) {
    this.isDrivingMode = driving;
    this.showroomGroup.visible = !driving;
    this.highwayGroup.visible = driving;

    if (this.currentTheme === 'rainy' && this.rainGroup) {
      this.rainGroup.visible = !driving;
    }

    if (driving) {
      this.scene.background = new THREE.Color(0x05070a);
      this.dirLight.intensity = 1.8;
    } else {
      this.setTheme(this.currentTheme);
    }
  }

  public update(dt: number) {
    if (this.currentTheme === 'rainy' && this.rainInstancedMesh && this.rainGroup.visible) {
      const safeDt = Math.min(dt, 0.1);
      for (let i = 0; i < this.rainData.length; i++) {
        const r = this.rainData[i];
        r.y -= r.speed * safeDt;
        if (r.y < 0) {
          r.y = 11 + Math.random() * 3;
        }
        this.rainDummy.position.set(r.x, r.y, r.z);
        this.rainDummy.scale.set(1, r.len, 1);
        this.rainDummy.updateMatrix();
        this.rainInstancedMesh.setMatrixAt(i, this.rainDummy.matrix);
      }
      this.rainInstancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Animate highway texture and streetlamps based on vehicle speed
   * @param speedKmH current speed in km/h
   * @param dt delta time in seconds
   */
  public updateHighway(speedKmH: number, dt: number) {
    if (!this.isDrivingMode) return;

    // v in m/s
    const v = speedKmH / 3.6;
    // Texture repeats 10 times over 120m -> 1 unit = 12m
    const offset = (v * dt) / 12.0;

    this.roadTexture.offset.y -= offset;
    if (this.roadTexture.offset.y < -1) {
      this.roadTexture.offset.y += 1;
    }

    // Move streetlamps backward
    const moveZ = v * dt;
    this.streetLampsGroup.children.forEach((pole) => {
      pole.position.z += moveZ;
      if (pole.position.z > 60) {
        pole.position.z -= 120;
      }
    });
  }
}
