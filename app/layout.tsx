import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Footer } from "@/ui/Footer";
import { Header } from "@/ui/Header";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nobu — AI agent for post-purchase price monitoring",
  description:
    "Nobu is an AI agent that monitors supported purchases after checkout and alerts you when a lower retailer price may be available. Currently supports eligible Target.com purchases.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className={manrope.className}>
        <a className="n-skip" href="#main-content">
          Skip to content
        </a>
        <div className="n-shell">
          <Header />
          <main id="main-content" className="n-main legacy-main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
