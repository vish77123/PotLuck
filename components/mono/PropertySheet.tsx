"use client";

import { useEffect, useState } from "react";
import { useMonoActions } from "@/components/mono/actions";
import { useGameState, useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { GROUP_COLOURS, GROUP_LABELS, groupKeyOf } from "@/lib/monopoly/colors";
import { canBuild, canMortgage, canSellBuilding, canUnmortgage, levelOf, ownsFullGroup, rentFor, spaceOf } from "@/lib/monopoly/rules";

const DICE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function RentRow({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2 text-[13.5px]" style={{ background: on ? "var(--surface3)" : undefined, fontWeight: on ? 800 : 600 }}>
      <span className={on ? "" : "text-ink2"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Everything about one space. Tapping a space on the board is the "landed on" flow: who owns it, what's due, and the
 * one tap that does the right thing (buy it, pay the rent). Owners build, sell and mortgage from here too.
 */
export function PropertySheet({ open, onClose, game, me, spaceId, isHost }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer | null; spaceId: string | null; isHost: boolean }) {
  const gs = useGameState(game);
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const [dice, setDice] = useState<number | null>(null);
  useEffect(() => setDice(null), [spaceId, open]);

  if (!spaceId) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const space = spaceOf(game.boardSnapshot, spaceId);
  const prop = gs.props[spaceId];
  const key = groupKeyOf(space);
  const owner = prop?.owner ? game.players.find((p) => p._id === prop.owner) : undefined;
  const mine = !!me && owner?._id === me._id;
  const paused = game.status === "paused";
  const playing = !!me && me.status === "playing" && !paused;
  const level = prop ? levelOf(prop) : 0;
  const setOwned = !!owner && space.group !== undefined && ownsFullGroup(gs, owner._id, space.group);

  let rentDue: ReturnType<typeof rentFor> | null = null;
  let rentError: string | null = null;
  if (prop && owner && !mine) {
    try {
      rentDue = rentFor(gs, spaceId, { diceTotal: dice ?? undefined });
    } catch {
      rentError = "Pick the dice total to work out the rent.";
    }
  }
  const price = space.price ?? 0;
  const run = async (action: Parameters<typeof actions.perform>[0], done: string, close = true) => {
    const res = await actions.perform(action, { done });
    if (res && close) onClose();
  };

  const build = mine ? canBuild(gs, me!._id, spaceId) : null;
  const sell = mine ? canSellBuilding(gs, me!._id, spaceId) : null;
  const mort = mine ? canMortgage(gs, me!._id, spaceId) : null;
  const unmort = mine ? canUnmortgage(gs, me!._id, spaceId) : null;

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="mt-1 overflow-hidden rounded-[18px] border border-line">
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: GROUP_COLOURS[key], color: key === "lblue" || key === "yellow" || key === "util" ? "#1d1608" : "#fff" }}>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-extrabold tracking-[.16em] opacity-80">{GROUP_LABELS[key].toUpperCase()}</div>
            <div className="font-display truncate text-[26px] font-semibold leading-[1.1]">{space.name}</div>
          </div>
          {space.verified === false && <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">UNCHECKED</span>}
        </div>
        <div className="flex items-center gap-3 bg-surface2 px-4 py-2.5">
          {owner ? <Avatar name={owner.name} size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-dashed border-ink3 text-xs text-ink3">–</span>}
          <div className="flex-1 text-[13.5px] font-extrabold">
            {owner ? `${mine ? "You own" : `${owner.name} owns`} this` : "For sale · the bank owns it"}
            {prop?.mortgaged && <span className="ml-1.5 text-warn">· mortgaged</span>}
          </div>
          <div className="amount text-[18px]">{fmt(price)}</div>
        </div>
        {space.kind === "property" && space.rent && (
          <div className="border-t border-line py-1">
            <RentRow label="Rent" value={fmt(space.rent[0])} on={!!owner && level === 0 && !setOwned} />
            <RentRow label="With the whole set" value={fmt(space.rent[0] * 2)} on={!!owner && level === 0 && setOwned} />
            {[1, 2, 3, 4].map((n) => (
              <RentRow key={n} label={`${n} house${n > 1 ? "s" : ""}`} value={fmt(space.rent![n])} on={!!prop && prop.houses === n && !prop.hotel} />
            ))}
            <RentRow label="Hotel" value={fmt(space.rent[5])} on={!!prop?.hotel} />
            <RentRow label="House costs" value={fmt(space.houseCost ?? 0)} />
          </div>
        )}
        {space.kind === "rail" && space.rent && (
          <div className="border-t border-line py-1">
            {space.rent.map((r, i) => (
              <RentRow key={i} label={`${i + 1} station${i ? "s" : ""} owned`} value={fmt(r)} />
            ))}
          </div>
        )}
        {space.kind === "utility" && (
          <div className="border-t border-line py-1">
            <RentRow label="One utility owned" value={`${game.boardSnapshot.utilityMultipliers[0]}× the dice`} />
            <RentRow label="Both owned" value={`${game.boardSnapshot.utilityMultipliers[1]}× the dice`} />
          </div>
        )}
        <div className="border-t border-line bg-surface2 px-3.5 py-2 text-[12.5px] font-semibold text-ink2">Mortgage value {fmt(space.mortgage ?? 0)}</div>
      </div>

      {prop && playing && !prop.mortgaged && owner && !mine && rentDue && (
        <div className="mt-3">
          {space.kind === "utility" && (
            <>
              <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">DICE TOTAL</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DICE.map((d) => (
                  <button key={d} onClick={() => setDice(d)} aria-pressed={dice === d} className="press h-10 w-10 rounded-xl border text-[14px] font-extrabold" style={{ borderColor: dice === d ? "var(--gold)" : "var(--line)", background: dice === d ? "var(--surface3)" : "transparent" }}>
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
          {rentError ? (
            <div className="mt-2 text-[13px] font-semibold text-ink3">{rentError}</div>
          ) : (
            <>
              <div className="mt-2 text-[12.5px] font-semibold text-ink2">{rentDue.note}</div>
              <div className="mt-2">
                <GoldButton
                  pending={actions.pending}
                  disabled={!me || rentDue.amount > me.cash}
                  onClick={() => run({ kind: "rent", spaceId, diceTotal: dice ?? undefined }, `Paid ${owner.name} ${fmt(rentDue!.amount)} rent`)}
                >
                  Pay {owner.name} {fmt(rentDue.amount)}
                </GoldButton>
              </div>
              {me && rentDue.amount > me.cash && <div className="mt-2 text-[13px] font-semibold text-down">You have only {fmt(me.cash)}. Sell or mortgage something to raise {fmt(rentDue.amount - me.cash)} more.</div>}
            </>
          )}
        </div>
      )}
      {prop && owner && !mine && prop.mortgaged && <div className="mt-3 text-[13.5px] font-bold text-ink2">Mortgaged, so no rent is due.</div>}

      {prop && playing && !owner && (
        <div className="mt-3">
          <GoldButton pending={actions.pending} disabled={!me || me.cash < price} onClick={() => run({ kind: "buy", spaceId }, `Bought ${space.name}`)}>
            Buy for {fmt(price)}
          </GoldButton>
          {me && me.cash < price && <div className="mt-2 text-[13px] font-semibold text-down">You have only {fmt(me.cash)}. {fmt(price - me.cash)} more is needed.</div>}
        </div>
      )}

      {prop && playing && mine && (
        <div className="mt-3 grid gap-2">
          {space.kind === "property" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={actions.pending || !build?.ok || me!.cash < (build?.ok ? build.cost : 0)}
                onClick={() => run({ kind: "build", spaceId }, `Built on ${space.name}`, false)}
                className="gold-btn press h-14 rounded-[16px] text-[14px] disabled:opacity-40"
              >
                {build?.ok && build.after.hotel ? "Build hotel" : "Build house"}
                <div className="text-[11.5px] font-bold opacity-70">{build?.ok ? fmt(build.cost) : ""}</div>
              </button>
              <button
                disabled={actions.pending || !sell?.ok}
                onClick={() => run({ kind: "sellBuilding", spaceId }, `Sold a building on ${space.name}`, false)}
                className="press h-14 rounded-[16px] border border-line bg-surface2 text-[14px] font-extrabold disabled:opacity-40"
              >
                Sell building
                <div className="text-[11.5px] font-bold text-ink3">{sell?.ok ? `+${fmt(sell.refund)}` : ""}</div>
              </button>
            </div>
          )}
          {space.kind === "property" && build && !build.ok && !(sell?.ok) && <div className="text-[12.5px] font-semibold leading-snug text-ink3">{build.reason}</div>}
          {space.kind === "property" && build?.ok && me!.cash < build.cost && <div className="text-[12.5px] font-semibold text-down">You need {fmt(build.cost - me!.cash)} more to build here.</div>}
          {prop.mortgaged ? (
            <button
              disabled={actions.pending || !unmort?.ok || me!.cash < (unmort?.ok ? unmort.cost : 0)}
              onClick={() => run({ kind: "unmortgage", spaceId }, `Unmortgaged ${space.name}`)}
              className="press h-14 rounded-[16px] border border-line-gold bg-surface2 text-[14px] font-extrabold disabled:opacity-40"
            >
              Unmortgage · {unmort?.ok ? fmt(unmort.cost) : ""}
              <div className="text-[11.5px] font-bold text-ink3">mortgage value plus 10%</div>
            </button>
          ) : (
            <button
              disabled={actions.pending || !mort?.ok}
              onClick={() => run({ kind: "mortgage", spaceId }, `Mortgaged ${space.name}`)}
              className="press h-14 rounded-[16px] border border-line bg-surface2 text-[14px] font-extrabold disabled:opacity-40"
            >
              Mortgage · +{fmt(mort?.ok ? mort.raises : (space.mortgage ?? 0))}
              {mort && !mort.ok && <div className="text-[11.5px] font-semibold leading-snug text-ink3">{mort.reason}</div>}
            </button>
          )}
        </div>
      )}
      {game.settings.bankerMode === "bankerApproves" && !isHost && prop && playing && (mine || !owner) && <div className="mt-3 text-[12px] font-semibold text-ink3">Bank payments wait for the banker's tap.</div>}
    </Sheet>
  );
}
