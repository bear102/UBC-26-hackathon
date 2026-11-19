// Engraving.tsx — the "Printed Policy" ornaments: guilloché rosette, wavy guilloché band, hedgehog seal.
// Pure SVG generated from a few formulas (a few KB each, no network, no deps). Decoration only: aria-hidden,
// pointer-events:none. NEVER place these behind a number, a table, the buy panel or the checkout dialog body.
import { useId } from "react";

const f = (n: number) => +n.toFixed(1);

function ring(c: number, base: number, amp: number, lobes: number, phase: number, steps: number) {
  let p = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2, rr = base + amp * Math.sin(lobes * t + phase);
    p += (i ? "L" : "M") + f(c + rr * Math.cos(t)) + " " + f(c + rr * Math.sin(t));
  }
  return p + "Z";
}
const rosetteCache = new Map<string, string[]>();
function rosettePaths(n: number, steps: number) {
  const key = `${n}:${steps}`;
  if (!rosetteCache.has(key)) {
    const c = 400, out: string[] = [];
    for (let k = 0; k < n; k++) out.push(ring(c, c * .55 + k * c * .02, c * .16, 18, k * .45, steps));
    for (let k = 0; k < 6; k++) out.push(ring(c, c * .22 + k * c * .012, c * .08, 12, k * .6, Math.round(steps * .6)));
    rosetteCache.set(key, out);
  }
  return rosetteCache.get(key)!;
}

/** Guilloché rosette. Size + position it with CSS (className). density = lines in the outer ring (8–14). */
export function Rosette({ className, density = 12, steps = 300 }: { className?: string; density?: number; steps?: number }) {
  return (
    <svg className={className} viewBox="0 0 800 800" aria-hidden="true" fill="none"
      style={{ stroke: "var(--guil)", strokeWidth: 0.6, pointerEvents: "none" }}>
      {rosettePaths(density, steps).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

let bandCache: string | null = null;
function bandPath() {
  if (bandCache) return bandCache;
  const w = 400, h = 24, lines = 5, waves = 10; let out = "";
  for (let k = 0; k < lines; k++) for (let i = 0; i <= 160; i++) {
    const x = (i / 160) * w, y = h / 2 + h * .38 * Math.sin((x / w) * Math.PI * 2 * waves + k * Math.PI / lines);
    out += (i ? "L" : "M") + f(x) + " " + f(y);
  }
  return (bandCache = out);
}

/** Wavy guilloché band for the top (blue) / bottom (red) edge of a `.cert` document. */
export function GuillocheBand({ tone = "blue" }: { tone?: "blue" | "red" }) {
  return (
    <svg className="band" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true"
      style={{ display: "block", width: "100%", height: 16, fill: "none", strokeWidth: .7, pointerEvents: "none",
        stroke: tone === "red" ? "var(--guil-2)" : "var(--guil)", opacity: tone === "red" ? .55 : .8 }}>
      <path d={bandPath()} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Seal geometry (160×160 viewBox), from the mockup generator.
const C = 80;
const SPOKES = Array.from({ length: 120 }, (_, i) => {
  const a = (i / 120) * Math.PI * 2, r1 = C * .62, r2 = C * (i % 2 ? .70 : .76);
  return `M${f(C + r1 * Math.cos(a))} ${f(C + r1 * Math.sin(a))}L${f(C + r2 * Math.cos(a))} ${f(C + r2 * Math.sin(a))}`;
}).join("");
const HOG = (() => {
  const hx = C - 2, hy = C + 10, br = C * .36; let back = "";
  for (let i = 0; i <= 26; i++) {
    const a = Math.PI + (i / 26) * Math.PI * .86, rr = br + (i % 2 ? 0 : C * .09);
    back += (i ? "L" : "M") + f(hx + rr * Math.cos(a)) + " " + f(hy + rr * Math.sin(a) * .82);
  }
  const ex = hx + br * Math.cos(Math.PI * 1.86), ey = hy + br * Math.sin(Math.PI * 1.86) * .82;
  back += `L${f(ex + 14)} ${f(ey + 8)}L${f(ex + 24)} ${f(hy + 2)}L${f(ex + 8)} ${f(hy + 6)}L${f(hx + br * .7)} ${f(hy + 6)}L${f(hx + br * .62)} ${f(hy + 14)}L${f(hx + br * .45)} ${f(hy + 14)}L${f(hx + br * .4)} ${f(hy + 6)}L${f(hx - br * .45)} ${f(hy + 6)}L${f(hx - br * .52)} ${f(hy + 14)}L${f(hx - br * .7)} ${f(hy + 14)}L${f(hx - br * .72)} ${f(hy + 6)}Z`;
  let quills = "";
  for (let i = 1; i < 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI * .8, r1 = br * .35, r2 = br * .92;
    quills += `M${f(hx + r1 * Math.cos(a))} ${f(hy + r1 * Math.sin(a) * .82)}L${f(hx + r2 * Math.cos(a))} ${f(hy + r2 * Math.sin(a) * .82)}`;
  }
  return { back, quills, eye: [f(ex + 10), f(ey + 9)] as const };
})();

/** Red hedgehog seal. withText=false below ~60px (logo, stubs). fill = the paper colour behind it. */
export function Seal({ className, withText = true, fill = "var(--surface)", text = "HEDGEHOG · WORST-DAY COVER · PAID ON SOLANA ·" }:
  { className?: string; withText?: boolean; fill?: string; text?: string }) {
  const id = "sp" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg className={className} viewBox="0 0 160 160" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {withText && <defs><path id={id} d="M 80,80 m -67.2,0 a 67.2,67.2 0 1,1 134.4,0 a 67.2,67.2 0 1,1 -134.4,0" /></defs>}
      <circle cx="80" cy="80" r="77.6" fill={fill} />
      <g fill="none" stroke="var(--red)" strokeWidth="1.2">
        <circle cx="80" cy="80" r="76" /><circle cx="80" cy="80" r="58.4" /><circle cx="80" cy="80" r="48" />
      </g>
      <path d={SPOKES} stroke="var(--red)" strokeWidth="1.1" />
      {withText && (
        <text fill="var(--red)" style={{ fontFamily: "var(--mono)", fontSize: 10.2, letterSpacing: 2.1, fontWeight: 600 }}>
          <textPath href={`#${id}`}>{text}</textPath>
        </text>
      )}
      <path d={HOG.back} fill="var(--red)" />
      <path d={HOG.quills} stroke={fill} strokeWidth="1.4" />
      <circle cx={HOG.eye[0]} cy={HOG.eye[1]} r="1.8" fill={fill} />
    </svg>
  );
}

/** Hand-drawn swash under the red italic "Hedge it." (h1 only). Positioned by `.swash` in globals.css. */
export function Swash({ className = "swash" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 300 16" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 10 C 60 2, 120 14, 180 7 S 270 4, 298 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M14 14 C 80 8, 150 15, 290 12" fill="none" stroke="currentColor" strokeWidth="1" opacity=".6" />
    </svg>
  );
}
