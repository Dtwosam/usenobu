"use client";

import { useEffect, useState } from "react";

/** Temporary logout confirmation — does not imply guest can read account purchases. */
export function SignedOutToast() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = reduce ? 8000 : 5000;
    const t = setTimeout(() => setVisible(false), ms);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="n-signed-out-toast"
      role="status"
      aria-live="polite"
      data-testid="signed-out-toast"
    >
      You’re signed out. Your account purchases are still saved.
    </div>
  );
}
