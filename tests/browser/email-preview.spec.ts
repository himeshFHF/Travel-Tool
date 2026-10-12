import { expect, test } from "@playwright/test";
import { buildEmailPreview } from "../../server/document-preview";

// A tiny valid raster fixture verifies actual browser decoding, not just markup.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4foAAAAASUVORK5CYII=";
const email = [
  "From: Ticket Desk <tickets@example.com>",
  "Subject: Test ticket email",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="ticket"', "",
  "--ticket", "Content-Type: text/html; charset=UTF-8", "",
  '<p>Your test ticket</p><img src="cid:barcode" alt="Embedded test barcode"><img src="https://tickets.example.com/barcode.png" alt="Hosted test barcode"><img width="1" height="1" src="https://tracker.example.com/pixel">',
  "--ticket", "Content-Type: image/png", "Content-ID: <barcode>", 'Content-Disposition: inline; filename="barcode.png"', "Content-Transfer-Encoding: base64", "", png,
  "--ticket", "Content-Type: application/pdf", 'Content-Disposition: attachment; filename="ticket.pdf"', "Content-Transfer-Encoding: base64", "", Buffer.from("%PDF-1.4\nTest attachment fixture").toString("base64"),
  "--ticket--",
].join("\r\n");

test("email ticket images render and hosted images wait for the user's load action", async ({ page }) => {
  let hostedRequests = 0;
  let trackerRequests = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "email-preview.test" && url.pathname === "/api/documents/email") {
      const response = await buildEmailPreview({ name: "ticket.eml", raw: email, downloadUrl: "/api/documents/email?tripId=example-trip&download=1", loadRemoteImages: url.searchParams.get("images") === "1" });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    if (url.hostname === "tickets.example.com") {
      hostedRequests++;
      return route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
    }
    if (url.hostname === "tracker.example.com") trackerRequests++;
    await route.abort();
  });
  const initial = await page.goto("https://email-preview.test/api/documents/email?tripId=example-trip");
  expect(initial?.headers()["content-security-policy"]).toContain("img-src data:;");
  expect(initial?.headers()["cache-control"]).toBe("private, no-store");
  const embedded = page.getByRole("img", { name: "Embedded test barcode", exact: true });
  await expect(embedded).toBeVisible();
  await expect.poll(() => embedded.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(hostedRequests).toBe(0);
  expect(trackerRequests).toBe(0);
  await expect(page.getByRole("link", { name: /^Open ticket\.pdf/ })).toHaveAttribute("href", "/api/documents/email?tripId=example-trip&attachment=1");
  await page.getByRole("link", { name: "Load email images", exact: true }).click();
  await expect(page).toHaveURL(/tripId=example-trip&images=1/);
  const hosted = page.getByRole("img", { name: "Hosted test barcode", exact: true });
  await hosted.scrollIntoViewIfNeeded();
  await expect.poll(() => hosted.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(hostedRequests).toBe(1);
  expect(trackerRequests).toBe(0);
  await page.screenshot({ path: "outputs/email-preview-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(embedded).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "outputs/email-preview-mobile.png", fullPage: true });
});
