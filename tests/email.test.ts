import test from "node:test";
import assert from "node:assert/strict";
import { emailHtmlToText, parseEmail, readEmailAttachment } from "../src/email";
import { buildEmailPreview } from "../server/document-preview";

const multipart = [
  "From: =?UTF-8?Q?Island_Packers_=E2=80=94_Reservations?= <bookings@example.com>",
  "To: Traveler <traveler@example.com>",
  "Subject: =?UTF-8?Q?Anacapa_booking_=E2=80=94_confirmed?=",
  "Date: Sat, 10 Oct 2026 12:00:00 -0700",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  'Content-Type: multipart/alternative; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/html; charset=UTF-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  '<html><head><style>.ticket {color: red}</style></head><body><h1>Booking =',
  'confirmation</h1><p>Island Packers &amp; Anacapa Island</p><table><tr><td>Date</td><td>December 19, 2026</td></tr><tr><td>Check-in</td><td>8:45 AM</td></tr></table><p>Caf=C3=A9 visit</p><a href=3D"https://example.com/tickets?x=3D1&amp;y=3D2">View ticket</a></body></html>',
  "--inner--",
  "--outer",
  'Content-Type: application/pdf; name="ticket.pdf"',
  'Content-Disposition: attachment; filename="ticket.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQ=",
  "--outer--",
].join("\r\n");

test("multipart quoted-printable email becomes readable Unicode booking text", async () => {
  const email = await parseEmail(new TextEncoder().encode(multipart));
  assert.equal(email.subject, "Anacapa booking — confirmed");
  assert.equal(email.from, "Island Packers — Reservations <bookings@example.com>");
  assert.equal(email.to, "Traveler <traveler@example.com>");
  assert.match(email.text, /Booking confirmation/);
  assert.match(email.text, /Island Packers & Anacapa Island/);
  assert.match(email.text, /December 19, 2026/);
  assert.match(email.text, /8:45 AM/);
  assert.match(email.text, /Café visit/);
  assert.match(email.text, /https:\/\/example.com\/tickets\?x=1&y=2/);
  assert.doesNotMatch(email.text, /Content-Type|--inner|<html>|\.ticket|=3D/);
  assert.deepEqual(email.attachmentNames, ["ticket.pdf"]);
});

test("base64 plain text preserves line breaks and declared non-UTF8 charsets", async () => {
  const body = "Check out at 11:00 AM\nReservation confirmed";
  const email = await parseEmail(`Subject: Hotel booking\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString("base64")}`);
  assert.equal(email.text, body);
  const latin = await parseEmail("Subject: Hotel\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCaf=E9 checkout");
  assert.equal(latin.text, "Café checkout");
});

test("HTML text extraction removes scripts and hidden content but decodes entities", () => {
  const text = emailHtmlToText('<!DOCTYPE html><html><head><title>Hidden title</title><script>alert(1)</script></head><body><p>Good &quot;trip&quot; &#8212; &#x1F30A;</p><div hidden>hidden secret</div><p style="display:none">hidden second</p><svg><text>Hidden SVG</text></svg><p>Checkout<br>11 AM</p><img src="https://tracker.example/pixel" alt="Ticket QR"><a href="javascript:alert(1)">Unsafe link label</a></body></html>');
  assert.match(text, /Good "trip" — 🌊/);
  assert.match(text, /Checkout\n11 AM/);
  assert.doesNotMatch(text, /alert|hidden secret|hidden second|Hidden title|Hidden SVG|javascript|tracker/);
  assert.match(text, /Ticket QR/);
  assert.equal(emailHtmlToText("<pre>Boarding time\n8:45 AM</pre>"), "Boarding time\n8:45 AM");
});

test("viewer escapes sender, title, plain message and attachment names and blocks remote resources", async () => {
  const raw = 'From: "<script>bad</script>" <x@example.com>\r\nSubject: <img src=x onerror=alert(1)>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n<script>fetch("/api/trip")</script>\nhttps://example.com/booking\nhttps://user:pass@example.com/private';
  const response = await buildEmailPreview({ name: "booking.eml", raw, downloadUrl: "/api/documents/doc-1?download=1" });
  const body = await response.text();
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Content-Security-Policy")!, /default-src 'none'/);
  assert.match(response.headers.get("Content-Security-Policy")!, /frame-ancestors 'self'/);
  assert.doesNotMatch(body, /<script|<img|onerror="|href="https:\/\/user:/);
  assert.match(body, /&lt;script&gt;/);
  assert.match(body, /href="https:\/\/example.com\/booking" target="_blank" rel="noopener noreferrer"/);
  assert.match(body, /href="\/api\/documents\/doc-1\?download=1" download/);
});

test("HTML-only email viewer offers decoded message and original attachment access", async () => {
  const response = await buildEmailPreview({ name: "Anacapa.eml", raw: multipart, downloadUrl: "/api/documents/abc?download=1" });
  const body = await response.text();
  assert.match(body, /Anacapa booking — confirmed/);
  assert.match(body, /Booking confirmation/);
  assert.match(body, /ticket.pdf/);
  assert.match(body, /Open ticket.pdf/);
  assert.doesNotMatch(body, /Content-Transfer-Encoding|--outer|<iframe|src="https:/);
});

test("preview errors retain a safe download path without exposing raw MIME", async () => {
  const raw = `Subject: ${"a".repeat(270000)}\r\n\r\nSecret raw MIME content`;
  const response = await buildEmailPreview({ name: "Saved email.eml", raw, downloadUrl: "/api/documents/abc?download=1" });
  const body = await response.text();
  assert.match(body, /couldn’t be previewed/);
  assert.match(body, /Download original email/);
  assert.doesNotMatch(body, /Secret raw MIME content/);
  const external = await buildEmailPreview({ name: "x.eml", raw: "Subject: Test\r\n\r\nHi", downloadUrl: "https://evil.example/api/documents/abc?download=1" });
  assert.doesNotMatch(await external.text(), /href="https:\/\/evil/);
});

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4foAAAAASUVORK5CYII=";
function imageEmail(images: { mime: string; data: string; id: string; filename: string }[], html = '<p>Your ticket</p><img src="cid:barcode" alt="Ticket barcode">') {
  return ["Subject: Your ticket", "MIME-Version: 1.0", 'Content-Type: multipart/related; boundary="images"', "", "--images", "Content-Type: text/html; charset=UTF-8", "", html, ...images.flatMap((image) => ["--images", `Content-Type: ${image.mime}`, `Content-ID: <${image.id}>`, `Content-Disposition: inline; filename="${image.filename}"`, "Content-Transfer-Encoding: base64", "", image.data]), "--images--"].join("\r\n");
}

test("embedded CID ticket raster is visible in the preview without external requests", async () => {
  const raw = imageEmail([{ mime: "image/png", data: png, id: "barcode", filename: "ticket-barcode.png" }]);
  const email = await parseEmail(raw);
  assert.equal(email.images.length, 1);
  assert.equal(email.images[0].name, "Ticket barcode");
  assert.equal(email.images[0].dataUrl, `data:image/png;base64,${png}`);
  const preview = await buildEmailPreview({ name: "Ticket.eml", raw, downloadUrl: "/api/documents/ticket?tripId=trip-2&download=1" });
  const body = await preview.text();
  assert.match(body, /aria-label="Email message"/);
  assert.match(body, /<img src="data:image\/png;base64,/);
  assert.match(body, /alt="Ticket barcode"/);
  assert.doesNotMatch(body, /<img src="https:/);
  assert.match(preview.headers.get("Content-Security-Policy")!, /img-src data:;/);
});

test("remote barcode images load only after explicit action and retain trip selection", async () => {
  const raw = imageEmail([], '<p>Your ticket</p><img src="https://tickets.example.com/barcode?id=123&amp;type=qr" alt="Boarding barcode"><img width="1" height="1" src="https://tracker.example.com/pixel"><img src="http://unsafe.example.com/code"><img src="https://127.0.0.1/private"><img src="https://user:pass@example.com/code"><img src="javascript:alert(1)">');
  const email = await parseEmail(raw);
  assert.deepEqual(email.remoteImages, [{ name: "Boarding barcode", url: "https://tickets.example.com/barcode?id=123&type=qr" }]);
  const initial = await buildEmailPreview({ name: "Ticket.eml", raw, downloadUrl: "/api/documents/ticket?tripId=trip-2&download=1" });
  const initialBody = await initial.text();
  assert.match(initialBody, /Load email images/);
  assert.match(initialBody, /href="\/api\/documents\/ticket\?tripId=trip-2&amp;images=1"/);
  assert.doesNotMatch(initialBody, /<img src=/);
  const loaded = await buildEmailPreview({ name: "Ticket.eml", raw, downloadUrl: "/api/documents/ticket?tripId=trip-2&download=1", loadRemoteImages: true });
  assert.match(await loaded.text(), /<img src="https:\/\/tickets.example.com\/barcode\?id=123&amp;type=qr" alt="Boarding barcode" referrerpolicy="no-referrer"/);
  assert.match(loaded.headers.get("Content-Security-Policy")!, /img-src data: https:;/);
});

test("image preview rejects SVG, mismatched signatures, huge dimensions and oversized image bytes", async () => {
  const huge = Buffer.from(png, "base64");
  huge.writeUInt32BE(50000, 16);
  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1);
  Buffer.from(png, "base64").copy(oversized);
  const raw = imageEmail([
    { mime: "image/svg+xml", data: Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"), id: "svg", filename: "unsafe.svg" },
    { mime: "image/jpeg", data: png, id: "wrong", filename: "wrong.jpg" },
    { mime: "image/png", data: huge.toString("base64"), id: "huge", filename: "huge.png" },
    { mime: "image/png", data: oversized.toString("base64"), id: "large", filename: "large.png" },
  ]);
  const email = await parseEmail(raw);
  assert.equal(email.images.length, 0);
  assert.equal(email.omittedImages, 4);
  const body = await (await buildEmailPreview({ name: "images.eml", raw, downloadUrl: "/api/documents/images?download=1" })).text();
  assert.doesNotMatch(body, /<img|<svg|onload=/);
  assert.match(body, /4 images are not included/);
});

test("PDF and raster email attachments are directly addressable by validated MIME index", async () => {
  const email = await parseEmail(multipart);
  assert.deepEqual(email.viewableAttachments, [{ index: 0, name: "ticket.pdf", mime: "application/pdf" }]);
  const attachment = await readEmailAttachment(multipart, 0);
  assert.equal(attachment?.mime, "application/pdf");
  assert.equal(new TextDecoder().decode(attachment?.bytes), "%PDF-1.4");
  assert.equal(await readEmailAttachment(multipart, 1), undefined);
  assert.equal(await readEmailAttachment(multipart, -1), undefined);
  assert.equal(await readEmailAttachment(multipart, 0.5), undefined);
  const raw = imageEmail([{ mime: "image/png", data: png, id: "barcode", filename: "../ticket.png" }, { mime: "image/svg+xml", data: Buffer.from("<svg></svg>").toString("base64"), id: "bad", filename: "bad.svg" }]);
  assert.equal((await readEmailAttachment(raw, 0))?.name, "ticket.png");
  assert.equal((await readEmailAttachment(raw, 0))?.mime, "image/png");
  assert.equal(await readEmailAttachment(raw, 1), undefined);
  const body = await (await buildEmailPreview({ name: "booking.eml", raw: multipart, downloadUrl: "/api/documents/doc-1?tripId=my-trip&download=1" })).text();
  assert.match(body, /href="\/api\/documents\/doc-1\?tripId=my-trip&amp;attachment=0"/);
  assert.match(body, /Open ticket.pdf/);
});

test("email layout retains tables and image positions while stripping active content and preheaders", async () => {
  const html = '<html><head><style>body{background:url(https://tracker.example/x)}</style></head><body><div style="display:none!important">Invisible preheader filler\u200c\u200c</div><table width="600" style="max-width:600px;width:100%;background-color:#ffffff"><tr><td style="padding:12px;font-size:16px;background-image:url(https://tracker.example/bg)"><img src="cid:barcode" alt="Ticket barcode" width="150"><p>Check-out</p><p>December 21, 2026</p><p>11:00 AM</p></td></tr></table><form action="/api/trip"><input name="danger"><button>Submit unsafe form</button></form><script>alert(1)</script><iframe src="https://tracker.example/frame"></iframe><p onclick="alert(2)" style="position:fixed;inset:0;color:#333">Visible detail</p></body></html>';
  const email = await parseEmail(imageEmail([{ mime: "image/png", data: png, id: "barcode", filename: "barcode.png" }], html));
  assert.match(email.bodyHtml!, /<table width="600" style="max-width:600px;width:100%;background-color:#ffffff">/);
  assert.match(email.bodyHtml!, /<td style="padding:12px;font-size:16px"><img src="data:image\/png;base64,/);
  assert.match(email.bodyHtml!, /width="150"/);
  assert.doesNotMatch(email.bodyHtml!, /<script|<iframe|<form|<input|<button|onclick|position:|tracker.example|Invisible preheader/);
  assert.match(email.bodyHtml!, /Visible detail/);
  assert.doesNotMatch(email.text, /Invisible preheader/);
  const body = await (await buildEmailPreview({ name: "ticket.eml", raw: imageEmail([{ mime: "image/png", data: png, id: "barcode", filename: "barcode.png" }], html), downloadUrl: "/api/documents/ticket?download=1" })).text();
  assert.equal((body.match(/<img src="data:image\/png;base64,/g) || []).length, 1);
  assert.match(body, /Plain text version/);
});

test("empty format-control filler lines are removed without changing meaningful right-to-left text", async () => {
  const email = await parseEmail(`Subject: Confirmation\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHotel confirmation\n\n${"\u200c \u200c \n".repeat(80)}\nCheckout 11 AM\n\u200fשלום`);
  assert.ok(email.text.length < 80);
  assert.match(email.text, /Hotel confirmation\n\nCheckout 11 AM/);
  assert.match(email.text, /\u200fשלום/);
});

test("image-only HTML does not hide substantive booking details in the plain-text alternative", async () => {
  const raw = ["Subject: Booking confirmation", 'Content-Type: multipart/alternative; boundary="alternative"', "", "--alternative", "Content-Type: text/plain; charset=UTF-8", "", "Hotel Burbank booking confirmation. Check-in December 18, 2026 at 3:00 PM. Check-out December 21, 2026 at 11:00 AM. Your original booking details remain available in plain text.", "--alternative", "Content-Type: text/html; charset=UTF-8", "", '<p>Your booking</p><img src="https://example.com/ticket.png" alt="Booking details and barcode">', "--alternative--"].join("\r\n");
  const email = await parseEmail(raw);
  assert.match(email.text, /Check-in December 18, 2026/);
  assert.match(email.text, /Check-out December 21, 2026 at 11:00 AM/);
  assert.match(email.bodyHtml!, /Your booking/);
});
