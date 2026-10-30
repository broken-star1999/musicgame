import type { Onset } from '../types';
export const CONCURRENCE_WINDOW = .05;
/** Reweight measured attacks for the clock. Other-band events
 * may support one nearest pulse attack; they never add or move a pulse attack. */
export function reinforceCoincidentOnsets(onsets: Onset[], streams: Onset[][], variant: 'weighted' | 'count'): Onset[] {
    const targets = onsets.flatMap((event, index) => event.boundary ? [] : [{ event, index }]);
    if (!targets.length)
        return onsets;
    const support = onsets.map(() => [0, 0, 0]);
    for (let band = 0; band < 3; band++) {
        let cursor = 0;
        for (const auxiliary of streams[band] ?? []) {
            if (auxiliary.boundary)
                continue;
            while (cursor + 1 < targets.length && Math.abs(targets[cursor + 1].event.time - auxiliary.time) < Math.abs(targets[cursor].event.time - auxiliary.time))
                cursor++;
            const target = targets[cursor], distance = Math.abs(target.event.time - auxiliary.time);
            if (target.event.band === band || distance >= CONCURRENCE_WINDOW)
                continue;
            const value = Math.min(1, Math.max(0, auxiliary.strength)) * (1 - distance / CONCURRENCE_WINDOW);
            support[target.index][band] = Math.max(support[target.index][band], value);
        }
    }
    return onsets.map((event, i) => {
        const gain = variant === 'weighted' ? support[i].reduce((a, b) => a + b, 0) : event.strength * support[i].filter(x => x > 0).length;
        return gain ? { ...event, strength: event.strength + gain } : event;
    });
}
/** Each selected event owns one nearest mixed event; simultaneous support uses
 * max, never sum. Only these clock copies change strength; physical inputs stay. */
export function mergeClockOnsets(mixed: Onset[], selected: Onset[]): Onset[] {
    const regular = mixed.filter(e => !e.boundary), result = regular.map(e => ({ ...e }));
    selected.forEach((event) => {
        if (event.boundary)
            return;
        let best = -1, distance = CONCURRENCE_WINDOW;
        regular.forEach((other, i) => {
            const d = Math.abs(other.time - event.time);
            if (d < distance || (d === distance && (best < 0 || other.time < regular[best].time || (other.time === regular[best].time && i < best)))) {
                best = i;
                distance = d;
            }
        });
        if (best >= 0) {
            result[best].strength = Math.max(result[best].strength, event.strength);
        }
        else {
            result.push(event);
        }
    });
    return result.sort((a, b) => a.time - b.time);
}
