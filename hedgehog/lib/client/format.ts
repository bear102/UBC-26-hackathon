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
  // a date far from today names its year ("Fri, Jun 29" alone reads as next June)
  const far = Math.abs(d.getTime() - Date.now()) > 200 * 86_400_000;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(far ? { year: "numeric" } : {}) });
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const VENUE_LABEL: Record<string, string> = { gemini: "Gemini", kalshi: "Kalshi · DFlow", polymarket: "Polymarket", hedgehog: "Hedgehog parametric" };
/** One-line venue role shown under quote lines. */
export const VENUE_ROLE: Record<string, string> = {
  gemini: "Priced & hedged on Gemini · settled on Solana",
  kalshi: "Kalshi contract · settled on Solana",
  polymarket: "Polymarket · read-only context",
  hedgehog: "Hedgehog parametric · priced from public history · underwritten by the Hedgehog pool",
};
/** "BUY 5 YES GEMI-… @ $0.15" */
export const orderText = (h: { quantity: number; outcome: string; symbol: string; limitPrice: number }) =>
  `BUY ${h.quantity.toLocaleString()} ${h.outcome.toUpperCase()} ${h.symbol} @ $${h.limitPrice.toFixed(2)}`;
export const PERIL_LABEL: Record<string, string> = {
  heat: "Heat", cold: "Cold snap", rain: "Rain", game: "Game result", oil: "Oil price", gas: "Gas price",
  fed: "Fed rate", cpi: "Inflation", crypto: "Crypto", other: "Other",
  snow: "Snow", power: "Power price", water: "Water level", quake: "Earthquake", storm: "Storms", natgas: "Natural gas", metals: "Metals",
  flood: "Flood", smoke: "Air quality", hail: "Hail", wildfire: "Wildfire",
};
export const PERIL_ICON: Record<string, string> = {
  heat: "☀", cold: "❄", rain: "☂", game: "🏀", oil: "🛢", gas: "⛽", fed: "🏦", cpi: "📈", crypto: "◎", other: "•",
  snow: "🌨", power: "⚡", water: "🌊", quake: "⚠", storm: "🌪", natgas: "🔥", metals: "⛏",
  flood: "🌊", smoke: "😷", hail: "🧊", wildfire: "🔥",
};
