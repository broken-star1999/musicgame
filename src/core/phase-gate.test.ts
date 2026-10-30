import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Onset } from '../types';
import { gateClockEvidence } from './phase-gate';
import type { TempoBlock, TempoInvestigation } from './tempo-families';
import * as families from './tempo-families';
import * as phase from './phase-dp';
import { trackBeats } from './rhythm';

function block(patch: Partial<TempoBlock> = {}): TempoBlock {
    return { time: 0, from: 0, to: 4, preferredPeriod: 1, preferredBpm: 60,
        action: 'keep-supported-reference', supported: true, referencePhaseCount: 1,
        refAnchors: [0], phaseAmbiguous: false, levelAmbiguous: false,
        oldReferenceEvidence: [], hypotheses: [], ...patch };
}
function investigation(): TempoInvestigation {
    return { version: 'test', scope: 'synthetic control', blocks: [block()], work: {
        rawPairs: 0, acfProducts: 0, predictions: 0, phaseAnchorTrials: 0,
        blocks: 1, maximumRetainedPeriods: 0, maximumRetainedPhases: 0 } };
}
afterEach(() => vi.restoreAllMocks());

describe('supported phase evidence projection', () => {
    it('keeps exact 50ms and zeros the next representable outside value without moving fields', () => {
        const input: Onset[] = [{ time: .05, strength: .7, band: 1, attack: .3 },
            { time: .05000000000000001, strength: .8, band: 2, boundary: true }];
        const original = structuredClone(input), result = gateClockEvidence(input, [block()]);
        expect(result[0]).toBe(input[0]);
        expect(result[1]).toEqual({ ...input[1], strength: 0 });
        expect(result[1] === input[1]).toBe(false);
        expect(input).toEqual(original);
    });

    it('uses unrestricted negative lattice indices for a unique supported phase', () => {
        const input: Onset[] = [{ time: .1, strength: 1, band: 0 }, { time: .35, strength: .4, band: 1 }, { time: .6, strength: .8, band: 2 }];
        const result = gateClockEvidence(input, [block({ refAnchors: [1.1] })]);
        expect(result.map(event => event.strength)).toEqual([1, 0, 0]);
        expect(result.map(event => event.time)).toEqual(input.map(event => event.time));
    });

    it('preserves all measured evidence when phase references conflict', () => {
        const input: Onset[] = [.1, .35, .6].map(time => ({ time, strength: .8, band: 1 }));
        const result = gateClockEvidence(input, [block({ refAnchors: [1.1, 1.35], phaseAmbiguous: true })]);
        expect(result).toEqual(input);
        expect(result.every((event, index) => event === input[index])).toBe(true);
        expect(gateClockEvidence(input, [block({ phaseAmbiguous: true })])).toEqual(input);
    });

    it.each([block({ supported: false }), block({ refAnchors: [] }), block({ preferredPeriod: null }), block({ preferredPeriod: 0 })])('leaves unresolved evidence unchanged', unresolved => {
        const event: Onset = { time: .25, strength: .7, band: 0 };
        expect(gateClockEvidence([event], [unresolved])[0]).toBe(event);
    });

    it('uses the same nearest two-second block, including midpoint and last-block clamp', () => {
        const events: Onset[] = [{ time: .99, strength: 1, band: 0 }, { time: 1, strength: 1, band: 0 }, { time: 5, strength: 1, band: 0 }];
        const result = gateClockEvidence(events, [block(), block({ refAnchors: [1.25] })]);
        expect(result.map(event => event.strength)).toEqual([1, 0, 0]);
    });

    it('retains the original max reference when a louder competing phase is zeroed', () => {
        vi.spyOn(families, 'investigateTempo').mockReturnValue(investigation());
        const capture = vi.spyOn(phase, 'phaseDP');
        const events: Onset[] = [{ time: 0, strength: 1, band: 0 }, { time: .25, strength: 10, band: 1 },
            { time: 1, strength: 1, band: 0 }, { time: 2, strength: 1, band: 0 }];
        trackBeats(events, 3, 60);
        const input = capture.mock.calls[0][0];
        expect(input.envelope[0]).toBe(.1);
        expect(input.envelope[25]).toBe(0);
        expect(input.onsets === events).toBe(true);
        expect(events[1].strength).toBe(10);
    });

    it('permits an all-zero projected numerator without replacing the normalization source', () => {
        vi.spyOn(families, 'investigateTempo').mockReturnValue(investigation());
        const capture = vi.spyOn(phase, 'phaseDP');
        const events: Onset[] = [.25, .75, 1.25, 1.75].map(time => ({ time, strength: 1, band: 0 }));
        trackBeats(events, 3, 60);
        const input = capture.mock.calls[0][0];
        expect(input.envelope.every(value => value === 0)).toBe(true);
        expect(input.onsets === events).toBe(true);
        expect(events.every(event => event.strength === 1)).toBe(true);
    });
});
