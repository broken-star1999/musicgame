import type { Analysis, Onset } from '../types';
import { musicalEvents } from './musical-events';

type SignalRole = Extract<NonNullable<Onset['role']>, 'beat' | 'half' | 'quarter'>;

/** Preserve the selected signal source and its exact attacks. DSP clock roles
 * guide density reduction; they never synthesize or replace a pulse event. */
export function annotateSignalEvents(analysis: Analysis): Analysis {
  const pulse = analysis.pulse, rhythm = analysis.rhythm;
  if (!pulse?.onsets.length || !rhythm) return analysis;
  // Geometry only: do not bind another frequency band or promote a left-censored
  // f0 candidate into beat evidence without a measured rising edge.
  const bound = musicalEvents({ ...analysis, candidates: pulse.onsets.filter(event => !event.boundary) }, rhythm);
  const byTime = new Map<number, SignalRole>();
  let beats = 0;
  for (const event of bound) {
    const role = event.role;
    if (role === 'beat' || role === 'half' || role === 'quarter') {
      byTime.set(event.time, role);
      if (role === 'beat') beats++;
    }
  }
  // Global support can be low after a rest or volume change. Require actual
  // bound primary attacks rather than gating on that global confidence value.
  if (beats < 3) return analysis;
  return { ...analysis, pulse: { ...pulse, onsets: pulse.onsets.map(event => {
    if (event.boundary) return event;
    const role = byTime.get(event.time);
    return role ? { ...event, role } : event;
  }) } };
}
