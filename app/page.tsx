import Link from "next/link";
export default function Home() {
  return (
    <main className="narrow">
      <h1>Hedgehog</h1>
      <p className="big">“Your drink’s on us if the Spurs lose.”</p>
      <p>Austin bars, coffee carts and food trucks type one sentence and get a promo they can sell in 30 seconds. It is priced from Gemini’s live prediction-market book and hedged on Gemini before the first sale. Customers’ refunds sit in a Solana escrow and pay out automatically as dollars the customer owns.</p>
      <div className="row"><Link className="btn" href="/merchant">Merchant console</Link><Link className="btn secondary" href="/w">My receipts</Link></div>
      <p className="footer">Demo: refunds are devnet test USDC. Hedges are Gemini prediction-market contracts.</p>
    </main>
  );
}
