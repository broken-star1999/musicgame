import { describe, expect, it } from 'vitest';
import type { Onset } from '../types';
import type { TempoBlock } from './tempo-families';
import { gateClockEvidence } from './phase-gate';

const event = (time: number, strength = .7, patch: Partial<Onset> = {}): Onset => ({ time, strength, band: 0, ...patch });
const block = (patch: Partial<TempoBlock> = {}): TempoBlock => ({
  time: 0, from: 0, to: 4, preferredPeriod: 1, preferredBpm: 60,
  action: 'keep-supported-reference', supported: true, referencePhaseCount: 1,
  refAnchors: [0], phaseAmbiguous: false, levelAmbiguous: false,
  oldReferenceEvidence: [], hypotheses: [], ...patch,
});

describe('V5 original selected-source phase context', () => {
  it.each([undefined, [] as Onset[]])('keeps all objects without usable source context (%s)', source => {
    const input = [event(.25), event(.75, 3, { band: 2 })];
    const result = gateClockEvidence(input, [block()], source);
    expect(result).toStrictEqual(input);
    result.forEach((value, index) => expect(value).toBe(input[index]));
  });

  it('makes an empty nearest block unknown even when another block has a valid source', () => {
    const input = [event(.25), event(1.25)];
    const result = gateClockEvidence(input, [block(), block()], [event(0)]);
    expect(result[0].strength).toBe(0);
    expect(result[1]).toBe(input[1]);
  });

  it('one contradicting selected event releases the entire block, including unrelated events', () => {
    const input = [event(.7), event(1.4, .6, { band: 2 })];
    expect(gateClockEvidence(input, [block()], [event(0)]).map(value => value.strength)).toEqual([0, 0]);
    const source = [event(0), event(.25, .000001)];
    const before = structuredClone({ input, source });
    const result = gateClockEvidence(input, [block()], source);
    result.forEach((value, index) => expect(value).toBe(input[index]));
    expect({ input, source }).toStrictEqual(before);
  });

  it('protects a selected neighbor across adjacent nearest-two-second blocks', () => {
    const input = [event(.99)], blocks = [block({ refAnchors: [.8] }), block({ refAnchors: [1.01] })];
    expect(gateClockEvidence(input, blocks, [event(.8)])[0].strength).toBe(0);
    const result = gateClockEvidence(input, blocks, [event(.8), event(1.01)]);
    expect(result[0]).toBe(input[0]);
  });

  it('uses inclusive 50ms selected protection without widening to the next floating value', () => {
    const input = [event(.1), event(.10000000000000002, .8, { band: 2, attack: .31 })];
    // Source .05 lies on the existing phase tolerance edge. Clock .1 is outside
    // phase tolerance and survives only via exactly .05 source concurrence.
    const source = [event(.05)], before = structuredClone({ input, source });
    const result = gateClockEvidence(input, [block()], source);
    expect(result[0]).toBe(input[0]);
    expect(result[1]).toStrictEqual({ ...input[1], strength: 0 });
    expect(result[1]).not.toBe(input[1]);
    expect({ input, source }).toStrictEqual(before);
  });

  it('boundary context neither validates a phase nor protects a nearby clock observation', () => {
    const input = [event(.25)], boundary = event(.25, 2, { boundary: true });
    expect(gateClockEvidence(input, [block()], [boundary])[0]).toBe(input[0]);
    expect(gateClockEvidence(input, [block()], [event(0), boundary])[0].strength).toBe(0);
    const adjacent = [block({ refAnchors: [.8] }), block({ refAnchors: [1.01] })];
    expect(gateClockEvidence([event(.99)], adjacent, [event(.8), event(1.01, 1, { boundary: true })])[0].strength).toBe(0);
  });

  it('keeps unresolved or multiple phase hypotheses even with a compatible source context', () => {
    const input = [event(.25)];
    for (const unresolved of [block({ supported: false }), block({ refAnchors: [] }),
      block({ refAnchors: [0, .25] }), block({ phaseAmbiguous: true }),
      block({ preferredPeriod: null }), block({ preferredPeriod: 0 })]) {
      expect(gateClockEvidence(input, [unresolved], [event(0)])[0]).toBe(input[0]);
    }
  });
});
