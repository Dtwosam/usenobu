import { peekMagicLinkToken } from "@/auth/service";
import { VerifyConfirmClient } from "./VerifyConfirmClient";

export const dynamic = "force-dynamic";

/**
 * GET /auth/verify?token=...
 * Validates token format/expiry without consuming (email previews safe).
 * User must POST via "Continue signing in".
 */
export default async function AuthVerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const token = String(sp.token ?? "");
  const peeked = await peekMagicLinkToken({ rawToken: token });

  if (!peeked.ok) {
    return (
      <div className="n-signin-page" data-testid="verify-invalid-page">
        <div className="n-signin-card" data-testid="sign-in-invalid">
          <h1 className="n-signin-title" tabIndex={-1} id="verify-invalid-heading">
            This sign-in link is no longer valid
          </h1>
          <p className="n-signin-support">
            Request a new secure link to continue.
          </p>
          <div className="n-signin-actions">
            <a
              className="n-btn n-signin-primary"
              href="/sign-in"
              data-testid="sign-in-send-new"
            >
              Send a new link
            </a>
            <a
              className="n-btn n-btn--secondary n-signin-secondary"
              href="/"
              data-testid="sign-in-return"
            >
              Return to Nobu
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="n-signin-page" data-testid="verify-confirm-page">
      <VerifyConfirmClient token={token} emailHint={peeked.email_hint} />
    </div>
  );
}
