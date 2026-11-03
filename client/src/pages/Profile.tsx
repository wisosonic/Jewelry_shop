import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateUser } from "../api/admin";
import { BellIcon, CheckIcon, ClipboardListIcon, LogoutIcon } from "../components/icons/Icon";
import { useAuth } from "../context/AuthContext";
import { isAdminRole } from "../lib/roles";

/**
 * Account page: an editable profile form, a change-password form, and the
 * sign-out action. Order history lives on its own page (`/orders`, see
 * `OrderHistory.tsx`) rather than here.
 */
export function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: user?.name ?? "", phone: user?.phone ?? "", address: user?.address ?? "" });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user) return null;

  /** Saves the profile form and refreshes the shared auth user with the updated record. */
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    try {
      const updated = await updateUser(user!.id, form);
      refreshUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(message ?? "Could not save your changes. Please try again.");
    }
  }

  /** Changes the current user's password, verifying the current one server-side first. */
  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }

    try {
      await updateUser(user!.id, {
        currentPassword: passwordForm.currentPassword,
        password: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 1500);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPasswordError(message ?? "Could not change your password. Please try again.");
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">My account</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to="/notifications" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
            <BellIcon className="h-4 w-4" /> View notifications &rarr;
          </Link>
          {/* Order history is a shopping feature, not relevant to an admin's own account - see ProductCard.tsx's identical note. */}
          {!isAdminRole(user.role) && (
            <Link to="/orders" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
              <ClipboardListIcon className="h-4 w-4" /> View order history &rarr;
            </Link>
          )}
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-xl text-ink-900">Profile details</h2>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Phone"
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
          />
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Address"
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
          />
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          <button type="submit" className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700">
            <CheckIcon className="h-4 w-4" /> {saved ? "Saved" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-xl text-ink-900">Change password</h2>
        <form onSubmit={handlePasswordChange} className="mt-4 space-y-3">
          <input
            type="password"
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
            placeholder="Current password"
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
            required
          />
          <input
            type="password"
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            placeholder="New password"
            minLength={10}
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
            required
          />
          <input
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
            placeholder="Confirm new password"
            minLength={10}
            className="w-full rounded-lg border border-brand-300 px-3 py-2"
            required
          />
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <button type="submit" className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700">
            <CheckIcon className="h-4 w-4" /> {passwordSaved ? "Password updated" : "Update password"}
          </button>
        </form>
      </section>

      <section className="mt-8 flex justify-end">
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-full bg-ink-900 px-6 py-2 text-sm text-white hover:bg-ink-900/80"
        >
          <LogoutIcon className="h-4 w-4" /> Log out
        </button>
      </section>
    </div>
  );
}
