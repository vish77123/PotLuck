# PotLuck

A live cash pool for physical card games, and a bank-and-deeds tracker for physical Monopoly-style board games. The cards, board and dice stay on the table; the money lives on everyone's phone.
Friends join a session from their own phones, put money into a per-game pool, and at the end get a report and a
"who pays whom" list. The app tracks money only and never enforces card rules.

**Stack:** Next.js (App Router) + TypeScript, Tailwind CSS v4, Framer Motion, Zustand (UI-only state),
Convex (database, reactive queries, mutations) with Convex Auth (anonymous), Vitest + convex-test, Playwright.

## How money is kept safe

- **Append-only ledger.** Rows in `ledgerEntries` are never edited or deleted. An undo inserts a `REVERSAL`
  that points at the original (one reversal per entry; a reversal can't be reversed).
- **One writer.** `applyEntry` in `convex/lib/ledger.ts` is the only code that inserts ledger entries and moves
  wallet and pool balances. It throws if a wallet or pool would go below 0. Every money mutation is a Convex
  mutation, so it runs as one serializable transaction.
- **Idempotency.** Every money mutation takes a client-generated key; a repeat returns the first result.
- **Access control in code.** Convex has no row-level security, so every function resolves the caller and checks
  they sit in the session (`requirePlayer`, `requireHost` in `convex/lib/access.ts`).
- **Invariants.** `assertSessionInvariants` (internal query) replays the ledger and checks that no wallet is
  negative, pools match their entries, wallets + open pools = buy-ins + top-ups − cash-outs, and nets sum to 0.
  A seeded 1,000-operation randomized test runs it after every operation.
- Amounts are whole rupees stored as integers.

## Local setup

Requires Node 20+ (tested on 22+).

```bash
npm install
npx convex dev          # first run: log in, create a project; keeps running and pushes functions
npx @convex-dev/auth    # once: sets the JWT keys and SITE_URL on your dev deployment
npm run dev:frontend    # Next.js on http://localhost:3000
```

`npm run dev` runs the frontend and `convex dev` together.

Open the app on your phone with your computer's LAN address, or use several browser profiles. To simulate more
than one player on one computer, use different origins: `localhost`, `127.0.0.1` and `anything.localhost`
(each has its own anonymous identity; `next.config.ts` allows them in dev).

### Environment variables

`npx convex dev` writes `.env.local` for you:

| Variable | Where | Meaning |
| --- | --- | --- |
| `CONVEX_DEPLOYMENT` | `.env.local` | Which Convex deployment the CLI talks to (dev). |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` / Vercel | The deployment's `.convex.cloud` URL used by the browser. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `.env.local` / Vercel | The deployment's `.convex.site` URL (auth endpoints). |
| `CONVEX_DEPLOY_KEY` | Vercel only | Lets Vercel deploy Convex functions on each build (Production key). |
| `NEXT_PUBLIC_MONOPOLY_ENABLED` | `.env.development.local` / Vercel Preview | `true` shows property games in the UI. Unset (production) keeps every Monopoly entry point hidden. |
| `MONOPOLY_ENABLED` | Convex deployment env | `true` lets the server create property sessions. Set on dev and preview deployments only. |
| `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS` | Convex deployment env | Set by `npx @convex-dev/auth`. For production, run it against the prod deployment with your real domain as `--web-server-url`. |

## Tests

```bash
npm test                 # Vitest + convex-test: every business rule, race, idempotency, randomized invariants
npm run typecheck
npx playwright install chromium   # once
npm run test:e2e         # three simulated phones play a card round and a property game (needs `npx convex dev` running,
                         # MONOPOLY_ENABLED=true on that deployment and NEXT_PUBLIC_MONOPOLY_ENABLED=true for Next)
```

## Deploy: Vercel + Convex

1. Push the repo to GitHub and import it in Vercel.
2. In the Convex dashboard, create a **Production** deploy key and add it to Vercel as `CONVEX_DEPLOY_KEY`.
3. Set the Vercel **Build Command** to:

   ```bash
   npx convex deploy --cmd 'npm run build'
   ```

   `convex deploy` pushes the functions, injects `NEXT_PUBLIC_CONVEX_URL` for the build, then runs the Next build.
4. Configure auth on the production deployment (once), using your Vercel domain:

   ```bash
   CONVEX_DEPLOYMENT=prod:<name> npx @convex-dev/auth --web-server-url https://your-app.vercel.app
   ```

5. Open the site on a phone and use "Add to Home Screen" (it's a PWA; the screen stays awake during a game).

Convex's free plan is plenty for a friend group: heartbeats run every 20 s only while the app is visible, the feed
is paginated, and nothing scans whole tables (stats read per-session summary rows written when a session ends).

## Where things are

```
convex/            schema, access helpers, ledger core, every mutation and query, tests (*.test.ts)
  mono*.ts         property (Monopoly-style) games: mono.ts (actions), monoBoards.ts, monoStats.ts, monoDisplay.ts
  lib/ledger.ts    applyEntry, reversals, idempotency
  invariants.ts    assertSessionInvariants
lib/               pure code shared by backend and frontend: settle-up, wallet breakdown, bet suggestions, seats
app/               routes: / · /new · /join/CODE · /s/CODE (lobby or table) · /s/CODE/report · /s/CODE/display · /crew/ID
components/        table, lobby, wallet, report, UI primitives; components/mono/ for property games
e2e/               Playwright three-player test
design/            the design handoff the screens follow
```

## Using it

- **Host** creates a session, shares the code or QR, sets wallets (equal or custom), picks a money theme and a
  game template, then starts a game. The host is also a normal player and can hand host over at any time.
- **Players** open the link, pick their name, and bet by tapping notes/chips and swiping the stack into the pool
  (Enter on the stack works from a keyboard). Settings (sound, haptics, animations, Night/Day) are on the home screen.
- **Table display:** open `/s/CODE/display` on a laptop or TV for a read-only landscape view.
- **Report:** `/s/CODE/report` shows nets, who pays whom, every game and entry, loans and the undo log; export a
  PDF (print) or share a tall PNG.

## Property games (Monopoly-style)

A second session type for physical board games: the board, tokens, dice and cards stay on the table, and the app keeps the
money, the bank and, optionally, the deeds. It lives in the same crews, join codes, guest-name picker, device binding,
host transfer and lifetime stats as card games. Pool sessions are unchanged.

**Feature flag.** Everything is hidden unless `NEXT_PUBLIC_MONOPOLY_ENABLED=true`. The server also refuses to create a
property session unless the Convex env var `MONOPOLY_ENABLED=true`, so a crafted client can't make one on a deployment
that hasn't switched it on. Turn both on for dev and preview deployments only.

**Two kinds of money, never mixed.** *Game money* (a preset's starting cash, with an unlimited bank) lives in the game.
*Real stakes* are optional real-₹ buy-ins per game, paid out by finishing place (winner takes all, or percentages that
total 100). Stakes go through the existing ledger as `MONO_BUY_IN` / `MONO_PAYOUT` entries, so the session report and
settle-up work unchanged: net ₹ = payouts − buy-ins.

**Setup** (host, in the lobby): board (Classic or Business), track properties on or off, starting cash, banker mode
(self-service, or the banker approves every bank payment), house rules (Free Parking pot, double on GO, auctions, even
building) and stakes. Rematches are new games in the same session.

**Rules are pure functions.** `lib/monopoly/rules.ts` (rent, building, mortgages, raise-money options, net worth, stake
split) and `lib/monopoly/engine.ts` (an event reducer, one planner per action, grouped undo and the invariants) are shared by
the Convex mutations and the UI previews, and covered by Vitest. Every change to a game is a group of events written by
`applyMonopolyGroup`, which enforces cash ≥ 0, ownership and the bank's 32 houses and 12 hotels. Host undo reverses a whole
group, and is refused (naming the blocking action) if a later group touched the same players' cash or the same properties.

**Board editor.** `/crew/<id>/board` (also linked from the lobby and the crew page) lets a crew keep its own corrected copy
of Classic and Business: names, prices, rents, house costs, mortgages, taxes, Pass GO, jail fine, starting cash and stock.
Each game snapshots its board when it is set up; saving a correction updates games still in setup, never a game in play.
"Reset to the shipped values" discards the crew's copy.

**Preset verification (important).** Classic has the standard values and original street names. **Business uses the
design's Indian city names, but every number is a copy of the Classic number, not read from a physical Business board.**
Every space and the board-wide values carry `verified: false`, shown as "unchecked" in the lobby, the property sheet and
the editor. Check them against your board in the editor and mark them checked. The full list of values to check is in
[docs/monopoly.md](docs/monopoly.md).

**Screens.** Me (cash, turn strip, quick actions, my deeds), Board (every deed by colour, tap a space for the landed-on
flow), Ranks (net worth), Bank (banker queue, pot, house and hotel stock, host tools), Feed (plain-language activity with host
undo), plus pay / request, trade builder, live auction, cards, jail, raise money and bankruptcy sheets, game over, and a
landscape table display at `/s/CODE/display` that shows the real board ring with owners and buildings.

**Pause and resume.** The host can pause a game and resume it later, even another day. Games never end on their own.

**Rules decisions worth knowing.** Hotels return 4 houses to the bank when built, and need 4 houses in stock to sell back.
A mortgaged property received in a trade or a bankruptcy costs its receiver 10% interest at once. Auction countdown is 30 s,
reset to 15 s by each bid. Payment requests, trades and banker approvals lapse after 5 minutes. Bank payments wait for the
banker in banker mode; player-to-player money is always instant. Declaring bankruptcy isn't checked against a debt, because
the debt lives on the physical table; the host can undo it.
