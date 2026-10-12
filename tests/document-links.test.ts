import test from "node:test";
import assert from "node:assert/strict";
import type { Document, Stop } from "../src/model";
import { missingDetails } from "../src/model";
import { documentsForDay, documentsForStop, hotelStayForStop } from "../src/document-links";
import { getHotelCheckout, checkoutStayForReminder } from "../src/hotel-checkout";

const stay: Stop = {id:"stay-one",date:"2026-12-18",checkoutDate:"2026-12-21",time:"15:00",title:"Check in",type:"stay",status:"reported",location:"Hotel Burbank · 150 E Angeleno Ave",notes:""};
const reminder: Stop = {...stay,id:"checkout-one",date:"2026-12-21",checkoutDate:undefined,time:"11:00",title:"Checkout",location:"Hotel Burbank",notes:"Check-out by 11 AM"};
const doc = (id:string,eventId:string|null): Document => ({id,eventId,name:id+".pdf",size:10,mime:"application/pdf"});
const booking = doc("booking-one",stay.id);
const ids = (documents: Document[]) => documents.map(document=>document.id);

test("one hotel attachment is available on every occupied day and checkout day",()=>{
  for(const date of ["2026-12-18","2026-12-19","2026-12-20","2026-12-21"]) {
    assert.deepEqual(ids(documentsForDay(date,[booking],[stay,reminder])),[booking.id],date);
  }
  assert.deepEqual(documentsForDay("2026-12-17",[booking],[stay,reminder]),[]);
  assert.deepEqual(documentsForDay("2026-12-22",[booking],[stay,reminder]),[]);
  assert.deepEqual(ids(documentsForStop(reminder,[booking],[stay,reminder])),[booking.id]);
  assert.equal(hotelStayForStop(reminder,[stay,reminder])?.id,stay.id);
});

test("daily hotel stops and checkout attachments share only within the same stay",()=>{
  const night={...reminder,id:"second-night",date:"2026-12-19",title:"Back at the hotel",notes:""};
  const checkoutDocument=doc("checkout-confirmation",reminder.id);
  const documents=[booking,checkoutDocument,booking];
  const stops=[stay,night,reminder];
  assert.deepEqual(ids(documentsForStop(night,documents,stops)),[booking.id,checkoutDocument.id]);
  assert.deepEqual(ids(documentsForStop(stay,documents,stops)),[booking.id,checkoutDocument.id]);
  assert.deepEqual(ids(documentsForDay(night.date,documents,stops)),[booking.id,checkoutDocument.id]);
});

test("separate visits to the same hotel never inherit another visit's booking",()=>{
  const second={...stay,id:"stay-two",date:"2026-12-23",checkoutDate:"2026-12-25"};
  const secondCheckout={...reminder,id:"checkout-two",date:"2026-12-25"};
  const bookingTwo=doc("booking-two",second.id);
  const stops=[stay,reminder,second,secondCheckout], documents=[booking,bookingTwo];
  assert.deepEqual(ids(documentsForStop(reminder,documents,stops)),[booking.id]);
  assert.deepEqual(ids(documentsForStop(secondCheckout,documents,stops)),[bookingTwo.id]);
  assert.deepEqual(ids(documentsForDay("2026-12-24",documents,stops)),[bookingTwo.id]);
  assert.deepEqual(documentsForDay("2026-12-22",documents,stops),[]);
});

test("ambiguous overlapping stays do not attach a hotel's daily stop to an arbitrary reservation",()=>{
  const overlap={...stay,id:"overlap",date:"2026-12-19",checkoutDate:"2026-12-22"};
  const night={...reminder,id:"ambiguous-night",date:"2026-12-20",title:"Hotel",notes:""};
  const direct=doc("direct-note",night.id);
  const stops=[stay,overlap,night];
  assert.equal(hotelStayForStop(night,stops),undefined);
  assert.deepEqual(ids(documentsForStop(night,[booking,doc("overlap-booking",overlap.id),direct],stops)),[direct.id]);
  assert.deepEqual(ids(documentsForStop(stay,[booking,doc("overlap-booking",overlap.id)],stops)),[booking.id]);
});

test("a clear checkout reminder uses the departing visit at a shared arrival boundary",()=>{
  const following={...stay,id:"next-stay",date:"2026-12-21",checkoutDate:"2026-12-23"};
  const documents=[booking,doc("next-booking",following.id)];
  assert.equal(hotelStayForStop(reminder,[stay,following,reminder])?.id,stay.id);
  assert.deepEqual(ids(documentsForStop(reminder,documents,[stay,following,reminder])),[booking.id]);
});

test("missing dates, unnamed hotels and unrelated stops cannot spread a booking",()=>{
  const noDates={...stay,checkoutDate:undefined};
  assert.deepEqual(documentsForDay("2026-12-19",[booking],[noDates]),[]);
  const unnamed={...stay,location:"Hotel to choose"};
  assert.deepEqual(documentsForDay("2026-12-19",[booking],[unnamed]),[]);
  const other={...stay,id:"other-hotel",location:"Another Hotel"};
  const flight={...stay,id:"flight",type:"flight" as const,checkoutDate:undefined};
  const foreign=doc("another-trip-booking","not-in-this-trip");
  const itinerary=doc("whole-trip",null);
  const documents=[booking,foreign,itinerary];
  assert.deepEqual(documentsForStop(other,documents,[stay,other]),[]);
  assert.deepEqual(documentsForStop(flight,documents,[stay,flight]),[]);
  assert.deepEqual(ids(documentsForDay("2026-12-19",documents,[stay,other,flight])),[booking.id]);
});

test("hotel checkout borrows the same stay's evidence without an ambiguous reminder match",()=>{
  const booked={...stay,checkout:{time:"10:00",source:"booking" as const,documentId:booking.id}};
  const night={...reminder,id:"night",date:"2026-12-19",title:"Hotel night",notes:""};
  assert.equal(getHotelCheckout(night,[booking],[booked,night,reminder])?.document?.id,booking.id);
  assert.equal(getHotelCheckout(night,[booking],[booked,night,reminder])?.time,"10:00");
  const duplicate={...booked,id:"another-room"};
  assert.equal(checkoutStayForReminder(reminder,[booked,duplicate]),undefined);
  assert.equal(getHotelCheckout(reminder,[booking],[booked,duplicate,reminder])?.document,undefined);
});

test("the missing-details list recognizes an existing booking across its hotel nights",()=>{
  const night={...reminder,id:"night",date:"2026-12-19",title:"Hotel night",notes:""};
  const other={...stay,id:"other",location:"Another Hotel"};
  const trip={title:"Stay test",start:stay.date,end:stay.checkoutDate!,events:[stay,night,reminder,other]};
  const needs=missingDetails(trip,[booking]);
  assert.ok(!needs.some(item=>[stay.id+"doc",night.id+"doc",reminder.id+"doc"].includes(item.id)));
  assert.ok(needs.some(item=>item.id===other.id+"doc"));
});
