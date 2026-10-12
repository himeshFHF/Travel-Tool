import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
test("Sites travel workspace: saved edits, private files, PDF import and mobile", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.text().includes("Setting up fake worker")) errors.push(message.text());
  });
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  // Clear only artifacts from previous runs in this disposable local preview.
  const previous = await (await page.request.get("/api/trip")).json();
  for (const doc of previous.documents.filter((d: {name:string}) => ["Universal-confirmation.txt","sample-itinerary.pdf"].includes(d.name))) {
    await page.request.delete(`/api/documents/${doc.id}`);
  }
  previous.trip.events = previous.trip.events.filter((e:{title:string}) => !["Reviewed imported activity","Temporary test stop"].includes(e.title));
  await page.request.put("/api/trip",{data:{trip:previous.trip,version:previous.version}});
  await page.reload();
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
  await page.screenshot({ path: "test-results/wayfarer-desktop.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "California, together." })).toBeVisible();
  await expect(page.locator(".stop-pin").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/wayfarer-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: /Documents/ })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "Universal-confirmation.txt" }),
  ).toBeVisible();
  await page.clock.install({ time: new Date("2026-12-20T17:00:00Z") });
  await page.goto("/#day");
  await page.reload();
  await expect(page.getByRole("button", { name: /Sun 20/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/Today ·/)).toBeVisible();
  expect(errors).toEqual([]);

});

test("My trips navigation and booking-to-itinerary attachment", async ({page}) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(page.getByRole("heading", {name:"California, together."})).toBeVisible();
  await page.getByRole("button", {name:/To sort out/}).click();
  await page.getByRole("link", {name:"My trips",exact:true}).click();
  await expect(page.getByRole("heading",{name:"My trips",exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading",{name:"My trips",exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Open California escape"}).click();
  await expect(page.getByRole("heading", {name:"California, together."})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading",{name:"My trips",exact:true})).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", {name:"California, together."})).toBeVisible();
  const before=await (await page.request.get("/api/trip")).json();
  const fileName=`booking-match-${Date.now()}.txt`;
  let documentId: string|undefined;
  try {
    await page.getByRole("button",{name:"Add documents",exact:true}).click();
    await page.locator("input[type=file]").setInputFiles({name:fileName,mimeType:"text/plain",buffer:Buffer.from("Booking confirmation ABC123. American Airlines AA1639. DFW to LAX. December 18, 2026.")});
    await expect(page.getByText("Matched to Hello, Los Angeles",{exact:true})).toBeVisible();
    await expect(page.getByLabel("Attach to a stop",{exact:true})).toHaveValue("flight-out");
    await page.getByRole("button",{name:"Save document",exact:true}).click();
    await expect(page.getByText(/Attached to Hello, Los Angeles/)).toBeVisible();
    await expect(page.getByRole("heading",{name:"Review extracted day notes"})).toHaveCount(0);
    const after=await (await page.request.get("/api/trip")).json();
    const document=after.documents.find((d:{name:string})=>d.name===fileName);
    documentId=document.id;
    expect(document.eventId).toBe("flight-out");
    expect(after.trip.events).toEqual(before.trip.events);
    await page.getByRole("button",{name:"Done",exact:true}).click();
    await page.getByRole("button",{name:"Hello, Los Angeles",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open document",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Close dialog"}).click();
    await page.getByRole("button",{name:"Add documents",exact:true}).click();
    await page.locator("input[type=file]").setInputFiles({name:"two-bookings.txt",mimeType:"text/plain",buffer:Buffer.from("Booking confirmation. AA1639 DFW to LAX December 18, 2026. Hotel Burbank check-in December 18, 2026.")});
    await expect(page.getByText("Choose the matching stop",{exact:true})).toBeVisible();
    await expect(page.getByLabel("Attach to a stop",{exact:true})).toHaveValue("");
    await page.getByRole("dialog").getByRole("button",{name:/Check in. Settle in./}).click();
    await expect(page.getByLabel("Attach to a stop",{exact:true})).toHaveValue("burbank");
    await page.getByRole("button",{name:"Close dialog"}).click();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("link",{name:"My trips",exact:true}).click();
    await expect(page.getByRole("heading",{name:"My trips",exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/my-trips-mobile.png",fullPage:true,animations:"disabled"});
  } finally {
    if(documentId) await page.request.delete(`/api/documents/${documentId}`);
  }
});

test("checkout evidence, flight check-in and reviewed park order work together",async({page})=>{
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(page.getByRole("heading",{name:"California, together."})).toBeVisible();
  const before=await (await page.request.get("/api/trip")).json();
  let uploadedId:string|undefined;
  try {
    await page.getByRole("button",{name:"Check in. Settle in.",exact:true}).click();
    await expect(page.getByRole("dialog").getByText("Standard checkout 12 PM",{exact:true})).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/itinerary reports 11 AM/)).toBeVisible();
    await page.getByRole("button",{name:"Close dialog"}).click();
    await page.getByRole("button",{name:"Add documents",exact:true}).click();
    await page.locator("input[type=file]").setInputFiles({name:"hotel-checkout-test.txt",mimeType:"text/plain",buffer:Buffer.from("Reservation confirmation HB1234. Hotel Burbank. Check-in: December 18, 2026 at 3 PM. Check-out: December 21, 2026 at 10:30 AM.")});
    await expect(page.getByText("Matched to Check in. Settle in.",{exact:true})).toBeVisible();
    await expect(page.getByLabel("Save checkout at 10:30 AM with this stay")).toBeChecked();
    await page.getByRole("button",{name:"Save document",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Document tucked away"})).toBeVisible();
    await page.getByRole("button",{name:"Done",exact:true}).click();
    const saved=await (await page.request.get("/api/trip")).json();
    uploadedId=saved.documents.find((d:{name:string})=>d.name==="hotel-checkout-test.txt").id;
    expect(saved.trip.events.find((e:{id:string})=>e.id==="burbank").checkout).toMatchObject({time:"10:30",source:"booking",documentId:uploadedId});
    expect(saved.trip.events.length).toBe(before.trip.events.length);
    await page.reload();
    await page.getByRole("button",{name:"Check in. Settle in.",exact:true}).click();
    await expect(page.getByRole("dialog").getByText("By 10:30 AM",{exact:true})).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/From booking/)).toBeVisible();
    await page.getByRole("button",{name:"Close dialog"}).click();
    await page.getByRole("button",{name:/Mon 21/}).click();
    await expect(page.getByText("Checkout by 10:30 AM",{exact:false})).toBeVisible();
    await page.getByRole("button",{name:"One last Burbank morning",exact:true}).click();
    await expect(page.getByRole("dialog").locator(".detail-meta")).toContainText("Checkout by 10:30 AM");
    await page.getByRole("button",{name:"Edit hotel checkout"}).click();
    await expect(page.getByLabel("Checkout deadline (local time)")).toHaveValue("10:30");
    await page.getByRole("button",{name:"Close dialog"}).click();
    const directions=page.getByRole("link",{name:"Open day in Google Maps",exact:true});
    const routeUrl=new URL((await directions.getAttribute("href"))!);
    expect(routeUrl.hostname).toBe("www.google.com");
    expect(routeUrl.searchParams.get("origin")).toContain("Hotel Burbank");
    expect(routeUrl.searchParams.get("destination")).toContain("6333 Encelia");
    expect(routeUrl.searchParams.get("waypoints")!.split("|")).toHaveLength(4);
    await expect(directions).toHaveAttribute("target","_blank");
    await expect(page.getByRole("region",{name:"Death Valley route review"})).toContainText("Order reviewed");
    await page.getByRole("region",{name:"Death Valley route review"}).getByText("Why this route").click();
    await expect(page.getByRole("region",{name:"Death Valley route review"})).toContainText("no direct road between them");
    await page.screenshot({path:"test-results/route-review-desktop.png",fullPage:true,animations:"disabled"});
    // Simulate an editable older order to exercise the route suggestion after
    // the one-time default correction has already been recorded locally.
    const oldOrder=["jt","keys","cap","cholla","hidden","arch","sandiego"];
    const fixture=await (await page.request.get("/api/trip")).json();
    let orderIndex=0;
    const oldStops=oldOrder.map(id=>fixture.trip.events.find((e:{id:string})=>e.id===id));
    fixture.trip.events=fixture.trip.events.map((e:{date:string})=>e.date==="2026-12-22"?oldStops[orderIndex++]:e);
    await page.request.put("/api/trip",{data:{trip:fixture.trip,version:fixture.version}});
    await page.reload();
    await page.getByRole("button",{name:/Tue 22/}).click();
    const review=page.getByRole("region",{name:"Joshua Tree route review"});
    await expect(review).toContainText("Suggested order");
    await review.getByRole("button",{name:"Use this stop order"}).click();
    await expect(review).toContainText("Order reviewed");
    const reordered=await (await page.request.get("/api/trip")).json();
    expect(reordered.trip.events.filter((e:{date:string})=>e.date==="2026-12-22").map((e:{id:string})=>e.id)).toEqual(["jt","hidden","cap","keys","arch","cholla","sandiego"]);
    expect(reordered.trip.events.find((e:{id:string})=>e.id==="cap").lat).toBe(33.98921);
    await page.getByRole("button",{name:/Fri 18/}).click();
    await page.getByRole("button",{name:"Hello, Los Angeles",exact:true}).click();
    await expect(page.getByRole("dialog").getByText(/Check-in opens in/)).toBeVisible();
    await expect(page.getByRole("dialog").locator("time")).toHaveAttribute("datetime","2026-12-17T12:00:00.000Z");
    await page.getByRole("button",{name:"Save boarding pass",exact:true}).click();
    await expect(page.getByLabel("Attach to a stop",{exact:true})).toHaveValue("flight-out");
    await page.getByRole("button",{name:"Close dialog"}).click();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:/Mon 21/}).click();
    await expect(page.getByRole("link",{name:"Open day in Google Maps, part 1 of 2",exact:true})).toBeVisible();
    await expect(page.locator(".day-directions-parts a")).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/route-review-mobile.png",fullPage:true,animations:"disabled"});
    const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa"]).analyze();
    expect(audit.violations.map(v=>v.id)).toEqual([]);
  } finally {
    if(uploadedId) await page.request.delete(`/api/documents/${uploadedId}`);
    const latest=await (await page.request.get("/api/trip")).json();
    await page.request.put("/api/trip",{data:{trip:before.trip,version:latest.version}});
  }
});
