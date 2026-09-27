export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-10 text-slate-100">
      <h1 className="text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-4 text-slate-300">
        This MVP stores only the data needed to operate core features: profile handle, preferences, and alert/backtest
        records.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-300">
        <li>We do not store exchange API keys in this MVP.</li>
        <li>Telegram settings are used only for sending alerts you enable.</li>
        <li>You may delete your local session by signing out.</li>
      </ul>
    </main>
  );
}
