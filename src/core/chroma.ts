import FFT from 'fft.js';

/** Longer windows resolve semitones for phrase matching; the short-window
 * onset detector remains independent so transient timing is not blurred. */
export function extractTonalFeatures(samples: Float32Array, sampleRate: number, hop: number, rms: Float64Array): { chroma: number[][]; tonalEnergy: number[][] } {
  const size = 4096, fft = new FFT(size), input = new Float64Array(size), spectrum = fft.createComplexArray();
  const magnitude = new Float64Array(size / 2), pitch = Float64Array.from({ length: size / 2 }, (_, bin) => {
    const frequency = bin * sampleRate / size;
    return frequency >= 80 && frequency <= 4000 ? ((69 + 12 * Math.log2(frequency / 440)) % 12 + 12) % 12 : -1;
  });
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const output: number[][] = [], tonalEnergy: number[][] = [];
  for (let frame = 0; frame < rms.length; frame += 5) {
    const start = frame * hop - size / 2;
    for (let i = 0; i < size; i++) input[i] = (samples[start + i] || 0) * window[i];
    fft.realTransform(spectrum, input);
    for (let k = 1; k < size / 2; k++) magnitude[k] = Math.hypot(spectrum[k * 2], spectrum[k * 2 + 1]);
    const values = Array<number>(12).fill(0);
    for (let k = 3; k < size / 2 - 3; k++) {
      if (pitch[k] < 0) continue;
      const floor = (magnitude[k - 2] + magnitude[k - 1] + magnitude[k] + magnitude[k + 1] + magnitude[k + 2]) / 5;
      const salient = Math.max(0, magnitude[k] - floor * 0.8), power = salient * salient / Math.sqrt(k);
      const lower = Math.floor(pitch[k]), fraction = pitch[k] - lower;
      values[lower] += power * (1 - fraction); values[(lower + 1) % 12] += power * fraction;
    }
    const compressed = values.map(Math.sqrt), mean = compressed.reduce((a, b) => a + b, 0) / 12, norm = Math.hypot(...compressed);
    const contrast = Math.hypot(...compressed.map(value => value - mean)) / Math.max(1e-8, norm);
    tonalEnergy.push(compressed.map(value => rms[frame] > 0.001 && contrast > 0.18 ? value : 0));
    output.push(compressed.map(value => rms[frame] > 0.001 && contrast > 0.18 && norm > 1e-8 ? value / norm : 0));
  }
  return { chroma: output, tonalEnergy };
}

export function extractChroma(samples: Float32Array, sampleRate: number, hop: number, rms: Float64Array): number[][] {
  return extractTonalFeatures(samples, sampleRate, hop, rms).chroma;
}
