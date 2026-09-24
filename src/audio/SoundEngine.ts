/**
 * Web Audio API based Synthesizer for Xiaomi SU7
 * Generates realistic electric motor whines, door thuds, lock chimes, and UI sounds
 * 100% offline, zero external sound files required!
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  // Motor sound nodes
  private motorOsc: OscillatorNode | null = null;
  private motorSubOsc: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private motorFilter: BiquadFilterNode | null = null;
  private isMotorRunning: boolean = false;

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.motorGain && this.ctx) {
      this.motorGain.gain.setValueAtTime(muted ? 0 : 0.08, this.ctx.currentTime);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Start electric drive sound
   */
  public startMotor() {
    if (this.isMotorRunning) return;
    this.initContext();
    if (!this.ctx) return;

    this.motorOsc = this.ctx.createOscillator();
    this.motorSubOsc = this.ctx.createOscillator();
    this.motorGain = this.ctx.createGain();
    this.motorFilter = this.ctx.createBiquadFilter();

    // Electric motor waveform (triangle + sine blend)
    this.motorOsc.type = 'triangle';
    this.motorSubOsc.type = 'sine';

    this.motorOsc.frequency.setValueAtTime(80, this.ctx.currentTime);
    this.motorSubOsc.frequency.setValueAtTime(40, this.ctx.currentTime);

    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.setValueAtTime(350, this.ctx.currentTime);
    this.motorFilter.Q.setValueAtTime(2, this.ctx.currentTime);

    this.motorGain.gain.setValueAtTime(this.isMuted ? 0 : 0.05, this.ctx.currentTime);

    this.motorOsc.connect(this.motorFilter);
    this.motorSubOsc.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.ctx.destination);

    this.motorOsc.start();
    this.motorSubOsc.start();
    this.isMotorRunning = true;
  }

  /**
   * Update motor pitch and volume according to speed (0 to 265 km/h)
   */
  public updateMotorSpeed(speed: number) {
    if (!this.isMotorRunning || !this.ctx || !this.motorOsc || !this.motorSubOsc || !this.motorFilter || !this.motorGain) return;

    const normalized = Math.max(0, Math.min(speed / 265, 1));
    const now = this.ctx.currentTime;

    // Pitch rises smoothly from 80Hz to 850Hz with electric inverter whine
    const freq = 80 + normalized * 750 + Math.pow(normalized, 1.5) * 200;
    this.motorOsc.frequency.setTargetAtTime(freq, now, 0.05);
    this.motorSubOsc.frequency.setTargetAtTime(freq * 0.5, now, 0.05);

    // Filter opens up as speed increases for crisp electric resonance
    const filterFreq = 300 + normalized * 1800;
    this.motorFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);

    // Volume dynamically scales with throttle/speed
    if (!this.isMuted) {
      const vol = 0.03 + normalized * 0.12;
      this.motorGain.gain.setTargetAtTime(vol, now, 0.05);
    }
  }

  public stopMotor() {
    if (!this.isMotorRunning) return;
    try {
      this.motorOsc?.stop();
      this.motorSubOsc?.stop();
    } catch {
      // ignore
    }
    this.isMotorRunning = false;
  }

  /**
   * Heavy, high-end car door latch/closing thud sound
   */
  public playDoorClose() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.18);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(280, now);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.22);
  }

  /**
   * Door handle click / pop sound
   */
  public playDoorOpen() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * Xiaomi smart lock / unlock high-tech chime
   */
  public playLockChime() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Pleasant dual chime (A5 -> E6)
    [880, 1318.5].forEach((freq, i) => {
      const startTime = now + i * 0.1;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.25);
    });
  }

  /**
   * Futuristic UI button tap
   */
  public playUiClick() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }
}

export const sound = new SoundEngine();
