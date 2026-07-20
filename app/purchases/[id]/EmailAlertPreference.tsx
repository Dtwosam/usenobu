"use client";

import { useState, useTransition } from "react";
import { setEmailAlertPrefAction } from "@/web/alert-pref-actions";
import {
  ALERT_PREFERENCE_LABEL,
  ALERT_PREFERENCE_SUPPORT,
  alertPreferenceMaskedSupport,
  GUEST_ALERT_ACTION,
  GUEST_ALERT_CTA,
  WATCHING_BODY,
  WATCHING_HEADING,
} from "@/notifications/copy";

type Props = {
  purchaseId: string;
  signedIn: boolean;
  initialEnabled: boolean;
  maskedEmail: string | null;
  /** After confirm / while monitoring */
  showWatchingCopy: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

export function EmailAlertPreference({
  purchaseId,
  signedIn,
  initialEnabled,
  maskedEmail,
  showWatchingCopy,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <div
        className="n-alert-pref"
        data-testid="email-alert-pref"
        data-state="guest"
      >
        <p className="n-alert-pref__guest" data-testid="alert-pref-guest">
          {GUEST_ALERT_CTA}
        </p>
        <a
          className="n-btn n-btn--secondary n-btn--sm"
          href={`/sign-in?next=${encodeURIComponent(`/purchases/${purchaseId}`)}`}
          data-testid="alert-pref-sign-in"
        >
          {GUEST_ALERT_ACTION}
        </a>
      </div>
    );
  }

  function onToggle(next: boolean) {
    setEnabled(next);
    setSaveState("saving");
    startTransition(async () => {
      const result = await setEmailAlertPrefAction({
        purchaseId,
        enabled: next,
      });
      if (!result.ok) {
        setEnabled(!next);
        setSaveState("error");
        return;
      }
      setEnabled(result.enabled);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2000);
    });
  }

  const support =
    maskedEmail != null && maskedEmail.length > 0
      ? alertPreferenceMaskedSupport(maskedEmail)
      : ALERT_PREFERENCE_SUPPORT;

  const busy = pending || saveState === "saving";

  return (
    <div
      className="n-alert-pref"
      data-testid="email-alert-pref"
      data-state={
        busy ? "saving" : saveState === "error" ? "error" : enabled ? "enabled" : "disabled"
      }
    >
      {showWatchingCopy && enabled ? (
        <div className="n-alert-pref__watching" data-testid="nobu-watching">
          <h3 className="n-alert-pref__watching-title">{WATCHING_HEADING}</h3>
          <p className="muted n-alert-pref__watching-body">{WATCHING_BODY}</p>
        </div>
      ) : null}

      <div className="n-alert-pref__control">
        <label className="n-alert-pref__label" htmlFor={`email-alert-${purchaseId}`}>
          <span className="n-alert-pref__switch-wrap">
            <input
              id={`email-alert-${purchaseId}`}
              type="checkbox"
              role="switch"
              className="n-alert-pref__switch"
              checked={enabled}
              disabled={busy}
              data-testid="email-alert-switch"
              aria-checked={enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
          </span>
          <span className="n-alert-pref__text">
            <span className="n-alert-pref__title">{ALERT_PREFERENCE_LABEL}</span>
            <span className="muted n-alert-pref__support" data-testid="alert-pref-support">
              {support}
            </span>
          </span>
        </label>
      </div>

      {saveState === "saving" || pending ? (
        <p className="muted n-alert-pref__status" data-testid="alert-pref-status">
          Saving…
        </p>
      ) : null}
      {saveState === "saved" ? (
        <p className="muted n-alert-pref__status" data-testid="alert-pref-status">
          Saved
        </p>
      ) : null}
      {saveState === "error" ? (
        <p className="n-alert-pref__error" data-testid="alert-pref-status" role="alert">
          Could not save alert preference. Try again.
        </p>
      ) : null}
    </div>
  );
}
