import type { Trip } from "../src/model";
import { applyReviewedOrder } from "../src/route-review";

/** Apply the requested correction once, only to the original Day 5 ordering.
 * A custom order, changed place or conflicting appointment keeps its own plan.
 */
export function upgradeTrip(trip: Trip): Trip {
  if (trip.routeRevision === 1) return trip;
  const original = ["jt", "keys", "cap", "cholla", "hidden", "arch", "sandiego"];
  const current = trip.events.filter(stop=>stop.date==="2026-12-22").map(stop=>stop.id);
  const unchangedOrder = current.length === original.length && current.every((id,i)=>id===original[i]);
  const updated = unchangedOrder ? applyReviewedOrder(trip,"2026-12-22") : trip;
  return {...updated,routeRevision:1};
}
