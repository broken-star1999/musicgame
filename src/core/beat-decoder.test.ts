import { describe, expect, it } from 'vitest';
import { decodeBeatClock, neuralPeaks } from './beat-decoder';

function logitsFor(times: number[], duration: number) {
  const logits = new Float32Array(Math.ceil(duration * 50) * 2).fill(-8);
  times.forEach(time => { const frame = Math.round(time * 50); for (let d = -2; d <= 2; d++) if (frame + d >= 0 && frame + d < logits.length / 2) logits[(frame + d) * 2] = 6 - Math.abs(d) * 3; });
  return logits;
}
describe('conservative neural beat clock', () => {
  it('collapses flat peaks without creating silent beats', () => {
    const logits = new Float32Array(100).fill(-8); logits[20] = 3; logits[22] = 3;
    expect(neuralPeaks(logits)).toEqual([0.21]);
    expect(decodeBeatClock(new Float32Array(400).fill(-8)).beats).toEqual([]);
  });
  it('preserves a changing tempo instead of forcing a constant metronome', () => {
    const times = [...Array.from({ length: 12 }, (_, i) => 1 + i * 0.5), ...Array.from({ length: 12 }, (_, i) => 7 + i * 0.4)];
    const result = decodeBeatClock(logitsFor(times, 13));
    expect(times.filter(time => result.beats.some(beat => Math.abs(beat - time) < 0.05))).toHaveLength(times.length);
    expect(result.beats[0]).toBeGreaterThan(0.9);
  });
  it('does not turn alternating strong and softer clear beats into half speed', () => {
    const times = Array.from({ length: 32 }, (_, i) => 1 + i * 0.64), logits = logitsFor(times, 22);
    times.forEach((time, i) => { if (i % 2) for (let d = -2; d <= 2; d++) logits[(Math.round(time * 50) + d) * 2] -= 4; });
    const result = decodeBeatClock(logits);
    expect(result.beats.filter(time => times.some(beat => Math.abs(time - beat) < 0.05)).length).toBeGreaterThanOrEqual(30);
  });
  it('estimates 128 BPM across output quantization rather than rounding a single 20 ms interval', () => {
    const result = decodeBeatClock(logitsFor(Array.from({ length: 64 }, (_, i) => 0.6 + i * 60 / 128), 32));
    const tempi = result.tempo.map(point => point.bpm).sort((a, b) => a - b);
    expect(tempi[Math.floor(tempi.length / 2)]).toBeCloseTo(128, 0);
  });
});
