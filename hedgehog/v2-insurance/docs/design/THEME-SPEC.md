# Hedgehog redesign — DESIGN SPEC: "The Printed Policy"

Winner of the 4-way bake-off (space / sketch / policy / forecast). This spec is the single source of truth for
4 engineers working in parallel. If something is not covered here, copy the reference mockup; if the mockup
is silent, choose the plainer option.

- Reference mockup (copy CSS from it): `/tmp/claude-0/-root-blockchainHackathon26-projects-hedgehog/e63244d5-00af-45a7-9466-0914bd0c6cbd/scratchpad/concepts/policy/index.html`
  (generator for its SVG ornaments: `.../concepts/policy/gen.mjs`; the HTML is 360 KB because the paths are inlined, so do NOT paste its path data into the app; use `components/Engraving.tsx` below.)
- Reference screenshots:
  - `/tmp/claude-0/-root-blockchainHackathon26-projects-hedgehog/e63244d5-00af-45a7-9466-0914bd0c6cbd/scratchpad/concepts/policy/hero-1440.png`
  - `/tmp/claude-0/-root-blockchainHackathon26-projects-hedgehog/e63244d5-00af-45a7-9466-0914bd0c6cbd/scratchpad/concepts/policy/full-1440.png`
  - `/tmp/claude-0/-root-blockchainHackathon26-projects-hedgehog/e63244d5-00af-45a7-9466-0914bd0c6cbd/scratchpad/concepts/policy/top-390.png`
  - `/tmp/claude-0/-root-blockchainHackathon26-projects-hedgehog/e63244d5-00af-45a7-9466-0914bd0c6cbd/scratchpad/concepts/policy/full-390.png`
- Grafted from the runners-up (details in §6):
  - Storm Desk: the **live-odds ticker**, which replaces the static microtext strip.
  - Risk Sky: the **"quoted at · model" stamp** on the quote, plus the coverage toggle and budget bar inside the buy panel.
  - Underwriter's Notebook: the **"dry day vs bad day" bar with a cross-hatched covered slice**, and an honest greyed **"reference price only"** row.

---

## 1. Concept

Hedgehog looks like an engraved insurance certificate. It borrows from banknotes and share certificates: cream
security paper, intaglio-navy ink, guilloché rosettes, a vermilion hedgehog seal, serial numbers and
double-ruled ledgers. That is the visual language people already link with "this is a real financial
promise", and almost no web3 or AI site uses it, so judges remember it. The drama comes from the craft (giant
Bodoni headline, a tilted certificate, a seal that stamps itself), not from neon colour. The money surfaces
(quote, buy panel, checkout, policy receipts) are the plainest parts of the site. They are typeset like a
printed schedule of cover: straight rules, big condensed figures and no ornament behind any number. One theme
covers every page: **paper, ink, seal, ledger**.

**Scheme decision:** ship ONE fixed light scheme (paper). Delete the `@media (prefers-color-scheme: dark)`
block and set `color-scheme: light`. A certificate printed on dark paper stops being a certificate.

---

## 2. Tokens — replace the `:root` block in `app/globals.css`

Keep the existing token NAMES so the 40+ existing `var(--x)` usages keep working, and remap their values.
New tokens are marked `/* new */`.

```css
:root {
  /* paper */
  --bg: #F3EEE1;            /* security paper (page) */
  --bg-2: #E9E2CF;          /* darker paper: hovers, segmented bg, stub left, microtext strip */
  --surface: #FBF8F0;       /* "sheet": every card/document */
  --surface-2: #F7F2E6;     /* inset/soft sheet */
  --sheet: #FBF8F0;         /* new, alias of --surface for clarity in new code */

  /* ink */
  --ink: #14203F;           /* intaglio navy: text, borders of documents, primary button */
  --ink-2: #414B66;
  --muted: #6B7389;         /* = mockup --ink-3 */
  --ink-3: #6B7389;         /* new alias */
  --line: rgba(20, 32, 63, .16);    /* hairline rule (mockup --rule) */
  --line-2: rgba(20, 32, 63, .32);  /* stronger rule (mockup --rule-2) */
  --rule: var(--line);      /* new alias */
  --rule-2: var(--line-2);  /* new alias */

  /* brand = ink. Hedgehog's "brand colour" is the navy ink, and the seal red is the signature accent */
  --brand: #14203F;
  --brand-ink: #FBF8F0;
  --brand-soft: rgba(20, 32, 63, .07);
  --brand-2: #0B1430;       /* hover/darker ink */

  /* seal red: italic emphasis, seal, serial numbers, DEVNET stamp. NEVER for money or buttons */
  --red: #B4312A;           /* new */
  --red-soft: #F3DCD6;      /* new */

  /* money */
  --pay: #17694A;           /* payout amounts, "if it happens" */
  --pay-soft: #DCEBE2;
  --pay-on-ink: #9FE0BE;    /* new: payout figure on the navy binding panel */
  --cost: #14203F;          /* new: premium amounts are INK, not gold */
  --gold: #8A6A22;          /* fine print, basis-risk rule, "premium" labels; text-safe on paper */
  --gold-rule: #A8843A;     /* new: decorative gold rule (border-left of fine print) */
  --gold-soft: rgba(168, 132, 58, .08);

  /* status */
  --bad: #B4312A;           /* errors share the seal red */
  --bad-soft: #F3DCD6;
  --info: #2B5C78;          /* = guilloché blue */
  --info-soft: rgba(43, 92, 120, .08);

  /* venues */
  --gemini: #0F7C8C;
  --kalshi: #1D7A47;
  --poly: #2F4FB8;

  /* engraving */
  --guil: #2B5C78;          /* new: guilloché linework blue */
  --guil-2: #8C3B33;        /* new: guilloché red band */

  /* depth: paper does not glow. Use soft drop shadows for lifted documents and hard offsets for hover */
  --shadow: 0 1px 0 var(--line-2);
  --shadow-lg: 0 1px 0 var(--line-2), 0 30px 60px -30px rgba(20, 32, 63, .45);
  --shadow-hard: 6px 6px 0 var(--ink);  /* new: card hover */

  --radius: 3px;            /* documents are cut paper: near-square */
  --radius-sm: 2px;

  /* type (variables injected by next/font, see §3) */
  --serif: var(--font-bodoni), "Didot", "Bodoni 72", Georgia, serif;
  --sans: var(--font-archivo), system-ui, -apple-system, "Segoe UI", sans-serif;
  --fig: var(--font-archivo), system-ui, sans-serif;  /* new: big money figures (condensed 800) */
  --mono: var(--font-plex-mono), ui-monospace, "SF Mono", Menlo, monospace;

  color-scheme: light;
}
```

Body background (security-paper engraving lines):
```css
body {
  background: var(--bg);
  background-image: repeating-linear-gradient(0deg, rgba(20,32,63,.035) 0 1px, transparent 1px 4px);
  color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.5;
}
```

Hard-coded colours to remove: `themeColor` in `app/layout.tsx` becomes `"#F3EEE1"`. In `app/wallet-debug/page.tsx`
the `<pre>` uses `#111/#9f9`; change it to `background: var(--ink); color: var(--pay-on-ink)`. No other hex
values are allowed in components; use tokens.

---

## 3. Fonts — `app/layout.tsx`

```tsx
import { Bodoni_Moda, Archivo, IBM_Plex_Mono } from "next/font/google";

const bodoni = Bodoni_Moda({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-bodoni", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

<html lang="en" className={`${bodoni.variable} ${archivo.variable} ${plexMono.variable}`}>
```
(Bodoni Moda and Archivo are variable fonts, so do not pass `weight`. If the `axes` option errors on the
installed Next version, drop `axes`. Archivo's condensed width is then lost and the figures fall back to
normal width, which is still acceptable.)

Roles:
| Role | Font | Settings |
|---|---|---|
| Display h1 | Bodoni Moda | 500, `clamp(40px,5.5vw,80px)`, line-height 1, letter-spacing -.03em, `font-optical-sizing:auto` (the mockup's fixed `opsz 40` caused the wide gap after the "W"; use auto, and if the gap persists, set `font-variation-settings:'opsz' 96`) |
| h2 / section titles | Bodoni Moda | 500, `clamp(30px,3.6vw,48px)`, lh 1.05, -.02em; `<em>` inside = italic 700, `color: var(--red)` |
| h3 / document titles, risk names | Bodoni Moda | 600, 19–30px, lh 1.1–1.2 |
| Certificate caps titles ("CERTIFICATE OF COVER", "SCHEDULE OF COVER") | Bodoni Moda | 700, 14–15px, uppercase, letter-spacing .28–.32em |
| Body/UI | Archivo | 400/600, normal width |
| Nav links, buttons | Archivo | 600; nav uses uppercase 12.5px, letter-spacing .12em |
| **Big money figures** | Archivo | `font-stretch:72%; font-weight:800; font-variant-numeric: tabular-nums lining-nums; letter-spacing:-.01em` |
| Table numbers, odds, serials, eyebrows, labels, timestamps | IBM Plex Mono | 400–600, `tabular-nums` |

Utility classes (globals.css):
```css
h1,h2,h3{font-family:var(--serif);font-weight:500;letter-spacing:-.02em;line-height:1.08;margin:0 0 .4em;font-optical-sizing:auto}
h1{font-size:clamp(40px,5.5vw,80px);line-height:1;letter-spacing:-.03em}
h2{font-size:clamp(30px,3.6vw,48px);line-height:1.05}
h3{font-size:1.25rem;font-weight:600;letter-spacing:-.01em}
h1 em,h2 em{font-style:italic;font-weight:700;color:var(--red)}
.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.fig{font-family:var(--fig);font-stretch:72%;font-weight:800;font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.01em;line-height:1}
.eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2);font-weight:500;display:inline-flex;align-items:center;gap:10px}
.eyebrow::before{content:"";width:28px;height:1px;background:currentColor}
.serial{font-family:var(--mono);font-size:12px;color:var(--red);letter-spacing:.1em}
.caps-title{font-family:var(--serif);font-weight:700;font-size:14px;letter-spacing:.28em;text-transform:uppercase}
a{color:var(--ink);text-decoration-color:var(--line-2);text-underline-offset:3px}
a:hover{color:var(--brand-2);text-decoration-color:var(--ink)}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}
```

---

## 4. Signature motifs — `components/Engraving.tsx` (NEW, owner: Engineer 1)

All ornaments are generated at module load with a small number of points, so they cost no network and stay a
few KB each. They are decoration only (`aria-hidden`), with `pointer-events:none`. They NEVER sit behind a
number or table.

```tsx
// components/Engraving.tsx — guilloché rosette, wavy band, hedgehog seal. Pure SVG, no deps.
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
/** Guilloché rosette. Size it with CSS (width/height). density: lines in the outer ring. */
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
/** Wavy guilloché band for certificate top/bottom edges. tone="red" for the bottom band. */
export function GuillocheBand({ tone = "blue" }: { tone?: "blue" | "red" }) {
  return (
    <svg className="band" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true"
         style={{ display: "block", width: "100%", height: 16, fill: "none", strokeWidth: .7,
                  stroke: tone === "red" ? "var(--guil-2)" : "var(--guil)", opacity: tone === "red" ? .55 : .8 }}>
      <path d={bandPath()} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Seal geometry (size 160): copied from gen.mjs seal()
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

/** Red hedgehog seal. withText=false for small sizes (logo, < 60px). fill = paper colour behind it. */
export function Seal({ className, withText = true, fill = "var(--surface)", text = "HEDGEHOG · WORST-DAY COVER · PAID ON SOLANA ·" }:
  { className?: string; withText?: boolean; fill?: string; text?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 160 160" aria-hidden="true">
      <defs><path id={`sp${id}`} d="M 80,80 m -67.2,0 a 67.2,67.2 0 1,1 134.4,0 a 67.2,67.2 0 1,1 -134.4,0" /></defs>
      <circle cx="80" cy="80" r="77.6" fill={fill} />
      <g fill="none" stroke="var(--red)" strokeWidth="1.2">
        <circle cx="80" cy="80" r="76" /><circle cx="80" cy="80" r="58.4" /><circle cx="80" cy="80" r="48" />
      </g>
      <path d={SPOKES} stroke="var(--red)" strokeWidth="1.1" />
      {withText && <text fill="var(--red)" style={{ fontFamily: "var(--mono)", fontSize: 10.2, letterSpacing: 2.1, fontWeight: 600 }}>
        <textPath href={`#sp${id}`}>{text}</textPath></text>}
      <path d={HOG.back} fill="var(--red)" />
      <path d={HOG.quills} stroke={fill} strokeWidth="1.4" />
      <circle cx={HOG.eye[0]} cy={HOG.eye[1]} r="1.8" fill={fill} />
    </svg>
  );
}
```

Placement rules:
- **Rosette**: (a) a big one behind the home hero: `width/height:980px; position:absolute; right:-220px; top:-170px; opacity:.22`. At ≤640px it becomes `620px; right:-300px; top:-120px`. (b) A small one (`density 8–10`, 260–300px, opacity .22–.28) in the bottom-right corner of the certificate and the policy stub, clipped by `overflow:hidden`. (c) At most one per page section header on secondary pages (how-it-works hero, dashboard header), opacity ≤ .18. Never inside tables, the buy panel or the checkout dialog.
- **Band**: the top (blue) and bottom (red) edge of `.cert` documents only: the hero certificate, the dashboard policy certificate and the checkout success receipt.
- **Seal**: (a) the Logo (replace `components/Logo.tsx` content with `<Seal withText={false} fill="var(--bg)" className="seal-logo" />`, 40px; keep `export function Logo({size})`). (b) Stamped on the hero certificate corner (118px, `rotate(-12deg)`, stamp animation §8). (c) The policy stub's left column (46–70px, no text). (d) The checkout dialog success state ("Cover bound"), stamping once. Also update `public/favicon.svg` to a static red seal (no text).
- **Microtext / live-odds ticker strip** (§6.1): sits above the header on every page.
- **Hedge-it underline**: a hand-drawn swash under the red italic `<em>` in the h1 only:
  ```html
  <svg viewBox="0 0 300 16" preserveAspectRatio="none" aria-hidden="true" class="swash"><path d="M2 10 C 60 2, 120 14, 180 7 S 270 4, 298 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
  ```
  `.swash{position:absolute;left:-2%;bottom:-14px;width:104%;height:16px}`
- **Line icons** (replace ALL emoji, which render as empty boxes in headless/Linux). Style: 48×48 viewBox, `stroke: currentColor; stroke-width:1.3; fill:none; stroke-linecap:round`, like the mockup's preset icons (glass, truck, cloche, pen). Needed: preset icons (umbrella/glass, truck, fuel pump/cloche, pen), market categories (sun, cloud-rain, snowflake, bolt, ball, barrel, bank/columns, coin, dots), check `✓` → `<svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7"/></svg>`, warning `⚠` → a triangle + bar, `💸` → a coin/arrow icon. Put them in `components/Icons.tsx` (owner: Engineer 1, exported by name; others may add icons there in their own named exports at the end of the file).

---

## 5. Component recipes (globals.css, owner Engineer 1; other engineers use these class names)

### 5.1 Buttons
```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;font:inherit;font-family:var(--sans);font-weight:600;font-size:15px;line-height:1.1;
  padding:12px 20px;min-height:44px;border-radius:var(--radius);border:1.5px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;text-decoration:none;
  transition:background .15s ease, transform .06s ease}
.btn:hover{background:rgba(20,32,63,.06);color:var(--ink)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
/* primary = engraved ink plate: a double inner rule */
.btn-primary{background:var(--ink);color:var(--surface);border-color:var(--ink);box-shadow:inset 0 0 0 3px var(--ink),inset 0 0 0 4px rgba(251,248,240,.35)}
.btn-primary:hover{background:var(--brand-2);color:var(--surface)}
/* secondary = outlined (the default .btn) */
.btn-ghost{border-color:transparent;color:var(--ink-2)}
.btn-ghost:hover{background:var(--bg-2);color:var(--ink)}
/* gold: legacy class still used; render as outlined gold-ruled */
.btn-gold{border-color:var(--gold-rule);color:var(--gold);background:var(--gold-soft)}
/* buy = the one CTA on the navy binding panel: inverted plate */
.btn-buy{width:100%;background:var(--surface);color:var(--ink);border-color:var(--surface);font-size:17px;padding:17px 18px;min-height:56px;
  box-shadow:inset 0 0 0 3px var(--surface),inset 0 0 0 4px var(--ink)}
.btn-buy:hover{background:#fff;color:var(--ink)}
.btn-sm{font-size:13px;padding:8px 13px;min-height:36px}
.btn-lg{font-size:16px;padding:15px 24px;min-height:52px}
.btn-block{width:100%}
```
Arrow icon for "Get my quote": `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h10M9 4l4 4-4 4"/></svg>`.
Buttons never wrap their label: add `white-space:nowrap` to `.btn`. On mobile, CTA rows use `flex:1 1 auto` (the mockup wrapped "Get my quote" at 390px, which is a bug).

### 5.2 Cards / documents
```css
.card{background:var(--surface);border:1px solid var(--ink);border-radius:var(--radius);box-shadow:none;padding:20px}
.card.lift{box-shadow:var(--shadow-lg)}
a.card:hover,.card.link:hover{transform:translateY(-3px);box-shadow:var(--shadow-hard);transition:transform .15s, box-shadow .15s}
.card-soft{background:var(--surface-2);border:1px solid var(--line-2);border-radius:var(--radius);padding:16px}
.card-dashed{background:transparent;border:1px dashed var(--ink)}   /* "blank form" / empty states */
.doc-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--ink);margin:-20px -20px 16px}
.doc-head .meta{font-family:var(--mono);font-size:11.5px;color:var(--muted);letter-spacing:.06em}
.divider{height:1px;background:var(--line);margin:16px 0;border:0}
.rule-double{border:0;border-top:3px double var(--ink);margin:16px 0}
```
- **Certificate** (`.cert`, hero + dashboard policy + checkout success): copy `.cert-stage/.cert-under/.cert/.cert-frame/.cert-in/.cert-head/.terms/.term/.cert-foot/.facts/.sig` from the mockup verbatim. The tilt is `rotate(-1.2deg)` (≤1.2°) on the hero only, with an under-sheet at `+2.2deg`. Dashboard and receipt certificates are NOT rotated.
- **Form card** (presets): copy `.form/.fno/.ico/.go/.form.blank/.lines`. The "Form A · Bar" numbering goes A, B, C… in preset order, with the blank custom form last as "Form · Blank".
- **Policy stub** (dashboard list items): copy `.stub/.stub-left/.stub-body/.inforce/.stub-grid`. The perforated edge is `border-right:2px dashed var(--line-2)`. Status stamp classes: `.stamp` base + modifiers:
  ```css
  .stamp{display:inline-block;font-family:var(--mono);font-weight:600;font-size:12px;letter-spacing:.2em;text-transform:uppercase;padding:4px 9px;border:2px solid currentColor;transform:rotate(6deg)}
  .stamp-inforce{color:var(--pay);background:rgba(23,105,74,.05)}   /* IN FORCE / active */
  .stamp-settled{color:var(--ink)}                                    /* SETTLED / PAID */
  .stamp-void{color:var(--muted)}                                     /* EXPIRED / NOT TRIGGERED */
  .stamp-red{color:var(--red);background:rgba(180,49,42,.05);transform:rotate(-3deg)} /* DEVNET */
  ```

### 5.3 Badges / pills
```css
.badge{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  padding:3px 7px;border:1.25px solid currentColor;border-radius:var(--radius-sm);white-space:nowrap;line-height:1.4;background:var(--surface)}
.badge-gemini{color:var(--gemini)} .badge-kalshi{color:var(--kalshi)} .badge-polymarket{color:var(--poly)}
.badge-gemini::before,.badge-kalshi::before,.badge-polymarket::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge-neutral{color:var(--ink-2);border-color:var(--line-2)}
.badge-good{color:var(--pay)} .badge-bad{color:var(--red)} .badge-gold{color:var(--gold)} .badge-brand{color:var(--ink)}
.badge-demo{color:var(--info)}
.badge-devnet{color:var(--red);border-width:1.5px;transform:rotate(-3deg);background:rgba(180,49,42,.05);letter-spacing:.14em}
```
Venue badge text: "GEMINI", "KALSHI · DFLOW", "POLYMARKET". `components/markets/VenueBadge.tsx` must render these classes. When a `.dot` is used inside badges it stays a 6–7px circle. `.dot.live` keeps the pulse (reduced-motion: static).

### 5.4 Tables (ledger style)
```css
table.table{width:100%;border-collapse:collapse;font-size:14px;background:var(--surface)}
.table-wrap{overflow-x:auto;border:1px solid var(--ink);background:var(--surface)}
.table th{text-align:left;font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:11px 14px;border-bottom:1px solid var(--ink);white-space:nowrap}
.table td{padding:14px;border-bottom:1px solid var(--line);vertical-align:top}
.table tr:last-child td{border-bottom:0}
.table td.num,.table td .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.table tfoot td{border-top:3px double var(--ink);border-bottom:0;padding:16px 14px;font-weight:600}
.table tbody tr:hover{background:rgba(20,32,63,.03)}
.table .ix{font-family:var(--mono);font-size:12px;color:var(--muted);width:40px}   /* row numbers 01 02 03 */
.table tr.ref td{color:var(--muted)} .table tr.ref .pay,.table tr.ref .cost{color:var(--muted)}  /* reference-only rows */
.right{text-align:right!important}
.pay{color:var(--pay)} .cost{color:var(--cost)} .bad{color:var(--red)}
.up{color:var(--pay)} .dn{color:var(--red)}
```
The risk name in quote/schedule rows is Bodoni 600 19px (`.risk b`); the trigger line is 13px `--ink-2`. In the
markets explorer, row titles stay Archivo 600 14px (dense data); only page and section titles use Bodoni there.
Odds bar (`.oddbar`): 64×3px, track `--line`, fill `--ink`.

### 5.5 Forms
```css
label.field>span{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:6px;font-weight:500}
.input,textarea.input,select.input{width:100%;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--ink);border-radius:var(--radius-sm);padding:11px 13px}
.input:focus{outline:none;box-shadow:0 0 0 3px rgba(20,32,63,.14);border-color:var(--ink)}
textarea.input{background-image:repeating-linear-gradient(transparent 0 27px, var(--line) 27px 28px);line-height:28px;padding-top:6px} /* lined write-in form */
.input-prefix>b{font-family:var(--mono)}
.chip{font:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:var(--radius-sm);border:1px solid var(--line-2);background:var(--surface);color:var(--ink-2);min-height:36px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.seg{display:inline-flex;border:1px solid var(--ink);border-radius:var(--radius-sm);padding:0;gap:0;background:var(--surface)}
.seg button{font-family:var(--mono);font-weight:600;font-size:13px;border:0;border-right:1px solid var(--line-2);background:transparent;color:var(--ink-2);padding:8px 14px;min-height:36px;border-radius:0;cursor:pointer}
.seg button:last-child{border-right:0}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--surface);box-shadow:none}
```
On the navy binding panel, `.seg` inverts: border `rgba(251,248,240,.4)`, active = `--surface` bg + `--ink` text.

### 5.6 Dialogs (CheckoutDialog, wallet modal)
```css
.modal-backdrop{background:rgba(20,32,63,.55)}
.modal{background:var(--surface);border:1px solid var(--ink);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:0}
.modal>.doc-head{margin:0}        /* caps-title "BINDING COVER" + serial */
.modal-body{padding:22px 24px}
```
The checkout dialog is a document: header `caps-title` "Binding cover" + `.serial` with the quote id. Steps list
(`.steps`): `.ic` circles become 24px squares with a 1.5px ink border; done = ink fill + check SVG; active = a
spinner border (reduced-motion: a static half-filled square); fail = red. On success, show a certificate block
(non-rotated `.cert` with bands) whose seal stamps once. The explorer link is a `.btn btn-sm`.
Wallet adapter: `.wallet-adapter-button-trigger{background:var(--ink)!important;color:var(--surface)!important;border-radius:var(--radius)!important;font-family:var(--sans)!important}`. The modal is `.wallet-adapter-modal-wrapper{background:var(--surface)!important;color:var(--ink)!important;border:1px solid var(--ink);border-radius:var(--radius)!important;font-family:var(--sans)!important}`, its title is Bodoni, and its list items have ink text and a hover of `--bg-2`.

### 5.7 Money display
- Hero/binding/checkout headline figures: `.fig` at 40–52px. Payout in `--pay` (on navy: `--pay-on-ink`), premium in `--cost` (ink; on navy: `--surface`).
- Always pair the figure with a plain-language label ABOVE it: "If it rains, you get" / "If it doesn't, you paid" / "Pays out if it happens" / "Premium if it doesn't". Labels are Archivo 600 12px uppercase .06em `--ink-2`.
- Table money: Plex Mono 15–16px, payout 600 in `--pay`, premium 400 in ink, right-aligned. Cents shown for premiums (`$154.00`), whole dollars for payouts if the data is whole.
- Odds: mono `28%` plus `.oddbar`. Prices in cents on markets: `28¢`.
- Never put a number on top of a rosette, a band or a texture.

### 5.8 Section headers
```html
<div class="sec-head"><div><span class="eyebrow">Step 1</span><h2>Pick a business, <em>or describe yours</em></h2></div><span class="muted small">Three Austin examples · about 30 seconds to a quote</span></div>
```
```css
section.sec{padding:84px 0;border-bottom:1px solid var(--line-2)}
.sec-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:28px}
```
Every page starts with a page header of the same shape: an eyebrow (mono), an h1/h2 in Bodoni with one red
italic `<em>` phrase, and optional meta on the right. Use one red italic phrase per heading at most.

### 5.9 Header / nav / footer (Engineer 1)
- Above the header: the **ticker strip** (§6.1), 22px tall, `--bg-2` background, bottom border `--line-2`.
- Header: sticky, `background:var(--bg)` (no blur needed), `border-bottom:3px double var(--ink)`, height 72px (62px at ≤640px).
- Brand: Seal logo 40px + "Hedgehog" in Bodoni italic 700 27px.
- Nav links: Archivo 600 12.5px uppercase .12em `--ink-2`, active/hover = ink + `border-bottom:1.5px solid var(--ink)` (no pill backgrounds).
- Right: `.badge-devnet` stamp "DEVNET", the "Demo data" badge (`.badge-demo`) and the wallet button.
- Mobile nav (≤720px): a horizontal scroll strip under the header; links are mono 12px uppercase with an ink underline for the active one, and no pill borders.
- Footer: `border-top:3px double var(--ink)`; mono 11px uppercase .1em `--muted`; left "Hedgehog · worst-day cover for small business · Austin, TX", right "How it works · Devnet prototype · not a licensed insurance product; hedges carry basis risk". Keep the existing link and meaning.

---

## 6. Grafts from runners-up

### 6.1 Live-odds ticker strip (from Storm Desk), replacing the static microtext
`components/OddsTicker.tsx` (Engineer 1). It shows 4–8 items like `RAIN AT AUS SAT · 28%`, taken from the existing
markets feed if one is cheaply available client-side (`/api/markets` or `/api/feed`; reuse whatever the markets
page already fetches, and do not add a new API). If there is no data within 2s or on error, it falls back to the
microtext `HEDGEHOG WORST-DAY COVER · PRICED ON LIVE PREDICTION MARKETS · PAYS OUT ON SOLANA ·` repeated.
```css
.ticker{height:22px;overflow:hidden;background:var(--bg-2);border-bottom:1px solid var(--line-2);font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap}
.ticker .track{display:inline-flex;gap:36px;padding:5px 0;animation:tick 60s linear infinite}
.ticker b{color:var(--ink);font-weight:600} .ticker .pct{color:var(--pay)}
@keyframes tick{to{transform:translateX(-50%)}}   /* render the items twice for a seamless loop */
@media (prefers-reduced-motion:reduce){.ticker .track{animation:none}}
.ticker:hover .track{animation-play-state:paused}
```
The ticker is `aria-hidden="true"`; it is decoration plus proof of liveness, not the data source.

### 6.2 Quote stamp (from Risk Sky)
The schedule header row shows: `caps-title` "Schedule of cover" | right side mono meta
`POLICY HH·ATX·{id} · QUOTED 9:42 AM CST · MODEL gemini-2.5-pro`. Use real values from the quote object
(timestamp/model if present; otherwise omit that part and never invent it).
The coverage toggle (existing `.seg`) and the monthly budget bar sit inside the navy binding panel, above the
buy button, inverted for navy.

### 6.3 Dry day vs bad day bar + reference rows (from Underwriter's Notebook)
- For the how-it-works explainer (`components/explain/Visuals.tsx`) and optionally the RiskCard: two horizontal bars, "Normal Saturday $4,200" vs "Rainy Saturday", where the lost part is outlined in red dashes and the part the hedge covers is filled with **engraved hatching**:
  ```css
  .hatch-pay{background:repeating-linear-gradient(45deg,var(--pay) 0 1.5px,transparent 1.5px 5px);border:1px solid var(--pay)}
  .loss-gap{border:1.5px dashed var(--red);background:transparent}
  ```
  Label: "hedge pays this part" in mono 11px `--pay`. Bars are 14px tall with a 1px ink border, square. Numbers come from the component's existing props.
- Rows that are reference-only, not bought (e.g. cross-check prices, VenueCompare), use `tr.ref`: muted text, a "reference price · not bought" note, and an em dash `—` for pays and premium.

---

## 7. The quote + buy area: what MUST stay plain (Engineer 3)

Layout (desktop): `grid-template-columns: 1fr 360px; gap: 28px`. Left: **Schedule of cover** (`.card` with
`doc-head` + `table.table`). Right: **Binding summary** (navy panel, sticky top 20px). Copy `.schedule`,
`.sch`, `.bind`, `.btn-buy`, `.signline`, `.assure` and `.fine` from the mockup.

Binding panel, top to bottom: mono key "BINDING SUMMARY" → coverage `.seg` (if PlanView has one) → "If a bad day hits, you get up to" + `.fig` 46px `--pay-on-ink` → hairline → "If none do, you paid" + `.fig` 46px `--surface` → monthly budget bar (`.bar` inverted: track `rgba(251,248,240,.2)`, fill `--surface`; over budget = `--red`) → 1–2 lines of plain summary → **`.btn-buy` "Buy cover — one signature"** (with a shield-check icon; the existing label and handler are unchanged) → signature line `x ______ YOUR WALLET SIGNS` → two `.assure` checks ("Price locked/re-quoted before signing", "Pays automatically to your wallet on Solana devnet when the market settles", using the existing copy meaning).
Under the schedule: the `.fine` basis-risk box, headed **"Basis risk, in plain print."**, with a gold left rule.

Hard rules:
1. No rosette, band, texture, tilt or animation inside the schedule, binding panel or checkout dialog body. The page's paper lines are fine, but the sheet itself is flat `--surface`.
2. Exactly ONE primary action in the binding panel. Secondary actions (re-quote, edit picks) are `.btn-ghost`/`.btn-sm`, placed outside the panel or below the fine print.
3. Payout is always green, premium is always ink. Red is never used for money except a loss/over-budget state.
4. Every row is readable without hover: risk, trigger, venue badge, odds, pays, premium.
5. The total row uses a `3px double` rule.
6. Mobile (≤640px): the schedule turns into stacked rows (copy the mockup's `.sch` mobile rules: `td[data-l]::before{content:attr(data-l)}`, a 3-column Odds/Pays/Premium grid). **Add `data-l="Odds"` / `"Pays"` / `"Premium"` attributes to those `<td>`s in QuoteTable.** The binding panel follows the schedule, is not sticky, and the buy button is full width.
7. Loading/error states inside the quote area: `.empty` (dashed ink border, mono label) and `.alert` (see below), no spinners bigger than 16px.

Alerts:
```css
.alert{border-radius:var(--radius-sm);padding:12px 16px;border:1px solid var(--line-2);border-left-width:4px;font-size:14px;background:var(--surface);color:var(--ink-2)}
.alert-bad{border-left-color:var(--red)} .alert-bad b{color:var(--red)}
.alert-info{border-left-color:var(--info)}
.alert-good{border-left-color:var(--pay)}
.fine{border:1px solid var(--line-2);border-left:4px solid var(--gold-rule);background:var(--gold-soft);padding:14px 18px;font-size:13.5px;color:var(--ink-2)}
.empty{text-align:center;padding:28px 16px;color:var(--muted);border:1px dashed var(--ink);border-radius:var(--radius);font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.bar{height:6px;background:var(--line);border-radius:0;border:0;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--ink);border-radius:0;transition:width .4s ease}
.bar.over>i{background:var(--red)}
.conf i{width:8px;height:8px;border-radius:0;background:var(--line-2)} .conf i.on{background:var(--ink)}
.kv dt{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
```

---

## 8. Motion

Only these may move:
1. **Seal stamp**: once on the hero certificate (0.5s delay) and once on checkout success.
   `@keyframes stamp{from{opacity:0;transform:rotate(-30deg) scale(1.9)}to{opacity:1;transform:rotate(-12deg) scale(1)}}`, `.55s cubic-bezier(.2,.9,.3,1.3) both`.
2. **Ticker** crawl (60s loop, pauses on hover).
3. Card hover lift (`translateY(-3px)` + hard shadow, .15s), button press, `.dot.live` pulse, bar width transitions, and the step spinners.
4. Optional: the hero rosette rotates very slowly (`240s linear infinite`) on desktop only.

Global guard (globals.css):
```css
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}
```
(With this guard the stamp ends in its final state and the ticker stops.) Nothing in the quote or buy area animates except the budget-bar width.

---

## 9. Mobile rules (verify at 390×844, and no horizontal scroll: `document.documentElement.scrollWidth === 390`)
- Side gutter 16px (`.container{padding:0 16px}` at ≤640px). Max content width 1240px on desktop (`.container{max-width:1240px;padding:0 32px}`). Pages that were `.narrow` keep `max-width:760px`.
- h1 is 40px at ≤640px; h2 is 30px.
- Hero: under 1080px it is one column. The hero certificate must start ABOVE the fold at 390×844: tighten the hero padding (`28px 0 40px`) and lede spacing, and at ≤640px drop the `.priced` line below the certificate. If it still does not fit, show a compact certificate (terms grid only + kicker) on mobile.
- Certificate at ≤640px: `rotate(-.8deg)`, a 40px figure, cert-head stacked, a seal of 84px.
- Forms grid: 4 → 2 (≤1080) → 1 (≤640) columns.
- Tables: the quote uses stacked cards (§7.6). Markets explorer: keep `.table-wrap` horizontal scroll inside its own box, and hide low-value columns at ≤640 (`.hide-m`); the page itself must not scroll sideways.
- The header wallet button shows only its icon/dot at ≤480px (as now). The DEVNET stamp stays visible.
- Touch targets ≥ 40px.

---

## 10. Page-by-page application (assignment for 4 parallel engineers)

**File ownership is strict to avoid merge conflicts.** Only Engineer 1 edits `app/globals.css`, `app/layout.tsx`,
`components/Header.tsx`, `components/Logo.tsx`, `components/WalletButton.tsx`, `components/Engraving.tsx`,
`components/Icons.tsx`, `components/OddsTicker.tsx` and `public/favicon.svg`. Everyone else styles through the
global classes above plus their own CSS modules, and may import `Rosette/Seal/GuillocheBand` and icons
(write against the APIs in this spec even before E1 lands them). In CSS modules use only tokens. No hex values,
no `border-radius` > 3px (except dots/seal), and no `box-shadow` other than `--shadow`, `--shadow-lg` and `--shadow-hard`.

- **Engineer 1 — foundation + chrome + wallet-debug:** tokens, fonts, all §5 global recipes, the Header with ticker, the footer, Logo/Seal, the favicon, the wallet adapter skin, Icons, OddsTicker, the reduced-motion guard. Also `app/wallet-debug/page.tsx` (page header pattern, `.card` documents, `<pre>` on ink).
- **Engineer 2 — home + intake:** `app/page.tsx` + `page.module.css` (hero = mockup hero: eyebrow, Bodoni h1 with red italic "Hedge it." + swash, lede, CTAs, priced-on line, rotated certificate with bands, small rosette and stamping seal, big background rosette), `PresetGrid` (Form A/B/C cards with line icons, blank form last), `IntakeForm` (a "Proposal form" document: caps-title header "PROPOSAL FOR COVER" + serial-like "Form P-1", lined textarea, mono field labels), `AdviseProgress` (an "Underwriting…" document with square step markers).
- **Engineer 3 — plan / quote / checkout:** `app/plan/page.tsx`, `PlanView`, `QuoteTable`, `RiskCard`, `CoverInfoPanel`, `CheckoutDialog`, `components/plan/*`. Follow §7 exactly. Add the `data-l` attributes. Add the quote stamp (§6.2). Reference-only rows use `tr.ref`. The checkout success state is a non-rotated certificate with bands and a seal stamp.
- **Engineer 4 — markets, dashboard, how-it-works, explainers:** `app/markets`, `components/markets/*` (ledger tables, venue badges, category chips with SVG icons instead of emoji, VenueCompare flag uses the warning SVG), `app/dashboard` + `Dashboard` (policy **stubs** with perforated edge, seal and `.stamp-inforce`/`settled`/`void`; an optional page-header rosette), `app/how-it-works` + `components/explain/*` (stages as "Clause 1 / 2 / 3" numbered in Bodoni with mono kickers; architecture diagram strokes in `--ink`/`--line-2`, boxes `--surface` with 1px ink border, square; dry vs bad-day hatched bar §6.3; replace the 💸 emoji and the ✓/✕ glyphs with SVG).

Each engineer verifies their pages with the screenshot tool at 1440×900 and 390×844 (and fullPage), LOOKS at
the PNGs, and checks there is no horizontal scroll and no console errors.

---

## 11. Do / Don't

**Do**
- Use ink borders (1px `--ink`) for documents and hairlines (`--line`) inside them.
- Use the double rule (`3px double var(--ink)`) for header bottoms, total rows and the footer top.
- Use Plex Mono for every number, serial, timestamp, eyebrow and label; use `.fig` for the hero money figures.
- Give each heading at most one red italic `<em>` phrase.
- Give documents serial numbers derived from real ids (`HH·ATX·` + the short id). If there is no id, show no serial; don't invent one.
- Keep all copy meaning, routes, handlers, API calls and data the same. Restyling only.
- Use inline SVG icons (stroke 1.3–1.8, currentColor).

**Don't**
- No dark mode, no gradients on surfaces, no glassmorphism/blur, no glow shadows, no rounded-pill cards (radius ≤ 3px; pills only for dots).
- No emoji anywhere in the UI.
- No ornament (rosette, band, texture, tilt) behind or inside the quote, binding panel, checkout dialog or any table.
- No red buy buttons and no red payouts. Red = seal, emphasis, errors and the DEVNET stamp.
- No rotations > 1.2° on documents, and no rotation of tables or the binding panel.
- Don't paste the mockup's inlined path data. Use `Engraving.tsx`.
- Don't add new dependencies beyond `next/font/google`.
- Don't spell "Certificate"/"Policy" claims beyond the existing disclaimers: the footer and fine print must keep "Devnet prototype · not a licensed insurance product".

---

## Implemented primitives (Engineer 1, landed and live on :5390)

Everything in §2–§9 is in `app/globals.css`, so pages pick up the theme automatically. The index comment at the top of the file lists every class. Fonts are loaded in `app/layout.tsx` via next/font (`--font-bodoni`, `--font-archivo`, `--font-plex-mono`; `axes` works on Next 15.5). There is no dark mode, and `themeColor` is `#F3EEE1`.

### React imports
```tsx
import { Rosette, GuillocheBand, Seal, Swash } from "@/components/Engraving";
<Rosette className="cert-rosette" density={9} steps={220} />   // size/position via CSS; opacity set by the class (.cert-rosette/.stub-rosette = .22)
<GuillocheBand />  <GuillocheBand tone="red" />                // top/bottom edge inside .cert-frame
<div className="seal-stamp"><Seal /></div>                      // stamps once (.5s delay); add class "now" for a .1s delay (checkout success)
<Seal withText={false} className="seal-sm" />                   // stub left column (70px; 46px at ≤640)
<em>Hedge it.<Swash /></em>                                     // em needs position:relative; display:inline-block

import { IconCheck, IconX, IconArrowRight, IconExternal, IconWarning, IconInfo, IconChevronDown, IconChevronUp,
  IconShieldCheck, IconPayout, IconWallet, IconPen, IconLock, IconGlass, IconUmbrella, IconTruck, IconCloche,
  IconFuelPump, IconBlankForm, IconHammer, IconSun, IconCloudRain, IconSnowflake, IconBolt, IconWave, IconStorm,
  IconBall, IconBarrel, IconFlame, IconPick, IconBank, IconChartUp, IconCoin, IconDots, IconGrid, PerilIcon } from "@/components/Icons";
<IconCheck size={14} />                 // all icons: props size, className, title, strokeWidth; stroke = currentColor
<PerilIcon peril="rain" size={15} />    // peril ids from lib/client/format.ts PERIL map AND MarketExplorer category ids
                                        // (all, heat, rain, snow, power, disaster, games, energy, commodities, rates, crypto, other)
```
`components/OddsTicker.tsx` is mounted by the Header (do not mount it again). `components/Logo.tsx` keeps `Logo({size})`.

### Class quick reference
- **Page header:** `<div className="page-head"><div><span className="eyebrow">Market explorer</span><h1>Every market <em>our AI can use</em></h1></div><span className="muted small">meta</span></div>`. Use `.sec-head` + h2 for sections inside a page.
- **Type:** `.fig` (big money; add a size), `.num`/`.mono`, `.eyebrow` (`.eyebrow.plain` = no leading rule), `.serial` (+ `<small>`), `.caps-title`, `.kicker`, `.label` (Archivo 12px caps, for money labels), `.lede`.
- **Buttons:** `.btn` (outline), `.btn-primary`, `.btn-ghost`, `.btn-gold`, `.btn-buy` (navy panel only), `.btn-on-ink` (secondary on navy), `.btn-sm`, `.btn-lg`, `.btn-block`. All are `nowrap`; on mobile, keep labels short or make the row wrap.
- **Documents:** `.card` (1px ink), `.card.lift`, `a.card` / `.card.link` (hover lift + hard shadow), `.card-soft`, `.card-dashed`, `.doc-head` with `.caps-title` + `.meta` (negative margins match `.card` padding; inside `.modal` it is already offset), `.divider`, `.rule-double`, `.paper-sheet`.
- **Certificate:**
  ```
  .cert-stage > .cert-under + .cert(.tilt for hero only)
    > .seal-stamp + .cert-frame
      > GuillocheBand + .cert-in(.cert-rosette, .cert-head, h3, .insured, .terms > .term.pay|.term.cost > .lab/.amt/.sub, .cert-foot > .facts + .sig) + GuillocheBand red
  ```
  For a non-rotated certificate (dashboard/receipt), drop `.tilt` and `.cert-under`, and use `.cert-stage` padding as needed.
- **Forms (presets):** `a.form` > `.fno` + `.ico` + h3 + p + `.go`. Add `.form.blank` + `.lines`.
- **Stub:**
  ```
  .stub > .stub-left(.pn, Seal.seal-sm) + .stub-body(.stub-rosette, .stamp, h4, p, .stub-grid)
  ```
  Stamps: `.stamp.stamp-inforce|stamp-settled|stamp-void|stamp-red`. Position the stamp yourself (e.g. `position:absolute; right:18px; top:16px`).
- **Badges:** `.badge` + `badge-gemini|kalshi|polymarket` (auto dot), `-neutral|-good|-bad|-gold|-brand|-demo|-devnet`. `.dot`, `.dot.live`. A `.badge svg` is 12px.
- **Tables:**
  ```
  .table-wrap > table.table
  ```
  Supports `.ix`, `td.num`, `.right`, `.pay`, `.cost`, `.bad`, `.up`, `.dn`, `tr.ref`, `tfoot` (3px double) and `.oddbar > i[style=width]`. Use `.hide-m` to hide at ≤640 and `.hide-sm` at ≤720.
- **Inputs:** `label.field > span`, `.input` (`textarea.input` = lined paper), `.input-prefix > b + .input` (mono), `.chips > .chip[aria-pressed]` (an svg inside is 15px), `.seg > button[aria-pressed]`. `.seg` auto-inverts inside `.bind`, or add `.seg.on-ink`.
- **Navy binding panel:**
  ```
  aside.bind > .bind-inner > .bind-k, .bind-big.pay > span + b, .bind-big > span + b, .bar (auto-inverted inside .bind), .btn.btn-buy, .signline(.x, .l, span), ul.assure > li > IconCheck
  ```
  E3 adds layout (sticky/grid) in its module.
- **Feedback:** `.alert.alert-bad|info|good`, `.fine`, `.empty`, `.bar(.over) > i`, `.conf > i(.on)`, `.kv dt/dd`, `.hatch-pay`, `.loss-gap`, `.spinner` (16px).
- **Steps:** `.steps > li.done|active|fail > .ic` (24px square). Put `<IconCheck size={14}/>` in `.ic` for done; active spins as a circle, and under reduced motion it is a static half-filled square.
- **Modal:** `.modal-backdrop > .modal > .doc-head (caps-title + .serial) + content`. `.modal` has 24px padding, and the doc-head bleeds to the edges. `.modal-body` is available if you set the `.modal` padding to 0 yourself.
- The wallet adapter button, dropdown and modal are skinned globally. At ≤480px the header wallet button shows only an icon or dot.
