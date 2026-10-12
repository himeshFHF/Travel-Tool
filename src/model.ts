import { documentsForStop } from "./document-links";

export type Checkout = {
  time: string;
  source: "booking" | "manual";
  documentId?: string;
  documentName?: string;
  evidence?: string;
};
export type Stop = {
  id: string;
  date: string;
  time: string;
  title: string;
  type: "flight" | "stay" | "activity" | "drive";
  status: "reported" | "planned" | "optional";
  /** Only set when a non-flight stop has a real departure, entry, or appointment deadline. */
  fixedTime?: boolean;
  location: string;
  notes: string;
  lat?: number;
  lng?: number;
  url?: string;
  zone?: string;
  checkoutDate?: string;
  checkout?: Checkout;
  staySource?: {
    start: string;
    end: string;
    source: "booking";
    documentId: string;
    documentName: string;
    evidence: string;
  };
};
export type Trip = {
  routeRevision?: 1;
  title: string;
  start: string;
  end: string;
  events: Stop[];
};
export type Document = {
  id: string;
  name: string;
  eventId: string | null;
  size: number;
  mime: string;
};
export const dates = Array.from({ length: 8 }, (_, i) => `2026-12-${18 + i}`);
export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
export const localDate = (now = new Date(), zone = "America/Los_Angeles") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export function timeLabel(time: string) {
  if (!time) return "Time to plan";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export const needsBookingTime = (stop: Stop) => {
  if (stop.type === "flight") return true;
  if (stop.type !== "activity" && stop.type !== "drive") return false;
  if (stop.fixedTime !== undefined) return stop.fixedTime;
  const description = `${stop.title}. ${stop.notes}`;
  const departure = /\b(?:boat|ferry|sailing|tour)\s+(?:departs?|leaves?)\b/i.test(description);
  const entry = /\b(?:timed|reserved) entry (?:required|at|for)\b/i.test(description)
    && !/\b(?:no|not|without)\s+(?:timed|reserved) entry\b/i.test(description);
  return departure || entry;
};

export const stopTimeLabel = (stop: Stop) =>
  stop.time ? timeLabel(stop.time) : needsBookingTime(stop) ? "Check booking time" : "Flexible timing";
export function phase(stop: Stop, now = new Date()) {
  const zone = stop.zone || "America/Los_Angeles";
  const day = localDate(now, zone);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return stop.date < day
    ? "past"
    : stop.date > day
      ? "future"
      : stop.time && stop.time < clock
        ? "past"
        : "upcoming";
}
/** Choose the nearest remaining timed stop, independently of the editable route order.
 * Candidates are on today's date in their own local zone; this trip is in December.
 */
export function nextScheduledStop(stops: Stop[], now = new Date()) {
  return stops
    .filter((s) => s.time && phase(s, now) === "upcoming")
    .map((stop) => {
      const clock = new Intl.DateTimeFormat("en-GB", {
        timeZone: stop.zone || "America/Los_Angeles",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      const minutes = (value: string) => {
        const [h, m] = value.split(":").map(Number);
        return h * 60 + m;
      };
      return { stop, remaining: minutes(stop.time) - minutes(clock) };
    })
    .sort((a, b) => a.remaining - b.remaining)[0]?.stop;
}
export const missingDetails = (trip: Trip, docs: Document[]) =>
  trip.events.flatMap((e) => [
    ...(!e.time && needsBookingTime(e)
      ? [
          {
            id: e.id + "time",
            eventId: e.id,
            title: `Check the ${e.type === "flight" ? "flight departure" : "ticket or booking"} time for ${e.title}`,
            detail: `${dateLabel(e.date)} · Add the time shown on your confirmation`,
          },
        ]
      : []),
    ...(e.status === "reported" && !documentsForStop(e,docs,trip.events).length
      ? [
          {
            id: e.id + "doc",
            eventId: e.id,
            title: `Add confirmation: ${e.title}`,
            detail: "Reported in itinerary · original document missing",
          },
        ]
      : []),
    ...(e.type === "stay" && e.status === "planned"
      ? [
          {
            id: e.id + "stay",
            eventId: e.id,
            title: `Confirm ${e.title}`,
            detail: "Accommodation still needs booking",
          },
        ]
      : []),
  ]);
