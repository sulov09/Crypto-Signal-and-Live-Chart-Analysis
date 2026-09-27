export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-10 text-slate-100">
      <h1 className="text-3xl font-semibold">Terms of Use</h1>
      <p className="mt-4 text-slate-300">
        By using this app, you agree to use it at your own risk. The service is provided "as is" without warranty of
        uptime, completeness, or profitability.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-300">
        <li>You are solely liable for trading losses or decisions based on platform output.</li>
        <li>You will comply with laws and exchange rules applicable to your jurisdiction.</li>
        <li>We may modify or discontinue MVP features at any time.</li>
      </ul>
    </main>
  );
}
