import { expect, test, type Browser, type Page } from "@playwright/test";

// Needs a Convex dev deployment with MONOPOLY_ENABLED=true, and NEXT_PUBLIC_MONOPOLY_ENABLED=true for the Next server.

/** Each player is its own browser context = its own phone = its own anonymous identity. */
async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return await context.newPage();
}

// Headless Chromium only runs animation frames for the page in front, and Playwright waits for bottom sheets to stop
// moving, so each phone is brought to the front before it acts.
const front = async (page: Page) => {
  await page.bringToFront();
  return page;
};

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Game sections" }).getByRole("button", { name });
// The Next dev badge sits over the middle of the first tab, so tabs are tapped a little off-centre.
const goTab = (page: Page, name: string) => tab(page, name).click({ position: { x: 62, y: 8 } });

async function openSpace(page: Page, name: string) {
  await front(page);
  await goTab(page, "Board");
  await page.getByRole("button", { name: new RegExp(`^${name},`) }).click();
}

async function declareBankruptcy(page: Page, creditor: string) {
  await front(page);
  await goTab(page, "Me");
  await page.getByRole("button", { name: "Declare bankruptcy" }).click();
  const sheet = page.getByRole("dialog", { name: "Declare bankruptcy" });
  await sheet.getByRole("button", { name: creditor }).click();
  await sheet.getByRole("button", { name: "Yes, I'm out" }).click();
}

test("three phones: a property game with rent, a trade, a bankruptcy and the real-money payout", async ({ browser }) => {
  const arjun = await phone(browser);
  const priya = await phone(browser);
  const rahul = await phone(browser);

  // Host creates a property game and sets ₹50 buy-ins, winner takes all.
  await arjun.goto("/new");
  await arjun.getByRole("radio", { name: "Property game" }).click();
  await arjun.getByPlaceholder("Friday Night Crew").fill("E2E Property Crew");
  await arjun.getByPlaceholder("Priya").first().fill("Arjun");
  await arjun.getByRole("button", { name: "Create property game" }).click();
  await arjun.waitForURL(/\/s\/[A-Z0-9]{6}$/);
  const code = arjun.url().split("/").pop()!;

  for (const [page, name] of [[priya, "Priya"], [rahul, "Rahul"]] as const) {
    await page.goto(`/join/${code}`);
    await page.getByRole("button", { name: "Add a new name" }).click();
    await page.getByPlaceholder("Priya").fill(name);
    await page.getByRole("button", { name: `Take a seat as ${name}` }).click();
    await page.waitForURL(new RegExp(`/s/${code}$`));
  }
  await expect(arjun.getByText("At the table · 3")).toBeVisible();
  await arjun.getByRole("button", { name: "Increase Buy-in" }).click();
  await expect(arjun.getByText("Pot ₹150 · 3 players")).toBeVisible({ timeout: 15_000 });
  await arjun.getByRole("button", { name: "Start game" }).click();
  for (const page of [arjun, priya, rahul]) await expect(page.getByText(/^YOUR CASH/)).toBeVisible({ timeout: 20_000 });
  await expect(arjun.getByText("$1,500").first()).toBeVisible();

  // Rent: Arjun buys Market Sq; Priya lands on it and pays $14 in one tap.
  await openSpace(arjun, "Market Sq");
  await arjun.getByRole("button", { name: "Buy for $180" }).click();
  await expect(arjun.getByText("Bought Market Sq")).toBeVisible();
  await openSpace(priya, "Market Sq");
  await expect(priya.getByText("Arjun owns this")).toBeVisible({ timeout: 15_000 });
  await priya.getByRole("button", { name: "Pay Arjun $14" }).click();
  await goTab(priya, "Me");
  await expect(priya.getByLabel("Your cash $1,486")).toBeVisible({ timeout: 15_000 });

  // A trade: Priya offers $100 for Market Sq; Arjun accepts on his phone.
  await front(priya);
  await priya.getByText("Trade", { exact: true }).click();
  const trade = priya.getByRole("dialog", { name: "Trade" });
  await trade.getByRole("button", { name: "Arjun" }).click();
  await trade.getByRole("textbox", { name: "You give cash" }).fill("100");
  await trade.getByRole("button", { name: /Market Sq/ }).click();
  await trade.getByRole("button", { name: "Offer to Arjun" }).click();
  await front(arjun);
  await goTab(arjun, "Me");
  await expect(arjun.getByText(/Priya offers \$100 for your Market Sq/)).toBeVisible({ timeout: 15_000 });
  await arjun.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(priya.getByLabel("Your cash $1,386")).toBeVisible({ timeout: 15_000 });
  await front(priya);
  await goTab(priya, "Board");
  await expect(priya.getByRole("button", { name: /^Market Sq, owned by Priya/ })).toBeVisible();

  // Ranks: net worth puts Arjun (cash plus a bought-then-sold deed) ahead of the others.
  await goTab(priya, "Ranks");
  await expect(priya.getByRole("heading", { name: "Ranks" })).toBeVisible();
  await expect(priya.getByText("Net worth = cash + property price")).toBeVisible();

  // Pause: the host pauses, everyone sees it and can't move; the host resumes.
  await front(arjun);
  await goTab(arjun, "Bank");
  await arjun.getByRole("button", { name: "Pause the game" }).click();
  await front(priya);
  await goTab(priya, "Me");
  await expect(priya.getByText(/The game is paused/)).toBeVisible({ timeout: 15_000 });
  await front(arjun);
  await arjun.getByRole("button", { name: "Resume the game" }).click();
  await front(priya);
  await expect(priya.getByText(/The game is paused/)).toHaveCount(0, { timeout: 15_000 });

  // The table display shows the real board with the owners.
  const tv = await phone(browser);
  await tv.setViewportSize({ width: 1280, height: 720 });
  await tv.goto(`/s/${code}/display`);
  await expect(tv.getByText("Players", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(tv.getByText("Market Sq").first()).toBeVisible();

  // Bankruptcy: Priya, then Rahul, go out to Arjun. The last player standing wins and the stakes pay out.
  await declareBankruptcy(priya, "Arjun");
  await expect(priya.getByText(/You're out of the game, finishing 3rd/)).toBeVisible({ timeout: 15_000 });
  await declareBankruptcy(rahul, "Arjun");
  await front(arjun);

  for (const page of [arjun, priya, rahul]) await expect(page.getByText("Arjun wins")).toBeVisible({ timeout: 20_000 });
  // Pot ₹150 to the winner: Arjun +₹100, the others −₹50.
  await expect(arjun.getByText("+₹100")).toBeVisible();
  await expect(priya.getByText("−₹50").first()).toBeVisible();
  await expect(arjun.getByText("Settle up · whole session")).toBeVisible();

  // The session report lists the game, the places and the settle-up.
  await arjun.getByRole("link", { name: "Session report" }).click();
  await arjun.waitForURL(/\/report$/);
  const report = arjun.getByRole("main");
  await expect(report.getByText("Property games · 1")).toBeVisible();
  await expect(report.getByText("1st · Arjun")).toBeVisible();
  await expect(report.getByText("2 transfers")).toBeVisible();
});
