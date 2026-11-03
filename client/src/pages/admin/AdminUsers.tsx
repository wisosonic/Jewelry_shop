import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createUser, deleteUser, fetchUsers, updateUser } from "../../api/admin";
import { Pagination } from "../../components/common/Pagination";
import { PlusIcon, TrashIcon } from "../../components/icons/Icon";
import { useAuth } from "../../context/AuthContext";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { formatRelativeTime } from "../../lib/format";
import type { Role, User } from "../../types";

const PAGE_SIZE = 20;

/** The password assigned when an admin leaves the "new user" form's password field blank - shown back to them since there's no email/SMS to deliver it otherwise. */
const DEFAULT_TEMP_PASSWORD = "User@12345";

const SORT_OPTIONS = [
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "name-asc", label: "Name: A to Z" },
  { value: "name-desc", label: "Name: Z to A" },
  { value: "email-asc", label: "Email: A to Z" },
  { value: "email-desc", label: "Email: Z to A" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const EMPTY_NEW_USER = { name: "", email: "", phone: "", address: "", password: "", role: "CUSTOMER" as Role };

/**
 * Admin page listing all users, paginated/filterable/sortable, with a
 * block/unblock action, delete, and creating a new user directly. The
 * table itself is read-only text (name, email, role, status, last login,
 * admin note) - no inline `<select>`/`<textarea>` editors - clicking a
 * name opens `AdminUserDetail.tsx`, the one place role, the admin-only
 * note, and every other profile field are actually edited (see `CLAUDE.md`).
 *
 * Only the super admin can manage other admin accounts (see CLAUDE.md's
 * `SUPER_ADMIN` bullet) - `canManage()` below decides, per row, whether the
 * signed-in viewer may click through to that row's detail page or use its
 * Block/Delete buttons. This is a client-side convenience only; the same
 * rule is enforced server-side in `users.service.ts`'s
 * `assertCanManageTarget()`, which is what actually stops a direct API call.
 */
export function AdminUsers() {
  const { user: viewer } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [sort, setSort] = useState<SortValue>("createdAt-desc");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [addError, setAddError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [sortBy, sortOrder] = sort.split("-") as ["name" | "email" | "createdAt", "asc" | "desc"];

  /** (Re)loads the current page of the user list from the server. */
  function load() {
    setLoadError(false);
    fetchUsers({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined, role: roleFilter || undefined, sortBy, sortOrder })
      .then((result) => {
        setUsers(result.items);
        setTotal(result.total);
      })
      .catch(() => setLoadError(true));
  }

  useEffect(load, [page, debouncedSearch, roleFilter, sort]);

  // Reset back to page 1 whenever a filter (not the page itself) changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, sort]);

  /** Toggles a user's blocked status - confirmed before blocking (a punitive, customer-impacting action), not before unblocking (purely restorative). */
  async function handleToggleBlock(user: User) {
    if (!user.isBlocked) {
      const confirmed = await confirm(`Block ${user.name} from placing orders? They can still browse and sign in.`, {
        title: "Block user",
        confirmLabel: "Block",
        danger: true,
      });
      if (!confirmed) return;
    }
    try {
      await updateUser(user.id, { isBlocked: !user.isBlocked });
      setUsers((current) => current.map((u) => (u.id === user.id ? { ...u, isBlocked: !user.isBlocked } : u)));
      showToast(user.isBlocked ? "User unblocked." : "User blocked.");
    } catch {
      showToast("Couldn't update that user's blocked status.", "error");
    }
  }

  /** Confirms with the user, then deletes the account and refreshes the list. */
  async function handleDelete(id: string) {
    const confirmed = await confirm("Delete this user? This cannot be undone.", {
      title: "Delete user",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteUser(id);
      load();
      showToast("User deleted.");
    } catch {
      showToast("Couldn't delete that user.", "error");
    }
  }

  /** Creates the new user from the form, showing the assigned email/password (which may be server-generated defaults) so the admin can pass them along. */
  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setIsSubmitting(true);
    try {
      const created = await createUser({
        name: newUser.name,
        email: newUser.email.trim() || undefined,
        password: newUser.password || undefined,
        role: newUser.role,
        phone: newUser.phone.trim() || undefined,
        address: newUser.address.trim() || undefined,
      });
      const passwordNote = newUser.password ? "" : ` Temporary password: ${DEFAULT_TEMP_PASSWORD}`;
      showToast(`User created (${created.email}).${passwordNote}`);
      setNewUser(EMPTY_NEW_USER);
      setIsAddOpen(false);
      setPage(1);
      load();
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAddError(message ?? "Could not create user.");
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Only the super admin can manage a different ADMIN/SUPER_ADMIN account - a plain admin can still manage any CUSTOMER, and themselves. */
  function canManage(target: User): boolean {
    if (viewer?.role === "SUPER_ADMIN") return true;
    return target.role === "CUSTOMER" || target.id === viewer?.id;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Users</h1>
        <button
          onClick={() => setIsAddOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
        >
          <PlusIcon className="h-4 w-4" /> Add user
        </button>
      </div>

      {isAddOpen && (
        <form onSubmit={handleAddUser} className="mt-4 space-y-3 rounded-xl border border-brand-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink-900/70">
              Name
              <input
                required
                value={newUser.name}
                onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-ink-900/70">
              Email (optional)
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
                placeholder="Auto-generated from name if left blank"
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-ink-900/70">
              Phone (optional)
              <input
                value={newUser.phone}
                onChange={(e) => setNewUser((u) => ({ ...u, phone: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-ink-900/70">
              Address (optional)
              <input
                value={newUser.address}
                onChange={(e) => setNewUser((u) => ({ ...u, address: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-ink-900/70">
              Password (optional)
              <input
                type="text"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                placeholder={`Defaults to "${DEFAULT_TEMP_PASSWORD}" if left blank`}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-ink-900/70">
              Role
              {/* SUPER_ADMIN is deliberately not an option here - it's a single, non-assignable role (see CLAUDE.md's SUPER_ADMIN bullet); the server would reject it anyway. */}
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value as Role }))}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              >
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-900/50">
            There's no email/SMS delivery in this app - after creating the account, you'll need to pass the
            email and password along to the new user yourself.
          </p>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-full bg-brand-600 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create user"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddOpen(false);
                setAddError(null);
                setNewUser(EMPTY_NEW_USER);
              }}
              className="rounded-full border border-brand-300 px-5 py-2 text-sm text-ink-900/70 hover:bg-brand-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load users.{" "}
          <button onClick={load} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          aria-label="Search users"
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | "")}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          <option value="">All roles</option>
          <option value="CUSTOMER">Customer</option>
          <option value="ADMIN">Admin</option>
          <option value="SUPER_ADMIN">Super Admin</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortValue)}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="text-sm text-ink-900/50">{total} user{total === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-brand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-brand-100/60 text-left text-ink-900/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last login</th>
              <th className="px-4 py-2">Admin notes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-900/50">
                  No users match your filters.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-brand-100">
                <td className="px-4 py-2">
                  {canManage(u) ? (
                    <Link to={`/admin/users/${u.id}`} className="font-medium text-brand-700 hover:underline">
                      {u.name}
                    </Link>
                  ) : (
                    <span
                      className="font-medium text-ink-900/70"
                      title="Only the super admin can manage other admin accounts"
                    >
                      {u.name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-ink-900/60">{u.email}</td>
                <td className="px-4 py-2 text-ink-900/80">{u.role}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.isVerified ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Verified</span>
                    ) : (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                        title={
                          u.deletionWarningSentAt
                            ? `Warned ${formatRelativeTime(u.deletionWarningSentAt)} that this account will be deleted if it stays unverified`
                            : "Not yet verified - will be automatically deleted (with a warning first) if it stays this way"
                        }
                      >
                        Unverified{u.deletionWarningSentAt ? " (warned)" : ""}
                      </span>
                    )}
                    {u.isBlocked && (
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                        title="Can still browse and sign in - only order placement is blocked"
                      >
                        Blocked
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-ink-900/60">
                  {u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : "Never"}
                </td>
                <td className="px-4 py-2 text-ink-900/60">
                  <span className="block max-w-56 truncate" title={u.adminNotes || undefined}>
                    {u.adminNotes || "—"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {canManage(u) ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => handleToggleBlock(u)}
                        className={`rounded px-2 py-1 hover:underline ${
                          u.isBlocked ? "text-green-700 hover:bg-green-50" : "text-amber-700 hover:bg-amber-50"
                        }`}
                      >
                        {u.isBlocked ? "Unblock" : "Block"}
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50 hover:underline"
                      >
                        <TrashIcon className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  ) : (
                    <span
                      className="text-xs text-ink-900/40"
                      title="Only the super admin can manage other admin accounts"
                    >
                      Restricted
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  );
}
