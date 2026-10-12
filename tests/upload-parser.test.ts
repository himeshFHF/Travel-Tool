import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "../src/import";
import { matchBooking } from "../src/booking-match";
import { extractHotelCheckout } from "../src/hotel-checkout";
import { seed } from "../src/seed";

test("EML extraction decodes the subject and base64 body before matching a flight", async () => {
  const subject = "Flight booking – AA1639";
  const body = "Booking confirmation AB1234. American Airlines AA1639. DFW to LAX. December 18, 2026.";
  const email = [
    "From: reservations@example.com",
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");
  const text = await extractText(new File([email], "flight.eml", { type: "message/rfc822" }));
  assert.ok(text.includes(subject));
  assert.ok(text.includes(body));
  assert.ok(!text.includes("Content-Transfer-Encoding"));
  assert.equal(matchBooking(text, seed.events).autoMatchId, "flight-out");
});

test("quoted-printable hotel mail yields readable checkout evidence", async () => {
  const email = [
    "Subject: =?UTF-8?Q?Hotel_Burbank_=E2=80=93_confirmation?=",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Reservation confirmation HB1234. Hotel Burbank.",
    "Check-in December 18, 2026. Check-out December 21, 2026 at 10:=",
    "30 AM.",
  ].join("\r\n");
  const text = await extractText(new File([email], "hotel.eml", { type: "message/rfc822" }));
  assert.ok(text.includes("Hotel Burbank – confirmation"));
  assert.ok(text.includes("10:30 AM"));
  const match = matchBooking(text, seed.events);
  assert.equal(match.autoMatchId, "burbank");
  assert.equal(extractHotelCheckout(text, seed.events.find((stop) => stop.id === match.autoMatchId)!)?.time, "10:30");
});
