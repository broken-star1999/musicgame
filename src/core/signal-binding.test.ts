import { describe, it, expect } from 'vitest';
import { mergeClockOnsets } from './clock-evidence';
import { bindCanonical } from './signal-binding';
import { analysisFixture, frozen, type Tagged } from './signal-test-fixtures';
describe('source-aware clock union independent contracts', () => {
    it('assigns one nearest owner, earlier on an exact binary tie, and uses max rather than sum', () => {
        const mixed = frozen([{ time: 0, strength: .1, band: 1, label: 'earlier' }, { time: .0625, strength: .2, band: 2, label: 'later' }]), selected = frozen([{ time: .03125, strength: .8, band: 0 }, { time: .01, strength: .7, band: 0 }]), before = JSON.stringify({ mixed, selected });
        const result = mergeClockOnsets(mixed, selected);
        expect(result).toEqual([{ ...mixed[0], strength: .8 }, mixed[1]]);
        expect(result[0]).not.toBe(mixed[0]);
        expect(JSON.stringify({ mixed, selected })).toBe(before);
    });
    it('includes exactly50ms, supplements a genuinely unmatched selected object, and excludes boundaries', () => {
        const extra = { time: .2, strength: .4, band: 2, label: 'unmatched' }, mixed = frozen([{ time: 0, strength: .1, band: 1 }, { time: -.1, strength: 9, band: 0, boundary: true as const }]), selected = frozen([{ time: .05, strength: .9, band: 0 }, extra, { time: .01, strength: 8, band: 0, boundary: true as const }]);
        const result = mergeClockOnsets(mixed, selected);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ time: 0, strength: .9, band: 1 });
        expect(result[1]).toBe(extra);
        expect(result.every(e => !e.boundary)).toBe(true);
        expect(mixed[0].strength).toBe(.1);
    });
});
describe('real canonical binder contracts, with its three-beat gate active', () => {
    it('promotes a role onto original time/band/strength/extra fields and emits one physical selected event', () => {
        const first: Tagged = { time: .49, strength: .12, band: 2, attack: .44, label: 'selected', extra: { owner: 'source' } }, selected: Tagged[] = [first, ...[.99, 1.49, 1.99].map(time => ({ time, strength: .12, band: 2 }))], mixed: Tagged[] = [.5, 1, 1.5, 2].map(time => ({ time, strength: 1, band: 0, label: 'mixed' })), input = frozen(analysisFixture(selected, [...selected, ...mixed].sort((a, b) => a.time - b.time), [.5, 1, 1.5, 2], mixed)), before = JSON.stringify(input);
        const result = bindCanonical(input).pulse!.onsets, canonical = result.find(e => e.time === .49)!;
        expect(canonical).toEqual({ ...first, role: 'beat' });
        expect((canonical as Tagged).extra).toBe(first.extra);
        expect(result).toHaveLength(4);
        expect(result.some(e => e.time === .5)).toBe(false);
        expect(JSON.stringify(input)).toBe(before);
    });
    it('maps an equidistant bound event to the earlier selected attack', () => {
        const selected: Tagged[] = [{ time: .46875, strength: .12, band: 2, role: 'quarter' }, { time: .53125, strength: .12, band: 1, role: 'free' }, ...[1, 1.5].map(time => ({ time, strength: .12, band: 2 }))], mixed: Tagged[] = [.5, 1, 1.5].map(time => ({ time, strength: 1, band: 0 }));
        const result = bindCanonical(frozen(analysisFixture(selected, [...selected, ...mixed].sort((a, b) => a.time - b.time), [.5, 1, 1.5], mixed))).pulse!.onsets;
        expect(result.find(e => e.time === .46875)?.role).toBe('beat');
        expect(result.find(e => e.time === .53125)?.role).toBe('free');
        expect(result.some(e => e.time === .5)).toBe(false);
    });
    it('includes exactly50ms in canonical ownership', () => {
        const selected: Tagged[] = [{ time: 0, strength: .12, band: 2 }, ...[.55, 1.05, 1.55].map(time => ({ time, strength: .12, band: 2 }))], mixed: Tagged[] = [.05, .55, 1.05, 1.55].map(time => ({ time, strength: 1, band: 0 }));
        const result = bindCanonical(frozen(analysisFixture(selected, [...selected, ...mixed].sort((a, b) => a.time - b.time), [.05, .55, 1.05, 1.55], mixed))).pulse!.onsets;
        expect(result.find(e => e.time === 0)).toEqual({ ...selected[0], role: 'beat' });
        expect(result.some(e => e.time === .05)).toBe(false);
    });
    it('keeps original beat priority over a mapped half and retains an unbound half role', () => {
        const late: Tagged = { time: .546875, strength: .7, band: 2, role: 'beat' }, unbound: Tagged = { time: 2.25, strength: .1, band: 1, role: 'half' }, selected: Tagged[] = [{ time: .453125, strength: .1, band: 2, role: 'free' }, late, ...[.75, 1, 1.25].map(time => ({ time, strength: .12, band: 2 })), unbound], mixed: Tagged[] = [.5, .75, 1, 1.25, .595703125].map(time => ({ time, strength: 1, band: 0 }));
        const result = bindCanonical(frozen(analysisFixture(selected, [...selected, ...mixed].sort((a, b) => a.time - b.time), [.5, .75, 1, 1.25], mixed))).pulse!.onsets;
        expect(result.find(e => e.time === late.time)).toEqual(late);
        expect(result.find(e => e.time === unbound.time)).toBe(unbound);
        expect(result.some(e => e.time === .595703125)).toBe(false);
    });
    it('keeps a real unmatched half-beat attack rather than projecting it to a selected source', () => {
        const selected: Tagged[] = [.5, 1, 1.5, 2].map(time => ({ time, strength: .5, band: 0 })), extra: Tagged = { time: .75, strength: .9, band: 2, label: 'actual-unmatched' }, mixed = [...selected, extra].sort((a, b) => a.time - b.time);
        const result = bindCanonical(frozen(analysisFixture(selected, mixed, [.5, 1, 1.5, 2], mixed))).pulse!.onsets;
        expect(result).toHaveLength(5);
        expect(result.find(e => e.time === .75)).toEqual({ ...extra, role: 'half' });
    });
    it('suppresses an old cue when a newly bound regular event is within85ms; no boundary gains a role', () => {
        const boundary: Tagged = { time: .01, strength: 1, band: 0, boundary: true }, regular: Tagged[] = [.5, 1, 1.5].map(time => ({ time, strength: .5, band: 0 })), mixed: Tagged[] = [.04, .5, 1, 1.5].map(time => ({ time, strength: 1, band: 0 }));
        const result = bindCanonical(frozen(analysisFixture([boundary, ...regular], mixed, [.04, .5, 1, 1.5], mixed))).pulse!.onsets;
        expect(result.some(e => e.time === .04 && !e.boundary && e.role === 'beat')).toBe(true);
        expect(result.some(e => e.boundary)).toBe(false);
        expect(boundary.role).toBeUndefined();
        const retained = bindCanonical(frozen(analysisFixture([boundary, ...regular], regular, [.5, 1, 1.5], regular))).pulse!.onsets.find(e => e.boundary);
        expect(retained).toEqual(boundary);
        expect(retained?.role).toBeUndefined();
    });
});
