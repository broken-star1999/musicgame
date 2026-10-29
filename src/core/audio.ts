let context: AudioContext | undefined;
export function audioContext(): AudioContext {
  if (!context) context = new AudioContext();
  return context;
}

export const SAMPLE_RATE = 22050;
export function toMono(buffer: AudioBuffer): Float32Array {
  const length = Math.floor(buffer.duration * SAMPLE_RATE), ratio = buffer.sampleRate / SAMPLE_RATE;
  const output = new Float32Array(length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(buffer.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (const channel of channels) for (let j = start; j < end; j++) sum += channel[j];
    output[i] = sum / ((end - start) * channels.length);
  }
  return output;
}

/** Reject high frequencies BEFORE reducing the sample rate. AudioBufferSource
 * rate conversion alone is not assumed to provide an anti-aliasing filter. */
export async function prepareMono(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === SAMPLE_RATE || typeof OfflineAudioContext === 'undefined') return toMono(buffer);
  const reducing = buffer.sampleRate > SAMPLE_RATE, rate = reducing ? buffer.sampleRate : SAMPLE_RATE;
  const offline = new OfflineAudioContext(1, Math.floor(buffer.duration * rate), rate);
  const source = offline.createBufferSource(); source.buffer = buffer;
  const filters: BiquadFilterNode[] = []; let tail: AudioNode = source;
  if (reducing) for (let pole = 0; pole < 4; pole++) {
    const filter = offline.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = SAMPLE_RATE * 0.45;
    const q = 1 / (2 * Math.cos((2 * pole + 1) * Math.PI / 16));
    // Web Audio lowpass Q is in dB, unlike its bandpass/peaking Q.
    filter.Q.value = 20 * Math.log10(q);
    tail.connect(filter); tail = filter; filters.push(filter);
  }
  tail.connect(offline.destination); source.start();
  try { const rendered = await offline.startRendering(); return reducing ? toMono(rendered) : rendered.getChannelData(0); }
  finally { source.disconnect(); filters.forEach(filter => filter.disconnect()); }
}

async function inspectDuration(file: File): Promise<number | undefined> {
  // Probe compressed metadata before allocating a potentially large PCM buffer.
  return new Promise(resolve => {
    const media = new Audio(), url = URL.createObjectURL(file);
    const finish = (duration?: number) => {
      clearTimeout(timeout); media.onloadedmetadata = null; media.onerror = null;
      media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); resolve(duration);
    };
    const timeout = setTimeout(() => finish(), 8000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : undefined);
    media.onerror = () => finish();
    media.src = url;
  });
}

export async function decodeFile(file: File): Promise<AudioBuffer> {
  if (file.size > 50 * 1024 * 1024) throw new Error('文件超过 50 MB，请选择小一些的音频。');
  if (!/\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name)) throw new Error('请选择 MP3、WAV、M4A、OGG 或 FLAC 格式的音频。');
  const duration = await inspectDuration(file);
  if (duration !== undefined && duration > 300) throw new Error('音乐超过 5 分钟，请先截取到 5 分钟以内。');
  let buffer: AudioBuffer;
  try { buffer = await audioContext().decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error('浏览器无法解码这段音频，请试试 MP3 或 WAV 文件。'); }
  if (buffer.duration > 300) throw new Error('音乐超过 5 分钟，请先截取到 5 分钟以内。');
  if (buffer.duration < 2) throw new Error('音频太短，请选择至少 2 秒的音乐。');
  return buffer;
}

export class Transport {
  private source: AudioBufferSourceNode;
  private gain: GainNode;
  private startTime: number;
  private stopped = false;
  constructor(buffer: AudioBuffer, volume: number, lead = 2.5) {
    const ctx = audioContext();
    this.source = ctx.createBufferSource(); this.source.buffer = buffer;
    this.gain = ctx.createGain(); this.gain.gain.value = volume;
    this.source.connect(this.gain); this.gain.connect(ctx.destination);
    this.startTime = ctx.currentTime + lead;
    this.source.start(this.startTime);
  }
  time() { return audioContext().currentTime - this.startTime; }
  async pause() { await audioContext().suspend(); }
  async resume() { await audioContext().resume(); }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.source.stop(); this.source.disconnect(); this.gain.disconnect();
  }
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
