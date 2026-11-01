import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ExpeditionPlan — Planner Hub",
  description: "Planowanie wyjazdów z pomocą AI",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Rozszerzenia przeglądarki (np. ColorZilla: `cz-shortcut-listen`) dopisują atrybuty do <body>
          przed hydratacją — ostrzeżenie dotyczy tylko atrybutów tego elementu, nie jego zawartości. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
