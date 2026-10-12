import test from "node:test";
import assert from "node:assert/strict";
import {
  localDate,
  phase,
  missingDetails,
  nextScheduledStop,
  needsBookingTime,
  stopTimeLabel,
} from "../src/model";
import { seed } from "../src/seed";
import { parseItinerary } from "../src/import";
import { stopSchema } from "../server/validation";
test("Pacific local date stays on previous day after UTC midnight", () => {
  assert.equal(localDate(new Date("2026-12-20T06:00:00Z")), "2026-12-19");
});
test("Dallas departure uses Central time, not Pacific time", () => {
  const flight = seed.events.find((e) => e.id === "flight-out")!;
  assert.equal(phase(flight, new Date("2026-12-18T12:30:00Z")), "past");
  assert.equal(
    phase(
      { ...flight, zone: "America/Los_Angeles" },
      new Date("2026-12-18T12:30:00Z"),
    ),
    "upcoming",
  );
});
test("booking evidence prompts clear only for the attached stop", () => {
  const empty = missingDetails(seed, []);
  const withDoc = missingDetails(seed, [
    {
      id: "a",
      name: "ticket.pdf",
      eventId: "universal",
      size: 10,
      mime: "application/pdf",
    },
  ]);
  assert.equal(empty.length - withDoc.length, 1);
  assert.ok(!withDoc.some((n) => n.id === "universaldoc"));
  assert.ok(!withDoc.some((n) => n.id === "universaltime"));
});
test("time reminders follow fixed departures and ticket appointments", () => {
  const withoutTimes = {
    ...seed,
    events: seed.events.map((stop) =>
      ["flight-out", "anacapa"].includes(stop.id) ? { ...stop, time: "" } : stop,
    ),
  };
  const reminders = missingDetails(withoutTimes, []);
  const ids = reminders.filter((need) => need.id.endsWith("time")).map((need) => need.id);
  assert.deepEqual(ids, ["flight-outtime", "anacapatime"]);
  assert.match(reminders.find((need) => need.id === "anacapatime")!.title, /ticket or booking time/);
  assert.equal(needsBookingTime(seed.events.find((stop) => stop.id === "anacapa")!), true);
  for (const id of ["rental", "return-car", "universal", "furnace", "cap", "fairfield"]) {
    assert.ok(!ids.includes(`${id}time`), `${id} should not demand an exact time`);
  }
});
test("a saved fixed-time marker round-trips and flexible stops remain editable", () => {
  const walk = seed.events.find((stop) => stop.id === "cap")!;
  const timedWalk = stopSchema.parse({ ...walk, fixedTime: true });
  assert.equal(needsBookingTime(timedWalk), true);
  assert.ok(missingDetails({ ...seed, events: [timedWalk] }, []).some((need) => need.id === "captime"));
  assert.equal(stopTimeLabel(timedWalk), "Check booking time");
  assert.equal(stopTimeLabel(walk), "Flexible timing");
  const ferry = seed.events.find((stop) => stop.id === "anacapa")!;
  assert.equal(needsBookingTime(stopSchema.parse({ ...ferry, fixedTime: false, time: "" })), false);
  assert.equal(stopTimeLabel(ferry), "8:45 AM");
  assert.equal(needsBookingTime({ ...walk, notes: "No timed entry required; visit when convenient." }), false);
  assert.equal(needsBookingTime({ ...walk, notes: "Timed entry required; check the ticket." }), true);
});
test("document parsing produces proposals and never confirmed bookings", () => {
  const parsed = parseItinerary(
    "December 20: Universal\nBring tickets\nDecember 21: Death Valley\nCheck road conditions",
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].date, "2026-12-20");
  assert.equal(parsed[0].status, "planned");
  assert.ok(parsed[0].notes?.includes("Bring tickets"));
  assert.equal(parseItinerary("A ticket with no date heading").length, 0);
});
test("sample contains every travel day without private references", () => {
  assert.equal(new Set(seed.events.map((e) => e.date)).size, 8);
  assert.ok(
    seed.events.every((e) => e.date >= seed.start && e.date <= seed.end),
  );
  assert.equal(new Set(seed.events.map((e) => e.id)).size, seed.events.length);
});

test("next stop follows local scheduled times rather than array order", () => {
  const base = seed.events.find((e) => e.id === "flight-out")!;
  const later = {
    ...base,
    id: "later",
    time: "11:00",
    zone: "America/Los_Angeles",
  };
  const sooner = {
    ...base,
    id: "sooner",
    time: "10:00",
    zone: "America/Chicago",
  };
  const next = nextScheduledStop(
    [later, sooner],
    new Date("2026-12-18T15:00:00Z"),
  );
  assert.equal(next?.id, "sooner");
  assert.equal(
    nextScheduledStop(
      [{ ...base, time: "" }],
      new Date("2026-12-18T15:00:00Z"),
    ),
    undefined,
  );
});
