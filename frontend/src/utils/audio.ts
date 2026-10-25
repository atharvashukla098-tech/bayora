// Web Audio API procedural sound engine + High-Fidelity Cinematic Sound Assets

class SoundEngine {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;
  private blastBuffer: AudioBuffer | null = null;
  private blastAudioEl: HTMLAudioElement | null = null;
  private activeBlastSource: AudioBufferSourceNode | null = null;
  private blastGainNode: GainNode | null = null;
  private isRiserActive: boolean = false;
  private stopTimer: number | null = null;
  private isUnlocked: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.blastAudioEl = new Audio('/assets/blast-whoom.mp3');
        this.blastAudioEl.preload = 'auto';
        this.blastAudioEl.volume = 1.0;
      } catch {
        // Fallback
      }

      // Proactively unlock AudioContext on any initial user gesture
      const unlock = () => {
        this.unlockAudio();
      };
      ['pointerdown', 'touchstart', 'click', 'keydown', 'wheel', 'scroll'].forEach((evt) => {
        window.addEventListener(evt, unlock, { passive: true });
      });

      // Eagerly prefetch and decode the blast buffer
      setTimeout(() => {
        this.init();
      }, 50);
    }
  }

  unlockAudio() {
    if (this.isUnlocked && this.ctx && this.ctx.state === 'running') return;
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.isUnlocked = true;
      }).catch(() => {});
    } else if (this.ctx && this.ctx.state === 'running') {
      this.isUnlocked = true;
    }
  }

  private init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.loadBlastBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.blastBuffer && this.ctx) {
      this.loadBlastBuffer();
    }
  }

  private async loadBlastBuffer() {
    if (this.blastBuffer || !this.ctx) return;
    try {
      const response = await fetch('/assets/blast-whoom.mp3');
      const arrayBuffer = await response.arrayBuffer();
      if (this.ctx) {
        this.blastBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      }
    } catch {
      // Audio buffer load fallback
    }
  }

  // Soft high-tech digital click
  playClick() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch {
      // Audio autoplay policy
    }
  }

  // Hover hum
  playHover() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(320, this.ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.02, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch {
      // Audio autoplay policy
    }
  }

  // Security tamper alert sound (warning siren pulse)
  playTamperAlert() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.setValueAtTime(880, this.ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(330, this.ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch {
      // Audio autoplay policy
    }
  }

  // Cryptographic verification success chime
  playVerified() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.06, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.35);
      });
    } catch {
      // Audio autoplay policy
    }
  }

  // Checks if the blast / riser sound is currently active
  isBlastActive(): boolean {
    return this.isRiserActive;
  }

  // Starts the cinematic whoosh swell from 0.0s in lockstep with the scrolling star shake
  startBlastRiser() {
    if (this.isMuted) return;
    this.unlockAudio();
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.isRiserActive) return;
    this.isRiserActive = true;

    try {
      if (this.ctx && this.blastBuffer && this.ctx.state === 'running') {
        if (this.activeBlastSource) {
          try { this.activeBlastSource.stop(); } catch {}
          this.activeBlastSource = null;
        }
        const source = this.ctx.createBufferSource();
        source.buffer = this.blastBuffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.85, this.ctx.currentTime);
        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start(0, 0);
        this.activeBlastSource = source;
        this.blastGainNode = gain;

        source.onended = () => {
          this.isRiserActive = false;
          if (this.activeBlastSource === source) {
            this.activeBlastSource = null;
          }
        };
        return;
      }

      // HTML5 Audio element fallback
      if (this.blastAudioEl) {
        this.blastAudioEl.currentTime = 0;
        this.blastAudioEl.volume = 1.0;
        this.blastAudioEl.play().catch(() => {});
        this.blastAudioEl.onended = () => {
          this.isRiserActive = false;
        };
      }
    } catch {
      // Autoplay policy
    }
  }

  // Stops and resets the riser if user stops scrolling before detonation
  stopBlastRiser() {
    if (!this.isRiserActive) return;
    this.isRiserActive = false;
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    try {
      if (this.ctx && this.blastGainNode && this.activeBlastSource) {
        const sourceToStop = this.activeBlastSource;
        this.blastGainNode.gain.setValueAtTime(this.blastGainNode.gain.value, this.ctx.currentTime);
        this.blastGainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2);
        this.stopTimer = window.setTimeout(() => {
          try {
            sourceToStop.stop();
          } catch {}
          if (this.activeBlastSource === sourceToStop) {
            this.activeBlastSource = null;
          }
          this.stopTimer = null;
        }, 220);
      }
      if (this.blastAudioEl && !this.blastAudioEl.paused) {
        this.blastAudioEl.pause();
        this.blastAudioEl.currentTime = 0;
      }
    } catch {}
  }

  // The single authentic cinematic WHOOM blast detonation
  playCosmicBlast() {
    if (this.isMuted) return;
    this.unlockAudio();

    // Cancel any pending stop/fade-out timer immediately!
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }

    try {
      // If the riser was already swelling during scroll:
      // Ramp gain to full volume 1.0 so it naturally erupts into the explosive WHOOM impact!
      if (this.ctx && this.activeBlastSource && this.blastGainNode && this.isRiserActive) {
        this.blastGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        this.blastGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
        return;
      }

      // If triggered directly without pre-scroll riser:
      this.isRiserActive = true;
      const onset = 0.85; // Strike with rushing whoosh directly into thunderous WHOOM impact!

      if (this.ctx && this.blastBuffer && this.ctx.state === 'running') {
        if (this.activeBlastSource) {
          try { this.activeBlastSource.stop(); } catch {}
          this.activeBlastSource = null;
        }
        const source = this.ctx.createBufferSource();
        source.buffer = this.blastBuffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start(0, onset);
        this.activeBlastSource = source;
        this.blastGainNode = gain;

        source.onended = () => {
          this.isRiserActive = false;
          if (this.activeBlastSource === source) {
            this.activeBlastSource = null;
          }
        };
        return;
      }

      // HTML5 Audio element fallback
      if (this.blastAudioEl) {
        this.blastAudioEl.currentTime = onset;
        this.blastAudioEl.volume = 1.0;
        this.blastAudioEl.play().catch(() => {
          if (this.blastAudioEl) {
            this.blastAudioEl.currentTime = 0;
            this.blastAudioEl.play().catch(() => {});
          }
        });
        this.blastAudioEl.onended = () => {
          this.isRiserActive = false;
        };
      }
    } catch {
      // Autoplay policy
    }
  }

  // Replaced by authentic cinematic whoosh riser - kept as no-op to silence all synthesizer tones
  playShakeCharge(_progress: number) {
    // Intentionally silent: zero artificial synth tones or tiny music
  }

  // Cinematic Vacuum Implosion (Reverse Shockwave + Sub Collapse)
  playImplosion() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Sub-bass frequency sweep upwards into vacuum singularity
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(45, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.5);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch {
      // Audio autoplay policy
    }
  }
}

export const sound = new SoundEngine();
