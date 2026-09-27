export const dynamic = "force-static";

export default function DisclaimerPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-10 text-slate-100">
      <h1 className="text-3xl font-semibold">Disclaimer</h1>
      <p className="mt-4 text-slate-300">
        Scalp Signal Pro provides probabilistic analytics for educational and research purposes only. It is not
        financial, investment, legal, or tax advice.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-300">
        <li>No indicator, model, or algorithm can guarantee profit or 99-100% accuracy.</li>
        <li>You are fully responsible for all trade decisions and risk management.</li>
        <li>Past performance and backtests do not guarantee future results.</li>
      </ul>
    </main>
  );
}
