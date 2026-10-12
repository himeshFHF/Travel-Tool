import { test, expect } from "@playwright/test";
import { seed } from "../../src/seed";

test("batch uploads keep separate matches, retry only failures and review another booking original", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  const tripId = crypto.randomUUID();
  const title = `Upload verification ${Date.now()}`;
  const tripApi = `/api/trip?tripId=${tripId}`;
  const uploadRoute = `**/api/documents?tripId=${tripId}`;
  const created = await page.request.post("/api/trips", { data: { id: tripId, title, start: seed.start, end: seed.end } });
  expect(created.ok()).toBe(true);
  expect((await page.request.put(tripApi, { data: { trip: { ...seed, title }, version: 1 } })).ok()).toBe(true);
  await page.goto(`/#day?trip=${tripId}`);
  const baseline = await (await page.request.get(tripApi)).json();
  test.info().annotations.push({ type: "isolated-trip", description: tripId });
  const prefix = `batch-test-${Date.now()}`;
  const flightName = `${prefix}-flight.txt`;
  const hotelName = `${prefix}-hotel.txt`;
  const requests: string[] = [];
  let failHotel = true;
  let releaseFirst: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route(uploadRoute, async (route) => {
    const body = route.request().postDataBuffer()?.toString("utf8") || "";
    requests.push(body);
    if (requests.length === 1) await firstMayFinish;
    if (body.includes(hotelName) && failHotel) {
      failHotel = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary upload failure. Try again." }) });
    } else await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Add documents", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles([
      { name: flightName, mimeType: "text/plain", buffer: Buffer.from("Booking confirmation AA456. American Airlines AA1639. DFW to LAX. December 18, 2026.") },
      { name: hotelName, mimeType: "text/plain", buffer: Buffer.from("Reservation confirmation HB456. Hotel Burbank. Check-in December 18, 2026. Check-out December 21, 2026 at 10:15 AM.") },
      { name: `${prefix}.exe`, mimeType: "application/octet-stream", buffer: Buffer.from("unsupported file") },
    ]);
    await expect(page.getByLabel(`Attach ${flightName} to a stop`)).toHaveValue("flight-out");
    await expect(page.getByLabel(`Attach ${flightName} to a stop`).locator('option[value="burbank"]')).toHaveCount(0);
    const flightCard = page.getByRole("region", { name: `Upload ${flightName}`, exact: true });
    await flightCard.getByRole("button", { name: "Show all stops for a manual correction" }).click();
    await expect(page.getByLabel(`Attach ${flightName} to a stop`).locator('option[value="burbank"]')).toHaveCount(1);
    await expect(page.getByLabel(`Attach ${hotelName} to a stop`)).toHaveValue("burbank");
    await expect(page.getByText("Unsupported file. Use PDF, TXT, EML, PNG, JPG or WebP.")).toBeVisible();
    await page.getByRole("button", { name: "Save 2 documents", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    await expect(page.locator("input[type=file]")).toBeDisabled();
    await expect(page.getByLabel(`Attach ${hotelName} to a stop`)).toBeDisabled();
    releaseFirst!();
    await expect(page.getByText("Temporary upload failure. Try again.")).toBeVisible();
    await expect(page.locator(".success-banner")).toHaveCount(1);
    await page.getByRole("button", { name: `Remove ${prefix}.exe`, exact: true }).click();
    await page.getByRole("button", { name: "Retry failed file", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Documents tucked away" })).toBeVisible();
    expect(requests.filter((body) => body.includes(flightName))).toHaveLength(1);
    expect(requests.filter((body) => body.includes(hotelName))).toHaveLength(2);
    const afterRetry = await (await page.request.get(tripApi)).json();
    expect(afterRetry.documents.filter((doc: { name: string }) => doc.name === flightName)).toHaveLength(1);
    expect(afterRetry.documents.filter((doc: { name: string }) => doc.name === hotelName)).toHaveLength(1);
    expect(afterRetry.documents.find((doc: { name: string }) => doc.name === flightName).eventId).toBe("flight-out");
    expect(afterRetry.trip.events.find((stop: { id: string }) => stop.id === "burbank").checkout.time).toBe("10:15");
    expect(afterRetry.trip.events).toHaveLength(baseline.trip.events.length);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Add documents", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles([
      { name: `${prefix}-burbank2.txt`, mimeType: "text/plain", buffer: Buffer.from("Reservation confirmation HB789. Hotel Burbank. Check-in December 18, 2026. Check-out December 21, 2026 at 10:30 AM.") },
      { name: `${prefix}-fairfield.txt`, mimeType: "text/plain", buffer: Buffer.from("Reservation confirmation FF789. Fairfield Inn & Suites Twentynine Palms. Check-in December 21, 2026. Check-out December 22, 2026 at 11:30 AM.") },
    ]);
    await expect(page.getByLabel(`Attach ${prefix}-burbank2.txt to a stop`)).toHaveValue("burbank");
    await expect(page.getByLabel(`Attach ${prefix}-fairfield.txt to a stop`)).toHaveValue("fairfield");
    await page.getByRole("button", { name: "Save 2 documents", exact: true }).click();
    await expect(page.getByRole("group",{name:`Review possible conflict for ${prefix}-burbank2.txt`})).toBeVisible();
    await page.getByRole("button",{name:"Keep both originals",exact:true}).click();
    await expect(page.getByRole("heading", { name: "Documents tucked away" })).toBeVisible();
    const afterHotels = await (await page.request.get(tripApi)).json();
    expect(afterHotels.version).toBe(afterRetry.version + 1);
    expect(afterHotels.trip.events.find((stop: { id: string }) => stop.id === "burbank").checkout.time).toBe("10:15");
    expect(afterHotels.trip.events.find((stop: { id: string }) => stop.id === "fairfield").checkout.time).toBe("11:30");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // Remove only this test's hotel originals so the next case independently tests a first booking.
    for(const document of afterHotels.documents.filter((document:{eventId:string})=>document.eventId==="burbank")) {
      expect((await page.request.delete(`/api/documents/${document.id}?tripId=${tripId}`)).ok()).toBe(true);
    }
    // Recover a missing checkout date from the booking, then share one original across the stay.
    const withoutEnd = { ...afterHotels.trip, events: afterHotels.trip.events.map((stop: { id: string; checkoutDate?: string; checkout?: unknown }) => {
      if (stop.id !== "burbank") return stop;
      const copy = { ...stop };
      delete copy.checkoutDate;
      delete copy.checkout;
      return copy;
    }) };
    expect((await page.request.put(tripApi, { data: { trip: withoutEnd, version: afterHotels.version } })).ok()).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Add documents", exact: true }).click();
    const rangeName = `${prefix}-whole-stay.txt`;
    await page.locator("input[type=file]").setInputFiles({ name: rangeName, mimeType: "text/plain", buffer: Buffer.from("Reservation confirmation HB111. Hotel Burbank. Check-in December 18, 2026. Check-out December 21, 2026 at 11:45 AM.") });
    await page.getByLabel("Attach to a stop", { exact: true }).selectOption("burbank");
    await expect(page.getByRole("checkbox", { name: /Save stay dates/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Save checkout at 11:45 AM/ })).toBeChecked();
    await page.getByRole("button", { name: "Save document", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Document tucked away" })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const afterRange = await (await page.request.get(tripApi)).json();
    expect(afterRange.trip.events.find((stop: { id: string }) => stop.id === "burbank").checkoutDate).toBe("2026-12-21");
    expect(afterRange.trip.events.find((stop: { id: string }) => stop.id === "burbank").checkout.time).toBe("11:45");
    expect(afterRange.documents.filter((doc: { name: string }) => doc.name === rangeName)).toHaveLength(1);
    for (const day of [/Fri 18/, /Sat 19/, /Mon 21/]) {
      await page.getByRole("button", { name: day }).click();
      await expect(page.getByRole("region", { name: "Documents for this day" }).getByRole("link", { name: rangeName })).toBeVisible();
    }
    await page.getByRole("button", { name: /Tue 22/ }).click();
    await expect(page.getByRole("region", { name: "Documents for this day" }).getByRole("link", { name: rangeName })).toHaveCount(0);

    await page.getByRole("button", { name: "Add documents", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles([
      { name: `${prefix}-notes1.txt`, mimeType: "text/plain", buffer: Buffer.from("December 20: Batch notes\nTake photos\nDecember 30: Outside trip\nSkip this date") },
      { name: `${prefix}-notes2.txt`, mimeType: "text/plain", buffer: Buffer.from("December 20: Batch notes\nTake photos") },
    ]);
    await page.getByRole("button", { name: "Save 2 documents", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review extracted day notes" })).toBeVisible();
    await expect(page.getByLabel("Imported title 1")).toHaveValue("December 20: Batch notes");
    await expect(page.locator(".proposal")).toHaveCount(1);
    await page.getByRole("button", { name: "Discard suggestion", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // A screenshot stays intact, can be inspected before upload, and can be linked manually.
    const screenshot = await page.screenshot();
    const imageName = `${prefix}-screenshot.png`;
    await page.getByRole("button", { name: "Add documents", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles({ name: imageName, mimeType: "image/png", buffer: screenshot });
    await expect(page.locator("input[type=file]")).toBeHidden();
    await expect(page.getByRole("img", { name: `Preview of ${imageName}` })).toBeVisible();
    const fullSizeLink = page.getByRole("link", { name: `Open ${imageName} at full size` });
    await expect(fullSizeLink).toHaveAttribute("href", /^blob:/);
    await expect(fullSizeLink).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByText("Images and scanned PDFs need a manual choice", { exact: false })).toBeVisible();
    await page.getByLabel("Attach to a stop", { exact: true }).selectOption("flight-out");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("img", { name: `Preview of ${imageName}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("upload-image-mobile.png") });
    await page.getByRole("button", { name: "Save document", exact: true }).click();
    await expect(page.getByRole("group",{name:`Review possible conflict for ${imageName}`})).toBeVisible();
    await page.getByRole("button",{name:"Keep both originals",exact:true}).click();
    await expect(page.getByRole("heading", { name: "Document tucked away" })).toBeVisible();
    const afterImage = await (await page.request.get(tripApi)).json();
    const imageDoc = afterImage.documents.find((doc: { name: string }) => doc.name === imageName);
    expect(imageDoc.eventId).toBe("flight-out");
    const imageResponse = await page.request.get(`/api/documents/${imageDoc.id}?tripId=${tripId}`);
    expect(imageResponse.headers()["content-type"]).toBe("image/png");
    expect(await imageResponse.body()).toEqual(screenshot);
    await page.getByRole("button", { name: "Done", exact: true }).click();
  } finally {
    releaseFirst?.();
    await page.unroute(uploadRoute);
    const current = await (await page.request.get(tripApi)).json();
    for (const doc of current.documents.filter((doc: { name: string }) => doc.name.startsWith(prefix))) {
      await page.request.delete(`/api/documents/${doc.id}?tripId=${tripId}`);
    }
    // Only this newly-created fixture is restored. Never write to the user's California trip.
    await page.request.put(tripApi, { data: { trip: baseline.trip, version: current.version } });
  }
});
