type Ctx = AudioContext;

export class AudioBus {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.now(), 0.01);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  resume(): void {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private envelope(start: number, attack: number, hold: number, release: number, peak: number): GainNode | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.setValueAtTime(peak, start + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
    return g;
  }

  private tone(
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    duration: number,
    peak: number,
    attack = 0.005,
    hold = 0.02,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const start = this.now();
    const release = Math.max(0.02, duration - attack - hold);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, start);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + duration);
    }
    const env = this.envelope(start, attack, hold, release, peak);
    if (!env) return;
    osc.connect(env).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private noise(duration: number, peak: number, lowpassHz: number, attack = 0.002, hold = 0.005): void {
    if (!this.ctx || !this.master || this.muted) return;
    const start = this.now();
    const length = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpassHz;
    const release = Math.max(0.02, duration - attack - hold);
    const env = this.envelope(start, attack, hold, release, peak);
    if (!env) return;
    src.connect(filter).connect(env).connect(this.master);
    src.start(start);
    src.stop(start + duration + 0.05);
  }

  private arpeggio(freqs: number[], step: number, type: OscillatorType, peak: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const start = this.now();
    freqs.forEach((f, i) => {
      const t = start + i * step;
      const osc = this.ctx!.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.95);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + step + 0.05);
    });
  }

  playCrumb(): void {
    const wobble = 1 + (Math.random() - 0.5) * 0.32;
    this.tone("sine", 620 * wobble, 920 * wobble, 0.09, 0.22, 0.005, 0.01);
  }

  playLifeUp(): void {
    this.arpeggio([523.25, 659.25, 783.99], 0.07, "triangle", 0.28);
  }

  playGem(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const start = this.now();
    for (const detune of [-12, 0, 14]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, start);
      osc.frequency.exponentialRampToValueAtTime(1320, start + 0.18);
      osc.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(g).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.25);
    }
  }

  playTrap(): void {
    this.noise(0.08, 0.4, 4500, 0.001, 0.006);
    this.tone("triangle", 180, 70, 0.14, 0.32, 0.002, 0.01);
  }

  playHazard(): void {
    this.tone("sawtooth", 160, 60, 0.35, 0.32, 0.005, 0.04);
  }

  playCatAlert(): void {
    this.tone("sawtooth", 220, 150, 0.22, 0.24, 0.01, 0.04);
    this.noise(0.12, 0.08, 1200, 0.005, 0.02);
  }

  playCatLost(): void {
    this.tone("sine", 300, 520, 0.22, 0.18, 0.01, 0.03);
  }

  playLevelComplete(): void {
    this.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.09, "triangle", 0.28);
  }

  playGameOver(): void {
    this.arpeggio([523.25, 415.3, 311.13, 233.08], 0.16, "sawtooth", 0.22);
  }

  tickFootstep(): void {
    this.noise(0.04, 0.06, 800, 0.001, 0.004);
  }
}
