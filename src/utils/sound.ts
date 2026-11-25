/**
 * Lightweight Web Audio synthesizer for UI micro-interaction sound effects.
 * Safely no-ops on SSR or restricted autoplay contexts.
 */
class SoundFXEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined' || this.muted) return null;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private playTone(freq: number, durationMs: number, type: OscillatorType = 'sine', gainPeak = 0.04, delaySec = 0) {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime + delaySec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durationMs / 1000 + 0.02);
    } catch {
      // Ignore audio context errors
    }
  }

  playClick() {
    this.playTone(540, 45, 'triangle', 0.03);
  }

  playSuccess() {
    this.playTone(587.33, 80, 'sine', 0.04, 0);
    this.playTone(880, 120, 'sine', 0.045, 0.07);
  }

  playCoin() {
    this.playTone(987.77, 70, 'sine', 0.045, 0);
    this.playTone(1318.51, 140, 'sine', 0.05, 0.06);
  }

  playError() {
    this.playTone(220, 140, 'sawtooth', 0.03, 0);
  }

  playToggle() {
    this.playTone(460, 50, 'sine', 0.03);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}

export const soundFX = new SoundFXEngine();
