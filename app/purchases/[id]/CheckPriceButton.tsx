"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/ui";

function SubmitControl() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      block
      loading={pending}
      loadingLabel="Checking the confirmed product…"
      data-testid="run-check"
      disabled={pending}
      disabledReason="Checking the confirmed product…"
    >
      Check price now
    </Button>
  );
}

/** Primary manual check control — loading disables double-submit. */
export function CheckPriceButton({
  purchaseId,
  action,
}: {
  purchaseId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} data-testid="run-check-form">
      <input type="hidden" name="purchase_id" value={purchaseId} />
      <SubmitControl />
    </form>
  );
}
