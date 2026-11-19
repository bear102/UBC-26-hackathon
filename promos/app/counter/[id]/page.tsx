"use client";
import { use, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { getJSON, post } from "@/lib/hh/client";

type PV = { card: { sentence: string }; cap: number; salesCloseTs: number; status: string; onchain: { sold: number; hedgedCapacity: number; cap: number } | null; lastRevertAt?: number };

export default function Counter({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<PV | null>(null);
  const [code, setCode] = useState<{ code: string; url: string; expiresAt: number } | null>(null);
  const [qr, setQr] = useState("");
  const [state, setState] = useState("idle");
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { const f = () => getJSON<PV>(`/api/promises/${id}`).then((v) => setP(v)).catch((e) => setErr(String(e.message))); f(); const t = setInterval(f, 3000); const c = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(t); clearInterval(c); }; }, [id]);

  async function sale() {
    setErr("");
    let r: { code?: string; url?: string; expiresAt?: number; error?: string };
    try { r = await post("/api/counter/code", { promiseId: id }); }
    catch (e) { setErr(`${(e as Error).message}. Open the counter from the merchant console ([Open counter QR]) on this device.`); return; }
    if (!r.code) { setErr(r.error || "failed"); return; }
    setCode({ code: r.code, url: r.url!, expiresAt: r.expiresAt! });
    setQr(await QRCode.toDataURL(r.url!, { margin: 1, width: 380 }));
    setState("live");
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const s = await getJSON<{ state: string }>(`/api/counter/status?code=${r.code}`).catch(() => ({ state: "live" }));
      if (s.state === "used" || s.state === "expired" || s.state === "waiting_for_hedge") {
        setState(s.state);
        if (s.state !== "waiting_for_hedge") { clearInterval(poll.current!); setTimeout(() => { setCode(null); setState("idle"); }, s.state === "used" ? 1500 : 0); }
      }
    }, 2000);
  }
  if (!p) return <main className="narrow">{err ? <p className="err">{err}</p> : <span className="spin" />}</main>;
  const oc = p.onchain;
  const left = oc ? Math.max(0, oc.cap - oc.sold) : p.cap;
  const closeIn = p.salesCloseTs * 1000 - now;
  const closed = closeIn <= 0 || !["SELLING", "HEDGING"].includes(p.status);
  const soldOut = left === 0;
  const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  return (
    <main className="narrow center">
      <p className="big" style={{ marginTop: 20 }}>{p.card.sentence}</p>
      {code && state !== "idle" ? (
        <>
          <div className="qr"><img src={qr} alt="scan for your promise" width={340} height={340} /></div>
          <p className="big">Scan for your promise.</p>
          <p className="muted">No app, no signup. {state === "live" && `Expires in ${Math.max(0, Math.ceil((code.expiresAt - now) / 1000))} s`}</p>
          {state === "waiting_for_hedge" && <p className="banner">WAITING FOR HEDGE… the agent is buying cover on Gemini</p>}
          {state === "used" && <p className="ok big">✓ Issued</p>}
          <button className="secondary" onClick={() => { setCode(null); setState("idle"); }}>Cancel</button>
        </>
      ) : closed ? <p className="huge">SALES CLOSED</p> : soldOut ? <p className="huge">SOLD OUT</p> : (
        <button style={{ fontSize: "2rem", padding: "28px 48px", margin: "30px 0" }} onClick={sale}>New sale</button>
      )}
      {err && <p className="err">{err}</p>}
      <p>{left} promises left at this price · {oc ? `${Math.max(0, oc.hedgedCapacity - oc.sold)} hedged now` : ""}</p>
      {!closed && <p className="muted">Sales close in {fmt(closeIn)}</p>}
    </main>
  );
}
