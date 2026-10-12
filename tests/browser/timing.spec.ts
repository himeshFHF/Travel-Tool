import { test, expect } from "@playwright/test";

test("only real departure times become reminders, and an override survives reload", async ({ page }) => {
  const title = `Timing check ${Date.now()}`;
  await page.goto("/signin-with-chatgpt?return_to=%2F%23trips");
  await page.getByRole("button", { name: "New trip", exact: true }).click();
  await page.getByLabel("Trip name", { exact: true }).fill(title);
  await page.getByLabel("Start date", { exact: true }).fill("2027-02-06");
  await page.getByLabel("End date", { exact: true }).fill("2027-02-07");
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add a stop", exact: true }).first().click();
  await page.getByLabel("Stop title", { exact: true }).fill("Pick up the rental car");
  await page.getByLabel(/^Type\b/).selectOption("drive");
  await page.getByRole("button", { name: "Save stop", exact: true }).click();

  await page.getByRole("button", { name: "Add a stop", exact: true }).first().click();
  await page.getByLabel("Stop title", { exact: true }).fill("Channel Islands ferry");
  await page.getByLabel("Details & things to know").fill("Ferry departs according to the ticket; check in before sailing.");
  await page.getByRole("button", { name: "Save stop", exact: true }).click();

  await page.getByRole("button", { name: /To sort out/ }).click();
  await expect(page.getByText("Check the ticket or booking time for Channel Islands ferry")).toBeVisible();
  await expect(page.getByText(/Check the .* time for Pick up the rental car/)).toHaveCount(0);

  await page.getByRole("button", { name: /Check the ticket or booking time for Channel Islands ferry/ }).click();
  const fixedTime = page.getByLabel("This stop has a fixed departure, entry, or appointment time");
  await expect(fixedTime).toBeChecked();
  await fixedTime.uncheck();
  await page.getByRole("button", { name: "Save stop", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Check the ticket or booking time for Channel Islands ferry")).toHaveCount(0);
  await page.getByRole("button", { name: /My journey/ }).click();
  await page.getByRole("button", { name: /Sat 6/ }).click();
  await page.getByRole("button", { name: "Channel Islands ferry", exact: true }).click();
  await page.getByRole("button", { name: "Edit this stop", exact: true }).click();
  await expect(page.getByLabel("This stop has a fixed departure, entry, or appointment time")).not.toBeChecked();
});
