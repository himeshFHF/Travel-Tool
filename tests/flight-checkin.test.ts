import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/seed";
import { checkInCountdown, checkInDateLabel, flightCheckIn, identifyAirline, zonedDeparture } from "../src/flight-checkin";

const outbound = seed.events.find((stop) => stop.id === "flight-out")!;
const inbound = seed.events.find((stop) => stop.id === "flight-home")!;

test("American check-in opens at 6 AM Central on Dec 17, independent of device zone", () => {
  const info = flightCheckIn(outbound, new Date("2026-12-17T11:59:00Z"));
  assert.equal(info.airline?.code, "AA");
  assert.equal(info.flightNumber, "AA1639");
  assert.equal(info.departureAt?.toISOString(), "2026-12-18T12:00:00.000Z");
  assert.equal(info.opensAt?.toISOString(), "2026-12-17T12:00:00.000Z");
  assert.equal(info.status, "future");
  assert.match(checkInDateLabel(info.opensAt!, info.zone!), /6:00 AM CST/);
  assert.equal(flightCheckIn(outbound, new Date("2026-12-17T12:00:00Z")).status, "open");
});

test("Alaska return uses San Diego departure time, not Dallas arrival time", () => {
  const info = flightCheckIn(inbound, new Date("2026-12-24T15:55:00Z"));
  assert.equal(info.airline?.code, "AS");
  assert.equal(info.flightNumber, "AS400");
  assert.equal(info.departureAt?.toISOString(), "2026-12-25T15:55:00.000Z");
  assert.equal(info.opensAt?.toISOString(), "2026-12-24T15:55:00.000Z");
  assert.equal(info.status, "open");
  assert.match(checkInDateLabel(info.opensAt!, info.zone!), /7:55 AM PST/);
});

test("near departure and past schedules never report open check-in", () => {
  assert.equal(flightCheckIn(outbound, new Date("2026-12-18T10:00:00Z")).status, "near-departure");
  assert.equal(flightCheckIn(outbound, new Date("2026-12-18T11:59:00Z")).status, "near-departure");
  assert.equal(flightCheckIn(outbound, new Date("2026-12-18T12:00:00Z")).status, "past");
});

test("missing, invalid or ambiguous flight details cannot create a countdown", () => {
  const cases = [
    { ...outbound, time: "" },
    { ...outbound, time: "25:00" },
    { ...outbound, date: "2026-02-30" },
    { ...outbound, zone: "made-up/time-zone" },
    { ...outbound, zone: undefined, location: "Unknown airport" },
    { ...outbound, notes: "Some Airline, flight 123" },
    { ...outbound, notes: "American Airlines AA123 operated by Alaska Airlines AS123" },
    { ...outbound, type: "stay" as const },
  ];
  for (const stop of cases) {
    const info = flightCheckIn(stop, new Date("2026-12-17T12:00:00Z"));
    assert.equal(info.status, "incomplete");
    assert.equal(info.opensAt, null);
  }
  assert.equal(identifyAirline({ ...outbound, notes: "CLASS400 seat, no airline recorded" }), undefined);
});

test("date conversion handles daylight saving offsets and rejects repeated or skipped hours", () => {
  assert.equal(zonedDeparture("2026-07-01", "06:00", "America/Chicago")?.toISOString(), "2026-07-01T11:00:00.000Z");
  assert.equal(zonedDeparture("2026-03-08", "02:30", "America/Chicago"), null);
  assert.equal(zonedDeparture("2026-11-01", "01:30", "America/Chicago"), null);
  const info = flightCheckIn({ ...outbound, date: "2026-03-08", time: "06:00" }, new Date("2026-03-07T10:00:00Z"));
  assert.equal(info.opensAt?.toISOString(), "2026-03-07T11:00:00.000Z");
  assert.match(checkInDateLabel(info.opensAt!, info.zone!), /5:00 AM CST/);
});

test("countdown rounds a positive remainder up and never shows negative time", () => {
  const opens = new Date("2026-12-17T12:00:00Z");
  assert.equal(checkInCountdown(opens, new Date("2026-12-16T10:00:00Z")), "1d 2h");
  assert.equal(checkInCountdown(opens, new Date("2026-12-17T10:00:00Z")), "2h 0m");
  assert.equal(checkInCountdown(opens, new Date("2026-12-17T11:59:59Z")), "1m");
  assert.equal(checkInCountdown(opens, new Date("2026-12-17T13:00:00Z")), "0m");
});
