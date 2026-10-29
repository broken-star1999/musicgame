import { audioContext } from './audio-context';
import { checkAudioAbort, waitForAudio } from './audio-work';
import type { AudioWorkOptions } from './audio-work';

let decodeTail: Promise<void> = Promise.resolve(), pendingDecodes = 0;
const DECODE_TIMEOUT = 45000;
const abortError = () => new DOMException('Audio decoding cancelled', 'AbortError');

/** Metadata probing is bounded and owns its object URL until every exit path. */
function inspectDuration(file: File, signal: AbortSignal): Promise<number | undefined> {
  checkAudioAbort(signal);
  return new Promise((resolve, reject) => {
    const media = new Audio(), url = URL.createObjectURL(file);
    let finished = false, timer: ReturnType<typeof setTimeout>;
    const finish = (duration?: number, error?: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', aborted);
      media.onloadedmetadata = null; media.onerror = null;
      try { media.removeAttribute('src'); media.load(); } catch { /* Cleanup must still revoke the URL. */ }
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    const aborted = () => finish(undefined, abortError());
    signal.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(), 8000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : undefined);
    media.onerror = () => finish();
    if (signal.aborted) aborted();
    else try { media.src = url; } catch { finish(); }
  });
}

function readAudioFile(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  checkAudioAbort(signal);
  if (typeof FileReader === 'undefined') return file.arrayBuffer().then(bytes => { checkAudioAbort(signal); return bytes; });
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); let finished = false;
    const finish = (action: () => void) => {
      if (finished) return;
      finished = true; signal.removeEventListener('abort', aborted);
      reader.onload = null; reader.onerror = null; reader.onabort = null; action();
    };
    const aborted = () => {
      finish(() => reject(abortError()));
      if (reader.readyState === 1) try { reader.abort(); } catch { /* The logical cancellation already completed. */ }
    };
    reader.onload = () => finish(() => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Audio file reading failed')));
    reader.onerror = () => finish(() => reject(reader.error ?? new Error('Audio file reading failed')));
    reader.onabort = () => finish(() => reject(abortError()));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else try { reader.readAsArrayBuffer(file); } catch (error) { finish(() => reject(error)); }
  });
}

/** A caller can stop waiting immediately, but decodeAudioData has no abort
 * parameter. Its reservation remains held until the real native work settles. */
export async function decodeFile(file: File, options: AudioWorkOptions = {}): Promise<AudioBuffer> {
  checkAudioAbort(options.signal);
  if (file.size > 50 * 1024 * 1024) throw new Error('文件超过 50 MB，请选择小一些的音频。');
  if (!/\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name)) throw new Error('请选择 MP3、WAV、M4A、OGG 或 FLAC 格式的音频。');
  const controller = new AbortController(), aborted = () => controller.abort();
  options.signal?.addEventListener('abort', aborted, { once: true });
  if (options.signal?.aborted) controller.abort();
  let release: (() => void) | undefined, nativeStarted = false;
  try {
    options.progress?.(0, '正在检查音频时长');
    const duration = await inspectDuration(file, controller.signal);
    checkAudioAbort(controller.signal);
    if (duration !== undefined && duration > 300) throw new Error('音乐超过 5 分钟，请先截取到 5 分钟以内。');
    const waiting = pendingDecodes > 0, previous = decodeTail;
    let released = false;
    const reserved = new Promise<void>(resolve => {
      release = () => { if (released) return; released = true; pendingDecodes--; resolve(); };
    });
    pendingDecodes++;
    // A cancelled waiter resolves its own reservation without bypassing the
    // previous native decode: subsequent callers still wait for previous.
    decodeTail = previous.then(() => reserved);
    const deadline = performance.now() + DECODE_TIMEOUT;
    if (waiting) options.progress?.(0, '正在等待前一首音频解码结束');
    await waitForAudio(previous, controller.signal, { ms: DECODE_TIMEOUT, message: '前一首音频解码仍未结束（45 秒），请刷新页面后重试。' });
    checkAudioAbort(controller.signal);
    const work = (async () => {
      let buffer: AudioBuffer;
      try {
        options.progress?.(0.01, '正在读取本地音频');
        const bytes = await readAudioFile(file, controller.signal);
        checkAudioAbort(controller.signal);
        options.progress?.(0.02, '正在解码你的音乐');
        buffer = await audioContext().decodeAudioData(bytes);
        checkAudioAbort(controller.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new Error('浏览器无法解码这段音频，请试试 MP3 或 WAV 文件。');
      }
      if (buffer.duration > 300) throw new Error('音乐超过 5 分钟，请先截取到 5 分钟以内。');
      if (buffer.duration < 2) throw new Error('音频太短，请选择至少 2 秒的音乐。');
      return buffer;
    })();
    nativeStarted = true;
    void work.then(release, release);
    return await waitForAudio(work, controller.signal, { ms: Math.max(1, deadline - performance.now()), message: '音频读取或解码超过 45 秒，请换一首或刷新页面后重试。' });
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', aborted);
    if (!nativeStarted) release?.();
  }
}
