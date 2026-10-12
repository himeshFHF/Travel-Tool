import test from "node:test";
import assert from "node:assert/strict";
import { upgradeTrip } from "../server/trip-upgrades";
import { seed } from "../src/seed";

test("original Day 5 is corrected once while notes and other days stay intact",()=>{
  const original=structuredClone(seed);
  original.events.find(stop=>stop.id==="hidden")!.notes="Keep this picnic note";
  const updated=upgradeTrip(original);
  assert.deepEqual(updated.events.filter(s=>s.date==="2026-12-22").map(s=>s.id),["jt","hidden","cap","keys","arch","cholla","sandiego"]);
  assert.equal(updated.events.find(s=>s.id==="hidden")?.notes,"Keep this picnic note");
  assert.deepEqual(updated.events.filter(s=>s.date!=="2026-12-22"),original.events.filter(s=>s.date!=="2026-12-22"));
  assert.equal(upgradeTrip(updated),updated);
  const manuallyReordered={...updated,events:original.events};
  assert.equal(upgradeTrip(manuallyReordered),manuallyReordered);
});

test("route correction preserves custom ordering, changed places and conflicting times",()=>{
  for(const variation of ["order","place","time"]){
    const trip=structuredClone(seed);
    if(variation==="order") trip.events.reverse();
    if(variation==="place") trip.events.find(s=>s.id==="fairfield")!.location="Different hotel";
    if(variation==="time") {trip.events.find(s=>s.id==="hidden")!.time="14:00";trip.events.find(s=>s.id==="cholla")!.time="10:00";}
    const upgraded=upgradeTrip(trip);
    assert.deepEqual(upgraded.events,trip.events,variation);
    assert.equal(upgraded.routeRevision,1);
  }
});
