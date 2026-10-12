import test from "node:test";
import assert from "node:assert/strict";
import { extractHotelCheckout, extractHotelStayDates, getHotelCheckout, hotelCheckoutPolicy, checkoutStayForReminder } from "../src/hotel-checkout";
import { stopSchema } from "../server/validation";
import type { Stop, Document } from "../src/model";
import { seed } from "../src/seed";

const stay: Stop = { ...seed.events.find((event) => event.id === "burbank")!, checkoutDate: "2026-12-21" };

test("checkout extraction accepts explicit 12-hour, 24-hour and noon labels", () => {
  for (const [text, expected] of [
    ["Check-out: 11 AM", "11:00"],
    ["Check out by 11:30 a.m.", "11:30"],
    ["Checkout time: 12:00", "12:00"],
    ["Check-out ends at noon", "12:00"],
    ["Check-out time: 14:30", "14:30"],
    ["Check-out: midnight", "00:00"],
  ]) {
    const parsed = extractHotelCheckout(text, stay);
    assert.equal(parsed?.time, expected, text);
    assert.ok(parsed?.evidence.includes("Check"));
  }
});

test("checkout dates before the time are checked against the matched stay", () => {
  for (const text of [
    "Check-out: December 21, 2026 at 11 AM",
    "Check-out: Monday, 21 Dec 2026, 11:00",
    "Check-out:\n2026-12-21\n11:00 AM",
    "Checkout date: 12/21/2026 at 11:00 AM",
    "Checkout December 21 at 11 AM",
  ]) assert.equal(extractHotelCheckout(text, stay)?.time, "11:00", text);
  assert.equal(extractHotelCheckout("Check-out December 22, 2026 at 11 AM", stay), null);
  assert.equal(extractHotelCheckout("Check-out 2026-12-20 11:00", stay), null);
  assert.equal(extractHotelCheckout("Check-out 03/04/2026 11:00", { ...stay, checkoutDate: "2026-03-04" }), null);
});

test("check-in, departure and nearby unrelated times never become checkout", () => {
  for (const text of [
    "Check-in December 18 at 3 PM. Departure at 6 AM.",
    "Check-out December 21. Breakfast at 7 AM.",
    "Check-out: December 21\nShuttle leaves at 10 AM",
    "Check-out 11",
    "Check-out 25:00",
    "Check-out 11:99",
    "Check-out 11 AM",
  ]) assert.equal(extractHotelCheckout(text, text === "Check-out 11 AM" ? { ...stay, type: "flight" } : stay), null, text);
});

test("conditional late checkout and conflicting rooms require review", () => {
  for (const text of [
    "Late check-out at 2 PM on request",
    "Late checkout by 2 PM",
    "Check-out between 10 AM and noon",
    "Room one check-out: 11 AM\nRoom two check-out: noon",
    "Checkout is at 11 AM; 2 PM subject to availability",
  ]) assert.equal(extractHotelCheckout(text, stay), null, text);
  assert.equal(extractHotelCheckout("Confirmed late checkout at 2 PM", stay)?.time, "14:00");
  assert.equal(extractHotelCheckout("Check-out 11 AM\nCheck-out time: 11:00 AM", stay)?.time, "11:00");
});

test("official fallback is property-specific and preserves the reported itinerary conflict", () => {
  const display = getHotelCheckout(stay)!;
  assert.equal(display.source, "standard");
  assert.equal(display.time, "12:00");
  assert.equal(display.reportedTime, "11:00");
  assert.equal(display.conflict, true);
  assert.equal(display.policy?.checkedOn, "2026-10-11");
  const fairfield = { ...stay, location: "Fairfield Inn & Suites Twentynine Palms" };
  assert.equal(hotelCheckoutPolicy(fairfield)?.time, "12:00");
  for (const location of ["Hotel Burbank Annex", "Fairfield Inn & Suites Los Angeles", "Unidentified San Diego hotel"]) {
    assert.equal(hotelCheckoutPolicy({ ...stay, location }), undefined);
    assert.equal(getHotelCheckout({ ...stay, location })?.source, "unknown");
  }
});

test("booking evidence outranks standard policy and stays linked only to the correct document", () => {
  const booked: Stop = { ...stay, checkout: { time: "11:00", source: "booking", documentId: "doc-1", documentName: "reservation.pdf", evidence: "Check-out 11 AM" } };
  const document: Document = { id: "doc-1", name: "reservation.pdf", eventId: stay.id, size: 20, mime: "application/pdf" };
  const display = getHotelCheckout(booked, [document])!;
  assert.equal(display.source, "booking");
  assert.equal(display.time, "11:00");
  assert.equal(display.document?.id, "doc-1");
  assert.equal(display.conflict, false);
  assert.equal(getHotelCheckout(booked, [{ ...document, eventId: "different-stop" }])?.document, undefined);
  assert.equal(getHotelCheckout({ ...booked, checkout: { time: "13:00", source: "manual" } })?.source, "manual");
});

test("companion reminder borrows booking deadline without changing actual departure clocks", () => {
  const booked: Stop = { ...stay, checkout: { time: "12:00", source: "booking" } };
  const reminder = seed.events.find((event) => event.id === "checkout")!;
  assert.equal(checkoutStayForReminder(reminder, [booked])?.id, stay.id);
  assert.equal(getHotelCheckout(reminder, [], [booked])?.time, "12:00");
  assert.equal(getHotelCheckout(reminder, [], [booked])?.source, "booking");
  assert.equal(checkoutStayForReminder({ ...reminder, type: "drive" }, [booked]), undefined);
  assert.equal(checkoutStayForReminder(booked, [reminder]), undefined);
  assert.equal(stay.time, "15:00");
  assert.equal(reminder.time, "11:00");
});

test("server validation retains bounded checkout provenance and rejects invalid clocks", () => {
  const saved = stopSchema.parse({ ...stay, checkout: { time: "11:30", source: "booking", documentId: "doc-1", documentName: "reservation.pdf", evidence: "Check out 11:30 AM" } });
  assert.equal(saved.checkout?.evidence, "Check out 11:30 AM");
  assert.equal(stopSchema.safeParse({ ...stay, checkout: { time: "25:00", source: "booking" } }).success, false);
  assert.equal(stopSchema.safeParse({ ...stay, checkout: { time: "12:00", source: "invented" } }).success, false);
  assert.equal(stopSchema.safeParse({ ...stay, checkout: { time: "12:00", source: "booking", evidence: "x".repeat(301) } }).success, false);
});

test("hotel stay dates require clear check-in and checkout dates from the booking",()=>{
  for(const text of [
    "Check-in: December 18, 2026 at 3 PM\nCheck-out: December 21, 2026 at 11 AM",
    "Check-in date: 2026-12-18\nCheck-out date: 2026-12-21",
    "Check in: Fri, 18 Dec 2026\nCheck out: Mon, 21 Dec 2026",
    "Check-in: 12/18/2026\nCheck-out: 12/21/2026",
    "Check-in December 18\nCheckout December 21",
  ]) {
    const range=extractHotelStayDates(text,{...stay,checkoutDate:undefined});
    assert.equal(range?.start,"2026-12-18",text);
    assert.equal(range?.end,"2026-12-21",text);
    assert.match(range?.evidence||"",/Check/);
  }
});

test("hotel stay date extraction never guesses ambiguous dates, repeated visits or day-use ranges",()=>{
  for(const text of [
    "Check-in: 03/04/2026\nCheck-out: 03/06/2026",
    "Check-in: December 18, 2026\nCheck-out: December 18, 2026",
    "Check-in: December 21, 2026\nCheck-out: December 18, 2026",
    "Check-in: December 18, 2026\nCheck-out: December 21, 2026\nCheck-in: December 23, 2026\nCheck-out: December 25, 2026",
    "Reservation date: December 18, 2026. Hotel stay December 18–21.",
    "Check-in: December 31\nCheck-out: January 2",
    "Check-in: February 30, 2026\nCheck-out: March 3, 2026",
    "Early check-in on request December 18, 2026\nCheck-out December 21, 2026",
  ]) assert.equal(extractHotelStayDates(text,{...stay,checkoutDate:undefined}),null,text);
  assert.equal(extractHotelStayDates("Check-in December 18, 2026\nCheck-out December 21, 2026",{...stay,type:"flight"}),null);
});

test("HTML table rows separated by blank lines retain the hotel checkout date and clock",()=>{
  const text="Reservation confirmed\n\nCheck-in\n\nFri, 18 Dec 2026\n\n3:00PM\n\nCheck-out\n\nMon, 21 Dec 2026\n\n11:00AM\n\n3\nnights";
  assert.deepEqual(extractHotelCheckout(text,stay),{time:"11:00",evidence:"Check-out Mon, 21 Dec 2026 11:00AM"});
  const range=extractHotelStayDates(text,{...stay,checkoutDate:undefined});
  assert.equal(range?.start,"2026-12-18");
  assert.equal(range?.end,"2026-12-21");
  assert.equal(range?.evidence,"Check-in Fri, 18 Dec 2026; Check-out Mon, 21 Dec 2026");
});

test("ambiguous interleaved hotel columns still require review after blank-line cleanup",()=>{
  const text="Check-in\n\nCheck-out\n\nFri, 18 Dec 2026\n\nMon, 21 Dec 2026\n\n3:00PM\n\n11:00AM";
  assert.equal(extractHotelStayDates(text,stay),null);
  assert.equal(extractHotelCheckout(text,stay),null);
});
