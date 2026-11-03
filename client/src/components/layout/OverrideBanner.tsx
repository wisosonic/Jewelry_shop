import { useEffect, useState } from "react";
import { fetchBusinessInfo } from "../../api/business";
import { findTodayHoliday, formatHour } from "../../lib/businessHours";

/**
 * Site-wide warning banner, shown for either of two independent triggers:
 * 1. An admin-toggled emergency/special-event override
 *    (`BusinessInfo.overrideActive`/`overrideMessage` - set from Admin ->
 *    Business info), for an unplanned closure with no pre-set date.
 * 2. A `BusinessHoliday` exception whose date is today - set in advance
 *    (e.g. "Christmas Day"), but still something a visitor arriving today
 *    needs to see before the footer, not just buried in it.
 * The manual override takes priority if both happen to be active at once.
 * Renders nothing until the fetch resolves and nothing at all when neither
 * trigger applies, so it never flashes on a normal day. Mounted once in
 * `App.tsx`, above the routed page content, so it's visible regardless of
 * which page is open.
 */
export function OverrideBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchBusinessInfo()
      .then((info) => {
        if (info.overrideActive && info.overrideMessage) {
          setMessage(info.overrideMessage);
          return;
        }

        const todayHoliday = findTodayHoliday(info.holidays);
        if (todayHoliday) {
          setMessage(
            todayHoliday.isClosed
              ? `We are closed today for ${todayHoliday.label}.`
              : `Today's hours are different for ${todayHoliday.label}: ${formatHour(
                  todayHoliday.openTime!
                )} - ${formatHour(todayHoliday.closeTime!)}.`
          );
          return;
        }

        setMessage(null);
      })
      .catch(() => setMessage(null));
  }, []);

  if (!message) return null;

  return (
    <div role="alert" className="bg-amber-400 px-4 py-2.5 text-center text-sm font-medium text-amber-950 print:hidden">
      {message}
    </div>
  );
}
