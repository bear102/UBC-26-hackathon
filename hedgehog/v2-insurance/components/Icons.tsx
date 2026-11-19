// Icons.tsx — engraved line icons that replace every emoji (emoji render as empty boxes on Linux/headless).
// Style: stroke = currentColor, round caps, no fill. Size with the `size` prop or CSS (width/height).
// Other engineers may append their own named exports at the END of this file.
import type { ReactNode, SVGProps } from "react";

type P = { size?: number; className?: string; title?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "children">;

function make(viewBox: string, body: ReactNode, defaultStroke = 1.3) {
  return function Icon({ size, className, title, strokeWidth, ...rest }: P) {
    return (
      <svg viewBox={viewBox} width={size} height={size} className={className} fill="none" stroke="currentColor"
        strokeWidth={strokeWidth ?? defaultStroke} strokeLinecap="round" strokeLinejoin="round"
        aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
        {title && <title>{title}</title>}
        {body}
      </svg>
    );
  };
}

// ---- small UI glyphs (16×16) ----
export const IconCheck = make("0 0 16 16", <path d="M3 8.5l3 3 7-7" />, 1.8);
export const IconX = make("0 0 16 16", <path d="M4 4l8 8M12 4l-8 8" />, 1.8);
export const IconArrowRight = make("0 0 16 16", <path d="M3 8h10M9 4l4 4-4 4" />, 1.8);
/** "↗" external link. */
export const IconExternal = make("0 0 16 16", <><path d="M6 3H3v10h10v-3" /><path d="M9 3h4v4M13 3L7 9" /></>, 1.6);
export const IconWarning = make("0 0 16 16", <><path d="M8 2L1.5 13.5h13z" /><path d="M8 6.5v3.5" /><circle cx="8" cy="11.9" r=".4" fill="currentColor" /></>, 1.5);
export const IconInfo = make("0 0 16 16", <><circle cx="8" cy="8" r="6.2" /><path d="M8 7.2v4" /><circle cx="8" cy="4.9" r=".4" fill="currentColor" /></>, 1.5);
export const IconChevronDown = make("0 0 16 16", <path d="M4 6l4 4 4-4" />, 1.6);
export const IconChevronUp = make("0 0 16 16", <path d="M4 10l4-4 4 4" />, 1.6);
export const IconDot = make("0 0 16 16", <circle cx="8" cy="8" r="2" fill="currentColor" />, 1);
/** Shield with a check: the buy button. */
export const IconShieldCheck = make("0 0 20 20", <><path d="M10 2l6.5 2.5v5c0 4-2.8 6.9-6.5 8.5-3.7-1.6-6.5-4.5-6.5-8.5v-5z" /><path d="M7 10l2.2 2.2L13.3 8" /></>, 1.6);
/** Coin with an arrow: replaces 💸 ("how you get paid"). */
export const IconPayout = make("0 0 20 20", <><circle cx="8" cy="10" r="5.5" /><path d="M8 7.2v5.6M9.6 8.2c-.4-.6-1-.8-1.7-.8-.9 0-1.6.5-1.6 1.2 0 1.6 3.4.8 3.4 2.5 0 .7-.8 1.2-1.7 1.2-.8 0-1.4-.3-1.8-.9" /><path d="M14.5 10h4M16.5 8l2 2-2 2" /></>, 1.4);
export const IconWallet = make("0 0 20 20", <><path d="M3 6h13v10H3z" /><path d="M3 6l10-3v3" /><path d="M12 11h4" /></>, 1.5);
export const IconPen = make("0 0 20 20", <><path d="M13 3l4 4-9 9-4.5 1 1-4.5z" /><path d="M11 5l4 4" /></>, 1.5);
export const IconLock = make("0 0 16 16", <><rect x="3" y="7" width="10" height="7" rx="1" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></>, 1.5);

// ---- preset / business icons (48×48, engraved) ----
export const IconGlass = make("0 0 48 48", <><path d="M10 8h28l-4 18a10 10 0 0 1-20 0z" /><path d="M24 36v6M16 42h16M12 16h24" /></>);
export const IconUmbrella = make("0 0 48 48", <><path d="M6 24a18 18 0 0 1 36 0c-2-2-4-2-6 0-2-2-4-2-6 0-2-2-4-2-6 0-2-2-4-2-6 0-2-2-4-2-6 0-2-2-4-2-6 0z" /><path d="M24 6v-2M24 24v14a4 4 0 0 1-8 0" /></>);
export const IconTruck = make("0 0 48 48", <><path d="M4 14h26v20H4zM30 20h8l6 7v7H30" /><circle cx="12" cy="36" r="4" /><circle cx="36" cy="36" r="4" /><path d="M9 20h16M9 25h10" /></>);
export const IconCloche = make("0 0 48 48", <><path d="M6 34h36M9 34a15 15 0 0 1 30 0" /><path d="M24 15v4M21 15h6" /><path d="M4 40h40" /></>);
export const IconFuelPump = make("0 0 48 48", <><path d="M8 42V8h20v34M4 42h28" /><path d="M12 13h12v9H12z" /><path d="M28 18h5l5 5v13a3 3 0 0 1-6 0v-6h-4" /><path d="M38 23l-4-6" /></>);
export const IconBlankForm = make("0 0 48 48", <><path d="M30 6l8 8-22 22-10 2 2-10z" /><path d="M26 10l8 8" /><path d="M6 44h36" /></>);
export const IconHammer = make("0 0 48 48", <><path d="M22 10l12-4 6 6-4 12" /><path d="M28 16L8 36a3 3 0 0 0 4 4l20-20" /></>);

// ---- peril / market category icons (24×24) ----
export const IconSun = make("0 0 24 24", <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>, 1.4);
export const IconCloudRain = make("0 0 24 24", <><path d="M7 15.5a4 4 0 0 1-.3-8 5.5 5.5 0 0 1 10.6 1.3A3.4 3.4 0 0 1 17 15.5z" /><path d="M8 18.5l-1 2.5M12 18.5l-1 2.5M16 18.5l-1 2.5" /></>, 1.4);
export const IconSnowflake = make("0 0 24 24", <><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6" /><path d="M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" /></>, 1.4);
export const IconBolt = make("0 0 24 24", <path d="M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z" />, 1.4);
export const IconWave = make("0 0 24 24", <><path d="M2.5 9c2.4-2 4.6-2 7 0s4.6 2 7 0 4.6-2 5 0" /><path d="M2.5 14c2.4-2 4.6-2 7 0s4.6 2 7 0 4.6-2 5 0" /><path d="M2.5 19c2.4-2 4.6-2 7 0s4.6 2 7 0 4.6-2 5 0" /></>, 1.4);
export const IconStorm = make("0 0 24 24", <><path d="M3 5h15M5 9h14M7 13h10M9 17h7M11 21h3" /></>, 1.4);
export const IconBall = make("0 0 24 24", <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18M5.6 5.6c3 2.6 3 10.2 0 12.8M18.4 5.6c-3 2.6-3 10.2 0 12.8" /></>, 1.3);
export const IconBarrel = make("0 0 24 24", <><path d="M6 3h12c1.3 3 1.3 15 0 18H6C4.7 18 4.7 6 6 3z" /><path d="M5.2 8h13.6M5.2 16h13.6" /></>, 1.4);
export const IconFlame = make("0 0 24 24", <path d="M12 21.5c-4 0-6.5-2.7-6.5-6.3 0-3.7 3-5.6 3.6-9.7 2.4 1.5 3.4 3.7 3.2 6 1-.6 1.8-1.7 2-3.2 2 1.8 3.2 4.2 3.2 6.9 0 3.6-2.5 6.3-5.5 6.3z" />, 1.4);
export const IconPick = make("0 0 24 24", <><path d="M4 9c4.5-4 11.5-4 16 0" /><path d="M12 6.3L6 21" /></>, 1.4);
export const IconBank = make("0 0 24 24", <><path d="M3 9.5L12 4l9 5.5z" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18" /></>, 1.4);
export const IconChartUp = make("0 0 24 24", <><path d="M3 20.5h18M4 16l5-5 4 3 7-8" /><path d="M15 6h5v5" /></>, 1.4);
export const IconCoin = make("0 0 24 24", <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /></>, 1.4);
export const IconDots = make("0 0 24 24", <><circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18" cy="12" r="1" fill="currentColor" /></>, 1.4);
export const IconGrid = make("0 0 24 24", <><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></>, 1.4);

const PERIL_ICONS = {
  // perils (lib/client/format.ts PERIL ids)
  heat: IconSun, cold: IconSnowflake, rain: IconCloudRain, game: IconBall, oil: IconBarrel, gas: IconFuelPump,
  fed: IconBank, cpi: IconChartUp, crypto: IconCoin, other: IconDots, snow: IconSnowflake, power: IconBolt,
  water: IconWave, quake: IconWarning, storm: IconStorm, natgas: IconFlame, metals: IconPick,
  // market explorer categories
  all: IconGrid, disaster: IconWave, games: IconBall, energy: IconBarrel, commodities: IconFlame, rates: IconBank,
} as const;

/** Icon for a peril id or market category id ("rain", "game", "energy"…). Unknown ids get the dots icon. */
export function PerilIcon({ peril, size = 16, className }: { peril: string; size?: number; className?: string }) {
  const I = (PERIL_ICONS as Record<string, (p: P) => React.JSX.Element>)[peril] ?? IconDots;
  return <I size={size} className={className} />;
}
