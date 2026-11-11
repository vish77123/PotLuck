# Monopoly sessions (work in progress)

Branch `monopoly`. Nothing here is deployed to production. The README gets its Monopoly section in milestone 6.

## Milestone 6 status

Net-worth leaderboard (Ranks tab), pause and resume, the table display, a Convex-level randomized test and the three-player
Playwright test are done. The README has the feature flag, board editor and preset verification notes.

- **Ranks:** cash + property price (mortgaged at its mortgage value) + buildings at cost, with a split bar. Out players sit
  below, with their finishing place.
- **Pause / resume:** `mono.pause` / `mono.resume` (host). A paused game takes no moves, even for days; the host can still undo,
  cancel or end it. Pausing is refused while an auction runs, since its countdown can't be frozen. Requests that expire
  meanwhile stay expired.
- **Table display:** `monoDisplay.view` (keyed by room code, like the card-game display) and `components/mono/MonoTV.tsx`:
  the real board order as a ring, owner fill, mortgage hatch, building pips, the Free Parking pot, the live auction, players
  with cash and the feed. The page picks it by session type. The stage is centred with its own wrapper; the card-game display
  uses a different centring that is offset on windows narrower than 1280 px, which I left alone.
- **Tests:** `convex/mono.random.test.ts` drives the real mutations for 1,000+ accepted operations (payments, rent, buying,
  building, trades, auctions, cards, jail, bankruptcy, pause, host undos) and replays the event log after every 25.
  `e2e/monopoly.spec.ts`: three phones play rent, a trade, ranks, pause, the display, two bankruptcies, the ₹100 / −₹50
  payout and the report.

## Milestone 5 status

Raise money, bankruptcy, finishing places, game over, the stakes payout into the existing report and settle-up, and
lifetime property-game stats work. Not yet built: the net-worth leaderboard tab, the table display, pause and resume, the
Playwright test and the 1,000-action Convex-level randomized test (milestone 6).

- **Raise money:** when a payment fails because a player is short, the phone opens a sheet listing what they can sell or
  mortgage and what each raises, with a progress bar. A card that collects from everyone fails with the short player named;
  that phone flags them (`mono.flagShort`) and their own phone shows a "raise money" banner. If even selling everything
  can't cover it, the sheet offers bankruptcy.
- **Bankruptcy** (`mono.declareBankruptcy`): to a player (buildings sold at half cost, then everything to them, 10% interest on
  mortgaged deeds, refused if the creditor can't pay it) or to the bank (cash to the bank, deeds back unmortgaged and, with
  auctions on, auctioned one after another through the auction `queue`). The player or the host can do it. Their open
  requests are cancelled and the turn moves on. The first player out takes the last place; the last one standing wins.
- **Ending:** the last player standing closes the game automatically. The host can also end early (`mono.endGameEarly`):
  places start from net worth and can be reordered. Closing a game pays the real-money stakes by place
  (`MONO_PAYOUT`, leftover rupees to 1st), writes one `mGameSummaries` row per player (place, rent earned and paid, stake
  net) and cancels open requests and auctions. Because `computeNets` already counts stakes, the existing settle-up and
  session report show the result with no other change; the report gains a "Property games" section and its totals count
  property games.
- **Reopen** (`mono.reopenGame`): reverses the payouts, removes the summaries and makes the game live, so the host can undo
  the last move and play on. Undo is refused while an auction is running.
- **Stats** (`convex/monoStats.ts`): games, wins, average finish, total rent earned and stake net per member, shown on the
  crew page and a player's profile. Rent excludes undone payments (undo events are marked `undo`).

## Milestone 4 status

Trades, auctions, card actions, jail and the Free Parking pot work. Not yet built: raise-money flow, bankruptcy, game over,
stakes payout, stats, the table display, pause and resume.

- **Trades:** `mono.proposeTrade` creates a request (cash, properties and Get Out of Jail Free cards on each side). The
  builder previews with the same rules as the server and shows interest on mortgaged properties. The other player accepts
  with `mono.respond`; it then re-checks against the game as it is and runs as one undoable group. Offers lapse after 5
  minutes. Buildings in a traded property's set must be sold first.
- **Auctions:** any player can start one on an unowned property when auctions are on (`mono.startAuction`). Anyone who can
  cover it bids (`mono.bid`, at least $1 more than the highest, not above their cash, and not on top of their own bid). The
  first countdown is 30 s and each bid resets it to 15 s by cancelling and rescheduling `internal.mono.closeAuction`, which
  does nothing if a later bid moved the deadline. The highest bidder pays the bank and gets the deed; no bids, or a winner
  who can no longer pay, leaves it with the bank with a feed note. The result is automatic: the bids are the consent, so it
  isn't queued for the banker. The host can stop an auction. `queue` on an auction lets a bankruptcy to the bank auction its
  properties one after another (used in milestone 5).
- **Cards:** "collect from every player" and "pay every player" are single atomic moves that fail with the short player
  named; repairs bill by the card's per-house and per-hotel amounts (to the pot when that rule is on); a Get Out of Jail
  Free card can be picked up (two exist), held, traded and used.
- **Jail:** go to jail (no GO), count a turn, pay the fine, use a card, or leave on doubles. The third turn shows a
  "pay the fine" prompt.
- **Banker mode:** payments, rent, "from every player" cards, trades and jail moves that pay nobody are instant; anything
  that pays the bank or the pot (including repairs and the jail fine) waits for the banker.
- **Feed:** non-action lines (turn changes, auction results with no winner) are `NOTE`/`TURN` rows that can't be undone.

## Milestone 3 status

Property tracking works in games with "Track properties" on: buy from the bank, the landed-on flow with one-tap rent,
the Board tab (every deed by colour, owner fill, mortgage hatch, building pips), my deeds on the Me tab, building and
selling with even-building and bank stock, mortgages, bank stock cards, and the crew-level board editor. Not yet built:
auctions (a property can only be bought at its list price for now), trades, card actions, jail UI, bankruptcy.

- **Property actions** go through the same `mono.perform` as bank moves: `buy`, `rent`, `build`, `sellBuilding`,
  `mortgage`, `unmortgage`. Rent is player-to-player, so it is instant even in banker mode; everything else that touches the
  bank is queued for the banker.
- **Board editor** (`/crew/ID/board`, also linked from the lobby and the crew page): each crew can keep a corrected copy of
  Classic and Business (`boardConfigs`). Saving also updates games of that crew that are still in setup (keeping a starting
  cash the host chose); a game that has started keeps its snapshot. Anyone in the crew can edit; values are validated by
  `boardProblems`. Marking a space "checked" clears its `verified: false` flag, which is how you work through the Business
  list above.
- **Files:** `convex/monoBoards.ts`, `components/mono/{PropertySheet,MonoBoardTab,BoardEditor}.tsx`,
  `lib/monopoly/colors.ts`.

## Milestone 2 status

The property-game session type works end to end behind the flag: create, join, setup, start, dashboard, bank moves, Pass GO,
payments and requests, banker mode, activity feed, grouped undo, turn strip. Not yet built: properties on the board,
trades, auctions, cards, jail UI, bankruptcy, game over, reports, the table display.

- **Convex:** `convex/mono.ts` (functions), `convex/lib/mono.ts` (`applyMonopolyGroup`, `loadGame`, `loadGroups`),
  `convex/mono.test.ts`. `internal.mono.assertGameInvariants` replays a game's event log and checks it.
- **Flags:** UI hidden unless `NEXT_PUBLIC_MONOPOLY_ENABLED=true`. The server refuses to create a property session unless
  the Convex env var `MONOPOLY_ENABLED=true`. Both are set only for local dev (`.env.development.local`, gitignored, and
  the dev deployment). Neither is set anywhere else.
- **Pool code touched** (all behaviour-preserving, covered by the existing tests): `seatPlayer` skips a 0 buy-in, `joinInfo`
  and `mine` return `type`, `games.start` / `wallet.topUp` / `loans.request` refuse property sessions, `sessions.end` and
  `reorderSeats` know about running property games.
- **Rules decided:** a player moves their own money with the bank; the host or banker can act for anyone. In banker mode
  the host acts at once and is the fallback approver for the banker's own moves. Payment requests and approvals expire
  after 5 minutes. Setup lives in the lobby (one screen), not a separate step before it.
- **Local testing:** `npx convex dev --once` pushed this branch's functions to the dev deployment. Nothing else was deployed.

## Milestone 1 status

Done: additive schema, board presets, the pure rules module and engine, stake entries in the ledger, tests.
Not started: any Convex function (`convex/mono*.ts`), any UI, the feature flag wiring.

| Where | What |
| --- | --- |
| `convex/schema.ts` | `sessions.type` (optional), `ledgerEntries.mGameId` (optional), `MONO_BUY_IN` / `MONO_PAYOUT` entry types, and new tables `boardConfigs`, `mGames`, `mPlayers`, `mPropertyStates`, `mEvents`, `mRequests`, `mAuctions`, `mGameSummaries`. No new index on any existing table. |
| `lib/monopoly/types.ts` | Board, settings, state and event types. |
| `lib/monopoly/presets.ts` | `CLASSIC` (standard values) and `BUSINESS` (placeholders, see below). |
| `lib/monopoly/rules.ts` | Rent, building and selling checks, mortgage maths, net worth, raise-money options, stake split, settings and board validation. |
| `lib/monopoly/engine.ts` | The event reducer, one planner per user action, grouped undo, invariants. |
| `convex/lib/ledger.ts`, `nets.ts`, `invariants.ts` | Stake entries are ledger-only: they never touch a wallet or pool, and `computeNets` adds payouts − buy-ins. |

Tests: `npm test`. New files are `lib/monopoly/*.test.ts` and `convex/monopoly.stakes.test.ts`. The randomized test plays
more than 1,000 mixed actions and undos per run and checks every invariant after each step, and that replaying the
event log from scratch gives the same state.

### Rules decided while building the engine

- **Hotels.** Building one returns 4 houses to the bank. Selling one swaps it for 4 houses, so it is blocked when the
  bank has fewer than 4. In a bankruptcy buildings go straight back to the bank, so stock never blocks it.
- **Even building** is ignored when properties aren't tracked, since nothing can be built then.
- **Trades** need every building in a traded property's colour set sold first. A mortgaged property costs its receiver
  10% interest (rounded up) to the bank at once. Both sides' cash nets to one payment, made first, so interest can be
  paid out of cash received in the same trade.
- **Bankruptcy to a player.** Buildings are sold to the bank at half cost, then all cash, deeds and jail cards go to the
  creditor, who pays 10% on each mortgaged deed. If the creditor can't afford that, the bankruptcy is refused until they
  raise money. **To the bank:** cash goes to the bank, deeds return unmortgaged and are queued for auction (when
  auctions are on), and the Free Parking pot is untouched.
- **Finishing places** run in reverse order of going out; the last player standing is 1st. The host can end a game early
  with places proposed by net worth.
- **Undo** is refused when a later group still in effect touched the same player's cash, property, the pot, jail state or
  jail cards. It is also refused if a player in the action has since gone out of the game. The error names the group to
  undo first. Bank stock isn't a blocking key, so an undo can still fail with "the bank has no houses left" if other
  groups used the stock; the mutation will report that as a refusal.
- **Stake split.** Each place gets its percentage of the pot rounded down; leftover rupees go to 1st.

## Business board: values to verify

The structure and Indian city names come from the design handoff. **Every number below is a copy of the Classic number,
not read from a physical Business board.** Every space and the board-wide values carry `verified: false` until you
correct them (in the board editor, milestone 3). Please check them against your board.

Board-wide: Pass GO 200 · jail fine 50 · starting cash 1,500 · Get Out of Jail Free cards 2 · houses 32 · hotels 12 ·
utility rent 4× dice with one, 10× with both.

Rents are base / 1 house / 2 / 3 / 4 / hotel (streets) and by number owned 1 / 2 / 3 / 4 (stations). Utilities and the
tax spaces use the price column for their amount. The colour groups, the order of the spaces and the names of the six
card spaces are also unconfirmed.

| # | Space | Kind | Price / tax | Rent | House cost | Mortgage |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Agra | property (brown) | 60 | 2 / 10 / 30 / 90 / 160 / 250 | 50 | 30 |
| 3 | Jaipur | property (brown) | 60 | 4 / 20 / 60 / 180 / 320 / 450 | 50 | 30 |
| 4 | Income Tax | tax | 200 |  |  |  |
| 5 | Central | rail | 200 | 25 / 50 / 100 / 200 |  | 100 |
| 6 | Kochi | property (lblue) | 100 | 6 / 30 / 90 / 270 / 400 / 550 | 50 | 50 |
| 8 | Mysuru | property (lblue) | 100 | 6 / 30 / 90 / 270 / 400 / 550 | 50 | 50 |
| 9 | Pune | property (lblue) | 120 | 8 / 40 / 100 / 300 / 450 / 600 | 50 | 60 |
| 11 | Indore | property (pink) | 140 | 10 / 50 / 150 / 450 / 625 / 750 | 100 | 70 |
| 12 | Power Co. | utility | 150 |  |  | 75 |
| 13 | Lucknow | property (pink) | 140 | 10 / 50 / 150 / 450 / 625 / 750 | 100 | 70 |
| 14 | Bhopal | property (pink) | 160 | 12 / 60 / 180 / 500 / 700 / 900 | 100 | 80 |
| 15 | Western | rail | 200 | 25 / 50 / 100 / 200 |  | 100 |
| 16 | Hyderabad | property (orange) | 180 | 14 / 70 / 200 / 550 / 750 / 950 | 100 | 90 |
| 18 | Ahmedabad | property (orange) | 180 | 14 / 70 / 200 / 550 / 750 / 950 | 100 | 90 |
| 19 | Kolkata | property (orange) | 200 | 16 / 80 / 220 / 600 / 800 / 1000 | 100 | 100 |
| 21 | Chennai | property (red) | 220 | 18 / 90 / 250 / 700 / 875 / 1050 | 150 | 110 |
| 23 | Bengaluru | property (red) | 220 | 18 / 90 / 250 / 700 / 875 / 1050 | 150 | 110 |
| 24 | Goa | property (red) | 240 | 20 / 100 / 300 / 750 / 925 / 1100 | 150 | 120 |
| 25 | Eastern | rail | 200 | 25 / 50 / 100 / 200 |  | 100 |
| 26 | Shimla | property (yellow) | 260 | 22 / 110 / 330 / 800 / 975 / 1150 | 150 | 130 |
| 27 | Darjeeling | property (yellow) | 260 | 22 / 110 / 330 / 800 / 975 / 1150 | 150 | 130 |
| 28 | Water Co. | utility | 150 |  |  | 75 |
| 29 | Ooty | property (yellow) | 280 | 24 / 120 / 360 / 850 / 1025 / 1200 | 150 | 140 |
| 31 | Chandigarh | property (green) | 300 | 26 / 130 / 390 / 900 / 1100 / 1275 | 200 | 150 |
| 32 | Gurugram | property (green) | 300 | 26 / 130 / 390 / 900 / 1100 / 1275 | 200 | 150 |
| 34 | Delhi | property (green) | 320 | 28 / 150 / 450 / 1000 / 1200 / 1400 | 200 | 160 |
| 35 | Northern | rail | 200 | 25 / 50 / 100 / 200 |  | 100 |
| 37 | Juhu | property (dblue) | 350 | 35 / 175 / 500 / 1100 / 1300 / 1500 | 200 | 175 |
| 38 | Luxury Tax | tax | 100 |  |  |  |
| 39 | Mumbai | property (dblue) | 400 | 50 / 200 / 600 / 1400 / 1700 / 2000 | 200 | 200 |

## Preview deployment checklist (before any Convex or Vercel step)

`vercel.json` runs `npx convex deploy --cmd 'npm run build'` on **every** Vercel build, and the README says
`CONVEX_DEPLOY_KEY` is a Production key. If that key is available to Preview builds, a preview of this branch would push
the Monopoly schema and functions to production. Do this first:

1. **Vercel → Settings → Environment Variables.** Edit `CONVEX_DEPLOY_KEY` (the Production key) so it applies to the
   **Production** environment only. Untick Preview and Development.
2. **Convex dashboard → this project → Settings → Deploy keys.** Create a **Preview** deploy key and add it to Vercel as
   `CONVEX_DEPLOY_KEY` for the **Preview** environment only. With it, each branch gets its own empty Convex preview
   deployment.
3. **Convex dashboard → Settings → Default environment variables** (applied to new preview deployments): set
   `JWT_PRIVATE_KEY` and `JWKS` (the same kind of values `npx @convex-dev/auth` generates) so anonymous sign-in works on a
   fresh preview. Also set `MONOPOLY_ENABLED=true` there; milestone 2 refuses to create a Monopoly session on any
   deployment without it. Do not set it on production.
4. **Vercel Preview environment only:** set `NEXT_PUBLIC_MONOPOLY_ENABLED=true`. Make sure `NEXT_PUBLIC_CONVEX_URL` is
   **not** set for Preview. The build injects it per deployment, and the app reads only that variable.
5. Local work uses your existing dev deployment (`npx convex dev`). Before running any Convex CLI command, confirm the
   deployment name starts with `dev:`.

I haven't touched Vercel, Convex or any deployment. Steps 1–4 are yours.
