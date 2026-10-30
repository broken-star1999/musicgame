import type { Analysis, Onset } from '../types';
import { CONCURRENCE_WINDOW } from './clock-evidence';

export interface PoolDecision {
    event: Onset;
    selectedExact: boolean;
    mixedCorroborated: boolean;
    nearestMixedDistance: number | null;
    accepted: boolean;
}

/** Inspect actual candidates without changing their order or object identity. */
export function inspectPool(analysis: Analysis): PoolDecision[] {
    const selectedTimes = new Set((analysis.pulse?.onsets ?? analysis.onsets).map(event => event.time));
    const mixed = analysis.onsets.filter(event => !event.boundary);
    const finiteMixed = mixed.every(event => Number.isFinite(event.time));
    const times = finiteMixed ? Float64Array.from(mixed, event => event.time).sort() : undefined;
    const nearest = (time: number): number | null => {
        if (!mixed.length) return null;
        // Retain the original Math.min/abs behavior for NaN, infinities and
        // invalid numeric inputs rather than silently dropping those values.
        if (!times || !Number.isFinite(time)) {
            let best = Infinity;
            for (const other of mixed) best = Math.min(best, Math.abs(other.time - time));
            return best;
        }
        let low = 0, high = times.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (times[middle] < time) low = middle + 1;
            else high = middle;
        }
        let best = Infinity;
        if (low < times.length) best = Math.min(best, Math.abs(times[low] - time));
        if (low > 0) best = Math.min(best, Math.abs(times[low - 1] - time));
        return best;
    };
    return (analysis.candidates ?? analysis.onsets).filter(event => !event.boundary).map(event => {
        const selectedExact = selectedTimes.has(event.time);
        const nearestMixedDistance = nearest(event.time);
        const mixedCorroborated = nearestMixedDistance !== null && nearestMixedDistance <= CONCURRENCE_WINDOW;
        return { event, selectedExact, mixedCorroborated, nearestMixedDistance, accepted: selectedExact || mixedCorroborated };
    });
}
