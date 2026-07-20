import { listPurchases } from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { getEffectivePurchaseOwner } from "@/auth/service";
import { formatUsd, statusLabel, statusTone } from "@/web/status-copy";
import {
  ButtonLink,
  Card,
  EmptyState,
  IconLock,
  PageHeader,
  StatusBadge,
} from "@/ui";

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
  const purchases = listPurchases({ owner_ref: effective.owner_ref });
  const signedIn = effective.kind === "account";
  const claimed = sp.claimed ? Number(sp.claimed) : 0;
  const showClaim =
    signedIn && Number.isFinite(claimed) && claimed > 0;

  return (
    <div className="n-screen">
      <PageHeader
        title="Your purchases"
        description="Purchases you’re watching for a lower observed retailer price."
        actions={
          purchases.length > 0 ? (
            <ButtonLink href="/purchases/new" size="sm">
              Track a purchase
            </ButtonLink>
          ) : undefined
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

      {purchases.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing being watched yet"
            description="Add a recent supported purchase and confirm the exact product to begin. Currently: eligible Target.com purchases."
            action={
              <ButtonLink href="/purchases/new" data-testid="empty-dashboard-cta">
                Track a purchase
              </ButtonLink>
            }
          />
          <p className="visually-hidden" data-testid="empty-dashboard">
            No purchases yet.
          </p>
        </Card>
      ) : (
        <ul className="n-purchase-list" data-testid="purchases-table">
          {purchases.map((p) => {
            const status = String(p.status);
            return (
              <li key={String(p.id)}>
                <a
                  className="n-purchase-card"
                  href={`/purchases/${String(p.id)}`}
                  data-testid="purchase-row"
                >
                  <div className="n-purchase-card__top">
                    <StatusBadge
                      label={statusLabel(status)}
                      tone={statusTone(status)}
                    />
                    <span className="muted n-purchase-card__date">
                      {String(p.purchase_date)}
                    </span>
                  </div>
                  <p className="n-purchase-card__title n-break">
                    {String(p.target_product_url)}
                  </p>
                  <p className="n-purchase-card__price">
                    You paid {formatUsd(String(p.purchase_price))}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
