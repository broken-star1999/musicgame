import type { ScrollMode } from '../types';

const NEAR_WIDTH_RATIO = 0.8;
const FAR_WIDTH_RATIO = 0.13;

/** Both modes reach the line at exactly noteTime; only their visual path differs. */
export function noteScreenY(noteTime: number, songTime: number, travel: number, hitY: number, mode: ScrollMode = 'screen') {
  const progress = 1 - (noteTime - songTime) / travel;
  if (mode === 'screen') return hitY * progress;
  // Constant displacement relative to local lane width, rather than to pixels.
  // dy/dt / roadWidth(y) is constant, avoiding the diminishing relative motion
  // of a linearly moving note that grows over sixfold along the perspective road.
  const depth = Math.log(NEAR_WIDTH_RATIO / FAR_WIDTH_RATIO);
  return hitY * Math.expm1(depth * progress) / Math.expm1(depth);
}

/** The road continues beyond the two-line judgment frame. */
export function stageLayout(width: number, height: number) {
  const hitY = height * 0.81, nearWidth = width * NEAR_WIDTH_RATIO, farWidth = width * FAR_WIDTH_RATIO;
  const frameTop = hitY - Math.max(18, Math.min(36, height * 0.075));
  const roadWidth = (y: number) => farWidth + (nearWidth - farWidth) * Math.max(0, y / Math.max(1, hitY));
  const xAt = (boundary: number, y: number) => width / 2 + (boundary / 4 - 0.5) * roadWidth(y);
  const laneAt = (x: number, y: number): number | null => {
    if (y < 0 || y > height) return null;
    // Each visible lane is touchable from top to bottom, including after the frame.
    const span = roadWidth(y), left = width / 2 - span / 2;
    if (x < left || x >= left + span) return null;
    return Math.min(3, Math.floor((x - left) / (span / 4)));
  };
  return { hitY, frameTop, nearWidth, farWidth, roadWidth, xAt, laneAt };
}
