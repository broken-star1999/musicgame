import type { Analysis, Onset } from '../types';
import { musicalEvents } from './musical-events';
import { inspectPool } from './signal-pool';
import { CONCURRENCE_WINDOW } from './clock-evidence';
const rank = (e: Onset): number => e.role === 'beat' ? 4 : e.role === 'half' ? 3 : e.role === 'quarter' ? 2 : e.role === 'free' ? 1 : 0;
export function bindCanonical(analysis: Analysis): Analysis {
    const pulse = analysis.pulse ?? { onsets: analysis.onsets, sections: [] }, selected = pulse.onsets.filter(e => !e.boundary);
    if (!analysis.rhythm || analysis.rhythm.beats.length < 2)
        return analysis;
    const pool = inspectPool(analysis).filter(d => d.accepted).map(d => d.event), bound = musicalEvents({ ...analysis, candidates: pool }, analysis.rhythm);
    if (bound.filter(e => e.role === 'beat').length < 3)
        return analysis;
    const byTime = new Map<number, Onset>();
    const put = (event: Onset) => { const old = byTime.get(event.time); if (!old || rank(event) > rank(old) || (rank(event) === rank(old) && event.strength > old.strength))
        byTime.set(event.time, event); };
    for (const event of selected)
        put(event);
    for (const event of bound) {
        let best = -1, distance = CONCURRENCE_WINDOW;
        selected.forEach((other, i) => { const d = Math.abs(other.time - event.time); if (d < distance || (d === distance && (best < 0 || other.time < selected[best].time || (other.time === selected[best].time && i < best)))) {
            best = i;
            distance = d;
        } });
        if (best >= 0) {
            const original = selected[best], existing = byTime.get(original.time) ?? original, winner = rank(event) > rank(existing) ? event : existing;
            put({ ...original, ...(winner.role ? { role: winner.role } : {}) });
        }
        else {
            put(event);
        }
    }
    const regular = [...byTime.values()];
    for (const boundary of pulse.onsets.filter(e => e.boundary)) {
        if (regular.some(e => Math.abs(e.time - boundary.time) <= .085)) {
            continue;
        }
        const copy = { ...boundary };
        delete copy.role;
        put(copy);
    }
    const onsets = [...byTime.values()].sort((a, b) => a.time - b.time);
    return { ...analysis, pulse: { ...pulse, onsets } };
}
export { inspectPool } from './signal-pool';
export type { PoolDecision } from './signal-pool';
export const bindSignalEvents = bindCanonical;
