/** USD policy arithmetic uses integer millionths, never floating-point totals. */
export function microUsd(value: number): number {
  const scaled = value * 1_000_000;
  const rounded = Math.round(scaled);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.00001) {
    throw new Error("USD amounts must be non-negative, safe, and have at most six decimal places");
  }
  return rounded;
}
