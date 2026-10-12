import type { Stop, Trip } from "./model";

export type DirectionPoint = {
  eventId: string;
  label: string;
  query: string;
  kind: "road" | "island";
  prepared: boolean;
  hotel?: boolean;
};
export type DirectionPart = { points: DirectionPoint[]; url: string };
export type DayDirectionsPlan = {
  points: DirectionPoint[];
  desktopParts: DirectionPart[];
  mobileParts: DirectionPart[];
  placeLinks: { point: DirectionPoint; url: string }[];
  unresolved: { eventId: string; label: string }[];
  includesHotel: boolean;
  mixedTransport: boolean;
  complete: boolean;
};

const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();

// Qualified names point at road access/parking, rather than the middle of a
// hiking destination. Sources: NPS DEVA sightseeing/hiking accessibility;
// NPS JOTR hiking and press kit; Hotel Burbank contact page; Marriott PS PTN.
// Only replace an original, unchanged name. An edited location always wins.
const preparedPlaces: Record<string, { names: string[]; query: string; kind?: "island" }> = {
  burbank: { names: ["Hotel Burbank · 150 E Angeleno Ave"], query: "Hotel Burbank, 150 E Angeleno Ave, Burbank, CA 91502" },
  checkout: { names: ["Hotel Burbank"], query: "Hotel Burbank, 150 E Angeleno Ave, Burbank, CA 91502" },
  rental: { names: ["Los Angeles International Airport"], query: "Los Angeles International Airport, Los Angeles, CA" },
  griffith: { names: ["Griffith Observatory"], query: "Griffith Observatory, Los Angeles, CA" },
  beverly: { names: ["Rodeo Drive"], query: "Rodeo Drive, Beverly Hills, CA" },
  anacapa: { names: ["Island Packers · Channel Islands Harbor"], query: "Island Packers, 3550 Harbor Blvd, Oxnard, CA" },
  island: { names: ["Anacapa Island"], query: "Anacapa Island, Channel Islands National Park, CA", kind: "island" },
  universal: { names: ["Universal Studios Hollywood"], query: "Universal Studios Hollywood, Universal City, CA" },
  furnace: { names: ["Furnace Creek Visitor Center"], query: "Furnace Creek Visitor Center, Death Valley National Park, CA" },
  badwater: { names: ["Badwater Basin"], query: "Badwater Basin Parking, Death Valley National Park, CA" },
  zabriskie: { names: ["Zabriskie Point"], query: "Zabriskie Point Parking Lot, Death Valley National Park, CA" },
  dante: { names: ["Dante’s View", "Dantes View"], query: "Dantes View Parking, Death Valley National Park, CA" },
  fairfield: { names: ["Fairfield Inn & Suites Twentynine Palms"], query: "Fairfield Inn & Suites, 6333 Encelia Avenue, Twentynine Palms, CA 92277" },
  jt: { names: ["Joshua Tree Visitor Center"], query: "Joshua Tree Visitor Center, 6554 Park Blvd, Joshua Tree, CA" },
  keys: { names: ["Keys View"], query: "Keys View Parking, Joshua Tree National Park, CA" },
  cap: { names: ["Cap Rock"], query: "Cap Rock Parking Area, Joshua Tree National Park, CA" },
  cholla: { names: ["Cholla Cactus Garden"], query: "Cholla Cactus Garden Parking, Joshua Tree National Park, CA" },
  hidden: { names: ["Hidden Valley"], query: "Hidden Valley Picnic Area, Joshua Tree National Park, CA" },
  arch: { names: ["Arch Rock"], query: "Arch Rock Trailhead, Twin Tanks, Joshua Tree National Park, CA" },
  "return-car": { names: ["San Diego International Airport"], query: "San Diego International Airport, San Diego, CA" },
};

const airports: Record<string, string> = {
  LAX: "Los Angeles International Airport, Los Angeles, CA",
  SAN: "San Diego International Airport, San Diego, CA",
  DFW: "Dallas Fort Worth International Airport, TX",
};

export function directionPoint(stop: Stop, trip: Trip): DirectionPoint | undefined {
  const location = stop.location.trim();
  if (!location || location.length > 500 || /[\r\n|]/.test(location) ||
      /\b(to choose|to be (?:confirmed|decided)|tbd|unknown|location needed)\b/i.test(location)) return;
  // An open city day is not a specific driving destination.
  if (["sd23", "sd24"].includes(stop.id) && normalize(location) === "san diego") return;
  let query = location;
  let prepared = false;
  let kind: DirectionPoint["kind"] = /\banacapa island\b/i.test(location) ? "island" : "road";
  if (stop.type === "flight") {
    const route = location.toUpperCase().match(/^([A-Z]{3})\s*(?:→|->|–|TO)\s*([A-Z]{3})$/);
    // A driving day begins after the arrival flight or ends at the departure
    // airport. Never turn a flight segment into a cross-country driving route.
    const airport = route && (stop.date === trip.start ? route[2] : stop.date === trip.end ? route[1] : undefined);
    if (!airport || !airports[airport]) return;
    query = airports[airport];
    prepared = true;
  } else {
    const known = preparedPlaces[stop.id];
    if (known?.names.some((name) => normalize(name) === normalize(location))) {
      query = known.query;
      prepared = true;
      kind = known.kind || "road";
    }
  }
  // Leave enough room for a pair of places plus URL parameters, even when
  // Unicode characters expand during URL encoding.
  if (new URLSearchParams({ destination: query }).toString().length > 900) return;
  return { eventId: stop.id, label: location, query, kind, prepared, hotel: stop.type === "stay" };
}

export function googleMapsPlaceUrl(query: string) {
  const params = new URLSearchParams({ api: "1", query });
  return `https://www.google.com/maps/search/?${params}`;
}

export function googleMapsDirectionsUrl(points: DirectionPoint[]) {
  if (!points.length) return undefined;
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (points.length > 1) params.set("origin", points[0].query);
  params.set("destination", points.at(-1)!.query);
  if (points.length > 2) params.set("waypoints", points.slice(1, -1).map((p) => p.query).join("|"));
  const url = `https://www.google.com/maps/dir/?${params}`;
  return url.length <= 2048 ? url : undefined;
}

/** Every part shares its endpoint with the next origin; never drop a waypoint.
 * Maps URL support: 3 intermediate waypoints on mobile browsers, 9 elsewhere.
 * https://developers.google.com/maps/documentation/urls/get-started#directions
 */
export function directionParts(points: DirectionPoint[], maxWaypoints: number): DirectionPart[] {
  if (!points.length) return [];
  const parts: DirectionPart[] = [];
  let start = 0;
  while (start < points.length) {
    let end = Math.min(points.length, start + maxWaypoints + 2);
    let chunk = points.slice(start, end);
    let url = googleMapsDirectionsUrl(chunk);
    while (!url && end > start + 1) {
      end--;
      chunk = points.slice(start, end);
      url = googleMapsDirectionsUrl(chunk);
    }
    if (!url) throw new Error("A map location is too long to open.");
    parts.push({ points: chunk, url });
    if (end === points.length) break;
    // At least two points are necessary to make progress with a joined route.
    if (end <= start + 1) { start++; } else { start = end - 1; }
  }
  return parts;
}

function deduplicateNeighbors(points: DirectionPoint[]) {
  return points.filter((point, i) => !i || normalize(points[i - 1].query) !== normalize(point.query));
}

export function dayDirections(trip: Trip, date: string): DayDirectionsPlan {
  const day = trip.events.filter((stop) => stop.date === date);
  const unresolved: DayDirectionsPlan["unresolved"] = [];
  if (!day.length) return { points: [], desktopParts: [], mobileParts: [], placeLinks: [], unresolved, includesHotel: false, mixedTransport: false, complete: false };
  const previousStay = trip.events
    .filter((s) => s.type === "stay" && s.date < date && s.checkoutDate && s.checkoutDate >= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const overnightStay = trip.events
    .filter((s) => s.type === "stay" && s.date <= date && s.checkoutDate && s.checkoutDate > date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const routeStops = [...(previousStay ? [previousStay] : []), ...day, ...(overnightStay ? [overnightStay] : [])];
  const points = deduplicateNeighbors(routeStops.flatMap((stop) => {
    const point = directionPoint(stop, trip);
    if (point) return [point];
    if (!unresolved.some((entry) => entry.eventId === stop.id)) unresolved.push({ eventId: stop.id, label: stop.location || stop.title });
    return [];
  }));
  const mixedTransport = points.some((p) => p.kind === "island");
  const placeLinks = points.filter((p) => p.kind === "island").map((point) => ({ point, url: googleMapsPlaceUrl(point.query) }));
  const groups: DirectionPoint[][] = [];
  let current: DirectionPoint[] = [];
  let harbor: DirectionPoint | undefined;
  for (const point of points) {
    if (point.kind === "island") {
      if (current.length) groups.push(current);
      // This itinerary's island boat returns to the same named harbor.
      const last = current.at(-1);
      harbor = last?.eventId === "anacapa" && last.prepared ? last : undefined;
      current = [];
    } else {
      if (!current.length && harbor) { current.push(harbor); harbor = undefined; }
      current.push(point);
    }
  }
  if (current.length) groups.push(deduplicateNeighbors(current));
  return {
    points,
    desktopParts: groups.flatMap((group) => directionParts(group, 9)),
    mobileParts: groups.flatMap((group) => directionParts(group, 3)),
    placeLinks,
    unresolved,
    includesHotel: Boolean(previousStay || overnightStay),
    mixedTransport,
    complete: !unresolved.length && !mixedTransport,
  };
}
