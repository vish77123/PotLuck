# PotLuck

A live cash pool for physical card games. The cards stay on the table; the money lives on everyone's phone.
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
| `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS` | Convex deployment env | Set by `npx @convex-dev/auth`. For production, run it against the prod deployment with your real domain as `--web-server-url`. |

## Tests

```bash
npm test                 # Vitest + convex-test: every business rule, race, idempotency, randomized invariants
npm run typecheck
npx playwright install chromium   # once
npm run test:e2e         # three simulated phones play a round (needs `npx convex dev` running)
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
  lib/ledger.ts    applyEntry, reversals, idempotency
  invariants.ts    assertSessionInvariants
lib/               pure code shared by backend and frontend: settle-up, wallet breakdown, bet suggestions, seats
app/               routes: / · /new · /join/CODE · /s/CODE (lobby or table) · /s/CODE/report · /s/CODE/display · /crew/ID
components/        table, lobby, wallet, report, UI primitives
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
