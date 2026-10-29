import { audioContext } from './audio-context';
import { checkAudioAbort, waitForAudio, yieldAudio } from './audio-work';
import type { AudioWorkOptions } from './audio-work';
export { audioContext } from './audio-context';
export { decodeFile } from './audio-decode';
export { Transport } from './audio-transport';

export const SAMPLE_RATE = 22050;
function writeMono(buffer: AudioBuffer, output: Float32Array, from: number, to: number, ratio: number, origin = 0): void {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = from; i < to; i++) {
    // Keep the global fractional sample phase across chunk boundaries.
    const start = Math.floor(i * ratio) - origin;
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((i + 1) * ratio) - origin));
    let sum = 0;
    for (const channel of channels) for (let j = start; j < end; j++) sum += channel[j];
    output[i] = sum / ((end - start) * channels.length);
  }
}

export function toMono(buffer: AudioBuffer): Float32Array {
  const output = new Float32Array(Math.floor(buffer.duration * SAMPLE_RATE));
  writeMono(buffer, output, 0, output.length, buffer.sampleRate / SAMPLE_RATE);
  return output;
}

async function renderAudioWindow(buffer: AudioBuffer, from: number, length: number, rate: number, signal?: AbortSignal): Promise<AudioBuffer> {
  checkAudioAbort(signal);
  const offline = new OfflineAudioContext(1, length, rate);
  const source = offline.createBufferSource(); source.buffer = buffer;
  const filters: BiquadFilterNode[] = []; let tail: AudioNode = source;
  if (buffer.sampleRate > SAMPLE_RATE) for (let pole = 0; pole < 4; pole++) {
    const filter = offline.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = SAMPLE_RATE * 0.45;
    const q = 1 / (2 * Math.cos((2 * pole + 1) * Math.PI / 16));
    // Web Audio lowpass Q is in dB, unlike its bandpass/peaking Q.
    filter.Q.value = 20 * Math.log10(q);
    tail.connect(filter); tail = filter; filters.push(filter);
  }
  try {
    tail.connect(offline.destination); source.start(0, from / buffer.sampleRate);
    return await waitForAudio(offline.startRendering(), signal, { ms: 45000, message: '音频预处理连续 45 秒没有响应，请重试或更换音频。' });
  }
  finally {
    try { source.stop(); } catch { /* Already stopped or rendering failed. */ }
    source.disconnect(); source.buffer = null; filters.forEach(filter => filter.disconnect());
  }
}

/** Keep the native eight-pole anti-alias filter at the ORIGINAL rate. Four
 * second windows with 50 ms of filter history bound temporary high-rate PCM;
 * the output windows retain their global sample indices and timing. */
export async function prepareMono(buffer: AudioBuffer, options: AudioWorkOptions = {}): Promise<Float32Array> {
  const { signal, progress } = options;
  checkAudioAbort(signal); progress?.(0, '正在准备音频分析');
  const length = Math.floor(buffer.duration * SAMPLE_RATE), ratio = buffer.sampleRate / SAMPLE_RATE;
  const native = typeof OfflineAudioContext !== 'undefined';
  // Native upsampling keeps its uninterrupted interpolation phase. This path
  // only renders at 22.05 kHz, so it has no full high-rate temporary buffer.
  if (native && ratio < 1) {
    const rendered = await renderAudioWindow(buffer, 0, length, SAMPLE_RATE, signal);
    checkAudioAbort(signal); progress?.(1, '音频准备完成'); return rendered.getChannelData(0);
  }
  const output = new Float32Array(length), chunk = SAMPLE_RATE * 4;
  for (let from = 0; from < length; from += chunk) {
    checkAudioAbort(signal);
    const to = Math.min(length, from + chunk);
    if (native && ratio > 1) {
      const origin = Math.max(0, Math.floor(from * ratio) - Math.ceil(buffer.sampleRate * 0.05));
      const end = Math.min(buffer.length, Math.max(Math.floor(to * ratio), Math.floor((to - 1) * ratio) + 1));
      const rendered = await renderAudioWindow(buffer, origin, end - origin, buffer.sampleRate, signal);
      checkAudioAbort(signal); writeMono(rendered, output, from, to, ratio, origin);
    } else writeMono(buffer, output, from, to, ratio);
    progress?.(to / length, `正在准备音频分析 ${Math.round(to / length * 100)}%`);
    if (to < length) await yieldAudio(signal);
  }
  checkAudioAbort(signal); return output;
}

// An original, deterministic 128 BPM synth loop; no downloaded music or assets.
export function createDemo(): AudioBuffer {
  const rate = 44100, bpm = 128, beat = 60 / bpm, bars = 24, lead = 0.65;
  const buffer = audioContext().createBuffer(1, Math.ceil((lead + bars * 4 * beat + 1.2) * rate), rate);
  const data = buffer.getChannelData(0);
  let seed = 7241;
  const noise = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 2147483648 - 1; };
  const add = (at: number, duration: number, sample: (t: number) => number) => {
    const start = Math.round(at * rate), count = Math.min(Math.round(duration * rate), data.length - start);
    for (let i = 0; i < count; i++) data[start + i] += sample(i / rate);
  };
  const chordRoots = [45, 41, 48, 43];
  for (let bar = 0; bar < bars; bar++) {
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
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * 1.1) * Math.min(1, (data.length - i) / rate / 0.8);
  return buffer;
}
