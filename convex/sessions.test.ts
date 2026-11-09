import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { balances, checkInvariants, expectError, key, newDevice, setup, startGame, table } from "./test.setup";

describe("create and join", () => {
  test("host gets a buy-in, code uses the unambiguous alphabet", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"], { startingAmount: 2000 });
    expect(s.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 2000 });
    const state = await s.host.as.query(api.sessions.state, { sessionId: s.sessionId });
    expect(state.isHost).toBe(true);
    expect(state.session.status).toBe("lobby");
    await checkInvariants(t, s.sessionId);
  });

  test("equal mode: everyone joins with the starting amount", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"], { startingAmount: 500 });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 500, Priya: 500, Rahul: 500 });
  });

  test("custom mode: each player picks a buy-in, and must pick one", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [1500, 700] });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1500, Priya: 700 });
    const d = await newDevice(t);
    await expectError(
      d.mutation(api.sessions.join, { code: s.code, newName: "Kabir", idempotencyKey: key() }),
      "INVALID_AMOUNT",
    );
    await expectError(
      d.mutation(api.sessions.join, { code: s.code, newName: "Kabir", buyIn: 12.5, idempotencyKey: key() }),
      "INVALID_AMOUNT",
    );
  });

  test("join code is case-insensitive and ignores spaces", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"]);
    const d = await newDevice(t);
    const code = `${s.code.slice(0, 3).toLowerCase()} ${s.code.slice(3)}`;
    const info = await d.query(api.sessions.joinInfo, { code });
    expect(info?.crewName).toBe("Friday Night Crew");
    expect(info?.hostName).toBe("Arjun");
    expect(info?.members.map((m) => [m.name, m.atTable])).toEqual([["Arjun", true]]);
  });

  test("crew names are unique case-insensitively", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const d = await newDevice(t);
    await expectError(
      d.mutation(api.sessions.join, { code: s.code, newName: "  priya ", idempotencyKey: key() }),
      "NAME_TAKEN",
    );
  });

  test("one device = one player per session", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const priya = s.seats.Priya.as;
    // Same name again from the same phone is a no-op that returns the same seat.
    const info = await priya.query(api.sessions.joinInfo, { code: s.code });
    const priyaMember = info!.members.find((m) => m.name === "Priya")!;
    const again = await priya.mutation(api.sessions.join, {
      code: s.code,
      crewMemberId: priyaMember._id,
      idempotencyKey: key(),
    });
    expect(again.playerId).toBe(s.seats.Priya.playerId);
    expect((await balances(t, s.sessionId)).Priya).toBe(1000);
    await expectError(
      priya.mutation(api.sessions.join, { code: s.code, newName: "Kabir", idempotencyKey: key() }),
      "FORBIDDEN",
      /already playing as Priya/,
    );
  });

  test("a name already at the table on another phone can't be taken", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const d = await newDevice(t);
    const info = await d.query(api.sessions.joinInfo, { code: s.code });
    const priya = info!.members.find((m) => m.name === "Priya")!;
    await expectError(
      d.mutation(api.sessions.join, { code: s.code, crewMemberId: priya._id, idempotencyKey: key() }),
      "NAME_TAKEN",
      /another phone/,
    );
  });

  test("host rebinds a player to a new phone", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const newPhone = await newDevice(t);
    const info = await newPhone.query(api.sessions.joinInfo, { code: s.code });
    const priya = info!.members.find((m) => m.name === "Priya")!;
    await newPhone.mutation(api.sessions.requestRebind, { code: s.code, crewMemberId: priya._id });
    await expectError(
      s.seats.Priya.as.mutation(api.sessions.approveRebind, {
        sessionId: s.sessionId,
        playerId: s.seats.Priya.playerId,
        approve: true,
      }),
      "NOT_HOST",
    );
    await s.host.as.mutation(api.sessions.approveRebind, {
      sessionId: s.sessionId,
      playerId: s.seats.Priya.playerId,
      approve: true,
    });
    const state = await newPhone.query(api.sessions.state, { sessionId: s.sessionId });
    expect(state.meId).toBe(s.seats.Priya.playerId);
    await expectError(s.seats.Priya.as.query(api.sessions.state, { sessionId: s.sessionId }), "NOT_IN_SESSION");
  });

  test("outsiders can't read session state", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"]);
    const stranger = await newDevice(t);
    await expectError(stranger.query(api.sessions.state, { sessionId: s.sessionId }), "NOT_IN_SESSION");
    await expectError(t.query(api.sessions.state, { sessionId: s.sessionId }), "UNAUTHENTICATED");
  });

  test("join is idempotent per key", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"]);
    const d = await newDevice(t);
    const k = key();
    const a = await d.mutation(api.sessions.join, { code: s.code, newName: "Kabir", idempotencyKey: k });
    const b = await d.mutation(api.sessions.join, { code: s.code, newName: "Kabir", idempotencyKey: k });
    expect(a).toEqual(b);
    expect((await balances(t, s.sessionId)).Kabir).toBe(1000);
    await checkInvariants(t, s.sessionId);
  });
});

describe("lobby edits", () => {
  test("host changes the equal starting amount before the first game (reversal + new buy-in)", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { startingAmount: 1000 });
    await s.host.as.mutation(api.sessions.updateSettings, {
      sessionId: s.sessionId,
      startingAmount: 2000,
      idempotencyKey: key(),
    });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 2000, Priya: 2000 });
    const nets = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(nets.nets.map((n) => [n.name, n.buyIn, n.net])).toEqual([
      ["Arjun", 2000, 0],
      ["Priya", 2000, 0],
    ]);
    await checkInvariants(t, s.sessionId);
  });

  test("host edits a custom buy-in, then buy-ins lock after the first game", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [1000, 500] });
    await s.host.as.mutation(api.sessions.setPlayerBuyIn, {
      sessionId: s.sessionId,
      playerId: s.seats.Priya.playerId,
      amount: 800,
      idempotencyKey: key(),
    });
    expect((await balances(t, s.sessionId)).Priya).toBe(800);
    await expectError(
      s.seats.Priya.as.mutation(api.sessions.setPlayerBuyIn, {
        sessionId: s.sessionId,
        playerId: s.seats.Priya.playerId,
        amount: 9000,
        idempotencyKey: key(),
      }),
      "NOT_HOST",
    );
    await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await expectError(
      s.host.as.mutation(api.sessions.setPlayerBuyIn, {
        sessionId: s.sessionId,
        playerId: s.seats.Priya.playerId,
        amount: 900,
        idempotencyKey: key(),
      }),
      "INVALID_STATE",
      /locked/,
    );
    await checkInvariants(t, s.sessionId);
  });

  test("host reorders seats", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const order = [s.seats.Rahul.playerId, s.seats.Arjun.playerId, s.seats.Priya.playerId];
    await s.host.as.mutation(api.sessions.reorderSeats, { sessionId: s.sessionId, order });
    const state = await s.host.as.query(api.sessions.state, { sessionId: s.sessionId });
    expect(state.players.map((p) => p.name)).toEqual(["Rahul", "Arjun", "Priya"]);
    await expectError(
      s.host.as.mutation(api.sessions.reorderSeats, { sessionId: s.sessionId, order: order.slice(1) }),
      "INVALID_STATE",
    );
  });
});
