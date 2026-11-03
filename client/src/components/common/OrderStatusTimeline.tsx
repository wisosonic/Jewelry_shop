import type { OrderStatus } from "../../types";
import { CheckIcon, CloseIcon } from "../icons/Icon";

const STEPS: OrderStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"];
const STEP_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/**
 * Visual progress stepper for an order's fulfillment status, replacing a
 * plain static status pill on `OrderHistory.tsx`/`OrderDetail.tsx`.
 * `CANCELLED` is a terminal state outside the normal progression, so it's
 * rendered as its own row rather than a 5th step.
 */
export function OrderStatusTimeline({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-red-600" role="status">
        <CloseIcon className="h-4 w-4" /> Order cancelled
      </div>
    );
  }

  const currentIndex = STEPS.indexOf(status);

  return (
    <ol className="flex items-center" aria-label="Order status" role="list">
      {STEPS.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <li key={step} className="flex flex-1 items-center last:flex-none" aria-current={isCurrent ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isComplete || isCurrent ? "bg-brand-600 text-white" : "bg-brand-100 text-ink-900/40"
                }`}
              >
                {isComplete ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={`whitespace-nowrap text-[11px] ${isCurrent ? "font-semibold text-ink-900" : "text-ink-900/50"}`}>
                {STEP_LABELS[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className={`mx-1 h-0.5 flex-1 ${isComplete ? "bg-brand-600" : "bg-brand-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
