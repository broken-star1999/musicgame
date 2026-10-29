export class BeatResourceError extends Error {
  constructor(message: string) { super(message); this.name = 'BeatResourceError'; }
}

interface DownloadOptions {
  label: string;
  bytes: number;
  sha256: string;
  progress?: (received: number, total: number) => void;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/** Fetch and stream the decoded body, so gzip Content-Length never produces
 * false percentages. Both a stalled connection and a stalled body are bounded. */
export async function downloadBeatAsset(url: string | URL, options: DownloadOptions): Promise<Uint8Array> {
  const controller = new AbortController(), idleMs = options.idleTimeoutMs ?? 15000;
  let idle: ReturnType<typeof setTimeout>, deadline: ReturnType<typeof setTimeout>;
  let headersReceived = false, completed = false, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let failTimeout: (error: Error) => void;
  const timeout = new Promise<never>((_, reject) => { failTimeout = reject; });
  const fail = (message: string) => { failTimeout(new BeatResourceError(message)); controller.abort(); };
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => fail(headersReceived ? `${options.label}下载停滞（${idleMs / 1000} 秒没有新数据）` : `${options.label}连接超时`), idleMs);
  };
  resetIdle();
  deadline = setTimeout(() => fail(`${options.label}下载超时`), options.totalTimeoutMs ?? 90000);
  const download = async () => {
    options.progress?.(0, options.bytes);
    const response = await fetch(url, { signal: controller.signal }); headersReceived = true;
    if (!response.ok) throw new BeatResourceError(`${options.label}加载失败（${response.status}）`);
    if (!response.body) throw new BeatResourceError(`${options.label}没有下载数据`);
    resetIdle(); reader = response.body.getReader();
    const data = new Uint8Array(options.bytes); let received = 0, lastReported = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;
      resetIdle();
      if (received + value.byteLength > options.bytes) throw new BeatResourceError(`${options.label}文件大小不符`);
      data.set(value, received); received += value.byteLength;
      if (performance.now() - lastReported >= 100 || received === options.bytes) {
        options.progress?.(received, options.bytes); lastReported = performance.now();
      }
    }
    if (received !== options.bytes) throw new BeatResourceError(`${options.label}下载不完整`);
    if (globalThis.crypto?.subtle) {
      const hash = await crypto.subtle.digest('SHA-256', data);
      if (Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('') !== options.sha256) throw new BeatResourceError(`${options.label}校验失败`);
    }
    completed = true; return data;
  };
  try { return await Promise.race([download(), timeout]); }
  catch (error) {
    if (error instanceof BeatResourceError) throw error;
    throw new BeatResourceError(`${options.label}下载失败，请检查网络后重试`);
  } finally {
    clearTimeout(idle!); clearTimeout(deadline);
    if (!completed) controller.abort();
    // Do not await cancellation of a stalled stream; the worker can be killed.
    if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* A read may still be pending. */ } }
  }
}
