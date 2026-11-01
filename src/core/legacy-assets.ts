const LEGACY_BEAT_CACHE = 'beatfall-beat-assets-v1';
let attempted = false;

/** Remove only the retired download cache. Startup and audio never await it. */
export function releaseLegacyBeatAssets(): void {
  if (attempted) return;
  attempted = true;
  try {
    const storage = globalThis.caches;
    if (storage && typeof storage.delete === 'function') {
      void Promise.resolve(storage.delete(LEGACY_BEAT_CACHE)).catch(() => {});
    }
  } catch { /* Optional cleanup can be retried on the next page load. */ }
}
