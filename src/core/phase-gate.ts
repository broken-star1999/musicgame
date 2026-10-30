import type { Onset } from '../types';
import type { TempoBlock } from './tempo-families';
import { CONCURRENCE_WINDOW } from './clock-evidence';
/** Seconds throughout. The same nearest2s block supplies local period and
 * supported post-update phase anchors. No threshold/gain/family policy added. */
export function gateClockEvidence(onsets: Onset[], blocks: TempoBlock[]): Onset[] {
    const projected = onsets.map((event) => {
        const blockIndex = Math.min(blocks.length - 1, Math.round(event.time / 2)), block = blocks[blockIndex];
        if (!block?.supported || block.refAnchors.length !== 1 || block.phaseAmbiguous || !(block.preferredPeriod! > 0)) {
            return event;
        }
        const period = block.preferredPeriod!, distance = Math.min(...block.refAnchors.map(anchor => Math.abs(event.time - (anchor + Math.round((event.time - anchor) / period) * period))));
        const keep = distance <= CONCURRENCE_WINDOW;
        return keep ? event : { ...event, strength: 0 };
    });
    return projected;
}
