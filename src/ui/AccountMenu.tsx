"use client";

import { useEffect, useId, useRef, useState } from "react";
import { logoutAction } from "@/web/auth-actions";

export type AccountMenuProps = {
  emailDisplay: string;
  initial: string;
};

export function AccountMenu({ emailDisplay, initial }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const btnId = useId();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="n-account-menu" ref={rootRef} data-testid="account-menu">
      <button
        ref={btnRef}
        type="button"
        id={btnId}
        className="n-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid="account-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="n-account-avatar" aria-hidden>
          {initial}
        </span>
        <span className="n-account-email">{emailDisplay}</span>
        <span className="n-account-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="n-account-dropdown"
          aria-labelledby={btnId}
          data-testid="account-menu-dropdown"
        >
          <a
            role="menuitem"
            href="/dashboard"
            className="n-account-item"
            data-testid="account-menu-purchases"
            onClick={() => setOpen(false)}
          >
            My Purchases
          </a>
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="n-account-item n-account-item--button"
              data-testid="account-menu-sign-out"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
