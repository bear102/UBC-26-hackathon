export const usd = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? "—" :
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const cents = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}¢`);
export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);

export const shortAddr = (s?: string, n = 4) => (!s ? "—" : s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`);

export function explorerTx(sig: string, network: "devnet" | "mainnet" = "devnet") {
  return `https://explorer.solana.com/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;
}
export function explorerAddr(addr: string, network: "devnet" | "mainnet" = "devnet") {
  return `https://explorer.solana.com/address/${addr}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

export function shortDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const VENUE_LABEL: Record<string, string> = { gemini: "Gemini", kalshi: "Kalshi · DFlow", polymarket: "Polymarket" };
export const PERIL_LABEL: Record<string, string> = {
  heat: "Heat", cold: "Cold snap", rain: "Rain", game: "Game result", oil: "Oil price", gas: "Gas price",
  fed: "Fed rate", cpi: "Inflation", crypto: "Crypto", other: "Other",
};
export const PERIL_ICON: Record<string, string> = {
  heat: "☀", cold: "❄", rain: "☂", game: "🏀", oil: "🛢", gas: "⛽", fed: "🏦", cpi: "📈", crypto: "◎", other: "•",
};
