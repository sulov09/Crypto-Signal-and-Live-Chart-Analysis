import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scalp Signal Pro | Crypto Scanner",
  description:
    "Real-time crypto scalp opportunity scanner with probabilistic BUY/SELL/WAIT signals, live chart analysis, alerts, and backtesting.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_40%),radial-gradient(circle_at_80%_20%,_rgba(168,85,247,0.12),_transparent_35%)]">
          <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-8">
              <Link href="/" className="text-sm font-semibold tracking-wide text-cyan-300">
                Scalp Signal Pro
              </Link>
              <nav className="flex items-center gap-4 text-xs text-slate-300">
                <Link href="/disclaimer" className="hover:text-cyan-300">
                  Disclaimer
                </Link>
                <Link href="/privacy" className="hover:text-cyan-300">
                  Privacy
                </Link>
                <Link href="/terms" className="hover:text-cyan-300">
                  Terms
                </Link>
              </nav>
            </div>
          </header>
          {children}
          <footer className="border-t border-slate-800/90 py-6 text-center text-xs text-slate-400">
            Educational analytics only • No guaranteed outcomes • Trade responsibly
          </footer>
        </div>
      </body>
    </html>
  );
}
