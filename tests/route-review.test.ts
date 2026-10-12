import test from "node:test";
import assert from "node:assert/strict";
import { applyReviewedOrder, reviewRoute } from "../src/route-review";
import { seed } from "../src/seed";

test("Death Valley order follows the known road branches without promising a loop", () => {
  const review = reviewRoute(seed, "2026-12-21")!;
  assert.equal(review.status, "in-order");
  assert.equal(review.canApply, false);
  assert.match(review.explanation, /return legs/);
  assert.deepEqual(review.stops.map((s) => s.id), ["checkout", "furnace", "badwater", "zabriskie", "dante", "fairfield"]);
});

test("Joshua Tree order removes the Cholla-to-Hidden-Valley reversal without editing stops", () => {
  const trip = structuredClone(seed);
  trip.events.find((s) => s.id === "hidden")!.notes = "My own picnic plan";
  const updated = applyReviewedOrder(trip, "2026-12-22");
  assert.deepEqual(updated.events.filter((s) => s.date === "2026-12-22").map((s) => s.id), ["jt", "hidden", "cap", "keys", "arch", "cholla", "sandiego"]);
  for (const stop of trip.events) {
    const next = updated.events.find((s) => s.id === stop.id)!;
    if (stop.id === "cap" && stop.lat === 33.958 && stop.lng === -116.163) {
      assert.deepEqual(next, { ...stop, lat: 33.98921, lng: -116.163646 });
    } else assert.equal(next, stop);
  }
  assert.deepEqual(updated.events.filter((s) => s.date !== "2026-12-22"), trip.events.filter((s) => s.date !== "2026-12-22"));
  assert.equal(reviewRoute(updated, "2026-12-22")!.status, "in-order");
  assert.equal(applyReviewedOrder(updated, "2026-12-22"), updated);
});

test("changed or added places cannot inherit a reviewed route", () => {
  for (const change of ["name", "coordinate", "added", "anchor"] as const) {
    const trip = structuredClone(seed);
    if (change === "name") trip.events.find((s) => s.id === "jt")!.location = "Joshua Tree National Park Visitor Center, Twentynine Palms";
    if (change === "coordinate") trip.events.find((s) => s.id === "hidden")!.lng = -117;
    if (change === "added") trip.events.push({ ...trip.events.find((s) => s.id === "arch")!, id: "extra-stop" });
    if (change === "anchor") trip.events.find((s) => s.id === "fairfield")!.location = "A hotel in Las Vegas";
    assert.equal(reviewRoute(trip, "2026-12-22")!.status, "needs-review", change);
    assert.equal(applyReviewedOrder(trip, "2026-12-22"), trip, change);
  }
});

test("omitted optional stop is not reintroduced", () => {
  const trip = { ...seed, events: seed.events.filter((s) => s.id !== "arch") };
  const updated = applyReviewedOrder(trip, "2026-12-22");
  assert.equal(updated.events.length, trip.events.length);
  assert.deepEqual(updated.events.filter((s) => s.date === "2026-12-22").map((s) => s.id), ["jt", "hidden", "cap", "keys", "cholla", "sandiego"]);
});

test("saved times that conflict with suggested order require review", () => {
  const trip = structuredClone(seed);
  trip.events.find((s) => s.id === "hidden")!.time = "13:00";
  trip.events.find((s) => s.id === "cholla")!.time = "10:00";
  const review = reviewRoute(trip, "2026-12-22")!;
  assert.equal(review.status, "needs-review");
  assert.equal(review.canApply, false);
  assert.match(review.reason!, /saved times/);
  assert.equal(applyReviewedOrder(trip, "2026-12-22"), trip);
});

test("unreviewed dates do not receive a route claim", () => {
  assert.equal(reviewRoute(seed, "2026-12-18"), null);
  assert.equal(applyReviewedOrder(seed, "2026-12-18"), seed);
});

test("only the exact legacy Cap Rock coordinate is corrected", () => {
  const trip = structuredClone(seed);
  const cap = trip.events.find((s) => s.id === "cap")!;
  cap.lat = 33.958;
  cap.lng = -116.163;
  const corrected = applyReviewedOrder(trip, "2026-12-22").events.find((s) => s.id === "cap")!;
  assert.equal(corrected.lat, 33.98921);
  assert.equal(corrected.lng, -116.163646);
  cap.lat = 33.9894;
  cap.lng = -116.164;
  const custom = applyReviewedOrder(trip, "2026-12-22").events.find((s) => s.id === "cap")!;
  assert.equal(custom, cap);
});
