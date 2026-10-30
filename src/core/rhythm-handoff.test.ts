import { describe, expect, it } from 'vitest';
import type { Onset } from '../types';
import { analyzeAudio } from './analysis';
import { generateChart } from './chart';
import { followRhythmSource, periodicSupport } from './rhythm-source';

function regular(start: number, period: number, end: number, band: number, strength = 1): Onset[] {
  const events: Onset[] = [];
  for (let i = 0; start + i * period < end; i++) events.push({ time: start + i * period, strength, band });
  return events;
}
const combine = (...parts: Onset[][]) => parts.flat().sort((a, b) => a.time - b.time);

describe('measured rhythm source handoffs', () => {
  it('keeps a continuing quiet reference when a loud half-beat layer enters', () => {
    const low = regular(0.8, 0.5, 48, 0).map(event => ({ ...event, strength: event.time < 16 ? 1 : 0.15 }));
    const mid = regular(16.05, 0.5, 48, 1);
    const pulse = followRhythmSource([low, mid, []], combine(low, mid), 48);
    expect(pulse.onsets).toEqual(low);
    expect(pulse.sections.every(section => section.band === 'low')).toBe(true);
  });

  it('preserves the global opening choice, including its unresolved wrong-from-start case', () => {
    const low = regular(0.8, 0.5, 120, 0).map(event => ({ ...event, strength: event.time < 24 ? 1 : 0.15 }));
    const mid = regular(1.05, 0.5, 120, 1).map(event => ({ ...event, strength: event.time < 24 ? 0.8 : 1 }));
    const mixed = combine(low, mid), before = structuredClone({ low, mid, mixed });
    const pulse = followRhythmSource([low, mid, []], mixed, 120);
    // With no actual handoff, this guard does not reinterpret the global path.
    expect(pulse.onsets).toEqual(mid);
    expect(pulse.sections.every(section => section.band === 'mid')).toBe(true);
    expect(pulse.onsets.every(event => mid.includes(event))).toBe(true);
    expect({ low, mid, mixed }).toEqual(before);
    expect(followRhythmSource([low, mid, []], mixed, 120)).toEqual(pulse);
  });

  it('leaves a complete no-handoff path unchanged by unused sparse attacks', () => {
    const mid = regular(0.8, 0.5, 32, 1);
    const sparse = [{ time: 3.13, strength: 0.05, band: 0 }, { time: 15.27, strength: 0.05, band: 0 }, { time: 26.91, strength: 0.05, band: 0 }];
    const original = followRhythmSource([[], mid, []], mid, 32);
    const withUnusedAttacks = followRhythmSource([sparse, mid, []], combine(sparse, mid), 32);
    expect(original.onsets).toEqual(mid);
    expect(original.sections.every(section => section.band === 'mid')).toBe(true);
    expect(withUnusedAttacks).toEqual(original);
  });

  it('hands off to a differently phased source after the old source ends', () => {
    const low = regular(0.8, 0.5, 12, 0), mid = regular(12.05, 0.5, 32, 1);
    const pulse = followRhythmSource([low, mid, []], combine(low, mid), 32);
    expect(pulse.onsets).toEqual([...low, ...mid]);
    expect(pulse.sections[0].band).toBe('low');
    expect(pulse.sections.at(-1)!.band).toBe('mid');
  });

  it('releases the old period when the continuing instrument and new source change tempo', () => {
    const before = regular(0.8, 0.5, 12, 0), after = regular(12.3, 0.4, 32, 0, 0.2);
    const mid = after.map(event => ({ ...event, strength: 1, band: 1 }));
    const low = [...before, ...after], pulse = followRhythmSource([low, mid, []], combine(low, mid), 32);
    expect(pulse.onsets.map(event => event.time)).toEqual(low.map(event => event.time));
    expect(pulse.sections.at(-1)!.band).toBe('mid');
    expect(pulse.onsets.every(event => low.includes(event) || mid.includes(event))).toBe(true);
  });

  it('releases the phase through a long rest without inserting metronome attacks', () => {
    const low = regular(0.8, 0.5, 8, 0), mid = regular(17.05, 0.5, 28, 1);
    const pulse = followRhythmSource([low, mid, []], combine(low, mid), 28);
    expect(pulse.onsets).toEqual([...low, ...mid]);
    expect(pulse.onsets.some(event => event.time >= 8 && event.time < 17.05)).toBe(false);
    expect(pulse.sections.at(-1)!.band).toBe('mid');
  });

  it('carries the supported period through mixed output instead of adopting a jitter harmonic', () => {
    const attacks = regular(0.8, 0.5, 120, 0), jitter = [0.1, -0.06, -0.06, 0.1];
    const low = attacks.map((event, i) => ({ ...event, time: event.time < 12 ? event.time : event.time + jitter[i % 4], strength: event.time < 12 ? 1 : 0.01 }));
    // A long mixed passage earns its extra switch in the global path, so this
    // exercises natural mixed output before the opposite layer enters.
    const mid = regular(96.05, 0.5, 120, 1);
    const mixed = combine(attacks.map(event => ({ ...event, strength: 9 })), mid);
    const pulse = followRhythmSource([low, mid, []], mixed, 120);
    expect(pulse.sections.some(section => section.start >= 16 && section.start < 96 && section.band === 'mixed')).toBe(true);
    expect(pulse.sections.some(section => section.start >= 96 && section.band === 'mid')).toBe(false);
    expect(pulse.onsets.every(event => !mid.includes(event))).toBe(true);
    expect(pulse.onsets.every(event => low.includes(event) || mixed.includes(event))).toBe(true);
  });

  it('resolves exact harmonic ties so a legal faster reference is not mistaken for the opposite phase', () => {
    const low = regular(0.8, 0.6, 48, 0).map(event => ({ ...event, strength: event.time < 16 ? 1 : 0.15 }));
    const mid = regular(16.25, 0.3, 48, 1);
    expect(periodicSupport(low)).toBeCloseTo(1, 12);
    const pulse = followRhythmSource([low, mid, []], combine(low, mid), 48);
    expect(pulse.sections[0].band).toBe('low');
    expect(pulse.sections.at(-1)!.band).toBe('mid');
    expect(pulse.onsets.filter(event => event.time >= 20).every(event => mid.includes(event))).toBe(true);
  });

  it('returns no attacks for silence and does not turn sparse events into a periodic reference', () => {
    const empty = followRhythmSource([[], [], []], [], 24);
    expect(empty.onsets).toEqual([]);
    expect(empty.sections.every(section => section.support === 0)).toBe(true);
    expect(periodicSupport(regular(0.8, 0.5, 2, 0))).toBe(0);
  });

  it('retains the actual detected drum attacks through a loud competing layer in full PCM analysis', () => {
    const rate = 22050, duration = 20, samples = new Float32Array(rate * duration);
    const drums = regular(0.8, 0.5, duration - 0.4, 0), competing = regular(8.55, 0.5, duration - 0.4, 1);
    const add = (time: number, frequency: number, volume: number, attack: number, decay: number) => {
      const at = Math.round(time * rate);
      for (let i = 0; i < Math.round(rate * 0.21) && at + i < samples.length; i++) {
        const t = i / rate;
        samples[at + i] += Math.sin(2 * Math.PI * frequency * t) * Math.min(1, t / attack) * Math.exp(-t * decay) * volume;
      }
    };
    for (const event of drums) add(event.time, 96, event.time < 8 ? 0.48 : 0.075, 0.0017, 32);
    for (const event of competing) { add(event.time, 640, 0.46, 0.0035, 21); add(event.time, 1280, 0.46 * 0.26, 0.0035, 21); }
    const analysis = analyzeAudio(samples, rate), pulse = analysis.pulse!.onsets;
    expect(analysis.bpm).toBe(120);
    expect(drums.every(drum => pulse.some(onset => Math.abs(onset.time - drum.time) <= 0.05))).toBe(true);
    // Mixed-voice evidence may also retain the independently scheduled lead.
    // The low-finger game must keep the original drum phase throughout.
    expect(pulse.every(onset => [...drums, ...competing].some(event => Math.abs(onset.time - event.time) <= 0.05))).toBe(true);
    expect(pulse.every(onset => analysis.candidates!.some(candidate => candidate.time === onset.time
      && candidate.band === onset.band && candidate.strength === onset.strength))).toBe(true);
    const single = generateChart(analysis, 'one');
    expect(single.notes).toHaveLength(drums.length);
    expect(drums.every(drum => single.notes.some(note => Math.abs(note.time - drum.time) <= .05))).toBe(true);
    expect(single.notes.every(note => drums.some(drum => Math.abs(note.time - drum.time) <= .05))).toBe(true);
    const four = generateChart(analysis, 'four');
    expect(four.notes.some(note => competing.some(event => Math.abs(note.time - event.time) <= .05))).toBe(true);
  });
});
