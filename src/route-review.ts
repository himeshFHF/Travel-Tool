import type { Stop, Trip } from "./model";

export type RouteSource = { label: string; url: string };
export type RouteReview = {
  date: string;
  park: string;
  status: "in-order" | "suggested" | "needs-review";
  summary: string;
  explanation: string;
  timing: string;
  context: string;
  stops: Stop[];
  canApply: boolean;
  correctsCapRockPin?: boolean;
  reason?: string;
  sources: RouteSource[];
};

type Place = { name: string; lat: number; lng: number; legacyLat?: number; legacyLng?: number };
type Plan = {
  park: string;
  order: string[];
  required: string[];
  places: Record<string, Place>;
  anchor?: { id: string; date: string; place: Place };
  summary: string;
  explanation: string;
  timing: string;
  context: string;
  sources: RouteSource[];
};

const fairfield = {
  name: "Fairfield Inn & Suites Twentynine Palms",
  lat: 34.135,
  lng: -116.087,
};

// These are reviewed routes for the original California itinerary, not a
// straight-line route optimizer. Only the known places/road assumptions qualify.
const plans: Record<string, Plan> = {
  "2026-12-21": {
    park: "Death Valley",
    order: ["checkout", "furnace", "badwater", "zabriskie", "dante", "fairfield"],
    required: ["checkout", "furnace", "fairfield"],
    places: {
      checkout: { name: "Hotel Burbank", lat: 34.1808, lng: -118.3089 },
      furnace: { name: "Furnace Creek Visitor Center", lat: 36.462, lng: -116.866 },
      badwater: { name: "Badwater Basin", lat: 36.23, lng: -116.767 },
      zabriskie: { name: "Zabriskie Point", lat: 36.42, lng: -116.813 },
      dante: { name: "Dante’s View", lat: 36.221, lng: -116.726 },
      fairfield,
    },
    summary: "The park stops follow a sensible order with a west entry and east exit.",
    explanation: "From Furnace Creek, visit Badwater and return north to CA-190. Continue east past Zabriskie, take the Dante’s View spur and return to CA-190, then leave via Death Valley Junction toward CA-127. Badwater and Dante’s have return legs; there is no direct road between them across the mountains.",
    timing: "Allow for both long hotel transfers as well as the park visit. The checkout deadline is not the recommended departure time. Set an early start and check driving times; shorten the sightseeing if the day runs late.",
    context: "Hotel Burbank → west entrance → Death Valley → CA-190 / CA-127 → Twentynine Palms",
    sources: [
      { label: "NPS road map", url: "https://www.nps.gov/deva/planyourvisit/maps.htm" },
      { label: "Dante’s View access", url: "https://www.nps.gov/places/dantes-view.htm" },
      { label: "Current road conditions", url: "https://www.nps.gov/deva/planyourvisit/conditions.htm" },
    ],
  },
  "2026-12-22": {
    park: "Joshua Tree",
    order: ["jt", "hidden", "cap", "keys", "arch", "cholla", "sandiego"],
    required: ["jt", "sandiego"],
    places: {
      jt: { name: "Joshua Tree Visitor Center", lat: 34.128, lng: -116.315 },
      hidden: { name: "Hidden Valley", lat: 34.012, lng: -116.168 },
      // NPS Cap Rock trailhead: https://www.nps.gov/planyourvisit/event-details.htm?id=09A86BA6-F931-1615-F4DF94479BA376E2
      cap: { name: "Cap Rock", lat: 33.98921, lng: -116.163646, legacyLat: 33.958, legacyLng: -116.163 },
      keys: { name: "Keys View", lat: 33.927, lng: -116.188 },
      arch: { name: "Arch Rock", lat: 33.986, lng: -116.02 },
      cholla: { name: "Cholla Cactus Garden", lat: 33.925, lng: -115.929 },
      sandiego: { name: "San Diego", lat: 32.7157, lng: -117.1611 },
    },
    anchor: { id: "fairfield", date: "2026-12-21", place: fairfield },
    summary: "Keep the western sights together, then continue east and south through the park.",
    explanation: "Use the West Entrance after your listed visitor center in Joshua Tree town. Visit Hidden Valley, then Cap Rock and the Keys View spur. Return to Park Boulevard for Arch Rock, then continue down Pinto Basin Road to Cholla and the Cottonwood exit. This avoids going from Cholla back across the park to Hidden Valley.",
    timing: "Keys View requires an out-and-back drive. Arch Rock remains optional. Allow time for the walks, park driving and the onward trip to San Diego; arrival timing depends on the hotel you choose.",
    context: "Twentynine Palms → Joshua Tree town / West Entrance → Cottonwood exit → San Diego",
    sources: [
      { label: "NPS park map", url: "https://www.nps.gov/jotr/planyourvisit/park-map-and-brochure.htm" },
      { label: "Walks and trailheads", url: "https://www.nps.gov/jotr/planyourvisit/hiking.htm" },
      { label: "Current park conditions", url: "https://www.nps.gov/jotr/planyourvisit/conditions.htm" },
    ],
  },
};

const normalize = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function matchesPlace(stop: Stop, place: Place) {
  const name = normalize(stop.location.split("·")[0]);
  // Missing or edited coordinates cannot silently inherit a reviewed route.
  return (
    name === normalize(place.name) &&
    typeof stop.lat === "number" &&
    typeof stop.lng === "number" &&
    (Math.abs(stop.lat - place.lat) < 0.005 ||
      (place.legacyLat !== undefined && stop.lat === place.legacyLat && stop.lng === place.legacyLng)) &&
    Math.abs(stop.lng - place.lng) < 0.005
  );
}

function timesRunBackwards(stops: Stop[]) {
  const times = stops.map((stop) => stop.time).filter(Boolean);
  return times.some((time, index) => index > 0 && time < times[index - 1]);
}

export function reviewRoute(trip: Trip, date: string): RouteReview | null {
  const plan = plans[date];
  if (!plan) return null;
  const current = trip.events.filter((stop) => stop.date === date);
  if (!current.length) return null;
  const ids = current.map((stop) => stop.id);
  const anchor = plan.anchor && trip.events.find((stop) => stop.id === plan.anchor!.id);
  const changed =
    new Set(ids).size !== ids.length ||
    plan.required.some((id) => !ids.includes(id)) ||
    current.some((stop) => !plan.places[stop.id] || !matchesPlace(stop, plan.places[stop.id])) ||
    (plan.anchor && (!anchor || anchor.date !== plan.anchor.date || !matchesPlace(anchor, plan.anchor.place)));
  const base = {
    date,
    park: plan.park,
    summary: plan.summary,
    explanation: plan.explanation,
    timing: plan.timing,
    context: plan.context,
    sources: plan.sources,
  };
  if (changed) {
    return {
      ...base,
      status: "needs-review",
      summary: "Your stops or overnight locations have changed. This route needs another look.",
      explanation: "The earlier suggestion used the original locations and entrance. Check the new stops against the park’s road map before choosing an order.",
      context: "Recheck the starting hotel, park entrance and onward destination.",
      stops: [],
      canApply: false,
    };
  }
  const stops = plan.order.flatMap((id) => current.filter((stop) => stop.id === id));
  const sameOrder = ids.every((id, index) => id === stops[index]?.id);
  const timeConflict = timesRunBackwards(stops);
  const cap = current.find((stop) => stop.id === "cap");
  const correctsCapRockPin = date === "2026-12-22" && cap?.lat === 33.958 && cap.lng === -116.163;
  return {
    ...base,
    status: timeConflict ? "needs-review" : sameOrder && !correctsCapRockPin ? "in-order" : "suggested",
    stops,
    canApply: (!sameOrder || correctsCapRockPin) && !timeConflict,
    correctsCapRockPin,
    reason: timeConflict
      ? "Some saved times conflict with this order. Review those times before rearranging the day."
      : undefined,
  };
}

/** Reorders only the reviewed date; fixes only the exact original Cap Rock pin. */
export function applyReviewedOrder(trip: Trip, date: string): Trip {
  const review = reviewRoute(trip, date);
  if (!review?.canApply) return trip;
  let index = 0;
  return {
    ...trip,
    events: trip.events.map((stop) => {
      const next = stop.date === date ? review.stops[index++] : stop;
      return review.correctsCapRockPin && next.id === "cap" && next.lat === 33.958 && next.lng === -116.163
        ? { ...next, lat: 33.98921, lng: -116.163646 }
        : next;
    }),
  };
}
