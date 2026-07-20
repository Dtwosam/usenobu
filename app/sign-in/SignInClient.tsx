"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import {
  completeTestLoginAction,
  requestLoginAction,
} from "@/web/auth-actions";
import { Button, Card, Input } from "@/ui";

type Props = {
  initialError?: string | null;
  testMode?: boolean;
};

function isClientValidEmail(value: string): boolean {
  const t = value.trim();
  if (!t || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export function SignInClient({ initialError, testMode }: Props) {
  const emailId = useId();
  const errorId = useId();
  const liveId = useId();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [state, setState] = useState<"form" | "sent" | "invalid">(
    initialError ? "invalid" : "form",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resendAfter, setResendAfter] = useState(0);
  const [pending, startTransition] = useTransition();

  const emailValid = useMemo(() => isClientValidEmail(email), [email]);
  const showFieldError = touched && email.length > 0 && !emailValid;

  useEffect(() => {
    if (resendAfter <= 0) return;
    const t = setInterval(() => {
      setResendAfter((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [resendAfter]);

  useEffect(() => {
    if (state === "invalid") {
      const el = document.getElementById("sign-in-invalid-heading");
      el?.focus();
    }
  }, [state]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!emailValid || pending) return;
    startTransition(async () => {
      setSubmitError(null);
      const fd = new FormData();
      fd.set("email", email.trim());
      const result = await requestLoginAction(fd);
      if (!result.ok) {
        if (result.error === "invalid_email") {
          setSubmitError("Enter a valid email address.");
        } else if (result.error === "rate_limited") {
          setSubmitError("Please wait a moment before requesting another link.");
          setResendAfter(45);
        } else if (result.error === "not_configured") {
          setSubmitError(
            "Sign-in is not fully configured yet. Please try again later.",
          );
        } else {
          setSubmitError("Something went wrong. Please try again.");
        }
        return;
      }
      setResendAfter(result.resend_after_seconds);
      setState("sent");
    });
  }

  function onResend() {
    if (resendAfter > 0 || pending || !emailValid) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("email", email.trim());
      const result = await requestLoginAction(fd);
      if (result.ok) {
        setResendAfter(result.resend_after_seconds);
      } else if (result.error === "rate_limited") {
        setResendAfter(45);
      }
    });
  }

  if (state === "invalid") {
    return (
      <Card className="n-signin-card" data-testid="sign-in-invalid">
        <h1
          id="sign-in-invalid-heading"
          className="n-signin-title"
          tabIndex={-1}
        >
          This sign-in link is no longer valid
        </h1>
        <p className="n-signin-support">
          Request a new secure link to continue.
        </p>
        <div className="n-signin-actions">
          <Button
            type="button"
            className="n-signin-primary"
            data-testid="sign-in-send-new"
            onClick={() => {
              setState("form");
              setSubmitError(null);
            }}
          >
            Send a new link
          </Button>
          <a
            className="n-btn n-btn--secondary n-signin-secondary"
            href="/"
            data-testid="sign-in-return"
          >
            Return to Nobu
          </a>
        </div>
      </Card>
    );
  }

  if (state === "sent") {
    return (
      <Card className="n-signin-card n-signin-card--center" data-testid="sign-in-sent">
        <div className="n-signin-mail" aria-hidden>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <h1 className="n-signin-title">Check your email</h1>
        <p className="n-signin-support" id={liveId} aria-live="polite">
          We sent a secure sign-in link to your email address.
        </p>
        <p className="n-signin-secondary-copy">
          The link expires shortly and can only be used once.
        </p>
        <div className="n-signin-actions">
          <Button
            type="button"
            variant="secondary"
            className="n-signin-secondary"
            data-testid="sign-in-resend"
            disabled={resendAfter > 0 || pending}
            onClick={onResend}
          >
            {resendAfter > 0 ? `Resend email (${resendAfter}s)` : "Resend email"}
          </Button>
          <button
            type="button"
            className="n-text-action"
            data-testid="sign-in-different-email"
            onClick={() => {
              setState("form");
              setEmail("");
              setTouched(false);
            }}
          >
            Use a different email
          </button>
          {testMode ? (
            <form action={completeTestLoginAction} className="n-signin-test">
              <input type="hidden" name="email" value={email.trim()} />
              <Button
                type="submit"
                className="n-signin-primary"
                data-testid="sign-in-test-complete"
              >
                Complete test verification
              </Button>
            </form>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="n-signin-card" data-testid="sign-in-form">
      <h1 className="n-signin-title">Sign in to Nobu</h1>
      <p className="n-signin-support">
        Keep your purchases across devices and recover them if you change
        browsers.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <label className="n-field-label" htmlFor={emailId}>
          Email address
        </label>
        <Input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          className="n-signin-input"
          aria-invalid={showFieldError || undefined}
          aria-describedby={
            showFieldError || submitError ? errorId : undefined
          }
          data-testid="sign-in-email"
        />
        {showFieldError || submitError ? (
          <p
            id={errorId}
            className="n-signin-error"
            role="alert"
            data-testid="sign-in-error"
          >
            {submitError || "Enter a valid email address."}
          </p>
        ) : null}

        <Button
          type="submit"
          className="n-signin-primary"
          disabled={!emailValid || pending}
          data-testid="sign-in-submit"
          aria-busy={pending || undefined}
        >
          {pending ? (
            <span className="n-signin-loading">
              <span className="n-spinner" aria-hidden />
              Sending secure link…
            </span>
          ) : (
            "Continue with email"
          )}
        </Button>
        <p className="visually-hidden" aria-live="polite">
          {pending ? "Sending secure link" : ""}
        </p>
      </form>
    </Card>
  );
}
