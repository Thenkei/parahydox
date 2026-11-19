/**
 * All sound is synthesised: a handful of short voices for what the hero does, and a slow
 * generative melody for mood. Nothing plays before the first key press, as browsers require.
 */
export type Sound =
  | 'step'
  | 'hop'
  | 'land'
  | 'bump'
  | 'push'
  | 'slide'
  | 'fall'
  | 'wait'
  | 'to1d'
  | 'to2d'
  | 'to3d'
  | 'plateOn'
  | 'plateOff'
  | 'lever'
  | 'crumble'
  | 'rewind'
  | 'undo'
  | 'win'
  | 'select';

/** Two octaves of a pentatonic scale, in semitones above the root. */
const SCALES = {
  major: [0, 2, 4, 7, 9, 12, 14, 16],
  minor: [0, 3, 5, 7, 10, 12, 15, 17],
} as const;
export type Mode = keyof typeof SCALES;
const semitones = (n: number): number => 2 ** (n / 12);

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echo: DelayNode | null = null;
  private meter: AnalyserNode | null = null;
  private musicTimer: number | null = null;
  private root = 220;
  private scale: readonly number[] = SCALES.major;
  private note = 0;
  muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx !== null) {
      void this.ctx.resume();
      return;
    }
    const Context = window.AudioContext;
    if (!Context) return;
    const ctx = new Context();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.5;
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    master.connect(meter);
    master.connect(ctx.destination);

    // A feedback delay gives the dry synth voices some air.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.31;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    echo.connect(feedback).connect(echo);
    echo.connect(wet).connect(master);

    this.ctx = ctx;
    this.master = master;
    this.echo = echo;
    this.meter = meter;
    this.musicTimer = window.setInterval(() => this.playMelodyNote(), 1150);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Current output level (RMS, 0..1): lets a test confirm that sound is really produced. */
  level(): number {
    if (this.meter === null) return 0;
    const samples = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  }

  /** Each chapter sings in its own key: brighter worlds in major, burnt ones in minor, frozen ones in major pitched high. */
  setKey(root: number, mode: Mode): void {
    this.root = root;
    this.scale = SCALES[mode];
  }

  dispose(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    void this.ctx?.close();
  }

  private tone(options: {
    freq: number;
    to?: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
    echo?: boolean;
  }): void {
    const { ctx, master, echo } = this;
    if (!ctx || !master || !echo) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(options.freq, start);
    if (options.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + options.duration);
    const peak = options.gain ?? 0.2;
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0008, start + options.duration);
    osc.connect(amp);
    amp.connect(master);
    if (options.echo) amp.connect(echo);
    osc.start(start);
    osc.stop(start + options.duration + 0.02);
  }

  private noise(duration: number, gain: number, cutoff: number, delay = 0, filterType: BiquadFilterType = 'lowpass'): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = cutoff;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    source.connect(filter).connect(amp).connect(master);
    source.start(ctx.currentTime + delay);
  }

  /** `strength` (0..1) is how hard the thing is done, for the sounds that have a soft and a loud way of being made. */
  play(sound: Sound, delay = 0, strength = 1): void {
    const r = this.root;
    switch (sound) {
      case 'step':
        this.noise(0.05, 0.12, 1400 + Math.random() * 500, delay);
        this.tone({ freq: 150 + Math.random() * 30, to: 90, duration: 0.06, type: 'triangle', gain: 0.1, delay });
        break;
      case 'hop':
        this.tone({ freq: r * 1.5, to: r * 2.25, duration: 0.12, type: 'triangle', gain: 0.14, delay });
        break;
      case 'land':
        this.tone({ freq: 140, to: 55, duration: 0.14, gain: 0.3, delay });
        this.noise(0.09, 0.16, 700, delay);
        break;
      case 'bump':
        this.tone({ freq: 110, to: 80, duration: 0.07, type: 'square', gain: 0.06, delay });
        break;
      case 'push':
        this.noise(0.16, 0.18, 500, delay);
        break;
      case 'slide':
        // Ice under soles or under a crate: a thin hiss, all in the high end, played again while the slide lasts.
        this.noise(0.22, 0.03 + 0.07 * strength, 4200 + 2600 * strength, delay, 'bandpass');
        this.tone({ freq: r * 8, to: r * 7.6, duration: 0.2, gain: 0.006 + 0.012 * strength, delay });
        break;
      case 'fall':
        this.tone({ freq: r * 3, to: r * 0.5, duration: 0.5, type: 'triangle', gain: 0.16, delay, echo: true });
        break;
      case 'wait':
        this.tone({ freq: r * 2, duration: 0.05, gain: 0.05, delay });
        break;
      case 'to1d':
        // Folding down: everything narrows to one high thread.
        this.tone({ freq: r * 2, to: r * 6, duration: 0.35, type: 'sine', gain: 0.18, delay, echo: true });
        this.tone({ freq: r * 3, to: r * 6, duration: 0.35, type: 'sine', gain: 0.1, delay });
        break;
      case 'to3d':
        // Unfolding: a chord opens out.
        [0, 7, 12, 16].forEach((n, i) =>
          this.tone({ freq: r * semitones(n), duration: 0.6, type: 'triangle', gain: 0.11, delay: delay + i * 0.045, echo: true }),
        );
        break;
      case 'to2d':
        this.tone({ freq: r * 3, to: r * 1.5, duration: 0.28, type: 'triangle', gain: 0.16, delay, echo: true });
        break;
      case 'plateOn':
        this.tone({ freq: r * 2, duration: 0.09, type: 'square', gain: 0.06, delay });
        this.tone({ freq: r * 3, duration: 0.25, gain: 0.12, delay: delay + 0.05, echo: true });
        break;
      case 'plateOff':
        this.tone({ freq: r * 3, to: r * 2, duration: 0.16, gain: 0.1, delay });
        break;
      case 'lever':
        this.tone({ freq: 90, to: 60, duration: 0.07, type: 'square', gain: 0.12, delay });
        this.tone({ freq: r * 4, duration: 0.3, type: 'triangle', gain: 0.1, delay: delay + 0.04, echo: true });
        break;
      case 'crumble':
        this.noise(0.28, 0.22, 900, delay);
        this.tone({ freq: 120, to: 45, duration: 0.3, gain: 0.16, delay });
        break;
      case 'rewind':
        for (let i = 0; i < 9; i++) {
          this.tone({ freq: r * semitones(this.scale[8 - i - 1] ?? 0) * 2, duration: 0.07, type: 'square', gain: 0.05, delay: delay + i * 0.055 });
        }
        this.tone({ freq: r * 4, to: r * 0.5, duration: 0.6, type: 'sawtooth', gain: 0.05, delay });
        break;
      case 'undo':
        this.tone({ freq: r * 2, to: r * 1.5, duration: 0.08, type: 'triangle', gain: 0.1, delay });
        break;
      case 'win':
        [0, 4, 7, 12, 16].forEach((n, i) =>
          this.tone({ freq: r * 2 * semitones(n), duration: 0.5, type: 'triangle', gain: 0.15, delay: delay + i * 0.09, echo: true }),
        );
        break;
      case 'select':
        this.tone({ freq: r * 2, to: r * 3, duration: 0.1, type: 'triangle', gain: 0.12, delay, echo: true });
        break;
    }
  }

  /** A wandering pentatonic line: never the same twice, never in the way. */
  private playMelodyNote(): void {
    if (this.ctx === null || this.muted || this.ctx.state !== 'running') return;
    if (Math.random() < 0.25) return;
    this.note = Math.max(0, Math.min(this.scale.length - 1, this.note + Math.round(Math.random() * 4 - 2)));
    const freq = this.root * semitones(this.scale[this.note] ?? 0);
    this.tone({ freq, duration: 2.2, gain: 0.05, echo: true });
    if (Math.random() < 0.3) this.tone({ freq: freq * 1.5, duration: 1.8, gain: 0.025, delay: 0.5, echo: true });
    this.tone({ freq: this.root / 2, duration: 2.4, gain: 0.03 });
  }
}
