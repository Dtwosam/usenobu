import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Footer } from "@/ui/Footer";
import { Header } from "@/ui/Header";
import { prepareWebDatabase } from "@/web/prepare-db";
import { getAuthenticatedAccount } from "@/auth/service";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nobu — Catch price drops after you buy",
  description:
    "Nobu is a post-purchase monitoring agent that watches the exact product you bought and alerts you when a safely matched lower price may give you an opportunity to request the difference from the retailer.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let auth: {
    signedIn: boolean;
    emailDisplay?: string;
    initial?: string;
  } | null = null;
  try {
    const db = await prepareWebDatabase();
    const account = await getAuthenticatedAccount(db);
    if (account) {
      auth = {
        signedIn: true,
        emailDisplay: account.email_display,
        initial: account.initial,
      };
    } else {
      auth = { signedIn: false };
    }
  } catch {
    auth = { signedIn: false };
  }

  return (
    <html lang="en" className={manrope.variable}>
      <body className={manrope.className}>
        <a className="n-skip" href="#main-content">
          Skip to content
        </a>
        <div className="n-shell">
          <Header auth={auth} />
          <main id="main-content" className="n-main legacy-main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
