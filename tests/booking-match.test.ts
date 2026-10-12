import test from "node:test";
import assert from "node:assert/strict";
import { matchBooking } from "../src/booking-match";
import { seed } from "../src/seed";

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
