import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { checkInvariants, key, setup, table, templateId } from "./test.setup";

/** Small seeded PRNG so a failure replays exactly. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const OPS = 1000;

test(`invariants hold after each of ${OPS} random operations`, { timeout: 120_000 }, async () => {
  const seed = Number(process.env.POTLUCK_SEED ?? 20261109);
  const rand = mulberry32(seed);
  const pick = <X,>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
  const amount = (max: number) => 1 + Math.floor(rand() * max);

  const t = setup();
  const names = ["Arjun", "Priya", "Rahul", "Kabir", "Dev"];
  const s = await table(t, names, { walletMode: "custom", buyIns: [2000, 800, 500, 1200, 300] });
  const templates = {
    "Teen Patti": await templateId(t, s.sessionId, "Teen Patti"),
    Poker: await templateId(t, s.sessionId, "Poker"),
    Sequence: await templateId(t, s.sessionId, "Sequence"),
  };
  const seat = (name: string) => s.seats[name];
  let hostName = names[0];
  const host = () => seat(hostName).as;

  const counts: Record<string, { ok: number; rejected: number }> = {};
  async function attempt(label: string, fn: () => Promise<unknown>) {
    counts[label] ??= { ok: 0, rejected: 0 };
    try {
      await fn();
      counts[label].ok++;
    } catch (err) {
      // Business-rule rejections are expected; anything else is a bug.
      if (!(err instanceof ConvexError)) throw new Error(`${label} threw a non-business error: ${err}`);
      counts[label].rejected++;
    }
  }

  async function snapshot() {
    return await host().query(api.sessions.state, { sessionId: s.sessionId });
  }

  for (let i = 0; i < OPS; i++) {
    const state = await snapshot();
    const game = state.latestGame;
    const live = game?.status === "active" ? game : null;
    const active = state.players.filter((p) => p.status === "active").map((p) => p.name);
    const left = state.players.filter((p) => p.status === "left").map((p) => p.name);
    const r = rand();

    if (live && r < 0.45) {
      const playing = live.participants.filter((p) => p.status === "playing");
      const turnName = state.players.find((p) => p._id === live.currentTurnPlayerId)?.name;
      // Mostly the right player; sometimes someone else, to exercise NOT_YOUR_TURN.
      const other = pick(playing.length ? playing : live.participants).sessionPlayerId;
      const who: string =
        turnName && rand() < 0.85 ? turnName : state.players.find((p) => p._id === other)!.name;
      const bigBet = rand() < 0.1;
      await attempt("bet", () =>
        seat(who).as.mutation(api.games.bet, {
          gameId: live._id,
          amount: bigBet ? amount(1500) : 10 * amount(20),
          idempotencyKey: key(),
        }),
      );
    } else if (live && r < 0.52) {
      const packer = pick(live.participants).sessionPlayerId;
      const who = state.players.find((p) => p._id === packer)!.name;
      await attempt("pack", () => seat(who).as.mutation(api.games.pack, { gameId: live._id }));
    } else if (live && r < 0.6) {
      const t = live.templateSnapshot;
      if (t.teamMode === "solo") {
        const winner = pick(live.participants).sessionPlayerId;
        await attempt("endSolo", () =>
          host().mutation(api.games.endSolo, { gameId: live._id, winnerPlayerId: winner, idempotencyKey: key() }),
        );
      } else {
        const teams = [...new Set(live.participants.map((p) => p.teamNo!))];
        await attempt("endTeam", () =>
          host().mutation(api.games.endTeam, { gameId: live._id, teamNo: pick(teams), idempotencyKey: key() }),
        );
      }
    } else if (live && r < 0.63) {
      await attempt("cancel", () => host().mutation(api.games.cancel, { gameId: live._id, idempotencyKey: key() }));
    } else if (live && r < 0.66) {
      const p = pick(live.participants);
      await attempt("setTurn", () => host().mutation(api.games.setTurn, { gameId: live._id, playerId: p.sessionPlayerId }));
    } else if (!live && r < 0.4) {
      const tplName = pick(Object.keys(templates) as (keyof typeof templates)[]);
      const chosen = active.filter(() => rand() < 0.8);
      await attempt("start", () =>
        host().mutation(api.games.start, {
          sessionId: s.sessionId,
          templateId: templates[tplName],
          participants: chosen.map((n) => ({ playerId: seat(n).playerId, teamNo: 1 + Math.floor(rand() * 2) })),
          idempotencyKey: key(),
        }),
      );
    } else if (!live && game?.status === "ended" && r < 0.47) {
      await attempt("reopen", () => host().mutation(api.games.reopen, { gameId: game._id, idempotencyKey: key() }));
    } else if (r < 0.76) {
      // Undo something recent — often not undoable, which is the point.
      const entries = state.recentEntries.slice(0, 12);
      if (entries.length) {
        const e = pick(entries);
        await attempt("undo", () => host().mutation(api.host.undo, { entryId: e._id, idempotencyKey: key() }));
      }
    } else if (r < 0.82) {
      const who = pick(active.length ? active : names);
      await attempt("topUp", () =>
        seat(who).as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 50 * amount(10), idempotencyKey: key() }),
      );
    } else if (r < 0.9) {
      const borrower = pick(active.length ? active : names);
      const lender = pick(names.filter((n) => n !== borrower));
      let loanId: Id<"loans"> | undefined;
      await attempt("loanRequest", async () => {
        loanId = (
          await seat(borrower).as.mutation(api.loans.request, {
            sessionId: s.sessionId,
            lenderPlayerId: seat(lender).playerId,
            amount: 50 * amount(8),
            idempotencyKey: key(),
          })
        ).loanId;
      });
      if (loanId) {
        const id = loanId;
        await attempt("loanRespond", () =>
          seat(lender).as.mutation(api.loans.respond, { loanId: id, accept: rand() < 0.8, idempotencyKey: key() }),
        );
      }
    } else if (r < 0.95) {
      const borrowerState = await seat(pick(names)).as.query(api.sessions.state, { sessionId: s.sessionId });
      const open = borrowerState.myLoans.filter((l) => l.status === "open" && l.borrowerPlayerId === borrowerState.meId);
      if (open.length) {
        const loan = pick(open);
        const me = names.find((n) => seat(n).playerId === borrowerState.meId)!;
        if (rand() < 0.15) {
          await attempt("settledOutside", () => seat(me).as.mutation(api.loans.markSettledOutside, { loanId: loan._id }));
        } else {
          const outstanding = loan.amount - loan.repaidAmount;
          await attempt("repay", () =>
            seat(me).as.mutation(api.loans.repay, {
              loanId: loan._id,
              amount: rand() < 0.5 ? undefined : Math.min(outstanding, amount(outstanding)),
              idempotencyKey: key(),
            }),
          );
        }
      }
    } else if (r < 0.98) {
      const who = pick(active.filter((n) => n !== hostName));
      if (who) {
        const byHost = rand() < 0.3;
        await attempt("cashOut", () =>
          (byHost ? host() : seat(who).as).mutation(api.wallet.cashOut, {
            sessionId: s.sessionId,
            playerId: byHost ? seat(who).playerId : undefined,
            idempotencyKey: key(),
          }),
        );
      }
    } else if (left.length) {
      const who = pick(left);
      const info = await seat(who).as.query(api.sessions.joinInfo, { code: s.code });
      const member = info!.members.find((m) => m.name === who)!;
      await attempt("rejoin", () =>
        seat(who).as.mutation(api.sessions.join, {
          code: s.code,
          crewMemberId: member._id,
          buyIn: 100 * amount(10),
          idempotencyKey: key(),
        }),
      );
    } else {
      const to = pick(active.filter((n) => n !== hostName));
      if (to) {
        await attempt("transferHost", () =>
          host().mutation(api.host.transfer, { sessionId: s.sessionId, toPlayerId: seat(to).playerId }),
        );
        const after = await snapshot();
        hostName = after.players.find((p) => p._id === after.session.hostPlayerId)!.name;
      }
    }

    try {
      await checkInvariants(t, s.sessionId);
    } catch (err) {
      throw new Error(`After op ${i} (seed ${seed}): ${(err as Error).message}`);
    }
  }

  // Close out and confirm the final settlement balances.
  const final = await snapshot();
  if (final.latestGame?.status === "active") {
    await host().mutation(api.games.cancel, { gameId: final.latestGame._id, idempotencyKey: key() });
  }
  await host().mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() });
  const result = await checkInvariants(t, s.sessionId);
  expect(result.netSum).toBe(0);
  expect(result.openPools).toBe(0);
  const { transfers } = await host().query(api.report.settlement, { sessionId: s.sessionId });
  expect(transfers).not.toBeNull();

  // Make sure the run actually exercised the interesting paths.
  for (const label of ["bet", "pack", "endSolo", "endTeam", "cancel", "start", "reopen", "undo", "topUp", "loanRespond", "repay", "cashOut"]) {
    expect(counts[label]?.ok ?? 0, `${label} never succeeded`).toBeGreaterThan(0);
  }
  console.log(`seed ${seed}: ${result.entryCount} ledger entries`, counts);
});

