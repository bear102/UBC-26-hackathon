// POST { owner, contractId, side, contracts, businessId } -> { positionId, txBase64, network, position }
// Builds the buy tx for the owner's wallet to sign (devnet mock venue by default; VENUE=dflow for mainnet).
import { NextResponse } from "next/server";
import { z } from "zod";
import { getVenue, defaultGetContract, VenueError } from "@/lib/venue";
import { errorResponse } from "@/lib/venue/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  owner: z.string().min(32).max(44),
  contractId: z.string().min(1),
  side: z.enum(["yes", "no"]),
  contracts: z.number().int().min(1).max(10_000),
  businessId: z.string().min(1).default("unknown"),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "bad_request" }, { status: 400 });
    const b = parsed.data;
    const contract = await defaultGetContract(b.contractId);
    if (!contract) throw new VenueError(`unknown contract ${b.contractId}`, 404, "not_found");
    const venue = getVenue();
    if (!contract.tradable) throw new VenueError(`${contract.venue} contracts are read-only context in Hedgehog (not buyable)`, 400, "not_tradable");
    if (venue.id === "dflow" && contract.venue !== "kalshi") throw new VenueError("the mainnet DFlow venue only sells Kalshi outcome tokens; Gemini-priced tokens are issued on devnet", 400, "not_tradable");
    const { position, txBase64 } = await venue.buildBuyTx({ owner: b.owner, contract, side: b.side, contracts: b.contracts, businessId: b.businessId });
    return NextResponse.json({ positionId: position.id, txBase64, network: venue.network, position });
  } catch (e) {
    return errorResponse(e);
  }
}
