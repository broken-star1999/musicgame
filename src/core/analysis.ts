import { analyzeAudio as source } from './signal-analysis';
import { bindCanonical } from './signal-binding';
export { fingerprint, estimateTempo } from './signal-analysis';
export function analyzeAudio(...args: Parameters<typeof source>): ReturnType<typeof source> { return bindCanonical(source(...args)); }
