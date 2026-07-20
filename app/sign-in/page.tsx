import { isAuthTestMode } from "@/auth/config";
import { SignInClient } from "./SignInClient";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const err = sp.error;
  const initialError =
    err === "expired" || err === "used" || err === "invalid" ? err : null;

  return (
    <div className="n-signin-page" data-testid="sign-in-page">
      <SignInClient
        initialError={initialError}
        testMode={isAuthTestMode()}
      />
    </div>
  );
}
