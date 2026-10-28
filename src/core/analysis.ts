import type { Analysis, Onset } from '../types';
import FFT from 'fft.js';

export function fingerprint(samples: Float32Array): string {
  let hash = 2166136261;
  for (let i = 0; i < samples.length; i += 31) {
    hash = Math.imul(hash ^ Math.round(samples[i] * 32767), 16777619);
  }
  return `${samples.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

export function estimateTempo(onsets: Onset[]): { bpm: number; confidence: number } {
  if (onsets.length < 4) return { bpm: 120, confidence: 0 };
  const scores = new Float64Array(201);
  // A weighted inter-onset histogram tolerates subdivisions and missing beats.
  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j < Math.min(i + 10, onsets.length); j++) {
      const delta = onsets[j].time - onsets[i].time;
      if (delta < 0.2 || delta > 3) continue;
      let bpm = 60 / delta;
      while (bpm < 80) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const weight = Math.sqrt(onsets[i].strength * onsets[j].strength) / Math.sqrt(j - i);
      for (let k = Math.max(60, Math.floor(bpm - 3)); k <= Math.min(200, Math.ceil(bpm + 3)); k++) {
        scores[k] += weight * Math.exp(-0.5 * ((k - bpm) / 1.3) ** 2);
      }
    }
  }
  let best = 120;
  for (let k = 80; k <= 180; k++) if (scores[k] > scores[best]) best = k;
  const beat = 60 / best;
  const anchor = onsets.reduce((a, b) => a.strength > b.strength ? a : b).time;
  let aligned = 0, total = 0;
  for (const onset of onsets) {
    const phase = (onset.time - anchor) / (beat / 2);
    const err = Math.abs(phase - Math.round(phase)) * beat / 2;
    aligned += onset.strength * Math.exp(-0.5 * (err / 0.045) ** 2);
    total += onset.strength;
  }
  return { bpm: best, confidence: Math.min(1, aligned / Math.max(total, 1e-8)) };
}

export function analyzeAudio(samples: Float32Array, sampleRate: number, progress?: (value: number, stage: string) => void): Analysis {
  const n = 1024, hop = Math.round(sampleRate * 0.01);
  const frames = Math.max(0, Math.floor((samples.length - n) / hop) + 1);
  if (!frames) throw new Error('音频太短，请选择至少 2 秒的音乐。');
  const flux = new Float64Array(frames), rms = new Float64Array(frames), bands = new Uint8Array(frames);
  const transform = new FFT(n), input = new Float64Array(n), spectrum = transform.createComplexArray();
  const previous = new Float64Array(n / 2);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  let maxRms = 0, maxFlux = 0;
  for (let f = 0; f < frames; f++) {
    let square = 0;
    for (let j = 0; j < n; j++) { const x = samples[f * hop + j]; input[j] = x * window[j]; square += x * x; }
    rms[f] = Math.sqrt(square / n); maxRms = Math.max(maxRms, rms[f]);
    transform.realTransform(spectrum, input);
    const bandFlux = [0, 0, 0];
    for (let k = 1; k < n / 2; k++) {
      const magnitude = Math.log1p(Math.hypot(spectrum[k * 2], spectrum[k * 2 + 1]));
      const difference = Math.max(0, magnitude - previous[k]);
      const freq = k * sampleRate / n;
      bandFlux[freq < 250 ? 0 : freq < 2500 ? 1 : 2] += difference;
      previous[k] = magnitude;
    }
    // Equalize the number of bins so the high band does not dominate all songs.
    bandFlux[0] *= 3; bandFlux[1] *= 1.3; bandFlux[2] *= 0.65;
    flux[f] = bandFlux[0] + bandFlux[1] + bandFlux[2]; maxFlux = Math.max(maxFlux, flux[f]);
    bands[f] = bandFlux.indexOf(Math.max(...bandFlux));
    if (f % 256 === 0) progress?.(0.05 + f / frames * 0.72, '正在寻找声音起点');
  }
  if (maxRms < 0.0005 || maxFlux < 0.001) throw new Error('这段音频接近静音，没有检测到可用的节奏。');
  progress?.(0.8, '正在估计节拍');
  const onsets: Onset[] = [];
  for (let f = 1; f < frames - 2; f++) {
    if (flux[f] < flux[f - 1] || flux[f] <= flux[f + 1] || rms[f] < Math.max(0.0008, maxRms * 0.025)) continue;
    const local = Array.from(flux.slice(Math.max(0, f - 20), Math.min(frames, f + 16))).sort((a, b) => a - b);
    const median = local[Math.floor(local.length / 2)];
    if (flux[f] < median * 1.65 + maxFlux * 0.018 || flux[f] < maxFlux * 0.035) continue;
    const time = Math.max(0, (f * hop + n * 0.22) / sampleRate);
    const onset = { time, strength: flux[f] / maxFlux, band: bands[f] };
    const last = onsets[onsets.length - 1];
    if (last && time - last.time < 0.085) { if (onset.strength > last.strength) onsets[onsets.length - 1] = onset; }
    else onsets.push(onset);
  }
  if (onsets.length < 3) throw new Error('没有找到足够的声音起点，试试鼓点更清楚的音乐。');
  const tempo = estimateTempo(onsets);
  const energy: number[] = [];
  for (let i = 0; i < frames; i += 5) energy.push(rms[i] / maxRms);
  const waveform: number[] = [];
  const step = Math.max(1, Math.floor(samples.length / 160));
  for (let i = 0; i < 160; i++) {
    let sum = 0, count = 0;
    for (let j = i * step; j < Math.min(samples.length, (i + 1) * step); j += 8) { sum += samples[j] ** 2; count++; }
    waveform.push(Math.sqrt(sum / Math.max(count, 1)));
  }
  const maxWave = Math.max(...waveform, 0.0001);
  progress?.(1, '谱面分析完成');
  return { duration: samples.length / sampleRate, ...tempo, onsets, energy, energyStep: hop * 5 / sampleRate, waveform: waveform.map(x => x / maxWave), fingerprint: fingerprint(samples) };
}
