import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { CarController } from './car/CarController';
import { EnvironmentManager } from './environment/EnvironmentManager';
import { CameraManager } from './camera/CameraManager';
import { UIManager } from './ui/UIManager';
import { sound } from './audio/SoundEngine';

async function bootstrap() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // 1. WebGL Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true // Required for poster snapshot export
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  const isLowPower = /arm|aarch64|mobile/i.test(navigator.userAgent);
  renderer.setPixelRatio(isLowPower ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 2. Scene
  const scene = new THREE.Scene();

  // 3. Subsystems
  const env = new EnvironmentManager(scene, renderer);
  const cameraManager = new CameraManager(container);
  const car = new CarController();

  // Expose for inspection and verification
  (window as any).__car = car;
  (window as any).__scene = scene;
  (window as any).__camera = cameraManager;
  (window as any).__env = env;

  // 4. Loading Progress Hooks
  const loadingScreen = document.getElementById('loading-screen');
  const loadingProgress = document.getElementById('loading-progress');
  const loadingStatus = document.getElementById('loading-status');

  const updateProgress = (pct: number) => {
    if (loadingProgress) loadingProgress.style.width = `${pct}%`;
    if (loadingStatus) {
      if (pct < 35) loadingStatus.textContent = `正在加载 SU7 3D 几何网格... ${pct}%`;
      else if (pct < 75) loadingStatus.textContent = `正在生成 4K 金属车漆与座舱材质... ${pct}%`;
      else if (pct < 99) loadingStatus.textContent = `正在校验小米澎湃智能座舱与激光雷达... ${pct}%`;
      else loadingStatus.textContent = `准备就绪，欢迎进入小米 SU7 展厅！`;
    }
  };

  try {
    await car.load(scene, (pct) => updateProgress(pct));
    updateProgress(100);

    setTimeout(() => {
      loadingScreen?.classList.add('hidden');
      sound.playLockChime();
    }, 400);
  } catch (err) {
    console.error('Failed to initialize 3D scene:', err);
    if (loadingStatus) {
      loadingStatus.textContent = '模型加载失败，请刷新重试';
      loadingStatus.style.color = '#ef4444';
    }
  }

  // 5. UI Controller
  const ui = new UIManager(car, env, cameraManager);

  // 6. 3D Raycasting for Clicking Doors and Interactive Parts
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let mouseDownTime = 0;

  window.addEventListener('mousedown', () => {
    mouseDownTime = performance.now();
  });

  window.addEventListener('click', (e) => {
    // Distinguish click from camera drag: only trigger if mouse was down < 250ms
    if (performance.now() - mouseDownTime > 250) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, cameraManager.camera);
    const handled = car.handleRaycast(raycaster);
    if (handled) {
      ui.updateDoorButtons();
    }
  });

  // Cursor change on hover over clickable doors
  window.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, cameraManager.camera);
    const intersects = raycaster.intersectObjects(car.rootGroup.children, true);
    const hasDoorHover = intersects.some((hit) => hit.object.userData && hit.object.userData.isDoorPart);
    container.style.cursor = hasDoorHover ? 'pointer' : 'default';
  });

  // 7. Responsive Resizing
  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    cameraManager.onResize(width, height);
    renderer.setSize(width, height);
  });

  // 8. Main Render Loop
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const dt = clock.getDelta();

    TWEEN.update();
    cameraManager.update();
    env.update(dt);
    car.update(dt);
    ui.update(dt);

    renderer.render(scene, cameraManager.camera);
  }

  animate();
}

bootstrap();
