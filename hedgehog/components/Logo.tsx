import { Seal } from "./Engraving";

// Hedgehog mark: the red engraved hedgehog seal (no ring text at logo size).
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="seal-logo" style={{ width: size, height: size }} aria-hidden="true">
      <Seal withText={false} fill="var(--bg)" />
    </span>
  );
}
