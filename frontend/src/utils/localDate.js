/**
 * The calendar date where the user is, not where UTC is.
 *
 * `new Date().toISOString()` converts to UTC before formatting, so anywhere
 * east of Greenwich it names yesterday for part of every day. The analytics
 * panel opened on that value: at 02:18 in India it selected 15 September while
 * the header beside it read 16 September, showing a day the user had not asked
 * for. An empty day full of zeros reads as a broken panel, so picking the
 * wrong one is not a cosmetic bug.
 */
export function todayLocalISO(now = new Date()) {
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return shifted.toISOString().split('T')[0];
}
