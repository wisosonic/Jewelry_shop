import { useEffect, useState } from "react";
import {
  addBusinessHoliday,
  deleteBusinessHoliday,
  fetchBusinessInfo,
  updateBusinessHours,
  updateBusinessInfo,
} from "../../api/business";
import { CheckIcon, TrashIcon } from "../../components/icons/Icon";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import { formatHolidayDate } from "../../lib/businessHours";
import type { BusinessHoliday, BusinessHours, BusinessInfo } from "../../types";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY_HOLIDAY_DRAFT = { date: "", label: "", isClosed: true, openTime: "09:00", closeTime: "18:00" };

/**
 * Admin page for the storefront's public business info: contact details
 * (shown in the footer of every page), the weekly regular hours (also
 * footer), dated holiday exceptions (footer, upcoming ones only), and the
 * emergency/special-event override banner (shown site-wide via
 * `OverrideBanner.tsx` whenever active).
 */
export function AdminBusinessInfo() {
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [overrideActive, setOverrideActive] = useState(false);
  const [overrideMessage, setOverrideMessage] = useState("");
  const [hoursDraft, setHoursDraft] = useState<BusinessHours[]>([]);
  const [holidayDraft, setHolidayDraft] = useState(EMPTY_HOLIDAY_DRAFT);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();

  function load() {
    setLoadError(false);
    fetchBusinessInfo()
      .then((data) => {
        setInfo(data);
        setAddress(data.address ?? "");
        setPhone(data.phone ?? "");
        setOverrideActive(data.overrideActive);
        setOverrideMessage(data.overrideMessage ?? "");
        setHoursDraft(data.hours);
      })
      .catch(() => setLoadError(true));
  }

  useEffect(load, []);

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateBusinessInfo({ address, phone });
      load();
      showToast("Contact info saved.");
    } catch {
      showToast("Couldn't save contact info.", "error");
    }
  }

  async function handleSaveOverride(e: React.FormEvent) {
    e.preventDefault();
    if (overrideActive && !overrideMessage.trim()) {
      showToast("Enter a message for the banner before activating it.", "error");
      return;
    }
    try {
      await updateBusinessInfo({ overrideActive, overrideMessage });
      load();
      showToast(overrideActive ? "Override banner activated." : "Override banner deactivated.");
    } catch {
      showToast("Couldn't save the override banner.", "error");
    }
  }

  function updateDay(dayOfWeek: number, patch: Partial<BusinessHours>) {
    setHoursDraft((current) => current.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  async function handleSaveHours() {
    try {
      await updateBusinessHours(hoursDraft);
      load();
      showToast("Weekly hours saved.");
    } catch {
      showToast("Couldn't save weekly hours.", "error");
    }
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!holidayDraft.date || !holidayDraft.label.trim()) {
      showToast("Enter a date and a label for the exception.", "error");
      return;
    }
    try {
      await addBusinessHoliday(holidayDraft);
      setHolidayDraft(EMPTY_HOLIDAY_DRAFT);
      load();
      showToast("Exception added.");
    } catch {
      showToast("Couldn't add that exception.", "error");
    }
  }

  async function handleDeleteHoliday(holiday: BusinessHoliday) {
    const confirmed = await confirm(`Remove "${holiday.label}"?`, { title: "Remove exception", confirmLabel: "Remove", danger: true });
    if (!confirmed) return;
    try {
      await deleteBusinessHoliday(holiday.id);
      load();
      showToast("Exception removed.");
    } catch {
      showToast("Couldn't remove that exception.", "error");
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load business info.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!info) return <p className="text-ink-900/60">Loading...</p>;

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Business info</h1>
      <p className="mt-1 text-sm text-ink-900/60">
        Shown in the footer of every page, and used for the site-wide emergency banner below.
      </p>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Contact info</h2>
        <form onSubmit={handleSaveContact} className="mt-4 space-y-4">
          <label className="block text-sm text-ink-900/70">
            Address
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-ink-900/70">
            Phone number
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 010-0100"
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
            />
          </label>
          <button type="submit" className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700">
            <CheckIcon className="h-4 w-4" /> Save contact info
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-red-200 bg-red-50/40 p-6">
        <h2 className="font-serif text-lg text-ink-900">Emergency / special-event override</h2>
        <p className="mt-1 text-xs text-ink-900/50">
          When active, this message replaces the regular schedule with a warning banner across every page - use it for
          an unplanned closure or a one-off event, not a recurring schedule change (use an exception below for that).
        </p>
        <form onSubmit={handleSaveOverride} className="mt-4 space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
            <input type="checkbox" checked={overrideActive} onChange={(e) => setOverrideActive(e.target.checked)} />
            Show override banner
          </label>
          <textarea
            value={overrideMessage}
            onChange={(e) => setOverrideMessage(e.target.value)}
            rows={2}
            placeholder="e.g. Closed today due to a private event - we'll reopen tomorrow at 10am."
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
          />
          <button type="submit" className="flex items-center gap-1.5 rounded-full bg-red-600 px-6 py-2 text-white hover:bg-red-700">
            <CheckIcon className="h-4 w-4" /> Save override
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Weekly hours</h2>
        <div className="mt-4 space-y-2">
          {hoursDraft.map((day) => (
            <div key={day.dayOfWeek} className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex w-32 shrink-0 items-center gap-2 font-medium text-ink-900">
                <input
                  type="checkbox"
                  checked={day.isOpen}
                  onChange={(e) => updateDay(day.dayOfWeek, { isOpen: e.target.checked })}
                />
                {DAY_LABELS[day.dayOfWeek]}
              </label>
              <input
                type="time"
                value={day.openTime}
                disabled={!day.isOpen}
                onChange={(e) => updateDay(day.dayOfWeek, { openTime: e.target.value })}
                className="rounded-lg border border-brand-300 px-2 py-1.5 disabled:opacity-40"
              />
              <span className="text-ink-900/40">to</span>
              <input
                type="time"
                value={day.closeTime}
                disabled={!day.isOpen}
                onChange={(e) => updateDay(day.dayOfWeek, { closeTime: e.target.value })}
                className="rounded-lg border border-brand-300 px-2 py-1.5 disabled:opacity-40"
              />
            </div>
          ))}
        </div>
        <button
          onClick={handleSaveHours}
          className="mt-4 flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700"
        >
          <CheckIcon className="h-4 w-4" /> Save weekly hours
        </button>
      </section>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Holiday hours & exceptions</h2>
        <p className="mt-1 text-xs text-ink-900/50">
          A dated override to the regular weekly schedule above - a closure or special hours for one specific day.
        </p>

        <ul className="mt-4 space-y-2">
          {info.holidays.length === 0 && <li className="text-sm text-ink-900/50">No exceptions set.</li>}
          {info.holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-100 px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-ink-900">{formatHolidayDate(h.date)}</span> - {h.label}{" "}
                <span className="text-ink-900/60">
                  ({h.isClosed ? "Closed" : `${h.openTime} - ${h.closeTime}`})
                </span>
              </span>
              <button
                onClick={() => handleDeleteHoliday(h)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50 hover:underline"
              >
                <TrashIcon className="h-3.5 w-3.5" /> Remove
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAddHoliday} className="mt-4 space-y-3 border-t border-brand-100 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="date"
              value={holidayDraft.date}
              onChange={(e) => setHolidayDraft((d) => ({ ...d, date: e.target.value }))}
              className="rounded-lg border border-brand-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Label, e.g. Christmas Day"
              value={holidayDraft.label}
              onChange={(e) => setHolidayDraft((d) => ({ ...d, label: e.target.value }))}
              className="rounded-lg border border-brand-300 px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-900/70">
            <input
              type="checkbox"
              checked={holidayDraft.isClosed}
              onChange={(e) => setHolidayDraft((d) => ({ ...d, isClosed: e.target.checked }))}
            />
            Closed all day
          </label>
          {!holidayDraft.isClosed && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input
                type="time"
                value={holidayDraft.openTime}
                onChange={(e) => setHolidayDraft((d) => ({ ...d, openTime: e.target.value }))}
                className="rounded-lg border border-brand-300 px-2 py-1.5"
              />
              <span className="text-ink-900/40">to</span>
              <input
                type="time"
                value={holidayDraft.closeTime}
                onChange={(e) => setHolidayDraft((d) => ({ ...d, closeTime: e.target.value }))}
                className="rounded-lg border border-brand-300 px-2 py-1.5"
              />
            </div>
          )}
          <button type="submit" className="rounded-full bg-brand-600 px-5 py-2 text-sm text-white hover:bg-brand-700">
            Add exception
          </button>
        </form>
      </section>
    </div>
  );
}
