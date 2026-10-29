type MatchMediaOwner = { matchMedia?: (query: string) => MediaQueryList };
type ChangeListener = EventListenerOrEventListenerObject;
type LegacyListener = (this: MediaQueryList, event: MediaQueryListEvent) => void;

const installed = new WeakSet<MatchMediaOwner>();
const reducedMotionQuery = /^\s*\(\s*prefers-reduced-motion\s*(?::\s*(?:reduce|no-preference)\s*)?\)\s*$/i;
const legacy = (query: MediaQueryList) => typeof query.addEventListener !== 'function'
  && typeof query.removeEventListener !== 'function'
  && typeof query.addListener === 'function' && typeof query.removeListener === 'function';

/** Bridge only change listeners on legacy reduced-motion query objects. Keep
 * the native object/getters and legacy API; this is not an EventTarget polyfill. */
function bridge(query: MediaQueryList): void {
  if (!legacy(query)) return;
  const add = query.addListener, remove = query.removeListener;
  const listeners = new WeakMap<ChangeListener, Map<boolean, () => void>>();
  const captureOf = (options?: boolean | EventListenerOptions) => typeof options === 'boolean' ? options : !!options?.capture;

  const addEventListener = (type: string, listener: ChangeListener | null, options?: boolean | AddEventListenerOptions): void => {
    if (type !== 'change' || !listener || (typeof listener !== 'function' && typeof listener !== 'object')) return;
    const capture = captureOf(options), settings = typeof options === 'object' ? options : undefined;
    if (settings?.signal?.aborted) return;
    let registrations = listeners.get(listener);
    if (registrations?.has(capture)) return;
    if (!registrations) { registrations = new Map(); listeners.set(listener, registrations); }
    const owned = registrations; let active = true;
    const off = () => {
      if (!active) return;
      active = false; owned.delete(capture); if (!owned.size) listeners.delete(listener);
      settings?.signal?.removeEventListener('abort', off);
      remove.call(query, callback);
    };
    const callback: LegacyListener = event => {
      if (!active) return;
      if (settings?.once) off();
      if (typeof listener === 'function') listener.call(query, event);
      else listener.handleEvent(event);
    };
    owned.set(capture, off);
    try {
      add.call(query, callback);
      settings?.signal?.addEventListener('abort', off, { once: true });
      if (settings?.signal?.aborted) off();
    } catch (error) { off(); throw error; }
  };
  const removeEventListener = (type: string, listener: ChangeListener | null, options?: boolean | EventListenerOptions): void => {
    if (type === 'change' && listener) listeners.get(listener)?.get(captureOf(options))?.();
  };
  Object.defineProperties(query, {
    addEventListener: { value: addEventListener, configurable: true, writable: true },
    removeEventListener: { value: removeEventListener, configurable: true, writable: true },
  });
}

/** Call before React's first render. Modern browsers keep their original
 * matchMedia identity. Only verified legacy reduced-motion support is wrapped. */
export function installMotionPreferenceCompatibility(owner: MatchMediaOwner | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (!owner || installed.has(owner) || typeof owner.matchMedia !== 'function') return;
  const native = owner.matchMedia;
  try {
    const probe = native.call(owner, '(prefers-reduced-motion)');
    if (!legacy(probe)) return;
    bridge(probe);
    owner.matchMedia = function (this: MatchMediaOwner, query: string): MediaQueryList {
      const result = native.call(this, query);
      if (reducedMotionQuery.test(query)) bridge(result);
      return result;
    };
    installed.add(owner);
  } catch { /* Restricted/unpatchable APIs keep their native behavior. */ }
}
