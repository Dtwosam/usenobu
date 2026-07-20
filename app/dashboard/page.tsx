import { prepareWebDatabase } from "@/web/prepare-db";
import { getEffectivePurchaseOwner } from "@/auth/service";
import { listPurchasesForLifecycle } from "@/web/purchase-lifecycle-service";
import type { LifecycleTab } from "@/web/purchase-lifecycle";
import { ButtonLink, IconLock, PageHeader } from "@/ui";
import { MyPurchasesClient } from "./MyPurchasesClient";

function parseTab(raw: string | undefined): LifecycleTab {
  if (raw === "history" || raw === "archived" || raw === "active") return raw;
  return "active";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const db = await prepareWebDatabase();
  const effective = await getEffectivePurchaseOwner({
    db,
    createGuestIfMissing: true,
  });
  const { items, counts } = await listPurchasesForLifecycle({
    owner_ref: effective.owner_ref,
    kind: effective.kind,
    db,
  });
  const signedIn = effective.kind === "account";
  const claimed = sp.claimed ? Number(sp.claimed) : 0;
  const showClaim = signedIn && Number.isFinite(claimed) && claimed > 0;
  const initialTab = parseTab(sp.tab);

  return (
    <div className="n-screen">
      <PageHeader
        title="My purchases"
        description="Active monitors, history and archived purchases."
        actions={
          <ButtonLink href="/purchases/new" size="sm">
            Monitor a purchase
          </ButtonLink>
        }
      />

      <p className="n-privacy-reassurance" data-testid="privacy-reassurance">
        <IconLock className="n-privacy-reassurance__icon" width={14} height={14} />
        <span>Only you can see the purchases saved to your Nobu account.</span>
      </p>

      {showClaim ? (
        <div
          className="n-claim-success"
          data-testid="claim-success"
          role="status"
        >
          <h2 className="n-claim-success__title">
            Your purchases are now saved to your account
          </h2>
          <p className="n-claim-success__body">
            We moved the purchases from this browser into your Nobu account.
          </p>
          <p className="n-claim-success__count" data-testid="claim-count">
            {claimed === 1
              ? "1 purchase saved"
              : `${claimed} purchases saved`}
          </p>
          <ButtonLink
            href="/dashboard"
            size="sm"
            data-testid="claim-view-purchases"
          >
            View My Purchases
          </ButtonLink>
        </div>
      ) : null}

      {!signedIn ? (
        <div className="n-guest-notice" data-testid="guest-notice">
          <p className="n-guest-notice__text">
            You’re using Nobu as a guest. Sign in to keep your purchases across
            devices and recover them if you clear this browser.
          </p>
          <div className="n-guest-notice__actions">
            <ButtonLink
              href="/sign-in"
              size="sm"
              data-testid="guest-notice-sign-in"
            >
              Sign in
            </ButtonLink>
            <a
              href="/notices#guest-purchases"
              className="n-text-action"
              data-testid="guest-notice-learn"
            >
              Learn how guest purchases work
            </a>
          </div>
        </div>
      ) : null}

      {sp.outcome_saved === "1" ? (
        <p className="n-inline-status" role="status" data-testid="outcome-saved">
          Your report was saved. It is not verified by Target.
        </p>
      ) : null}
      {sp.deleted === "1" ? (
        <p className="n-inline-status" role="status" data-testid="deleted-status">
          Purchase deleted.
        </p>
      ) : null}

      <MyPurchasesClient
        key={`${initialTab}-${items.map((i) => i.id + i.lifecycle).join(",")}`}
        signedIn={signedIn}
        items={items}
        counts={counts}
        initialTab={initialTab}
      />

      {!signedIn && items.length === 0 ? (
        <p className="visually-hidden" data-testid="empty-dashboard">
          No purchases yet.
        </p>
      ) : null}
    </div>
  );
}
