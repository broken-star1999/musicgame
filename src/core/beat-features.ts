import FFT from 'fft.js';
import config from './beat-model-config.json';

/** Exact preprocessing for the published model: periodic Hann, centered
 * reflect padding, magnitude / sqrt(FFT length), frozen Slaney mel filters. */
export function beatSpectrogram(samples: Float32Array, progress?: (value: number) => void): { data: Float32Array; frames: number } {
  const size = config.fftSize, hop = config.hop, bins = config.melBins;
  const frames = Math.floor(samples.length / hop) + 1;
  const data = new Float32Array(frames * bins), fft = new FFT(size);
  const input = new Float64Array(size), spectrum = fft.createComplexArray(), magnitude = new Float64Array(size / 2 + 1);
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const filters = config.filters as [number, number[]][];
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop - size / 2;
    for (let i = 0; i < size; i++) {
      let index = start + i;
      if (index < 0) index = -index;
      if (index >= samples.length) index = samples.length * 2 - index - 2;
      input[i] = (samples[index] || 0) * window[i];
    }
    fft.realTransform(spectrum, input);
    for (let bin = 0; bin <= size / 2; bin++) magnitude[bin] = Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]) / Math.sqrt(size);
    for (let band = 0; band < bins; band++) {
      const [first, weights] = filters[band];
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += weights[k] * magnitude[first + k];
      data[frame * bins + band] = Math.log1p(1000 * sum);
    }
    if (frame % 128 === 0) progress?.(frame / frames);
  }
  progress?.(1);
  return { data, frames };
}

/** Same split and edge handling as the original 1500-frame inference path. */
export function beatChunks(frames: number): { start: number; length: number }[] {
  const size = config.frames, border = config.border, stride = size - 2 * border;
  const starts: number[] = [];
  for (let start = -border; start < frames - border; start += stride) starts.push(start);
  if (frames > stride) starts[starts.length - 1] = frames - (size - border);
  return starts.map(start => ({ start, length: Math.min(size, frames - Math.max(start, 0) + Math.max(0, -start) + border) }));
}
