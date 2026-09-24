import confetti from 'canvas-confetti';
import { CarController, SU7_COLORS, DoorId, CarColorPreset } from '../car/CarController';
import { EnvironmentManager, EnvironmentTheme } from '../environment/EnvironmentManager';
import { CameraManager, CameraPreset } from '../camera/CameraManager';
import { sound } from '../audio/SoundEngine';

export interface TrimOption {
  id: string;
  name: string;
  price: string;
  accel: string;
  topSpeed: string;
  range: string;
  power: string;
}

export const SU7_TRIMS: Record<string, TrimOption> = {
  standard: {
    id: 'standard',
    name: 'SU7 标准版',
    price: '¥ 215,900',
    accel: '5.28s',
    topSpeed: '210 km/h',
    range: '700 km',
    power: '299 PS / 220kW'
  },
  pro: {
    id: 'pro',
    name: 'SU7 Pro 超长续航版',
    price: '¥ 245,900',
    accel: '5.70s',
    topSpeed: '210 km/h',
    range: '830 km',
    power: '299 PS / 220kW'
  },
  max: {
    id: 'max',
    name: 'SU7 Max 旗舰高性能版',
    price: '¥ 299,900',
    accel: '2.78s',
    topSpeed: '265 km/h',
    range: '800 km',
    power: '673 PS / 495kW'
  }
};

export class UIManager {
  private car: CarController;
  private env: EnvironmentManager;
  private camera: CameraManager;

  // Selected Trim
  public selectedTrim: TrimOption = SU7_TRIMS.max;

  // Driving Simulation State
  public currentSpeed: number = 0; // km/h
  public targetSpeed: number = 0; // km/h
  public steerAngle: number = 0; // -1 to 1
  public isGasPressed: boolean = false;
  public isBrakePressed: boolean = false;
  public isTurningLeft: boolean = false;
  public isTurningRight: boolean = false;

  private themeCycle: EnvironmentTheme[] = ['studio', 'cyberpunk', 'sunset', 'minimal', 'rainy'];
  private currentThemeIdx = 0;

  constructor(car: CarController, env: EnvironmentManager, camera: CameraManager) {
    this.car = car;
    this.env = env;
    this.camera = camera;

    this.initColorPalette();
    this.bindModeSwitcher();
    this.bindDoorControls();
    this.bindSpoilerControls();
    this.bindLightControls();
    this.bindTechControls();
    this.bindCameraPresets();
    this.bindHeaderActions();
    this.bindSpecsDrawer();
    this.bindDrivingControls();
  }

  /**
   * Render official 9 color swatches
   */
  private initColorPalette() {
    const palette = document.getElementById('color-palette');
    if (!palette) return;

    SU7_COLORS.forEach((color, idx) => {
      const dot = document.createElement('div');
      dot.className = `color-dot ${idx === 0 ? 'active' : ''}`;
      dot.style.backgroundColor = color.hex;
      dot.title = `${color.name} (${color.enName})`;
      dot.dataset.hex = color.hex;

      dot.addEventListener('click', () => {
        this.selectColor(color, dot);
      });

      palette.appendChild(dot);
    });

    // Custom RGB Picker input
    const customPicker = document.getElementById('custom-paint-picker') as HTMLInputElement;
    if (customPicker) {
      customPicker.addEventListener('input', (e) => {
        const hex = (e.target as HTMLInputElement).value;
        this.car.setCarColor(hex);
        document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
        const nameEl = document.getElementById('color-name');
        const descEl = document.getElementById('color-desc');
        if (nameEl) nameEl.textContent = '个性定制车漆';
        if (descEl) descEl.textContent = `自选定制 HEX: ${hex.toUpperCase()}`;
      });
    }
  }

  private selectColor(color: CarColorPreset, activeDot: HTMLElement) {
    document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
    activeDot.classList.add('active');

    this.car.setCarColor(color.hex);
    sound.playUiClick();

    const nameEl = document.getElementById('color-name');
    const descEl = document.getElementById('color-desc');
    if (nameEl) nameEl.textContent = color.name;
    if (descEl) descEl.textContent = color.desc;

    const modalPaint = document.getElementById('modal-paint-name');
    if (modalPaint) modalPaint.textContent = color.name;
  }

  /**
   * Mode switcher: Showroom vs Dynamic Drive
   */
  private bindModeSwitcher() {
    const btnShowroom = document.getElementById('mode-showroom');
    const btnDrive = document.getElementById('mode-drive');
    const hud = document.getElementById('driving-hud');
    const pedals = document.getElementById('drive-pedals');
    const leftPanel = document.getElementById('left-panel');
    const cameraPanel = document.getElementById('camera-panel');

    btnShowroom?.addEventListener('click', () => {
      if (!this.env.isDrivingMode) return;
      btnShowroom.classList.add('active');
      btnDrive?.classList.remove('active');

      this.env.setDrivingMode(false);
      this.currentSpeed = 0;
      this.targetSpeed = 0;
      sound.stopMotor();

      if (hud) hud.style.display = 'none';
      if (pedals) pedals.style.display = 'none';
      if (leftPanel) leftPanel.style.display = 'flex';
      if (cameraPanel) cameraPanel.style.display = 'flex';

      this.camera.setPreset('hero');
      sound.playUiClick();
    });

    btnDrive?.addEventListener('click', () => {
      if (this.env.isDrivingMode) return;
      btnDrive.classList.add('active');
      btnShowroom?.classList.remove('active');

      this.env.setDrivingMode(true);
      // Close all doors if open
      if (this.car.areAnyDoorsOpen()) {
        this.car.toggleAllDoors();
      }

      // Automatically turn on headlights for dynamic driving
      if (!this.car.isLightsOn) {
        this.car.toggleLights();
      }

      sound.startMotor();

      if (hud) hud.style.display = 'flex';
      if (pedals) pedals.style.display = 'flex';
      if (leftPanel) leftPanel.style.display = 'none';
      if (cameraPanel) cameraPanel.style.display = 'none';

      this.camera.setPreset('drive');
      sound.playUiClick();
    });
  }

  /**
   * Car Doors Controls
   */
  private bindDoorControls() {
    // Individual 4 doors
    (['FL', 'FR', 'RL', 'RR'] as DoorId[]).forEach((id) => {
      const btn = document.getElementById(`door-${id.toLowerCase()}`);
      btn?.addEventListener('click', () => {
        this.car.toggleDoor(id);
        this.updateDoorButtons();
      });
    });

    // All doors
    document.getElementById('btn-door-all')?.addEventListener('click', () => {
      this.car.toggleAllDoors();
      this.updateDoorButtons();
    });
  }

  public updateDoorButtons() {
    (['FL', 'FR', 'RL', 'RR'] as DoorId[]).forEach((id) => {
      const btn = document.getElementById(`door-${id.toLowerCase()}`);
      if (btn) {
        const isOpen = this.car.getDoorState(id);
        btn.classList.toggle('active', isOpen);
      }
    });

    const allBtn = document.getElementById('btn-door-all');
    if (allBtn) {
      allBtn.textContent = this.car.areAnyDoorsOpen() ? '一键关闭' : '一键展翼';
    }
  }

  /**
   * Electric Active Rear Spoiler
   */
  private bindSpoilerControls() {
    const label = document.getElementById('spoiler-label');
    document.querySelectorAll('.spoiler-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.spoiler-btn').forEach((b) => b.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
        const angle = parseInt((e.currentTarget as HTMLElement).dataset.angle || '0', 10);
        this.car.setSpoilerAngle(angle);

        if (label) {
          if (angle === 0) label.textContent = '0° 收起';
          else if (angle === 5) label.textContent = '5° 低风阻节能';
          else if (angle === 12) label.textContent = '12° 巡航稳定';
          else if (angle === 25) label.textContent = '25° 极速下压力 (+130kg)';
        }
      });
    });
  }

  /**
   * Headlights, Taillights, Hazard & Ambient Light
   */
  private bindLightControls() {
    // Headlights
    const btnLights = document.getElementById('btn-headlights');
    btnLights?.addEventListener('click', () => {
      const on = this.car.toggleLights();
      btnLights.classList.toggle('active', on);
    });

    // Hazard Flasher
    const btnHazard = document.getElementById('btn-hazard');
    btnHazard?.addEventListener('click', () => {
      this.car.toggleHazard();
      btnHazard.classList.toggle('active', this.car.isHazardFlashing);
    });

    // 64-color ambient light pills
    document.querySelectorAll('.ambient-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.ambient-pill').forEach((p) => p.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
        const color = (e.currentTarget as HTMLElement).dataset.color || '#00e5ff';
        this.car.setAmbientColor(color);
        sound.playUiClick();
      });
    });
  }

  /**
   * LiDAR Pulse and Aerodynamic Airflow
   */
  private bindTechControls() {
    const btnLidar = document.getElementById('btn-lidar');
    btnLidar?.addEventListener('click', () => {
      this.car.triggerLidarPulse();
      btnLidar.classList.add('active');
      setTimeout(() => btnLidar.classList.remove('active'), 1800);
    });

    const btnAirflow = document.getElementById('btn-airflow');
    btnAirflow?.addEventListener('click', () => {
      const active = this.car.toggleAirflow();
      btnAirflow.classList.toggle('active', active);
    });
  }

  /**
   * Camera View Presets
   */
  private bindCameraPresets() {
    document.querySelectorAll('.cam-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.cam-btn').forEach((b) => b.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
        const preset = (e.currentTarget as HTMLElement).dataset.cam as CameraPreset;
        this.camera.setPreset(preset);
        sound.playUiClick();
      });
    });
  }

  /**
   * Top Header Actions: Theme, Auto-Orbit, Sound, Poster Snapshot
   */
  private bindHeaderActions() {
    // Theme switch
    document.getElementById('btn-theme')?.addEventListener('click', () => {
      this.currentThemeIdx = (this.currentThemeIdx + 1) % this.themeCycle.length;
      const theme = this.themeCycle[this.currentThemeIdx];
      this.env.setTheme(theme);
      sound.playUiClick();
    });

    // Auto orbit 360
    const btnOrbit = document.getElementById('btn-auto-orbit');
    btnOrbit?.addEventListener('click', () => {
      const active = this.camera.toggleAutoOrbit();
      btnOrbit.classList.toggle('active', active);
      sound.playUiClick();
    });

    // Sound toggle
    const btnSound = document.getElementById('btn-sound');
    const soundOn = document.getElementById('icon-sound-on');
    const soundOff = document.getElementById('icon-sound-off');
    btnSound?.addEventListener('click', () => {
      const isMuted = sound.toggleMute();
      btnSound.classList.toggle('active', !isMuted);
      if (soundOn && soundOff) {
        soundOn.style.display = isMuted ? 'none' : 'block';
        soundOff.style.display = isMuted ? 'block' : 'none';
      }
    });

    // Poster screenshot snapshot
    document.getElementById('btn-snapshot')?.addEventListener('click', () => {
      this.capturePosterSnapshot();
    });
  }

  /**
   * Export Poster Snapshot with car image and specifications
   */
  private capturePosterSnapshot() {
    sound.playLockChime();

    // Render 1 frame to ensure buffer is current
    this.env.renderer.render(this.env.scene, this.camera.camera);
    const dataUrl = this.env.renderer.domElement.toDataURL('image/png');

    // Create an elegant poster canvas (1200x800)
    const poster = document.createElement('canvas');
    poster.width = 1200;
    poster.height = 800;
    const ctx = poster.getContext('2d')!;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 800);
    grad.addColorStop(0, '#0a0d14');
    grad.addColorStop(1, '#020305');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1200, 800);

    const img = new Image();
    img.onload = () => {
      // Draw 3D render centered
      ctx.drawImage(img, 60, 40, 1080, 560);

      // Bottom specs card
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.roundRect ? ctx.roundRect(60, 620, 1080, 140, 16) : ctx.fillRect(60, 620, 1080, 140);
      ctx.fill();

      // Brand text
      ctx.fillStyle = '#ff6900';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('XIAOMI SU7', 90, 670);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(this.selectedTrim.name, 90, 715);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.fillText(`车身车漆：${document.getElementById('color-name')?.textContent || '海湾蓝'}  |  官方起售价：${this.selectedTrim.price}`, 90, 742);

      // Right performance stats
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(this.selectedTrim.accel, 740, 675);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('0-100km/h 零百', 740, 700);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(this.selectedTrim.topSpeed, 890, 675);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('最高时速', 890, 700);

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(this.selectedTrim.range, 1040, 675);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('CLTC续航', 1040, 700);

      // Download link
      const link = document.createElement('a');
      link.download = `小米SU7_${this.selectedTrim.name}_我的定制方案.png`;
      link.href = poster.toDataURL('image/png');
      link.click();
    };
    img.src = dataUrl;
  }

  /**
   * Specs Drawer & Trim Selection
   */
  private bindSpecsDrawer() {
    const drawer = document.getElementById('specs-drawer');
    const btnOpen = document.getElementById('btn-open-specs');
    const btnClose = document.getElementById('btn-close-specs');
    const btnBook = document.getElementById('btn-book-now');
    const modal = document.getElementById('booking-modal');
    const btnModalClose = document.getElementById('btn-modal-close');

    btnOpen?.addEventListener('click', () => {
      drawer?.classList.add('open');
      sound.playUiClick();
    });

    btnClose?.addEventListener('click', () => {
      drawer?.classList.remove('open');
      sound.playUiClick();
    });

    // Select trim cards
    document.querySelectorAll('.trim-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        document.querySelectorAll('.trim-card').forEach((c) => c.classList.remove('selected'));
        (e.currentTarget as HTMLElement).classList.add('selected');
        const trimKey = (e.currentTarget as HTMLElement).dataset.trim || 'max';
        this.selectedTrim = SU7_TRIMS[trimKey];
        this.updateSpecsDisplay();
        sound.playUiClick();
      });
    });

    // Booking modal & Confetti
    btnBook?.addEventListener('click', () => {
      drawer?.classList.remove('open');
      modal?.classList.add('active');

      const modalTrim = document.getElementById('modal-trim-name');
      if (modalTrim) modalTrim.textContent = this.selectedTrim.name;

      sound.playLockChime();

      // Confetti fireworks celebration
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 }
      });
      setTimeout(() => {
        confetti({
          particleCount: 60,
          angle: 60,
          spread: 55,
          origin: { x: 0 }
        });
        confetti({
          particleCount: 60,
          angle: 120,
          spread: 55,
          origin: { x: 1 }
        });
      }, 250);
    });

    btnModalClose?.addEventListener('click', () => {
      modal?.classList.remove('active');
      sound.playUiClick();
    });
  }

  private updateSpecsDisplay() {
    const specAccel = document.getElementById('spec-accel');
    const specSpeed = document.getElementById('spec-speed');
    const specRange = document.getElementById('spec-range');
    const specPower = document.getElementById('spec-power');
    const priceDisplay = document.getElementById('total-price-display');

    if (specAccel) specAccel.textContent = this.selectedTrim.accel;
    if (specSpeed) specSpeed.textContent = this.selectedTrim.topSpeed;
    if (specRange) specRange.textContent = this.selectedTrim.range;
    if (specPower) specPower.textContent = this.selectedTrim.power;
    if (priceDisplay) priceDisplay.textContent = this.selectedTrim.price;
  }

  /**
   * Dynamic Driving Keyboard & Pedal Controls
   */
  private bindDrivingControls() {
    // Keyboard listeners
    window.addEventListener('keydown', (e) => {
      if (!this.env.isDrivingMode) return;
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') this.isGasPressed = true;
      if (key === 's' || key === 'arrowdown' || key === ' ') {
        this.isBrakePressed = true;
        this.car.setBraking(true);
      }
      if (key === 'a' || key === 'arrowleft') this.isTurningLeft = true;
      if (key === 'd' || key === 'arrowright') this.isTurningRight = true;
    });

    window.addEventListener('keyup', (e) => {
      if (!this.env.isDrivingMode) return;
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') this.isGasPressed = false;
      if (key === 's' || key === 'arrowdown' || key === ' ') {
        this.isBrakePressed = false;
        this.car.setBraking(false);
      }
      if (key === 'a' || key === 'arrowleft') this.isTurningLeft = false;
      if (key === 'd' || key === 'arrowright') this.isTurningRight = false;
    });

    // Touch / Mouse Pedals
    const gasBtn = document.getElementById('pedal-gas');
    const brakeBtn = document.getElementById('pedal-brake');

    const handleGasDown = (e: Event) => {
      e.preventDefault();
      this.isGasPressed = true;
    };
    const handleGasUp = (e: Event) => {
      e.preventDefault();
      this.isGasPressed = false;
    };
    gasBtn?.addEventListener('mousedown', handleGasDown);
    gasBtn?.addEventListener('mouseup', handleGasUp);
    gasBtn?.addEventListener('touchstart', handleGasDown);
    gasBtn?.addEventListener('touchend', handleGasUp);

    const handleBrakeDown = (e: Event) => {
      e.preventDefault();
      this.isBrakePressed = true;
      this.car.setBraking(true);
    };
    const handleBrakeUp = (e: Event) => {
      e.preventDefault();
      this.isBrakePressed = false;
      this.car.setBraking(false);
    };
    brakeBtn?.addEventListener('mousedown', handleBrakeDown);
    brakeBtn?.addEventListener('mouseup', handleBrakeUp);
    brakeBtn?.addEventListener('touchstart', handleBrakeDown);
    brakeBtn?.addEventListener('touchend', handleBrakeUp);
  }

  /**
   * Main simulation step update
   */
  public update(dt: number) {
    if (this.env.isDrivingMode) {
      // Throttle acceleration
      if (this.isGasPressed) {
        this.targetSpeed = Math.min(265, this.targetSpeed + 75 * dt);
      } else if (this.isBrakePressed) {
        this.targetSpeed = Math.max(0, this.targetSpeed - 120 * dt);
      } else {
        // Natural coasting deceleration
        this.targetSpeed = Math.max(0, this.targetSpeed - 15 * dt);
      }

      // Smooth lerp speed
      this.currentSpeed += (this.targetSpeed - this.currentSpeed) * Math.min(1, 5 * dt);

      // Steering
      let targetSteer = 0;
      if (this.isTurningLeft) targetSteer -= 1;
      if (this.isTurningRight) targetSteer += 1;
      this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, 10 * dt);

      // Update speedometer HUD
      const hudSpeed = document.getElementById('hud-speed');
      const hudGear = document.getElementById('hud-gear');
      if (hudSpeed) hudSpeed.textContent = Math.round(this.currentSpeed).toString();
      if (hudGear) hudGear.textContent = this.currentSpeed > 0.5 ? 'D' : 'P';

      // Update audio motor pitch
      sound.updateMotorSpeed(this.currentSpeed);

      // Update wheels & road
      this.car.updatePhysics(this.currentSpeed, this.steerAngle, dt);
      this.env.updateHighway(this.currentSpeed, dt);
    }
  }
}
