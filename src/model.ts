export type Stop = {
  id: string;
  date: string;
  time: string;
  title: string;
  type: "flight" | "stay" | "activity" | "drive";
  status: "reported" | "planned" | "optional";
  location: string;
  notes: string;
  lat?: number;
  lng?: number;
  url?: string;
  zone?: string;
  checkoutDate?: string;
};
export type Trip = {
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
    ...(!e.time
      ? [
          {
            id: e.id + "time",
            eventId: e.id,
            title: `Set a time for ${e.title}`,
            detail: dateLabel(e.date),
          },
        ]
      : []),
    ...(e.status === "reported" && !docs.some((d) => d.eventId === e.id)
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
