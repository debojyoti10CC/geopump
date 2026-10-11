import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "geopump — Geo Duels",
  description: "Two friends. One real location. 30 seconds to guess. Play Geo Duels with Solana devnet test SOL.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
