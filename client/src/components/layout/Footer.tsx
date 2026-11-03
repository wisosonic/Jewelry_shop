import { useEffect, useState } from "react";
import { fetchBusinessInfo } from "../../api/business";
import { formatHolidayDate, formatHour, getTodayIso } from "../../lib/businessHours";
import type { BusinessInfo } from "../../types";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Collapses runs of consecutive open days sharing the same hours into one line, e.g. "Mon-Fri: 10am - 7pm". */
function summarizeHours(hours: BusinessInfo["hours"]): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < hours.length) {
    const day = hours[i];
    if (!day.isOpen) {
      lines.push(`${DAY_LABELS[day.dayOfWeek]}: Closed`);
      i += 1;
      continue;
    }
    let j = i;
    while (
      j + 1 < hours.length &&
      hours[j + 1].isOpen &&
      hours[j + 1].openTime === day.openTime &&
      hours[j + 1].closeTime === day.closeTime
    ) {
      j += 1;
    }
    const range = j > i ? `${DAY_LABELS[hours[i].dayOfWeek]}-${DAY_LABELS[hours[j].dayOfWeek]}` : DAY_LABELS[day.dayOfWeek];
    lines.push(`${range}: ${formatHour(day.openTime)} - ${formatHour(day.closeTime)}`);
    i = j + 1;
  }
  return lines;
}

/** Site-wide footer with store branding, contact info, weekly hours, upcoming holiday exceptions, and copyright. */
export function Footer() {
  const [info, setInfo] = useState<BusinessInfo | null>(null);

  useEffect(() => {
    fetchBusinessInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const todayIso = getTodayIso();
  const upcomingHolidays = (info?.holidays ?? []).filter((h) => h.date.slice(0, 10) >= todayIso);

  return (
    <footer className="mt-16 border-t border-brand-200 bg-brand-100/60 print:hidden">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6 lg:px-8">
        <div>
          <h3 className="font-serif text-lg text-brand-800">Naya Sophia</h3>
          <p className="mt-2 text-sm text-ink-900/70">
            Fine gold and silver jewelry, priced fairly against live market rates.
          </p>
        </div>
        <div className="text-sm text-ink-900/70">
          <h4 className="mb-2 font-medium text-ink-900">Visit us</h4>
          {info?.address && <p>{info.address}</p>}
          {info?.phone && <p className="mt-2">{info.phone}</p>}
          {!info?.address && !info?.phone && <p className="text-ink-900/50">Contact info coming soon.</p>}
        </div>
        <div className="text-sm text-ink-900/70">
          <h4 className="mb-2 font-medium text-ink-900">Hours</h4>
          {info ? summarizeHours(info.hours).map((line) => <p key={line}>{line}</p>) : <p>&nbsp;</p>}
          {upcomingHolidays.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 font-medium text-ink-900">Upcoming exceptions</h4>
              {upcomingHolidays.map((h) => (
                <p key={h.id}>
                  {formatHolidayDate(h.date)} - {h.label}:{" "}
                  {h.isClosed ? "Closed" : `${formatHour(h.openTime!)} - ${formatHour(h.closeTime!)}`}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-brand-200 py-4 text-center text-xs text-ink-900/50">
        &copy; {new Date().getFullYear()} Naya Sophia Jewelry. All rights reserved.
      </p>
    </footer>
  );
}
