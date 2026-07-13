import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AfterBuy — Target price-drop monitoring",
  description:
    "Monitor recent Target.com purchases for possible price drops. Third-party observed prices; Target decides.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div>
            <a href="/" data-testid="nav-home">
              AfterBuy
            </a>
            <a href="/purchases/new" data-testid="nav-add">
              Add purchase
            </a>
            <a href="/dashboard" data-testid="nav-dashboard">
              Dashboard
            </a>
            <a href="/notices" data-testid="nav-notices">
              Notices
            </a>
          </div>
          <div className="sub">
            Target.com MVP · third-party price observation · no refund guarantees
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
