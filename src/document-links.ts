import type { Document, Stop } from "./model";

/** Call these helpers with documents and stops from the same trip snapshot.
 * Document event IDs are local to that trip, not global hotel identities.
 */
function hotelIdentity(stop: Stop) {
  if (stop.type !== "stay") return "";
  const name = stop.location.split(/[·|\n]/)[0].normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  if (!name || /\b(?:to choose|tbd|not selected|accommodation needed)\b/.test(stop.location.toLowerCase())
    || /^(?:hotel|accommodation|stay|lodging)$/.test(name)) return "";
  return name;
}

function hasStayDates(stop: Stop): stop is Stop & { checkoutDate: string } {
  return stop.type === "stay" && !!stop.checkoutDate
    && /^\d{4}-\d{2}-\d{2}$/.test(stop.date) && /^\d{4}-\d{2}-\d{2}$/.test(stop.checkoutDate)
    && !Number.isNaN(Date.parse(stop.date)) && !Number.isNaN(Date.parse(stop.checkoutDate))
    && new Date(stop.date).toISOString().slice(0,10) === stop.date
    && new Date(stop.checkoutDate).toISOString().slice(0,10) === stop.checkoutDate
    && stop.checkoutDate > stop.date;
}

/** Find the single overnight stay represented by a hotel stop or checkout reminder.
 * A separate visit with its own checkout date always retains its own evidence.
 */
export function hotelStayForStop(stop: Stop, stops: Stop[]): Stop | undefined {
  const identity = hotelIdentity(stop);
  if (!identity) return undefined;
  if (hasStayDates(stop)) return stop;
  if (stop.checkoutDate) return undefined;
  let candidates = stops.filter((stay) => hasStayDates(stay)
    && hotelIdentity(stay) === identity && stay.date <= stop.date && stay.checkoutDate >= stop.date);
  if (stop.checkout || /\bcheck[\s\u2010-\u2015-]*out\b/i.test(`${stop.title} ${stop.notes}`)) {
    const endings = candidates.filter((stay) => stay.checkoutDate === stop.date);
    if (endings.length) candidates = endings;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function uniqueDocuments(documents: Document[]) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

/** A booking attached once remains available on every stop of that hotel stay. */
export function documentsForStop(stop: Stop, documents: Document[], stops: Stop[]): Document[] {
  const ids = new Set([stop.id]);
  const stay = hotelStayForStop(stop, stops);
  if (stay) {
    ids.add(stay.id);
    for (const related of stops) if (hotelStayForStop(related, stops)?.id === stay.id) ids.add(related.id);
  }
  return uniqueDocuments(documents.filter((document) => document.eventId && ids.has(document.eventId)));
}

/** Include arrival, every occupied night, and checkout day without duplicating files.
 * Whole-trip documents remain in the document collection, not on every day's stops.
 */
export function documentsForDay(date: string, documents: Document[], stops: Stop[]): Document[] {
  const applicable = stops.filter((stop) => stop.date === date
    || (hasStayDates(stop) && hotelIdentity(stop) && stop.date <= date && date <= stop.checkoutDate));
  return uniqueDocuments(applicable.flatMap((stop) => documentsForStop(stop, documents, stops)));
}
