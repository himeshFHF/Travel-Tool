import type { Stop } from "./model";

export type Airline = {
  code: "AA" | "AS";
  name: string;
  checkInUrl: string;
  guidanceUrl: string;
};

const airlines: Airline[] = [
  {
    code: "AA",
    name: "American Airlines",
    checkInUrl: "https://www.aa.com/reservation/flightCheckInViewReservationsAccess.do",
    guidanceUrl: "https://www.aa.com/web/i18n/travel-info/check-in-and-arrival.html",
  },
  {
    code: "AS",
    name: "Alaska Airlines",
    checkInUrl: "https://www.alaskaair.com/checkin",
    guidanceUrl: "https://www.alaskaair.com/content/about-us/help-contact",
  },
];

export function identifyAirline(stop: Stop): Airline | undefined {
  if (stop.type !== "flight") return undefined;
  const text = `${stop.title} ${stop.location} ${stop.notes}`;
  const candidates = airlines.filter(
    (airline) =>
      text.toLowerCase().includes(airline.name.toLowerCase()) ||
      new RegExp(`\\b${airline.code}\\s*\\d{1,4}\\b`, "i").test(text),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function flightTimeZone(stop: Stop): string | undefined {
  if (stop.zone) return stop.zone;
  // Infer only airports whose departure zone is known, never the arrival zone.
  const departure = stop.location.match(/^\s*([A-Z]{3})\s*(?:→|->|\bto\b)/i)?.[1]?.toUpperCase();
  const zones: Record<string, string> = {
    DFW: "America/Chicago",
    LAX: "America/Los_Angeles",
    SAN: "America/Los_Angeles",
  };
  return departure ? zones[departure] : undefined;
}

/** Resolve a local departure time without relying on the device's time zone.
 * Missing, invalid, nonexistent, or ambiguous local times need user correction.
 */
export function zonedDeparture(date: string, time: string, zone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (year < 1000 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).toISOString().slice(0, 16) !== `${date}T${time}`) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const localStamp = (instant: number) => {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
      );
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    };
    // Sampling either side captures both offsets when the date crosses DST.
    const offsets = new Set(
      [-36, 0, 36].map((hours) => {
        const instant = wall + hours * 60 * 60 * 1000;
        return localStamp(instant) - instant;
      }),
    );
    const candidates = [...offsets]
      .map((offset) => wall - offset)
      .filter((instant) => localStamp(instant) === wall);
    return candidates.length === 1 ? new Date(candidates[0]) : null;
  } catch {
    return null;
  }
}

export type FlightCheckInInfo = {
  airline?: Airline;
  flightNumber?: string;
  zone?: string;
  departureAt: Date | null;
  opensAt: Date | null;
  status: "incomplete" | "future" | "open" | "near-departure" | "past";
};

export function flightCheckIn(stop: Stop, now = new Date()): FlightCheckInInfo {
  const airline = identifyAirline(stop);
  const zone = flightTimeZone(stop);
  const departureAt = stop.type === "flight" && zone
    ? zonedDeparture(stop.date, stop.time, zone)
    : null;
  const numbers = airline
    ? [...`${stop.title} ${stop.notes}`.matchAll(new RegExp(`\\b${airline.code}\\s*(\\d{1,4})\\b`, "gi"))]
      .map((match) => `${airline.code}${match[1]}`)
    : [];
  const uniqueNumbers = [...new Set(numbers)];
  const opensAt = airline && departureAt
    ? new Date(departureAt.getTime() - 24 * 60 * 60 * 1000)
    : null;
  const result: FlightCheckInInfo = {
    airline,
    flightNumber: uniqueNumbers.length === 1 ? uniqueNumbers[0] : undefined,
    zone,
    departureAt,
    opensAt,
    status: "incomplete",
  };
  if (!opensAt || !departureAt || !Number.isFinite(now.getTime())) return result;
  result.status = now >= departureAt
    ? "past"
    : now < opensAt
      ? "future"
      // This is an approaching-departure notice, not an airline cutoff rule.
      : departureAt.getTime() - now.getTime() <= 2 * 60 * 60 * 1000
        ? "near-departure"
        : "open";
  return result;
}

export function checkInDateLabel(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

export function checkInCountdown(opensAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.ceil((opensAt.getTime() - now.getTime()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
}
