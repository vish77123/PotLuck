"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { ReportView, type ReportData } from "@/components/report/ReportView";
import { BackButton, GoldButton, SecondaryButton } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { normalizeCode } from "@/lib/format";
import { useUi } from "@/stores/ui";

// The share image is the same report drawn 390px wide and captured at 1080px, so it reads like the screen.
const IMAGE_WIDTH = 390;
const IMAGE_PX = 1080;

async function renderPng(node: HTMLElement) {
  const { toBlob } = await import("html-to-image");
  return await toBlob(node, { pixelRatio: IMAGE_PX / IMAGE_WIDTH, cacheBust: true, backgroundColor: "#f4ecda" });
}

function fileName(data: ReportData) {
  const base = (data.session.name ?? data.session.crewName).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "session";
  return `potluck-${base}`.toLowerCase();
}

export default function ReportPage() {
  const params = useParams<{ code: string }>();
  const code = normalizeCode(params.code ?? "");
  const info = useAuthedQuery(api.sessions.joinInfo, { code });
  const sessionId = info?.myPlayerId ? info.sessionId : undefined;
  const data = useAuthedQuery(api.report.full, sessionId ? { sessionId } : "skip");
  const paid = useUi((s) => s.paid);
  const togglePaid = useUi((s) => s.togglePaid);
  const pushToast = useUi((s) => s.pushToast);
  const share = useSubmit();

  const imageRef = useRef<HTMLDivElement>(null);
  const prepared = useRef<Blob | null>(null);

  // Draw the image in the background so Share can hand it over straight away (phones only allow
  // sharing as a direct result of a tap).
  const signature = data ? JSON.stringify([data.totals, data.players.map((p) => p.net), data.games.length, data.transfers?.length, Object.keys(paid).length]) : "";
  useEffect(() => {
    if (!data || !imageRef.current) return;
    prepared.current = null;
    const id = setTimeout(async () => {
      try {
        if (imageRef.current) prepared.current = await renderPng(imageRef.current);
      } catch {
        prepared.current = null;
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportPdf = useCallback(() => {
    const previous = document.title;
    if (data) document.title = fileName(data);
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }, [data]);

  const shareImage = () =>
    share.run(async () => {
      if (!data || !imageRef.current) return;
      const blob = prepared.current ?? (await renderPng(imageRef.current));
      if (!blob) throw new Error("Couldn't draw the image.");
      const file = new File([blob], `${fileName(data)}.png`, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${data.session.name ?? data.session.crewName} — PotLuck` });
          return;
        } catch (e) {
          if ((e as DOMException).name === "AbortError") return;
          // fall through to a download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      pushToast({ text: "Image saved to your downloads." });
    });

  const back = data?.session.status === "ended" ? "/" : `/s/${code}`;

  if (info === null || (info && !info.myPlayerId)) {
    return (
      <main className="room mx-auto w-full max-w-[520px] px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="pt-3">
          <BackButton href="/" />
        </div>
        <h1 className="font-display mt-16 text-[30px] font-semibold leading-[1.1]">No report to show</h1>
        <p className="mt-2 text-sm text-ink2">Only people who played in a session can see its report.</p>
        <Link href={info ? `/join/${code}` : "/"} className="gold-btn mt-6 grid h-[58px] place-items-center rounded-[18px] text-[16.5px]">
          {info ? "Join this table" : "Back home"}
        </Link>
      </main>
    );
  }

  return (
    <>
      <main className="room no-print mx-auto w-full max-w-[520px] pb-36 text-ink">
        <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
          <div className="pt-3">
            <BackButton href={back} />
          </div>
        </div>
        {!data ? (
          <div className="skeleton mx-4 mt-6 h-72 rounded-[20px] bg-surface2" aria-busy="true" />
        ) : (
          <ReportView data={data} sessionId={sessionId!} paid={paid} onTogglePaid={togglePaid} />
        )}
        <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 30%)" }}>
          <div className="mx-auto grid max-w-[520px] gap-2.5 px-4 pt-[18px]" style={{ gridTemplateColumns: "1fr 1.25fr", paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}>
            <SecondaryButton className="!h-14 !rounded-[18px] !text-[15px]" disabled={!data} onClick={exportPdf}>
              Export PDF
            </SecondaryButton>
            <GoldButton pending={share.pending} disabled={!data} onClick={shareImage} className="!h-14 !rounded-[18px] !text-[15px]">
              Share image
            </GoldButton>
          </div>
        </div>
      </main>

      {data && (
        <>
          <div className="print-only pl-light">
            <ReportView data={data} variant="print" sessionId={sessionId!} paid={paid} />
          </div>
          <div aria-hidden style={{ position: "fixed", left: -10000, top: 0 }}>
            <div ref={imageRef} className="pl-light" style={{ width: IMAGE_WIDTH }}>
              <ReportView data={data} variant="image" sessionId={sessionId!} paid={paid} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
