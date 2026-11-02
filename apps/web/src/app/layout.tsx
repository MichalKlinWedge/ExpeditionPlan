import type { Metadata } from "next";
import { Bitter, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// `latin-ext` — polskie znaki (ą, ę, ł…) z tej samej czcionki, a nie z zastępczej.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

// Nagłówki: szeryfowa czcionka „z mapy” (motyw w globals.css).
const bitter = Bitter({
  variable: "--font-bitter",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Expedition Planner",
  description: "Planowanie wyjazdów z pomocą AI",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} ${bitter.variable} h-full antialiased`}
    >
      {/* Rozszerzenia przeglądarki (np. ColorZilla: `cz-shortcut-listen`) dopisują atrybuty do <body>
          przed hydratacją — ostrzeżenie dotyczy tylko atrybutów tego elementu, nie jego zawartości. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
