/**
 * Payment provider adapter interface so a real provider (Stripe, PayPal,
 * ...) can be dropped in later without changing the orders module. Today's
 * implementation just records that payment is deferred - orders are created
 * with status PENDING and no money moves.
 */
export type PaymentIntentResult = {
  provider: string;
  status: "DEFERRED" | "SUCCEEDED" | "FAILED";
  reference?: string;
};

/** Contract every payment backend must implement to be used by the orders module. */
export interface PaymentProvider {
  createIntent(params: { orderId: string; amountCents: number; currency: string }): Promise<PaymentIntentResult>;
}

/** Placeholder provider that defers payment collection instead of charging a real processor. */
class ManualPaymentProvider implements PaymentProvider {
  /** Records the order as pending payment; performs no actual charge. */
  async createIntent({ orderId }: { orderId: string; amountCents: number; currency: string }): Promise<PaymentIntentResult> {
    console.log(`[payments] order ${orderId} created with payment deferred (no provider configured yet)`);
    return { provider: "manual", status: "DEFERRED" };
  }
}

/** Active payment provider instance used by the orders module. */
export const paymentProvider: PaymentProvider = new ManualPaymentProvider();
