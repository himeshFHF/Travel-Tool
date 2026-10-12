import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
const password = "travel-test-password-2026";
test("private travel workspace: setup, date navigation, edits, uploads, companion and mobile", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Let the adventure begin." }),
  ).toBeVisible();
  const authA11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    authA11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.getByLabel("Your name").fill("Traveler");
  await page.getByLabel("Email", { exact: true }).fill("traveler@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create my travel space" }).click();
  await expect(
    page.getByRole("heading", { name: "California, together." }),
  ).toBeVisible();
  await expect(page.getByText("Trip preview", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Sun 20/ }).click();
  await expect(
    page.getByRole("button", { name: "A little movie magic" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "A little movie magic" }).click();
  await page.getByRole("button", { name: "Edit this stop" }).click();
  await page.getByLabel("Local time").fill("09:00");
  await page.getByRole("button", { name: "Save stop" }).click();
  await expect(page.getByText("9:00 AM", { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Sun 20/ }).click();
  await expect(page.getByText("9:00 AM", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "Add confirmation", exact: false })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Universal-confirmation.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Universal ticket\nSample test document, not a real ticket.",
    ),
  });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(
    page.getByText("Original saved.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const docUrl = await page
    .getByRole("link", { name: "Open document" })
    .getAttribute("href");
  expect(docUrl).toBeTruthy();
  const denied = await request.get(docUrl!);
  expect(denied.status()).toBe(401);
  const allowed = await page.request.get(docUrl!);
  expect(allowed.status()).toBe(200);
  expect(await allowed.text()).toContain("Universal ticket");
  const pdfText = "December 20: A reviewed PDF note";
  const stream = `BT /F1 12 Tf 50 750 Td (${pdfText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page
    .getByRole("button", { name: "Add documents", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "sample-itinerary.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(
    page.getByRole("heading", { name: "Review extracted day notes" }),
  ).toBeVisible();
  await page.getByLabel("Imported title 1").fill("Reviewed imported activity");
  await page.getByRole("button", { name: "Add 1 reviewed notes" }).click();
  await expect(
    page.getByRole("button", {
      name: "Reviewed imported activity",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite companion", exact: true })
    .click();
  const code = await page.getByLabel("One-use invitation code").inputValue();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const context = await browser.newContext();
  const companion = await context.newPage();
  await companion.goto("/");
  await companion
    .getByRole("button", { name: "Have an invitation? Join your companion" })
    .click();
  await companion.getByLabel("Your name").fill("Companion");
  await companion
    .getByLabel("Email", { exact: true })
    .fill("companion@example.test");
  await companion.getByLabel("Password", { exact: true }).fill(password);
  await companion.getByLabel("Invitation code", { exact: true }).fill(code);
  await companion
    .getByRole("button", { name: "Join the adventure", exact: true })
    .click();
  await expect(
    companion.getByRole("heading", { name: "California, together." }),
  ).toBeVisible();
  expect((await companion.request.get(docUrl!)).status()).toBe(200);
  const snapshot = await (await page.request.get("/api/trip")).json();
  const save = await companion.request.put("/api/trip", {
    data: { trip: snapshot.trip, version: snapshot.version },
  });
  expect(save.ok()).toBeTruthy();
  const stale = await page.request.put("/api/trip", {
    data: { trip: snapshot.trip, version: snapshot.version },
  });
  expect(stale.status()).toBe(409);
  const invalid = await page.request.post("/api/documents", {
    multipart: {
      file: {
        name: "bad.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("<html>not a PDF</html>"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
  const csrf = await page.request.post("/api/invite", {
    headers: { origin: "https://other.example" },
  });
  expect(csrf.status()).toBe(403);
  const replay = await request.post("/api/auth/join", {
    data: { name: "Uninvited", email: "third@example.test", password, code },
  });
  expect(replay.status()).toBe(400);
  const publicSignup = await request.post("/api/auth/setup", {
    data: { name: "Stranger", email: "stranger@example.test", password },
  });
  expect(publicSignup.status()).toBe(409);
  await page.reload();
  await page.getByRole("button", { name: /Sun 20/ }).click();
  await page.getByRole("button", { name: "Add a stop", exact: true }).click();
  await page.getByLabel("Stop title").fill("Temporary test stop");
  await page
    .getByLabel("Place or address")
    .fill('<img src=x onerror="window.mapInjection=true">');
  await page.getByLabel("Latitude").fill("34.3");
  await page.getByLabel("Longitude").fill("-118.5");
  await page.getByRole("button", { name: "Save stop" }).click();
  await page.locator(".stop-pin").last().hover();
  await expect(page.locator(".leaflet-tooltip")).toContainText("<img");
  expect(await page.evaluate(() => "mapInjection" in window)).toBe(false);
  await page
    .getByRole("button", { name: "Temporary test stop", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit this stop" }).click();
  await page.getByRole("button", { name: "Remove stop", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Temporary test stop", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Fri 18/ }).click();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    a11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await expect(page.locator(".shared-pin")).toHaveText("1·2");
  const bounds = await page.locator(".route-map").boundingBox();
  for (const pin of await page.locator(".stop-pin").all()) {
    const point = await pin.boundingBox();
    expect(point!.x + point!.width / 2).toBeGreaterThan(bounds!.x);
    expect(point!.x + point!.width / 2).toBeLessThan(bounds!.x + bounds!.width);
    expect(point!.y + point!.height / 2).toBeGreaterThan(bounds!.y);
    expect(point!.y + point!.height / 2).toBeLessThan(
      bounds!.y + bounds!.height,
    );
  }
  await expect(page.getByRole("status")).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/wayfarer-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/wayfarer-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: /Documents/ })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "Universal-confirmation.txt" }),
  ).toBeVisible();
  await page.clock.install({ time: new Date("2026-12-20T17:00:00Z") });
  await page.reload();
  await expect(page.getByRole("button", { name: /Sun 20/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/Today ·/)).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
