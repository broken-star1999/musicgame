import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readers: FakeReader[] = [], media: FakeAudio[] = [];
class FakeReader {
  static auto = true;
  readyState = 0; result: ArrayBuffer | null = null; error: DOMException | null = null;
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  file?: File;
  constructor() { readers.push(this); }
  readAsArrayBuffer = vi.fn((file: File) => { this.file = file; this.readyState = 1; if (FakeReader.auto) queueMicrotask(() => this.complete()); });
  complete() { if (this.readyState !== 1) return; this.readyState = 2; this.result = new ArrayBuffer(8); this.onload?.(); }
  abort = vi.fn(() => { this.readyState = 2; this.onabort?.(); });
}
class FakeAudio {
  static auto = true; static duration = 12;
  duration = FakeAudio.duration; preload = '';
  onloadedmetadata: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor() { media.push(this); }
  set src(_url: string) { if (FakeAudio.auto) queueMicrotask(() => this.onloadedmetadata?.()); }
  removeAttribute = vi.fn(); load = vi.fn();
}
const buffer = (duration = 12) => ({ duration } as AudioBuffer);
let decode: ReturnType<typeof vi.fn<(input: ArrayBuffer) => Promise<AudioBuffer>>>;
let decodeFile: typeof import('./audio-decode')['decodeFile'];
const file = (name = 'song.flac') => new File([new Uint8Array(8)], name);
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred<T>() { let resolve: (value: T) => void, reject: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve: resolve!, reject: reject! }; }

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); readers.length = 0; media.length = 0;
  FakeAudio.auto = true; FakeAudio.duration = 12; FakeReader.auto = true;
  decode = vi.fn(async () => buffer());
  vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('FileReader', FakeReader);
  vi.stubGlobal('AudioContext', class { decodeAudioData = decode; });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:audio-${media.length}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  ({ decodeFile } = await import('./audio-decode'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('cancellable serialized local audio decoding', () => {
  it('decodes supported music and revokes its metadata URL once', async () => {
    const progress = vi.fn();
    expect((await decodeFile(file(), { progress })).duration).toBe(12);
    expect(decode).toHaveBeenCalledOnce(); expect(readers).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); expect(media[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(media[0].onloadedmetadata).toBeNull(); expect(media[0].onerror).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    expect(progress.mock.calls.map(call => call[1])).toEqual(['正在检查音频时长', '正在读取本地音频', '正在解码你的音乐']);
  });

  it('cancels metadata probing promptly without reading or decoding', async () => {
    FakeAudio.auto = false; const controller = new AbortController();
    const loading = decodeFile(file(), { signal: controller.signal }), failure = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await failure;
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); expect(readers).toHaveLength(0); expect(decode).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a failed or timed-out metadata probe and still tries the decoder', async () => {
    FakeAudio.auto = false;
    const loading = decodeFile(file()); await vi.advanceTimersByTimeAsync(8000);
    expect((await loading).duration).toBe(12); expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    const next = decodeFile(file()); media[1].onerror?.(); expect((await next).duration).toBe(12);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid input before any metadata or PCM allocation', async () => {
    const oversized = { size: 50 * 1024 * 1024 + 1, name: 'huge.wav' } as File;
    await expect(decodeFile(oversized)).rejects.toThrow(/50 MB/);
    await expect(decodeFile(file('image.png'))).rejects.toThrow(/请选择/);
    const controller = new AbortController(); controller.abort();
    await expect(decodeFile(file(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
  });

  it('rejects over-limit metadata before file reading, and checks decoded duration too', async () => {
    FakeAudio.duration = 301; await expect(decodeFile(file())).rejects.toThrow(/5 分钟/);
    expect(readers).toHaveLength(0); expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    FakeAudio.duration = 12; decode.mockResolvedValueOnce(buffer(301));
    await expect(decodeFile(file())).rejects.toThrow(/5 分钟/);
    decode.mockResolvedValueOnce(buffer(1.99)); await expect(decodeFile(file())).rejects.toThrow(/太短/);
    decode.mockResolvedValueOnce(buffer(2)); expect((await decodeFile(file())).duration).toBe(2);
    decode.mockResolvedValueOnce(buffer(300)); expect((await decodeFile(file())).duration).toBe(300);
  });

  it('aborts a FileReader and does not start native decoding', async () => {
    FakeReader.auto = false; const controller = new AbortController();
    const loading = decodeFile(file(), { signal: controller.signal }), failure = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await tick(); expect(readers).toHaveLength(1);
    controller.abort(); await failure; await tick();
    expect(readers[0].abort).toHaveBeenCalledOnce(); expect(readers[0].onload).toBeNull(); expect(decode).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('retains a cancelled native decode reservation until it actually finishes', async () => {
    const first = deferred<AudioBuffer>(); decode.mockReturnValueOnce(first.promise);
    const controller = new AbortController(), loading = decodeFile(file('first.wav'), { signal: controller.signal });
    const failure = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await tick(); expect(decode).toHaveBeenCalledOnce(); controller.abort(); await failure;
    const progress = vi.fn(), replacement = decodeFile(file('replacement.wav'), { progress });
    await tick(); expect(readers).toHaveLength(1); expect(decode).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(0, '正在等待前一首音频解码结束');
    first.resolve(buffer(22)); expect((await replacement).duration).toBe(12); expect(decode).toHaveBeenCalledTimes(2); expect(readers[1].file?.name).toBe('replacement.wav');
  });

  it('skips cancelled waiters without bypassing the earlier native decode', async () => {
    const first = deferred<AudioBuffer>(); decode.mockReturnValueOnce(first.promise);
    const initial = decodeFile(file('first.wav')); await tick();
    const controller = new AbortController(), cancelled = decodeFile(file('cancelled.wav'), { signal: controller.signal });
    const failure = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await tick(); controller.abort(); await failure;
    const last = decodeFile(file('last.wav')); await tick();
    expect(readers).toHaveLength(1); expect(decode).toHaveBeenCalledOnce();
    first.resolve(buffer()); await initial; await last;
    expect(readers.map(reader => reader.file?.name)).toEqual(['first.wav', 'last.wav']); expect(decode).toHaveBeenCalledTimes(2);
  });

  it('bounds callers at 45 seconds without allowing a second native decode to overlap', async () => {
    const native = deferred<AudioBuffer>(); decode.mockReturnValueOnce(native.promise);
    const old = decodeFile(file('old.wav')), oldFailure = expect(old).rejects.toThrow(/45 秒/);
    await tick(); await vi.advanceTimersByTimeAsync(45000); await oldFailure;
    const pending = decodeFile(file('waiting.wav')), pendingFailure = expect(pending).rejects.toThrow(/前一首.*45 秒/);
    await vi.advanceTimersByTimeAsync(45000); await pendingFailure;
    expect(readers).toHaveLength(1); expect(decode).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    native.resolve(buffer()); await tick(); expect((await decodeFile(file('recovered.wav'))).duration).toBe(12);
    expect(readers.map(reader => reader.file?.name)).toEqual(['old.wav', 'recovered.wav']);
  });

  it('uses a shared wait/read/decode deadline instead of restarting the 45 second budget', async () => {
    const old = deferred<AudioBuffer>(), next = deferred<AudioBuffer>(); decode.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const initial = decodeFile(file()); await tick();
    const loading = decodeFile(file()), failure = expect(loading).rejects.toThrow(/45 秒/);
    await vi.advanceTimersByTimeAsync(30000); old.resolve(buffer()); await initial; await tick();
    expect(decode).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000); await failure; next.resolve(buffer()); await tick(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the non-FileReader fallback reservation until its actual read settles', async () => {
    vi.stubGlobal('FileReader', undefined); const read = deferred<ArrayBuffer>(), first = file();
    Object.defineProperty(first, 'arrayBuffer', { value: () => read.promise });
    const controller = new AbortController(), loading = decodeFile(first, { signal: controller.signal });
    const failure = expect(loading).rejects.toMatchObject({ name: 'AbortError' }); await tick(); controller.abort(); await failure;
    const next = file(), arrayBuffer = vi.spyOn(next, 'arrayBuffer'); const replacement = decodeFile(next); await tick();
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
    read.resolve(new ArrayBuffer(8)); expect((await replacement).duration).toBe(12); expect(arrayBuffer).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce();
  });

  it('reports decoder failures but releases the queue for another file', async () => {
    decode.mockRejectedValueOnce(new DOMException('bad codec', 'EncodingError'));
    await expect(decodeFile(file())).rejects.toThrow(/浏览器无法解码/);
    expect((await decodeFile(file())).duration).toBe(12); expect(decode).toHaveBeenCalledTimes(2);
  });
});
