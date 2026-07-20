"use client";

import { useMemo, useState } from "react";
import {
  archivePurchaseAction,
  deletePurchaseAction,
  restorePurchaseAction,
  setOutcomeAction,
} from "@/web/lifecycle-actions";
import {
  USER_OUTCOME_DISCLOSURE,
  USER_OUTCOME_LABELS,
  type LifecycleTab,
  type PurchaseListItem,
  type UserOutcome,
  UserOutcome as UserOutcomeEnum,
} from "@/web/purchase-lifecycle";
import { formatUsd, statusLabel, statusTone } from "@/web/status-copy";
import { Button, ButtonLink, Card, EmptyState, StatusBadge } from "@/ui";
import { OkxMarketplaceLink } from "@/ui/OkxMarketplaceLink";

type Props = {
  signedIn: boolean;
  items: PurchaseListItem[];
  counts: Record<LifecycleTab, number>;
  initialTab?: LifecycleTab;
};

const TABS: { id: LifecycleTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "history", label: "History" },
  { id: "archived", label: "Archived" },
];

const OUTCOMES = Object.values(UserOutcomeEnum) as UserOutcome[];

export function MyPurchasesClient({
  signedIn,
  items,
  counts,
  initialTab = "active",
}: Props) {
  const [tab, setTab] = useState<LifecycleTab>(initialTab);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<PurchaseListItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<PurchaseListItem | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<UserOutcome | "">("");

  const visible = useMemo(
    () => items.filter((i) => i.lifecycle === tab),
    [items, tab],
  );

  function emptyCopy(t: LifecycleTab): { title: string; description: string } {
    switch (t) {
      case "active":
        return {
          title: "No active monitors yet",
          description:
            "Add a purchase on the website or use Nobu with OKX.AI.",
        };
      case "history":
        return {
          title: "No history yet",
          description:
            "Purchases move here when monitoring ends or the 14-day window expires. They stay saved to your account.",
        };
      case "archived":
        return {
          title: "Nothing archived",
          description:
            "Archive hides a purchase from Active and History without deleting its evidence.",
        };
    }
  }

  return (
    <div className="n-purchases-lifecycle" data-testid="purchases-lifecycle">
      <div className="n-tabs" role="tablist" aria-label="Purchase lists" data-testid="purchase-tabs">
        {TABS.map((t) => {
          const selected = tab === t.id;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`n-tab${selected ? " n-tab--active" : ""}`}
              data-testid={`tab-${t.id}`}
              onClick={() => {
                setTab(t.id);
                setMenuId(null);
              }}
            >
              {t.label}
              {signedIn || t.id !== "archived" ? (
                <span className="n-tab__count" data-testid={`tab-count-${t.id}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!signedIn && tab === "archived" ? (
        <Card>
          <EmptyState
            title="Archive needs an account"
            description="Sign in to archive purchases and keep history across devices."
            action={
              <ButtonLink href="/sign-in" data-testid="archive-sign-in">
                Sign in
              </ButtonLink>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={emptyCopy(tab).title}
            description={emptyCopy(tab).description}
            action={
              tab === "active" ? (
                <div className="n-hero__actions" style={{ justifyContent: "center" }}>
                  <ButtonLink href="/purchases/new" data-testid="empty-dashboard-cta">
                    Monitor a purchase
                  </ButtonLink>
                  <OkxMarketplaceLink
                    variant="secondary"
                    data-testid="empty-okx-cta"
                  />
                </div>
              ) : undefined
            }
          />
          <p className="visually-hidden" data-testid={`empty-${tab}`}>
            Empty {tab}
          </p>
        </Card>
      ) : (
        <ul className="n-purchase-list" data-testid="purchases-table">
          {visible.map((p) => (
            <li key={p.id} data-testid="purchase-row">
              <div className="n-purchase-card n-purchase-card--lifecycle">
                <div className="n-purchase-card__top">
                  <StatusBadge
                    label={statusLabel(p.status)}
                    tone={statusTone(p.status)}
                  />
                  <span className="muted n-purchase-card__date">
                    {p.purchase_date}
                  </span>
                </div>
                <p className="n-purchase-card__title n-break">
                  {p.product_title || p.target_product_url}
                </p>
                <p className="n-purchase-card__price">
                  You paid {formatUsd(p.purchase_price)}
                </p>
                {p.latest_observed_price != null ? (
                  <p className="n-purchase-card__meta muted">
                    Latest observed {formatUsd(p.latest_observed_price)}
                  </p>
                ) : null}
                {p.possible_difference != null && p.possible_difference > 0 ? (
                  <p
                    className="n-purchase-card__diff"
                    data-testid="possible-difference"
                  >
                    Possible difference {formatUsd(p.possible_difference)}
                  </p>
                ) : null}
                {p.monitoring_deadline ? (
                  <p className="n-purchase-card__meta muted">
                    {p.lifecycle === "history"
                      ? `Ended ${p.monitoring_deadline}`
                      : `Watch until ${p.monitoring_deadline}`}
                  </p>
                ) : null}
                {p.user_outcome ? (
                  <p
                    className="n-purchase-card__outcome"
                    data-testid="user-outcome"
                  >
                    {USER_OUTCOME_LABELS[p.user_outcome]}
                    <span className="n-purchase-card__outcome-note">
                      {" "}
                      · {USER_OUTCOME_DISCLOSURE}
                    </span>
                  </p>
                ) : null}
                {signedIn && p.email_alerts_enabled && p.fingerprint_id ? (
                  <p
                    className="n-purchase-card__meta muted"
                    data-testid="email-alerts-on"
                  >
                    Nobu is watching · email alerts on
                  </p>
                ) : null}
                {!signedIn && p.fingerprint_id ? (
                  <p
                    className="n-purchase-card__meta muted"
                    data-testid="email-alerts-guest"
                  >
                    Sign in to receive automatic email alerts
                  </p>
                ) : null}

                <div className="n-purchase-card__actions">
                  <ButtonLink
                    href={`/purchases/${p.id}`}
                    size="sm"
                    variant="secondary"
                    data-testid="view-details"
                  >
                    View details
                  </ButtonLink>

                  {signedIn ? (
                    <div className="n-card-menu">
                      <button
                        type="button"
                        className="n-card-menu__trigger"
                        aria-haspopup="menu"
                        aria-expanded={menuId === p.id}
                        data-testid="purchase-menu"
                        onClick={() =>
                          setMenuId((id) => (id === p.id ? null : p.id))
                        }
                      >
                        Actions
                      </button>
                      {menuId === p.id ? (
                        <div
                          className="n-card-menu__dropdown"
                          role="menu"
                          data-testid="purchase-menu-dropdown"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="n-card-menu__item"
                            data-testid="menu-outcome"
                            onClick={() => {
                              setOutcomeFor(p);
                              setSelectedOutcome(p.user_outcome ?? "");
                              setMenuId(null);
                            }}
                          >
                            What happened with Target?
                          </button>
                          {tab === "archived" ? (
                            <form action={restorePurchaseAction}>
                              <input type="hidden" name="purchase_id" value={p.id} />
                              <button
                                type="submit"
                                role="menuitem"
                                className="n-card-menu__item"
                                data-testid="menu-restore"
                              >
                                Restore
                              </button>
                            </form>
                          ) : (
                            <form action={archivePurchaseAction}>
                              <input type="hidden" name="purchase_id" value={p.id} />
                              <input type="hidden" name="tab" value={tab} />
                              <button
                                type="submit"
                                role="menuitem"
                                className="n-card-menu__item"
                                data-testid="menu-archive"
                              >
                                Archive
                              </button>
                            </form>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            className="n-card-menu__item n-card-menu__item--danger"
                            data-testid="menu-delete"
                            onClick={() => {
                              setDeleteFor(p);
                              setMenuId(null);
                            }}
                          >
                            Delete permanently
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Outcome modal */}
      {outcomeFor ? (
        <div
          className="n-modal-backdrop"
          role="presentation"
          data-testid="outcome-modal"
          onClick={() => setOutcomeFor(null)}
        >
          <div
            className="n-modal n-modal--sheet"
            role="dialog"
            aria-labelledby="outcome-heading"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="outcome-heading" className="n-modal__title">
              What happened with Target?
            </h2>
            <p className="n-modal__disclosure" data-testid="outcome-disclosure">
              This is saved as your report and is not verified by Target.
            </p>
            <form action={setOutcomeAction} className="n-outcome-form">
              <input type="hidden" name="purchase_id" value={outcomeFor.id} />
              <input type="hidden" name="tab" value={tab} />
              <fieldset className="n-outcome-options">
                <legend className="visually-hidden">Outcome</legend>
                {OUTCOMES.map((o) => (
                  <label key={o} className="n-outcome-option">
                    <input
                      type="radio"
                      name="outcome"
                      value={o}
                      checked={selectedOutcome === o}
                      onChange={() => setSelectedOutcome(o)}
                      data-testid={`outcome-${o}`}
                    />
                    <span>{USER_OUTCOME_LABELS[o]}</span>
                  </label>
                ))}
              </fieldset>
              <p className="n-modal__note muted">{USER_OUTCOME_DISCLOSURE}</p>
              <div className="n-modal__actions">
                <Button
                  type="submit"
                  disabled={!selectedOutcome}
                  data-testid="save-outcome"
                >
                  Save outcome
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="cancel-outcome"
                  onClick={() => setOutcomeFor(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Delete confirmation */}
      {deleteFor ? (
        <div
          className="n-modal-backdrop"
          role="presentation"
          data-testid="delete-modal"
          onClick={() => setDeleteFor(null)}
        >
          <div
            className="n-modal n-modal--sheet"
            role="dialog"
            aria-labelledby="delete-heading"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-heading" className="n-modal__title">
              Delete this purchase?
            </h2>
            <p className="n-modal__body">
              This permanently removes the purchase and its Nobu history. This
              cannot be undone.
            </p>
            <form action={deletePurchaseAction} className="n-modal__actions">
              <input type="hidden" name="purchase_id" value={deleteFor.id} />
              <input type="hidden" name="tab" value={tab} />
              <input type="hidden" name="confirm" value="delete" />
              <Button
                type="submit"
                variant="danger"
                data-testid="confirm-delete"
              >
                Delete permanently
              </Button>
              <Button
                type="button"
                variant="secondary"
                data-testid="cancel-delete"
                onClick={() => setDeleteFor(null)}
              >
                Cancel
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
