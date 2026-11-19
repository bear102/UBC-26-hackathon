// Hedgehog mark: a shield-shaped body with quills — "protection with spikes".
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="var(--brand)" />
      <g fill="var(--brand-ink)">
        <path d="M8 27c0-8 5.5-14 13-14 6 0 10.5 4 11.5 9.5L35 24l-2.2 1.2c-.6 3-3.4 4.8-7 4.8H11a3 3 0 0 1-3-3z" opacity=".95" />
      </g>
      <g stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 21l-2.5-3.5M17 18l-1.2-4.2M21.5 17l.2-4.3M25.5 18l1.8-3.8" />
      </g>
      <circle cx="29" cy="22.5" r="1.3" fill="var(--brand)" />
    </svg>
  );
}
