/** An unchanged estimate must keep the detected, potentially varying beat map. */
export function resolveBpmReference(draft: string, detected: number): number | undefined {
  const value = Number(draft);
  if (!Number.isFinite(value) || value < 30 || value > 300) throw new Error('BPM 请填写 30～300 之间的数值。');
  return value === detected ? undefined : value;
}
