import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemoRequest, DemoResponse } from './demo.worker';
import { DEMO_FRAMES, DEMO_SAMPLE_RATE } from './demo-synthesis';

afterEach(() => vi.unstubAllGlobals());

describe('demo worker owns synthesis and transfers its completed PCM', () => {
  it('transfers the original complete song and detaches its worker buffer', async () => {
    vi.resetModules();
    const messages: DemoResponse[] = [], transferred: { before: number; after: number }[] = [];
    const worker = {
      onmessage: null as ((event: MessageEvent<DemoRequest>) => void) | null,
      postMessage(message: DemoResponse, transfer: Transferable[] = []) {
        const bytes = transfer[0] as ArrayBuffer | undefined, before = bytes?.byteLength;
        messages.push(structuredClone(message, { transfer }));
        if (bytes) transferred.push({ before: before!, after: bytes.byteLength });
      },
    };
    vi.stubGlobal('self', worker); await import('./demo.worker');
    worker.onmessage!({ data: { type: 'synthesize' } } as MessageEvent<DemoRequest>);
    const result = messages.at(-1)!;
    expect(result.type).toBe('done'); if (result.type !== 'done') throw new Error('No result');
    expect(result.sampleRate).toBe(DEMO_SAMPLE_RATE); expect(result.samples.length).toBe(DEMO_FRAMES);
    expect(createHash('sha256').update(new Uint8Array(result.samples.buffer)).digest('hex')).toBe('36a3f9421d456dfa9829efa25223785da2d90963699d2352522a30d791cf5aaf');
    expect(transferred).toEqual([{ before: DEMO_FRAMES * 4, after: 0 }]);
    expect(messages.filter(message => message.type === 'done')).toHaveLength(1);
    expect(messages.filter(message => message.type === 'progress').length).toBeGreaterThanOrEqual(25);
  });

  it('sends a recoverable error if a synthesis progress post fails', async () => {
    vi.resetModules(); const postMessage = vi.fn((message: DemoResponse) => { if (message.type === 'progress') throw new Error('clone'); });
    const worker = { onmessage: null as ((event: MessageEvent<DemoRequest>) => void) | null, postMessage };
    vi.stubGlobal('self', worker); await import('./demo.worker');
    expect(() => worker.onmessage!({ data: { type: 'synthesize' } } as MessageEvent<DemoRequest>)).not.toThrow();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'error', message: expect.stringContaining('重试') });
    expect(postMessage.mock.calls.some(([message]) => message.type === 'done')).toBe(false);
  });
});
