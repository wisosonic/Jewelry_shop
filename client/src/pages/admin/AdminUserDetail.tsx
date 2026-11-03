import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteUser, fetchUser, fetchUserOrderSummary, sendPaymentReminder, updateUser } from "../../api/admin";
import { CheckIcon } from "../../components/icons/Icon";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import { formatCents, formatRelativeTime } from "../../lib/format";
import type { Role, User, UserOrderSummary } from "../../types";

type ProfileForm = {
  name: string;
  email: string;
  phone: string;
  address: string;
  adminNotes: string;
};

function formToUser(user: User): ProfileForm {
  return {
    name: user.name,
    email: user.email ?? "",
    phone: user.phone ?? "",
    address: user.address ?? "",
    adminNotes: user.adminNotes ?? "",
  };
}

/**
 * Admin's full management view of one user: a stats sub-header (total
 * spending, registration date, last login, last order, account status, OTP
 * verification, role), a profile-edit form
 * (name/email/phone/address/admin-only note), and delete. The "Total
 * spending" card also shows a "Send payment reminder" button whenever
 * `summary.totalPendingCents > 0` - it fires a real in-app notification
 * (`POST /users/:id/payment-reminder`, admin only), not an email/SMS, per
 * CLAUDE.md's "customers get in-app notifications only" rule; the server
 * re-derives the same pending total itself and 400s if there's actually
 * nothing pending, so a stale client-side check can't send a misleading
 * reminder. Order history
 * now lives on its own page
 * (`AdminUserOrders.tsx`, `/admin/users/:id/orders`, reached via the "Last
 * order" card's button) rather than inline here - keeps this page a
 * scannable overview rather than an unbounded table. `AdminUsers.tsx` (the
 * list page) keeps its own quicker inline role/notes/block/delete actions
 * for convenience - this page is the thorough one, reached by clicking a
 * user's name there (or an order's customer name on `AdminOrders.tsx`).
 *
 * A plain ADMIN can never even load this page for a *different*
 * ADMIN/SUPER_ADMIN account - `fetchUser()` 403s server-side (see
 * CLAUDE.md's `SUPER_ADMIN` bullet), surfacing as the generic `loadError`
 * banner below; only the super admin can reach another admin's detail
 * page. When the loaded user *is* the super admin (reachable only by
 * themselves, self-viewing), the "User role" card renders a fixed label
 * instead of the CUSTOMER/ADMIN `<select>` - `SUPER_ADMIN` is never a
 * selectable option there, since it's a single, non-assignable role.
 */
export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [summary, setSummary] = useState<UserOrderSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

  function load() {
    if (!id) return;
    setLoadError(false);
    fetchUser(id)
      .then((u) => {
        setUser(u);
        setForm(formToUser(u));
      })
      .catch(() => setLoadError(true));
  }

  function loadSummary() {
    if (!id) return;
    setSummaryError(false);
    fetchUserOrderSummary(id)
      .then(setSummary)
      .catch(() => setSummaryError(true));
  }

  useEffect(load, [id]);
  useEffect(loadSummary, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !form) return;
    setIsSaving(true);
    try {
      const updated = await updateUser(id, {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        address: form.address || undefined,
        adminNotes: form.adminNotes,
      });
      setUser(updated);
      setForm(formToUser(updated));
      showToast("User saved.");
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast(message ?? "Couldn't save this user.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Sends the customer an in-app reminder about their pending (unpaid)
   * orders - only ever clickable when `summary.totalPendingCents > 0`, but
   * the server re-checks this itself too (400 if there's nothing pending),
   * so this handler's `catch` also covers that race (e.g. the last pending
   * order just got confirmed in another tab).
   */
  async function handleSendPaymentReminder() {
    if (!id) return;
    setIsSendingReminder(true);
    try {
      await sendPaymentReminder(id);
      showToast("Payment reminder sent.");
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast(message ?? "Couldn't send this payment reminder.", "error");
    } finally {
      setIsSendingReminder(false);
    }
  }

  /** Confirmed before blocking (a punitive, customer-impacting action); not before unblocking (purely restorative). */
  async function handleToggleBlock() {
    if (!id || !user) return;
    if (!user.isBlocked) {
      const confirmed = await confirm(`Block ${user.name} from placing orders? They can still browse and sign in.`, {
        title: "Block user",
        confirmLabel: "Block",
        danger: true,
      });
      if (!confirmed) return;
    }
    try {
      const updated = await updateUser(id, { isBlocked: !user.isBlocked });
      setUser(updated);
      showToast(user.isBlocked ? "User unblocked." : "User blocked.");
    } catch {
      showToast("Couldn't update this user's blocked status.", "error");
    }
  }

  /** Saves a role change immediately on select, no confirmation step - the same immediate-save-select pattern `handleVerifiedChange` right below uses for OTP verification. */
  async function handleRoleChange(role: Role) {
    if (!id) return;
    try {
      const updated = await updateUser(id, { role });
      setUser(updated);
      showToast("Role updated.");
    } catch {
      showToast("Couldn't update this user's role.", "error");
    }
  }

  /** Manual OTP-verification override - same immediate-save-on-select pattern as the role dropdown, no confirmation step. */
  async function handleVerifiedChange(isVerified: boolean) {
    if (!id) return;
    try {
      const updated = await updateUser(id, { isVerified });
      setUser(updated);
      showToast(isVerified ? "User marked as verified." : "User marked as not verified.");
    } catch {
      showToast("Couldn't update this user's verification status.", "error");
    }
  }

  async function handleDelete() {
    if (!id || !user) return;
    const confirmed = await confirm(`Delete ${user.name}? This cannot be undone.`, {
      title: "Delete user",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteUser(id);
      showToast("User deleted.");
      navigate("/admin/users");
    } catch {
      showToast("Couldn't delete this user.", "error");
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load this user.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!user || !form) return <p className="text-ink-900/60">Loading...</p>;

  return (
    <div>
      <Link to="/admin/users" className="text-sm text-brand-600 hover:underline">
        &larr; Back to users
      </Link>

      <h1 className="mt-4 font-serif text-2xl text-ink-900 sm:text-3xl">{user.name}</h1>

      {summaryError ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load this user's order activity.{" "}
          <button onClick={loadSummary} className="font-medium underline">
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">Total spending</p>
            {summary ? (
              <>
                <p className="mt-1 text-lg font-semibold text-ink-900">{formatCents(summary.totalSpentCents)}</p>
                {summary.totalPendingCents > 0 && (
                  <>
                    <p className="mt-0.5 text-xs text-amber-600">{formatCents(summary.totalPendingCents)} pending</p>
                    <button
                      type="button"
                      onClick={handleSendPaymentReminder}
                      disabled={isSendingReminder}
                      className="mt-2 rounded-full bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      {isSendingReminder ? "Sending..." : "Send payment reminder"}
                    </button>
                  </>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-900/50">Loading...</p>
            )}
          </div>

          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">Registration date</p>
            <p className="mt-1 text-sm text-ink-900/80">{new Date(user.createdAt).toLocaleDateString()}</p>
          </div>

          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">Last login</p>
            <p className="mt-1 text-sm text-ink-900/80">
              {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : "Never"}
            </p>
          </div>

          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">Last order</p>
            {summary ? (
              summary.lastOrder ? (
                <p className="mt-1 text-sm text-ink-900/80">
                  #{summary.lastOrder.id.slice(-8)} &middot; {summary.lastOrder.status}
                  <br />
                  {formatRelativeTime(summary.lastOrder.createdAt)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-900/80">No orders yet</p>
              )
            ) : (
              <p className="mt-1 text-sm text-ink-900/50">Loading...</p>
            )}
            <Link
              to={`/admin/users/${id}/orders`}
              className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline"
            >
              View order history &rarr;
            </Link>
          </div>

          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">Account status</p>
            <p className="mt-1 text-sm text-ink-900/80">
              {user.isBlocked ? "Blocked from placing orders" : "Active"}
            </p>
            <button
              type="button"
              onClick={handleToggleBlock}
              className={`mt-2 rounded-full px-3 py-1 text-xs text-white ${
                user.isBlocked ? "bg-green-600 hover:bg-green-700" : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {user.isBlocked ? "Unblock" : "Block"}
            </button>
          </div>

          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">OTP verification</p>
            <p className="mt-1 text-sm text-ink-900/80">{user.isVerified ? "Verified" : "Not verified"}</p>
            <select
              aria-label="OTP verification status"
              value={user.isVerified ? "true" : "false"}
              onChange={(e) => handleVerifiedChange(e.target.value === "true")}
              className="mt-2 w-full rounded-lg border border-brand-300 px-2 py-1.5 text-sm text-ink-900"
            >
              <option value="true">Verified</option>
              <option value="false">Not verified</option>
            </select>
          </div>

          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">User role</p>
            {user.role === "SUPER_ADMIN" ? (
              <p className="mt-1.5 text-sm font-medium text-ink-900" title="Super Admin is a single, fixed role - it can't be changed or reassigned">
                Super Admin (fixed)
              </p>
            ) : (
              <select
                aria-label="User role"
                value={user.role}
                onChange={(e) => handleRoleChange(e.target.value as Role)}
                className="mt-1.5 w-full rounded-lg border border-brand-300 px-2 py-1.5 text-sm text-ink-900"
              >
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            )}
          </div>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Profile</h2>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-ink-900/70">
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-ink-900/70">
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-ink-900/70">
              Phone
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-ink-900/70">
              Address
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
              />
            </label>
          </div>
          <label className="block text-sm text-ink-900/70">
            Admin notes (never shown to this customer)
            <textarea
              rows={3}
              value={form.adminNotes}
              onChange={(e) => setForm({ ...form, adminNotes: e.target.value })}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" /> {isSaving ? "Saving..." : "Save changes"}
          </button>
        </form>
      </section>

      <section className="mt-6 flex justify-end">
        <button
          onClick={handleDelete}
          className="rounded-full bg-red-600 px-6 py-2 text-sm text-white hover:bg-red-700"
        >
          Delete user
        </button>
      </section>
    </div>
  );
}
