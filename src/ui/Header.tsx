"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ButtonLink } from "./Button.js";
import { IconButton } from "./IconButton.js";
import { IconClose, IconMenu } from "./icons.js";

const NAV = [
  { href: "/", label: "Home", testId: "nav-home" },
  { href: "/dashboard", label: "My purchases", testId: "nav-dashboard" },
  { href: "/notices", label: "Notices", testId: "nav-notices" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="n-header" data-testid="app-header">
      <div className="n-header__inner">
        <a href="/" className="n-wordmark" data-testid="nav-home">
          <span className="n-wordmark__mark" aria-hidden>
            N
          </span>
          <span>Nobu</span>
        </a>

        <nav className="n-nav-desktop" aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-testid={item.testId === "nav-home" ? "nav-home-desktop" : item.testId}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="n-header__actions">
          <ButtonLink
            href="/purchases/new"
            className="n-header__cta-desktop"
            size="sm"
            data-testid="nav-add"
          >
            Track a purchase
          </ButtonLink>
          <IconButton
            className="n-menu-toggle"
            label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={panelId}
            data-testid="nav-menu-toggle"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconClose /> : <IconMenu />}
          </IconButton>
        </div>
      </div>

      <div
        id={panelId}
        className="n-mobile-panel"
        data-open={open ? "true" : "false"}
        data-testid="nav-mobile-panel"
      >
        <nav aria-label="Mobile">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-testid={`${item.testId}-mobile`}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
          <ButtonLink
            href="/purchases/new"
            block
            data-testid="nav-add-mobile"
          >
            Track a purchase
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
