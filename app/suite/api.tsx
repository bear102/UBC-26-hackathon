"use client";
// Suite fetch helper + error UI: nothing in the suite may fail silently.
// Every call checks r.ok, parses JSON defensively, surfaces HTTP status + body text, and times out.
import { Component, useEffect, useState, type ReactNode } from "react";

export class ApiError extends Error {
  status: number; // 0 = network / timeout
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

const strip = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function api<T>(url: string, opts: { body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const ctl = new AbortController();
  let timedOut = false;
  const to = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  opts.signal?.addEventListener("abort", () => ctl.abort());
  let r: Response;
  try {
    r = await fetch(url, {
      cache: "no-store", signal: ctl.signal,
      ...(opts.body !== undefined ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    clearTimeout(to);
    if (timedOut) throw new ApiError(`No answer from ${url} after ${Math.round(timeoutMs / 1000)} s. The server may be slow (first compile, Gemini or the AI). Try again; check the terminal running "next dev" for errors.`, 0);
    if (opts.signal?.aborted) throw new ApiError("cancelled", 0);
    throw new ApiError(`Could not reach the app server (${(e as Error).message}). Is "npm run dev" still running?`, 0);
  }
  let text = "";
  try { text = await r.text(); } catch { /* body lost */ } finally { clearTimeout(to); }
  let j: unknown = undefined;
  try { j = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
  const errField = j && typeof j === "object" && typeof (j as { error?: unknown }).error === "string" ? (j as { error: string }).error : "";
  if (!r.ok) {
    const detail = errField || strip(text).slice(0, 300) || r.statusText || "no details";
    throw new ApiError(`HTTP ${r.status} from ${url}: ${detail}`, r.status);
  }
  if (j === undefined || j === null || typeof j !== "object") throw new ApiError(`HTTP ${r.status} from ${url} but the reply was not JSON: ${strip(text).slice(0, 200) || "(empty)"}`, r.status);
  if (errField) throw new ApiError(errField, r.status);
  return j as T;
}

export const errStatus = (e: unknown) => (e instanceof ApiError ? e.status : -1);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 401 banner with the exact fix + a paste-the-token shortcut that sets the cookie without leaving the page. */
export function LoginBanner({ onDone }: { onDone?: () => void }) {
  const [tok, setTok] = useState("");
  const [msg, setMsg] = useState("");
  async function login() {
    setMsg("");
    try {
      await fetch(`/api/login?t=${encodeURIComponent(tok.trim())}`, { redirect: "manual", cache: "no-store" });
      const r = await fetch("/api/hedge-desk", { cache: "no-store" });
      if (r.status === 401) { setMsg("That token was not accepted. It must equal HH_ADMIN_TOKEN in .env.local exactly."); return; }
      setMsg("Logged in."); onDone?.();
    } catch (e) { setMsg(errText(e)); }
  }
  return (
    <div className="banner" style={{ marginBottom: 10, borderColor: "var(--bad)" }} data-testid="login-banner">
      <b>Merchant login required (HTTP 401).</b> This server has <span className="mono">HH_ADMIN_TOKEN</span> set, so every suite call needs the login cookie.
      Fix: open <a className="mono" href="/api/login?t=">/api/login?t=&lt;your HH_ADMIN_TOKEN&gt;</a> once in this browser (it sends you to /merchant; then come back here), or paste the token:
      <div className="row" style={{ marginTop: 6 }}>
        <input type="password" placeholder="HH_ADMIN_TOKEN" value={tok} onChange={(e) => setTok(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tok.trim()) login(); }} style={{ width: 220 }} />
        <button className="secondary" disabled={!tok.trim()} onClick={login}>Log in</button>
        {msg && <span className={msg === "Logged in." ? "ok small" : "err small"}>{msg}</span>}
      </div>
    </div>
  );
}

/** Inline error display; switches to the login banner on 401. */
export function ErrorBox({ err, onRetry, onLogin }: { err: unknown; onRetry?: () => void; onLogin?: () => void }) {
  if (!err) return null;
  if (errStatus(err) === 401) return <LoginBanner onDone={onLogin ?? onRetry} />;
  return (
    <div className="banner" role="alert" style={{ margin: "8px 0", borderColor: "var(--bad)" }} data-testid="error-box">
      <span className="err">{errText(err)}</span>
      {onRetry && <> <a href="#" onClick={(e) => { e.preventDefault(); onRetry(); }}>try again</a></>}
    </div>
  );
}

/** Keeps one bad row / section from blanking the whole page. */
export class Boundary extends Component<{ label: string; children: ReactNode }, { e: Error | null }> {
  state = { e: null as Error | null };
  static getDerivedStateFromError(e: Error) { return { e }; }
  componentDidCatch(e: Error) { console.error(`[suite] ${this.props.label} failed to render:`, e); }
  render() {
    if (this.state.e) return (
      <div className="card" role="alert"><span className="err">Could not show {this.props.label}: {this.state.e.message}</span>{" "}
        <a href="#" onClick={(ev) => { ev.preventDefault(); this.setState({ e: null }); }}>retry</a></div>
    );
    return this.props.children;
  }
}

export function useElapsed(since: number | null) {
  const [, tick] = useState(0);
  useEffect(() => { if (since == null) return; const i = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(i); }, [since]);
  return since == null ? 0 : Math.max(0, Math.round((Date.now() - since) / 1000));
}

/** False during SSR and until React hydrates: buttons rendered before then are dead, so show them as loading. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
