/**
 * How full a resource bar should be, or that it cannot be drawn.
 *
 * The VRAM and RAM bars in Settings were `w-[30%]` and `w-[43%]` — literals,
 * drawn identically on every machine. Once the numbers above them were changed
 * to say "Not reported" the pair became actively misleading: a label admitting
 * nothing was measured, sitting above a bar that looked like a measurement.
 *
 * Returning null rather than 0 for "unknown" is the point. A zero-width bar and
 * an empty bar look the same, so a machine reporting nothing would be
 * indistinguishable from one genuinely using no memory. The caller renders a
 * different, obviously-unavailable state instead.
 */

/**
 * @param {number|null|undefined} used   e.g. GB in use
 * @param {number|null|undefined} total  e.g. GB installed
 * @returns {number|null} 0-100, or null when it cannot honestly be drawn
 */
export function usagePercent(used, total) {
  // Rejected before Number() touches them, because `Number(null)` is 0 and
  // `Number('')` is 0 - both perfectly finite. Left to the finite check alone,
  // an unreported reading became "0% used", which is the precise failure this
  // function exists to prevent.
  const missing = (value) => value === null || value === undefined || value === '';
  if (missing(used) || missing(total)) return null;

  const inUse = Number(used);
  const capacity = Number(total);
  // A non-numeric reading, or a capacity of zero, mean the same thing here:
  // there is nothing that can honestly be drawn.
  if (!Number.isFinite(inUse) || !Number.isFinite(capacity)) return null;
  if (capacity <= 0 || inUse < 0) return null;
  // Clamped, because a reading above capacity is a reporting fault rather than
  // a bar that should overflow its track.
  return Math.max(0, Math.min(100, (inUse / capacity) * 100));
}

/**
 * The same value as a CSS width, or null.
 *
 * Rounded to one decimal: a bar is a few hundred pixels wide, so more precision
 * is invisible and only makes the style string churn between renders.
 */
export function usageWidth(used, total) {
  const percent = usagePercent(used, total);
  return percent === null ? null : `${Math.round(percent * 10) / 10}%`;
}

export default usagePercent;
