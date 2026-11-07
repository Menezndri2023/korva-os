/**
 * `${date}T${time}` read as wall-clock time IN `timeZone` (the business's), as a UTC instant —
 * the browser's own timezone plays no part. Same round-trip as the API's zonedTimeToUtc
 * (apps/api/src/booking/availability/availability.service.ts): the difference between the same
 * instant read in `timeZone` and in UTC is that date's offset, DST included.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naiveUtc = new Date(`${date}T${time}:00.000Z`);
  const asZoned = new Date(naiveUtc.toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(naiveUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(naiveUtc.getTime() + (asUtc.getTime() - asZoned.getTime()));
}
