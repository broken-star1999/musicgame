import { DEMO_FRAMES, DEMO_SAMPLE_RATE, synthesizeDemo } from './demo-synthesis';
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
  const buffer = audioContext().createBuffer(1, DEMO_FRAMES, DEMO_SAMPLE_RATE);
  synthesizeDemo(buffer.getChannelData(0));
  return buffer;
}
