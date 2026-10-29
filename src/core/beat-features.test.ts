import { describe, expect, it } from 'vitest';
import { beatChunks, beatSpectrogram } from './beat-features';

describe('published-model feature framing', () => {
  it('keeps silence at zero and uses the centered 50 fps time origin', () => {
    const result = beatSpectrogram(new Float32Array(22050));
    expect(result.frames).toBe(51); expect(result.data).toHaveLength(51 * 128);
    expect(result.data.every(value => value === 0)).toBe(true);
    const impulse = new Float32Array(22050); impulse[4410] = 1;
    const spectrogram = beatSpectrogram(impulse);
    const frameEnergy = Array.from({ length: spectrogram.frames }, (_, i) => spectrogram.data.slice(i * 128, (i + 1) * 128).reduce((a, b) => a + b, 0));
    expect(frameEnergy.indexOf(Math.max(...frameEnergy))).toBe(10);
  });
  it.each([1, 100, 1488, 1489, 1494, 1500, 2976, 2977, 15001])('covers all %i frames at short, boundary and five-minute lengths', frames => {
    const covered = new Uint8Array(frames);
    for (const chunk of beatChunks(frames)) {
      expect(chunk.length).toBeLessThanOrEqual(1500);
      for (let i = 6; i < chunk.length - 6; i++) if (chunk.start + i >= 0 && chunk.start + i < frames) covered[chunk.start + i] = 1;
    }
    expect(covered.every(value => value === 1)).toBe(true);
  });
});
