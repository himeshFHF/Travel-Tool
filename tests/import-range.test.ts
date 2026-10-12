import test from "node:test";
import assert from "node:assert/strict";
import { parseItinerary } from "../src/import";

test("itinerary notes resolve months across the selected trip year boundary", () => {
  const notes=parseItinerary("December 30: Arrive\nDinner\nJanuary 2: Explore\nJanuary 8: Outside trip",2026,{start:"2026-12-30",end:"2027-01-03"});
  assert.deepEqual(notes.map(n=>n.date),["2026-12-30","2027-01-02"]);
  assert.match(notes[0].notes!,/Dinner/);
});
test("impossible dates are rejected without attaching their content to another day", () => {
  const notes=parseItinerary("February 27, 2027: Museum\nFebruary 30, 2027: Invalid\nIgnore this\n2027-02-28: Walk\n2027-02-31: Invalid",2027);
  assert.deepEqual(notes.map(n=>n.date),["2027-02-27","2027-02-28"]);
  assert.ok(!notes[0].notes!.includes("Ignore"));
});
