"use client";

import { useState, useTransition } from "react";
import { confirmMagicLinkAction } from "@/web/auth-actions";
import { Button, Card } from "@/ui";

type Props = {
  token: string;
  emailHint: string;
};

export function VerifyConfirmClient({ token, emailHint }: Props) {
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  function onConfirm() {
    if (pending || submitted) return;
    setSubmitted(true);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      await confirmMagicLinkAction(fd);
    });
  }

  return (
    <Card className="n-signin-card n-signin-card--center" data-testid="verify-confirm-card">
      <h1 className="n-signin-title">Continue signing in</h1>
      <p className="n-signin-support">
        Confirm below to securely sign in to Nobu.
      </p>
      <p className="n-signin-secondary-copy" data-testid="verify-email-hint">
        Link for {emailHint}
      </p>
      <div className="n-signin-actions">
        <Button
          type="button"
          className="n-signin-primary"
          data-testid="verify-continue"
          disabled={pending || submitted}
          aria-busy={pending || undefined}
          onClick={onConfirm}
        >
          {pending || submitted ? (
            <span className="n-signin-loading">
              <span className="n-spinner" aria-hidden />
              Signing you in…
            </span>
          ) : (
            "Continue signing in"
          )}
        </Button>
        <a
          className="n-btn n-btn--secondary n-signin-secondary"
          href="/sign-in"
          data-testid="verify-cancel"
        >
          Cancel
        </a>
      </div>
    </Card>
  );
}
