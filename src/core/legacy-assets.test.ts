import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function cleanup() { vi.resetModules(); return (await import('./legacy-assets')).releaseLegacyBeatAssets; }

it('deletes only the known retired cache once and never reads other caches, settings, or scores', async () => {
  const remove = vi.fn().mockResolvedValue(true), keys = vi.fn(), open = vi.fn();
  vi.stubGlobal('caches', { delete: remove, keys, open });
  const getItem = vi.fn(), setItem = vi.fn(), clear = vi.fn();
  vi.stubGlobal('localStorage', { getItem, setItem, clear });
  const release = await cleanup();
  expect(release()).toBeUndefined(); expect(release()).toBeUndefined();
  expect(remove).toHaveBeenCalledExactlyOnceWith('beatfall-beat-assets-v1');
  expect(keys).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});

it('returns immediately even when deletion never settles', async () => {
  const remove = vi.fn(() => new Promise<boolean>(() => {}));
  vi.stubGlobal('caches', { delete: remove });
  const release = await cleanup();
  expect(release()).toBeUndefined(); expect(release()).toBeUndefined();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('handles a rejected deletion silently and makes a fresh attempt after a new page module loads', async () => {
  const remove = vi.fn().mockRejectedValue(new Error('Storage denied'));
  vi.stubGlobal('caches', { delete: remove });
  const release = await cleanup(); expect(release()).toBeUndefined();
  await Promise.resolve(); await Promise.resolve();
  expect(release()).toBeUndefined(); expect(remove).toHaveBeenCalledTimes(1);
  const reloaded = await cleanup(); expect(reloaded()).toBeUndefined();
  await Promise.resolve(); await Promise.resolve(); expect(remove).toHaveBeenCalledTimes(2);
});

it.each([undefined, {}, { delete: undefined }])('tolerates an unavailable cache API %j', async caches => {
  vi.stubGlobal('caches', caches);
  const release = await cleanup(); expect(release()).toBeUndefined();
});

it('handles synchronous API failures without interrupting startup', async () => {
  const remove = vi.fn(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.stubGlobal('caches', { delete: remove });
  const release = await cleanup(); expect(() => release()).not.toThrow();
  expect(release()).toBeUndefined(); expect(remove).toHaveBeenCalledTimes(1);
});

it('tolerates access to CacheStorage itself being blocked', async () => {
  vi.stubGlobal('caches', undefined);
  Object.defineProperty(globalThis, 'caches', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
  const release = await cleanup(); expect(() => release()).not.toThrow();
});
