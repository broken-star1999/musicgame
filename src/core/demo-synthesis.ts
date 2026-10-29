export const DEMO_SAMPLE_RATE = 44100;
export const DEMO_FRAMES = Math.ceil((0.65 + 24 * 4 * (60 / 128) + 1.2) * DEMO_SAMPLE_RATE);

/** Fill the caller's PCM in place. Musical operations and RNG order match the
 * original synchronous demo exactly; no Web Audio or DOM APIs are used. */
export function synthesizeDemo(data: Float32Array, progress?: (value: number, stage: string) => void): void {
  if (data.length !== DEMO_FRAMES) throw new Error('演示曲音频长度无效。');
  data.fill(0);
  const rate = DEMO_SAMPLE_RATE, bpm = 128, beat = 60 / bpm, bars = 24, lead = 0.65;
  let seed = 7241;
  const noise = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 2147483648 - 1; };
  const add = (at: number, duration: number, sample: (t: number) => number) => {
    const start = Math.round(at * rate), count = Math.min(Math.round(duration * rate), data.length - start);
    for (let i = 0; i < count; i++) data[start + i] += sample(i / rate);
  };
  const chordRoots = [45, 41, 48, 43];
  for (let bar = 0; bar < bars; bar++) {
    progress?.(bar / bars * 0.85, `正在合成演示曲 ${bar + 1}/${bars} 乐段`);
    const root = chordRoots[Math.floor(bar / 2) % 4];
    const breakdown = bar >= 12 && bar < 16;
    if (breakdown) {
      const padFreq = 440 * 2 ** ((root + 12 - 69) / 12), padDuration = beat * 3.9;
      add(lead + bar * 4 * beat, padDuration, t => (Math.sin(t * 2 * Math.PI * padFreq) + Math.sin(t * 2 * Math.PI * padFreq * 1.5) * 0.45) * Math.min(1, t * 20, (padDuration - t) * 12) * 0.2);
    }
    for (let b = 0; b < 4; b++) {
      const at = lead + (bar * 4 + b) * beat;
      if (!breakdown || b === 0) add(at, 0.28, t => Math.sin(2 * Math.PI * (46 * t + 2.8 * (1 - Math.exp(-t * 34)))) * Math.exp(-t * 20) * 0.6);
      if (!breakdown && b % 2 === 1) add(at, 0.16, t => (noise() * 0.7 + Math.sin(t * 2 * Math.PI * 185) * 0.3) * Math.exp(-t * 28) * 0.24);
      if (!breakdown) for (let h = 0; h < 2; h++) add(at + h * beat / 2, 0.05, t => noise() * Math.exp(-t * 100) * (h ? 0.07 : 0.1));
      const frequency = 440 * 2 ** ((root - 69) / 12);
      add(at, beat * 0.83, t => (Math.sin(2 * Math.PI * frequency * t) + Math.sin(4 * Math.PI * frequency * t) * 0.25) * Math.min(1, t * 180) * Math.exp(-t * 5) * 0.2);
      const sequence = [0, 7, 12, 15, 12, 7, 10, 7];
      for (let s = 0; s < 2; s++) {
        const freq = 440 * 2 ** ((root + 24 + sequence[(b * 2 + s + bar % 2 * 2) % 8] - 69) / 12);
        add(at + s * beat / 2, breakdown ? 0.55 : 0.2, t => (Math.sin(t * 2 * Math.PI * freq) + 0.2 * Math.sin(t * 4 * Math.PI * freq)) * Math.min(1, t * 130) * Math.exp(-t * (breakdown ? 5 : 20)) * 0.14);
      }
    }
  }
  progress?.(0.9, '正在完成演示曲音色');
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * 1.1) * Math.min(1, (data.length - i) / rate / 0.8);
  progress?.(1, '演示曲合成完成');
}
