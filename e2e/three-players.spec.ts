import { expect, test, type Browser, type Page } from "@playwright/test";

/** Each player is its own browser context = its own phone = its own anonymous identity. */
async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return await context.newPage();
}

async function dismissHint(page: Page) {
  const got = page.getByRole("button", { name: "Got it" });
  if (await got.isVisible().catch(() => false)) await got.click();
}

/** Builds a bet with the Boot quick button, then places it with Enter on the stack (the keyboard path of the swipe). */
async function betBoot(page: Page) {
  await dismissHint(page);
  await page.getByRole("button", { name: /^Boot/ }).click();
  const stack = page.locator('[role=button][aria-label^="Bet stack"]');
  await stack.focus();
  await page.keyboard.press("Enter");
  await expect(stack).toHaveCount(0, { timeout: 10_000 });
}

test("three phones: create, join, play a round, pay out, report", async ({ browser }) => {
  const host = await phone(browser);
  const priya = await phone(browser);
  const rahul = await phone(browser);

  // Host creates the table.
  await host.goto("/new");
  await host.getByPlaceholder("Friday Night Crew").fill("E2E Crew");
  await host.getByPlaceholder("Priya").first().fill("Arjun");
  await host.getByRole("button", { name: "Create session" }).click();
  await host.waitForURL(/\/s\/[A-Z0-9]{6}$/);
  const code = host.url().split("/").pop()!;

  // Two friends join from their own phones.
  for (const [page, name] of [[priya, "Priya"], [rahul, "Rahul"]] as const) {
    await page.goto(`/join/${code}`);
    await page.getByRole("button", { name: "Add a new name" }).click();
    await page.getByPlaceholder("Priya").fill(name);
    await page.getByRole("button", { name: `Take a seat as ${name}` }).click();
    await page.waitForURL(new RegExp(`/s/${code}$`));
  }
  await expect(host.getByText("At the table · 3")).toBeVisible();

  // Host starts Teen Patti with everyone.
  await host.getByRole("button", { name: "Start Teen Patti" }).click();
  await host.getByRole("button", { name: /^Start · 3 players/ }).click();
  for (const page of [host, priya, rahul]) await expect(page.getByText("POOL", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(host.getByText("₹30").first()).toBeVisible();

  // Each plays their turn in seat order: Arjun, Priya, Rahul.
  await betBoot(host);
  await expect(priya.getByText("YOUR TURN")).toBeVisible({ timeout: 15_000 });
  await betBoot(priya);
  await expect(rahul.getByText("YOUR TURN")).toBeVisible({ timeout: 15_000 });
  await betBoot(rahul);

  // Everyone sees the same pool: 3 boots + 3 bets of ₹10.
  for (const page of [host, priya, rahul]) await expect(page.getByText("₹60", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Host ends the game: Priya wins.
  await host.getByRole("button", { name: "Host controls" }).click();
  await host.getByRole("button", { name: /End game/ }).click();
  await host.getByRole("button", { name: /Priya/ }).first().click();
  await host.getByRole("button", { name: /^Pay ₹60 to Priya/ }).click();
  for (const page of [host, priya, rahul]) await expect(page.getByText("+₹60")).toBeVisible({ timeout: 15_000 });
  await expect(priya.getByText("YOU WON")).toBeVisible();

  // Host ends the session; the report's nets add up and settle-up is shown.
  await host.getByRole("button", { name: "Next round" }).click();
  await host.getByRole("button", { name: "End session" }).click();
  await host.getByRole("button", { name: "End & see report" }).click();
  await host.waitForURL(/\/report$/);
  await expect(host.getByText("Settle up")).toBeVisible();
  await expect(host.getByText(/pays/).first()).toBeVisible();
  await expect(host.getByText("2 transfers")).toBeVisible();
});
