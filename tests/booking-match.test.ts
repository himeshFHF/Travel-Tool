import test from "node:test";
import assert from "node:assert/strict";
import { matchBooking } from "../src/booking-match";
import { seed } from "../src/seed";
import type { Stop } from "../src/model";

test("hotel email confirmation wording enables booking date and checkout review", () => {
  const match=matchBooking("Your hotel booking is confirmed!\nHotel Burbank\nCheck-in Fri, 18 Dec 2026, 3:00PM\nCheck-out Mon, 21 Dec 2026, 11:00AM",seed.events);
  assert.equal(match.isBooking,true);
  assert.equal(match.autoMatchId,"burbank");
  assert.equal(matchBooking("Your hotel booking is not confirmed. Hotel Burbank. December 18, 2026.",seed.events).isBooking,false);
});

test("flight confirmation matches flight number and travel date",()=>{
  const result=matchBooking("Booking confirmation ABC123. American Airlines flight AA 1639. Departure December 18, 2026. DFW to LAX.",seed.events);
  assert.equal(result.isBooking,true);
  assert.equal(result.autoMatchId,"flight-out");
});
test("hotel confirmation attaches to the check-in stop",()=>{
  const result=matchBooking("Reservation confirmation. Hotel Burbank. Check-in: 12/18/2026. Check-out: 12/21/2026. Confirmation: HOTEL123.",seed.events);
  assert.equal(result.autoMatchId,"burbank");
});
test("attraction tickets match their existing itinerary entry",()=>{
  const result=matchBooking("Ticket confirmation TKT987. Universal Studios Hollywood. Admission: 2026-12-20.",seed.events);
  assert.equal(result.autoMatchId,"universal");
});
test("wrong flight number or wrong date is not linked automatically",()=>{
  assert.equal(matchBooking("Booking confirmation. AA9999. DFW to LAX. December 18, 2026.",seed.events).autoMatchId,undefined);
  const wrongDate=matchBooking("Booking confirmation. AA1639. DFW to LAX. December 18, 2025.",seed.events);
  assert.equal(wrongDate.autoMatchId,undefined);
  assert.ok(wrongDate.candidates.some(c=>c.eventId==="flight-out"));
});
test("multiple qualifying entries require a choice instead of an arbitrary link",()=>{
  const flight=seed.events.find(e=>e.id==="flight-out")!;
  const result=matchBooking("Booking confirmation. AA1639. DFW to LAX. 2026-12-18.",[flight,{...flight,id:"second-flight"}]);
  assert.equal(result.autoMatchId,undefined);
  assert.equal(result.candidates.length,2);
});
test("a combined booking with two matched stops is not assigned to only one",()=>{
  const result=matchBooking("Booking confirmation. Flight AA1639 DFW to LAX December 18, 2026. Hotel Burbank check-in December 18, 2026.",seed.events);
  assert.equal(result.autoMatchId,undefined);
  assert.ok(result.candidates.some(c=>c.eventId==="flight-out"));
  assert.ok(result.candidates.some(c=>c.eventId==="burbank"));
});
test("whole itineraries, missing dates and generic cities do not auto-link",()=>{
  assert.equal(matchBooking("December 18, 2026: Hotel Burbank\nDecember 20, 2026: Universal Studios Hollywood",seed.events).isBooking,false);
  assert.equal(matchBooking("Hotel Burbank booking confirmation",seed.events).autoMatchId,undefined);
  assert.equal(matchBooking("Booking confirmation. Los Angeles. 2026-12-18.",seed.events).autoMatchId,undefined);
  assert.deepEqual(matchBooking("",seed.events),{isBooking:false,candidates:[]});
});
test("ambiguous numeric dates remain suggestions",()=>{
  const stop={...seed.events.find(e=>e.id==="burbank")!,date:"2026-05-06"};
  assert.equal(matchBooking("Hotel Burbank. Reservation confirmation. Check-in 05/06/2026.",[stop]).autoMatchId,undefined);
});

const flight = seed.events.find(event => event.id === "flight-out")!;
const inbound: Stop = { ...flight, id: "inbound", date: "2026-12-25", location: "LAX → DFW", notes: "American Airlines AA42" };

test("flight itineraries without confirmation wording classify and only suggest flights", () => {
  const result = matchBooking("Your flight itinerary\nAA1639\nDeparture: 18DEC2026\nDFW to LAX\nLos Angeles. Hotel deals, car rental deals and tours available.", seed.events);
  assert.equal(result.isBooking, true);
  assert.deepEqual(result.documentTypes, ["flight"]);
  assert.equal(result.autoMatchId, "flight-out");
  assert.ok(result.candidates.every(candidate => seed.events.find(event => event.id === candidate.eventId)?.type === "flight"));
});

test("two documents match independently with no evidence carried between files", () => {
  const events = [...seed.events, inbound];
  const outward = matchBooking("Booking confirmation AA456. American Airlines AA1639. DFW to LAX. December 18, 2026.", events);
  const returning = matchBooking("Boarding pass\nAA42\nLAX → DFW\n25-Dec-2026", events);
  assert.equal(outward.autoMatchId, "flight-out");
  assert.equal(returning.autoMatchId, "inbound");
  assert.deepEqual(matchBooking("", events), { isBooking: false, candidates: [] });
});

test("single digit and alphanumeric carrier flight numbers work in titles", () => {
  const event = { ...flight, title: "Flight B6 7", notes: "", location: "BOS → JFK" };
  assert.equal(matchBooking("E-ticket B6-007. Departure 2026-12-18. BOS to JFK.", [event]).autoMatchId, event.id);
});

test("reversed or conflicting routes never auto-link even with the same flight number", () => {
  for (const route of ["LAX to DFW", "dfw to jfk"]) {
    assert.equal(matchBooking(`Booking confirmation. AA1639. ${route}. December 18, 2026.`, [flight]).autoMatchId, undefined);
  }
});

test("route and date distinguish outbound from return without a flight number", () => {
  const sameDayReturn = { ...inbound, date: flight.date, notes: "" };
  const result = matchBooking("Flight booking confirmation. DFW → LAX. December 18, 2026.", [{ ...flight, notes: "" }, sameDayReturn]);
  assert.equal(result.autoMatchId, flight.id);
  assert.ok(!result.candidates.some(candidate => candidate.eventId === sameDayReturn.id));
});

test("multiple flight segments remain an explicit choice even if only one exists in the trip", () => {
  const result = matchBooking("Flight itinerary\nAA1639 DFW to LAX December 18, 2026\nAA42 LAX to DFW December 25, 2026", [flight]);
  assert.equal(result.autoMatchId, undefined);
  assert.match(result.notice!, /multiple flight segments/);
  assert.equal(result.candidates[0].eventId, flight.id);
});

test("repeated flight numbers on different travel days require review", () => {
  const result = matchBooking("Flight itinerary AA1639 DFW to LAX\nDeparture: December 18, 2026\nDeparture: December 19, 2026", [flight]);
  assert.equal(result.autoMatchId, undefined);
  assert.match(result.notice!, /multiple flight segments/);
});

test("separate origin and destination fields preserve direction", () => {
  const result = matchBooking("Booking confirmation ABC123. Flight AA1639\nDestination: DFW\nOrigin: LAX\nDeparture: December 18, 2026", [flight]);
  assert.equal(result.autoMatchId, undefined);
  assert.ok(result.candidates[0].reasons.some(reason => reason.includes("route differs")));
});

test("departure dates outweigh incidental issue dates", () => {
  const result = matchBooking("Booking confirmation. Flight AA1639 DFW to LAX.\nIssued: December 18, 2026\nDeparture: December 19, 2026", [flight]);
  assert.equal(result.autoMatchId, undefined);
  assert.ok(result.candidates[0].reasons.some(reason => reason.includes("date differs")));
});

test("cancelled and pending confirmations are never auto-linked", () => {
  for (const status of ["cancelled", "pending confirmation", "not confirmed"]) {
    const result = matchBooking(`Booking confirmation. Flight AA1639 DFW to LAX. December 18, 2026. Booking ${status}.`, [flight]);
    assert.equal(result.autoMatchId, undefined);
    assert.ok(result.notice);
  }
});

test("stay documents suggest the stay, not same-day activities or checkout reminders", () => {
  const result = matchBooking("Hotel Burbank reservation confirmation. Check-in December 18, 2026. Check-out December 21, 2026. Los Angeles Griffith Observatory.", seed.events);
  assert.equal(result.autoMatchId, "burbank");
  assert.deepEqual(result.candidates.map(candidate => candidate.eventId), ["burbank"]);
});

test("property and stay-date evidence classify confirmations without the word hotel", () => {
  const result = matchBooking("Reservation confirmation FF789. Fairfield Inn & Suites Twentynine Palms. Check-in December 21, 2026. Check-out December 22, 2026.", seed.events);
  assert.deepEqual(result.documentTypes, ["stay"]);
  assert.equal(result.autoMatchId, "fairfield");
  const property = { ...seed.events.find(event => event.id === "burbank")!, location: "Palm House" };
  assert.deepEqual(matchBooking("Reservation confirmation. Palm House. Check-in December 18, 2026. Check-out December 21, 2026.", [property]).documentTypes, ["stay"]);
});

test("a wrong check-in date cannot be rescued by an incidental matching checkout date", () => {
  const result = matchBooking("Hotel Burbank reservation confirmation. Check-in December 17, 2026. Check-out December 18, 2026.", seed.events);
  assert.equal(result.autoMatchId, undefined);
  assert.equal(result.candidates[0].eventId, "burbank");
});

test("rental confirmations use pickup dates and do not suggest airport flights", () => {
  const result = matchBooking("Car rental reservation confirmation. Los Angeles International Airport. Pick-up: December 18, 2026. Return: December 25, 2026.", seed.events);
  assert.deepEqual(result.documentTypes, ["drive"]);
  assert.equal(result.autoMatchId, "rental");
  assert.ok(result.candidates.every(candidate => seed.events.find(event => event.id === candidate.eventId)?.type === "drive"));
  const wrongPickup = matchBooking("Car rental reservation confirmation. Los Angeles International Airport. Pick-up: December 17, 2026. Return: December 18, 2026.", seed.events);
  assert.equal(wrongPickup.autoMatchId, undefined);
});

test("admission dates override receipt dates and retain only attraction suggestions", () => {
  const result = matchBooking("Ticket confirmation. Universal Studios Hollywood. Issued December 20, 2026. Admission: December 21, 2026.", seed.events);
  assert.equal(result.autoMatchId, undefined);
  assert.deepEqual(result.documentTypes, ["activity"]);
  assert.equal(result.candidates[0].eventId, "universal");
});

test("generic date and city overlap are insufficient to offer a stop", () => {
  assert.deepEqual(matchBooking("Booking confirmation. Los Angeles. December 18, 2026.", seed.events).candidates, []);
  const otherFlight = matchBooking("Flight itinerary. UA500 ORD to SEA. December 18, 2026. Los Angeles.", seed.events);
  assert.deepEqual(otherFlight.candidates, []);
});

test("expanded hotel names match the booked night, not attractions named in the property or nearby guide", () => {
  const result = matchBooking("Reservation confirmation for Fairfield by Marriott Inn & Suites Twentynine Palms-Joshua Tree National Park.\nCheck-in: December 21, 2026\nCheck-out: December 22, 2026\nNearby places: Joshua Tree Visitor Center and Dante’s View.", seed.events);
  assert.deepEqual(result.documentTypes, ["stay"]);
  assert.equal(result.autoMatchId, "fairfield");
  assert.deepEqual(result.candidates.map(candidate => candidate.eventId), ["fairfield"]);
  const unrelated = matchBooking("Hotel reservation confirmation. Holiday Inn Express near Joshua Tree National Park. Check-in: December 21, 2026. Check-out: December 22, 2026.", seed.events);
  assert.equal(unrelated.autoMatchId, undefined);
  assert.ok(!unrelated.candidates.some(candidate => candidate.eventId === "fairfield"));
});
