import { describe, expect, it, vi } from 'vitest';
import { installMotionPreferenceCompatibility } from './motion-preference';

function legacyQuery(media = '(prefers-reduced-motion)', initial = false) {
  let matches = initial;
  const callbacks = new Set<(this: MediaQueryList, event: MediaQueryListEvent) => void>();
  const query = {
    media, onchange: null,
    get matches() { return matches; },
    addListener: vi.fn(function (this: object, listener: (this: MediaQueryList, event: MediaQueryListEvent) => void) { expect(this).toBe(query); callbacks.add(listener); }),
    removeListener: vi.fn(function (this: object, listener: (this: MediaQueryList, event: MediaQueryListEvent) => void) { expect(this).toBe(query); callbacks.delete(listener); }),
  };
  const list = query as unknown as MediaQueryList;
  return { query: list, callbacks, emit(value: boolean) { matches = value; const event = { matches, media } as MediaQueryListEvent; for (const callback of [...callbacks]) callback.call(list, event); return event; } };
}

function legacyOwner() {
  const results = new Map<string, ReturnType<typeof legacyQuery>>();
  const owner = { matchMedia: vi.fn(function (this: object, query: string) {
    expect(this).toBe(owner);
    if (!results.has(query)) results.set(query, legacyQuery(query));
    return results.get(query)!.query;
  }) };
  return { owner, results };
}

describe('narrow reduced-motion MediaQueryList compatibility', () => {
  it('does not wrap or mutate modern browsers', () => {
    const query = { matches: true, media: '(prefers-reduced-motion)', addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() } as unknown as MediaQueryList;
    const native = vi.fn((_query: string) => query), owner = { matchMedia: native }, add = query.addEventListener, remove = query.removeEventListener;
    installMotionPreferenceCompatibility(owner);
    expect(owner.matchMedia).toBe(native); expect(owner.matchMedia('(min-width: 1px)')).toBe(query);
    expect(query.addEventListener).toBe(add); expect(query.removeEventListener).toBe(remove); expect(query.addListener).not.toHaveBeenCalled();
  });

  it('bridges the actual Motion boolean query and preserves native match values, object identity and callback receiver', () => {
    const { owner, results } = legacyOwner();
    installMotionPreferenceCompatibility(owner);
    const query = owner.matchMedia('(prefers-reduced-motion)'), original = results.get('(prefers-reduced-motion)')!;
    expect(query).toBe(original.query); expect(query.matches).toBe(false);
    let receiver: unknown, received: Event | undefined;
    const listener = vi.fn(function (this: unknown, event: Event) { receiver = this; received = event; });
    query.addEventListener('change', listener);
    const event = original.emit(true);
    expect(receiver).toBe(query); expect(received).toBe(event); expect(query.matches).toBe(true);
    query.removeEventListener('change', listener); original.emit(false);
    expect(listener).toHaveBeenCalledOnce(); expect(original.callbacks.size).toBe(0);
  });

  it.each(['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: no-preference)', ' ( PREFERS-REDUCED-MOTION : reduce ) '])('bridges the reduced-motion form %s without changing the native media text', text => {
    const { owner } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    const query = owner.matchMedia(text); expect(query.media).toBe(text); expect(typeof query.addEventListener).toBe('function');
  });

  it('does not add event methods to other or compound media queries', () => {
    const { owner, results } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    for (const media of ['(min-width: 800px)', '(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce) and (min-width: 800px)']) {
      const query = owner.matchMedia(media); expect(query).toBe(results.get(media)!.query);
      expect(query.addEventListener).toBeUndefined(); expect(query.removeEventListener).toBeUndefined();
    }
  });

  it('installs once and deduplicates listeners while allowing removal and re-registration', () => {
    const { owner, results } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    const wrapped = owner.matchMedia; installMotionPreferenceCompatibility(owner); expect(owner.matchMedia).toBe(wrapped);
    const query = owner.matchMedia('(prefers-reduced-motion)'), original = results.get(query.media)!;
    const listener = vi.fn(); query.addEventListener('change', listener); query.addEventListener('change', listener);
    expect(query.addListener).toHaveBeenCalledOnce(); original.emit(true); expect(listener).toHaveBeenCalledOnce();
    query.removeEventListener('change', listener); query.removeEventListener('change', listener);
    expect(query.removeListener).toHaveBeenCalledOnce();
    query.addEventListener('change', listener); original.emit(false); expect(listener).toHaveBeenCalledTimes(2);
  });

  it('supports handleEvent objects with the object receiver and correct removal', () => {
    const { owner, results } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    const query = owner.matchMedia('(prefers-reduced-motion)'); let receiver: unknown;
    const listener = { handleEvent: vi.fn(function (this: unknown) { receiver = this; }) };
    query.addEventListener('change', listener); results.get(query.media)!.emit(true); expect(receiver).toBe(listener);
    query.removeEventListener('change', listener); results.get(query.media)!.emit(false); expect(listener.handleEvent).toHaveBeenCalledOnce();
  });

  it('distinguishes capture registrations and ignores unsupported event types or null listeners', () => {
    const { owner, results } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    const query = owner.matchMedia('(prefers-reduced-motion)'), listener = vi.fn(), emit = results.get(query.media)!.emit;
    query.addEventListener('change', listener); query.addEventListener('change', listener, true);
    query.addEventListener('other', listener); Reflect.apply(query.addEventListener, query, ['change', null]);
    query.removeEventListener('change', listener, { capture: true }); emit(true);
    expect(listener).toHaveBeenCalledOnce(); query.removeEventListener('change', listener); emit(false); expect(listener).toHaveBeenCalledOnce();
  });

  it('removes once listeners before invoking them so re-registration works', () => {
    const { owner, results } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    const query = owner.matchMedia('(prefers-reduced-motion)'), listener = vi.fn();
    query.addEventListener('change', listener, { once: true }); results.get(query.media)!.emit(true); results.get(query.media)!.emit(false);
    expect(listener).toHaveBeenCalledOnce(); expect(query.removeListener).toHaveBeenCalledOnce();
    query.addEventListener('change', listener); results.get(query.media)!.emit(true); expect(listener).toHaveBeenCalledTimes(2);
  });

  it('supports an optional abort signal without leaving a legacy registration', () => {
    const { owner, results } = legacyOwner(); installMotionPreferenceCompatibility(owner);
    const query = owner.matchMedia('(prefers-reduced-motion)'), listener = vi.fn(), controller = new AbortController();
    query.addEventListener('change', listener, { signal: controller.signal }); controller.abort(); results.get(query.media)!.emit(true);
    expect(listener).not.toHaveBeenCalled(); expect(results.get(query.media)!.callbacks.size).toBe(0);
    query.addEventListener('change', listener, { signal: controller.signal }); expect(query.addListener).toHaveBeenCalledOnce();
  });

  it('leaves a modern object returned after the legacy probe untouched', () => {
    const old = legacyQuery(), modern = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList;
    const owner = { matchMedia: vi.fn((query: string) => query === '(prefers-reduced-motion)' ? old.query : modern) };
    installMotionPreferenceCompatibility(owner);
    const add = modern.addEventListener; expect(owner.matchMedia('(prefers-reduced-motion: reduce)')).toBe(modern); expect(modern.addEventListener).toBe(add);
  });

  it('leaves missing, throwing, nonextensible or partially modern APIs unchanged', () => {
    expect(() => installMotionPreferenceCompatibility(undefined)).not.toThrow();
    expect(() => installMotionPreferenceCompatibility({})).not.toThrow();
    const throwing = vi.fn(() => { throw new Error('restricted'); }), owner = { matchMedia: throwing };
    installMotionPreferenceCompatibility(owner); expect(owner.matchMedia).toBe(throwing);
    const frozen = Object.freeze(legacyQuery().query), native = vi.fn(() => frozen), blocked = { matchMedia: native };
    installMotionPreferenceCompatibility(blocked); expect(blocked.matchMedia).toBe(native);
    const partial = legacyQuery().query; partial.addEventListener = vi.fn(); const unchanged = vi.fn(() => partial), partialOwner = { matchMedia: unchanged };
    installMotionPreferenceCompatibility(partialOwner); expect(partialOwner.matchMedia).toBe(unchanged);
  });
});
