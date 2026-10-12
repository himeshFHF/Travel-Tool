import test from "node:test";
import assert from "node:assert/strict";
import { dayDirections, directionParts, directionPoint, googleMapsDirectionsUrl } from "../src/directions";
import type { DirectionPoint } from "../src/directions";
import type { Trip } from "../src/model";
import { seed } from "../src/seed";

test("Death Valley opens all saved stops with qualified destinations and no booking information", () => {
  const plan = dayDirections(seed, "2026-12-21");
  assert.equal(plan.complete, true);
  assert.equal(plan.desktopParts.length, 1);
  const params = new URL(plan.desktopParts[0].url).searchParams;
  assert.equal(params.get("api"), "1");
  assert.equal(params.get("travelmode"), "driving");
  assert.match(params.get("origin")!, /150 E Angeleno/);
  assert.match(params.get("destination")!, /6333 Encelia/);
  assert.equal(params.get("waypoints")!.split("|").length, 4);
  assert.deepEqual(plan.points.map((p) => p.eventId), ["burbank", "furnace", "badwater", "zabriskie", "dante", "fairfield"]);
  const privateTrip = structuredClone(seed);
  privateTrip.title = "Private secret trip";
  privateTrip.events.forEach((s) => s.notes = "Confirmation SECRET123 lastname PrivatePerson");
  assert.equal(dayDirections(privateTrip, "2026-12-21").desktopParts[0].url, plan.desktopParts[0].url);
});

test("mobile parts contain every stop in order and share endpoints", () => {
  const plan = dayDirections(seed, "2026-12-21");
  assert.equal(plan.mobileParts.length, 2);
  assert.deepEqual(plan.mobileParts.flatMap((part, i) => (i ? part.points.slice(1) : part.points).map((p) => p.query)), plan.points.map((p) => p.query));
  for (const part of plan.mobileParts) {
    const params = new URL(part.url).searchParams;
    assert.ok((params.get("waypoints")?.split("|").length || 0) <= 3);
  }
});

test("previous overnight hotel is included and hiking stops use parking locations", () => {
  const plan = dayDirections(seed, "2026-12-22");
  assert.equal(plan.points[0].eventId, "fairfield");
  assert.match(plan.points.find((p) => p.eventId === "arch")!.query, /Trailhead, Twin Tanks/);
  assert.match(plan.points.find((p) => p.eventId === "cap")!.query, /Parking/);
  assert.equal(plan.complete, false);
  assert.deepEqual(plan.unresolved.map((s) => s.eventId), ["sandiego"]);
});

test("island day splits land drives from the boat and includes the return hotel", () => {
  const plan = dayDirections(seed, "2026-12-19");
  assert.equal(plan.mixedTransport, true);
  assert.deepEqual(plan.desktopParts.map((part) => part.points.map((p) => p.eventId)), [["burbank", "anacapa"], ["anacapa", "burbank"]]);
  assert.equal(plan.placeLinks.length, 1);
  assert.match(new URL(plan.placeLinks[0].url).searchParams.get("query")!, /Anacapa Island/);
  assert.ok(plan.desktopParts.every((part) => part.points.every((p) => p.kind === "road")));
});

test("arrival and departure flights use the local airport, removing only adjacent duplicate places", () => {
  const outbound = dayDirections(seed, "2026-12-18");
  assert.match(outbound.points[0].query, /Los Angeles International/);
  assert.ok(!outbound.desktopParts[0].url.includes("Dallas"));
  assert.equal(outbound.points.filter((p) => /Los Angeles International/.test(p.query)).length, 1);
  assert.equal(outbound.points.filter((p) => /Hotel Burbank/.test(p.query)).length, 2);
  const home = dayDirections(seed, "2026-12-25");
  assert.equal(home.points.length, 1);
  assert.match(home.points[0].query, /San Diego International/);
  assert.ok(!new URL(home.desktopParts[0].url).searchParams.has("origin"));
});

test("edited names win over prepared locations and saved order immediately changes directions", () => {
  const trip = structuredClone(seed);
  const arch = trip.events.find((s) => s.id === "arch")!;
  arch.location = "Some New Trailhead, 15 Main Street, CA";
  assert.equal(directionPoint(arch, trip)!.query, arch.location);
  assert.equal(directionPoint(arch, trip)!.prepared, false);
  const a = trip.events.findIndex((s) => s.id === "furnace");
  const b = trip.events.findIndex((s) => s.id === "badwater");
  [trip.events[a], trip.events[b]] = [trip.events[b], trip.events[a]];
  assert.deepEqual(dayDirections(trip, "2026-12-21").points.slice(1, 3).map((p) => p.eventId), ["badwater", "furnace"]);
});

test("URLs are encoded and split within the supported URL length without losing places", () => {
  const points: DirectionPoint[] = Array.from({ length: 20 }, (_, i) => ({ eventId: `${i}`, label: `Place ${i}`, query: `Place ${i} & rue des Écoles, ${"水".repeat(60)}`, kind: "road", prepared: false }));
  const parts = directionParts(points, 9);
  assert.ok(parts.every((part) => part.url.length <= 2048));
  assert.deepEqual(parts.flatMap((part, i) => (i ? part.points.slice(1) : part.points).map((p) => p.eventId)), points.map((p) => p.eventId));
  const url = googleMapsDirectionsUrl(points.slice(0, 2))!;
  assert.equal(new URL(url).searchParams.get("origin"), points[0].query);
});

test("empty days and missing or unsupported flight locations do not invent destinations", () => {
  const trip: Trip = { ...seed, events: [] };
  assert.equal(dayDirections(trip, "2026-12-21").desktopParts.length, 0);
  const source = seed.events[0];
  assert.equal(directionPoint({ ...source, location: "XXX → LAX", date: "2026-12-20" }, seed), undefined);
  assert.equal(directionPoint({ ...source, type: "stay", location: "Hotel to choose" }, seed), undefined);
  assert.equal(directionPoint({ ...source, type: "activity", location: "One place|injected waypoint" }, seed), undefined);
  assert.equal(directionPoint({ ...source, type: "activity", location: "水".repeat(300) }, seed), undefined);
});
