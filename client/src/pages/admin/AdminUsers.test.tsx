import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, deleteUser, fetchUsers, updateUser } from "../../api/admin";
import { useAuth } from "../../context/AuthContext";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import type { Paginated, User } from "../../types";
import { AdminUsers } from "./AdminUsers";

vi.mock("../../api/admin", () => ({
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../context/ConfirmContext", () => ({ useConfirm: vi.fn() }));
vi.mock("../../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedFetchUsers = vi.mocked(fetchUsers);
const mockedCreateUser = vi.mocked(createUser);
const mockedDeleteUser = vi.mocked(deleteUser);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedUseAuth = vi.mocked(useAuth);
const mockedUseConfirm = vi.mocked(useConfirm);
const mockedUseToast = vi.mocked(useToast);

const CUSTOMER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Jane Shopper",
  role: "CUSTOMER",
  phone: null,
  address: null,
  isVerified: true,
  isBlocked: false,
  adminNotes: "Called about a late delivery.",
  createdAt: "2024-01-01T00:00:00.000Z",
  lastLoginAt: "2024-06-01T00:00:00.000Z",
};

const SUPER_ADMIN_VIEWER: User = {
  id: "viewer-super",
  email: "super@test.com",
  name: "Super Admin",
  role: "SUPER_ADMIN",
  phone: null,
  address: null,
  isVerified: true,
  isBlocked: false,
  adminNotes: "",
  createdAt: "2024-01-01T00:00:00.000Z",
  lastLoginAt: null,
};

function paginated(items: User[]): Paginated<User> {
  return { items, total: items.length, page: 1, pageSize: 20 };
}

function renderUsers() {
  return render(
    <MemoryRouter>
      <AdminUsers />
    </MemoryRouter>
  );
}

describe("AdminUsers", () => {
  const showToast = vi.fn();
  const confirm = vi.fn();

  beforeEach(() => {
    mockedFetchUsers.mockResolvedValue(paginated([CUSTOMER]));
    mockedUseToast.mockReturnValue({ showToast });
    showToast.mockClear();
    confirm.mockReset().mockResolvedValue(true);
    mockedUseConfirm.mockReturnValue(confirm);
    // Viewed as the super admin by default, so the pre-existing tests below
    // (written before SUPER_ADMIN existed) keep exercising full,
    // unrestricted management - the ADMIN-viewer restriction has its own
    // dedicated tests further down.
    mockedUseAuth.mockReturnValue({
      user: SUPER_ADMIN_VIEWER,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it("renders each user's row as plain text - no select or textarea for role or admin notes", async () => {
    renderUsers();
    const row = (await screen.findByText("Jane Shopper")).closest("tr")!;

    expect(within(row).getByText("CUSTOMER")).toBeInTheDocument();
    expect(within(row).getByText("Called about a late delivery.")).toBeInTheDocument();
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an em dash for a user with no admin note, still as plain text", async () => {
    mockedFetchUsers.mockResolvedValue(paginated([{ ...CUSTOMER, adminNotes: "" }]));
    renderUsers();
    const row = (await screen.findByText("Jane Shopper")).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("links the user's name to their admin detail page, where role/notes are actually edited", async () => {
    renderUsers();
    const link = await screen.findByRole("link", { name: "Jane Shopper" });
    expect(link).toHaveAttribute("href", "/admin/users/u1");
  });

  it("shows verified/blocked status badges", async () => {
    mockedFetchUsers.mockResolvedValue(paginated([{ ...CUSTOMER, isVerified: false, isBlocked: true }]));
    renderUsers();
    expect(await screen.findByText(/unverified/i)).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("blocks a user after confirming, and unblocks without confirming", async () => {
    mockedUpdateUser.mockResolvedValue({ ...CUSTOMER, isBlocked: true });
    const user = userEvent.setup();
    renderUsers();

    await user.click(await screen.findByRole("button", { name: /^block$/i }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mockedUpdateUser).toHaveBeenCalledWith("u1", { isBlocked: true });

    confirm.mockClear();
    mockedFetchUsers.mockResolvedValue(paginated([{ ...CUSTOMER, isBlocked: true }]));
    mockedUpdateUser.mockResolvedValue({ ...CUSTOMER, isBlocked: false });
    await user.click(await screen.findByRole("button", { name: /^unblock$/i }));
    expect(confirm).not.toHaveBeenCalled();
    expect(mockedUpdateUser).toHaveBeenCalledWith("u1", { isBlocked: false });
  });

  it("deletes a user after confirming", async () => {
    mockedDeleteUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderUsers();

    await user.click(await screen.findByRole("button", { name: /delete/i }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mockedDeleteUser).toHaveBeenCalledWith("u1");
    expect(showToast).toHaveBeenCalledWith("User deleted.");
  });

  it("shows a message when no users match the current filters", async () => {
    mockedFetchUsers.mockResolvedValue(paginated([]));
    renderUsers();
    expect(await screen.findByText(/no users match your filters/i)).toBeInTheDocument();
  });

  it("shows an error with retry when the list fails to load", async () => {
    mockedFetchUsers.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderUsers();

    expect(await screen.findByText(/couldn't load users/i)).toBeInTheDocument();

    mockedFetchUsers.mockResolvedValueOnce(paginated([CUSTOMER]));
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Jane Shopper")).toBeInTheDocument();
  });

  it("creates a new user from the Add user form", async () => {
    mockedCreateUser.mockResolvedValue({ ...CUSTOMER, id: "u2", name: "New Person", email: "new.person@nayasofia.com" });
    const user = userEvent.setup();
    renderUsers();
    await screen.findByText("Jane Shopper");

    await user.click(screen.getByRole("button", { name: /add user/i }));
    await user.type(screen.getByLabelText(/^name$/i), "New Person");
    await user.click(screen.getByRole("button", { name: /create user/i }));

    expect(mockedCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Person", role: "CUSTOMER" })
    );
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("new.person@nayasofia.com"));
  });

  describe("when the viewer is a plain admin (not the super admin)", () => {
    const ADMIN_VIEWER: User = { ...SUPER_ADMIN_VIEWER, id: "viewer-admin", name: "This Admin", role: "ADMIN" };
    const OTHER_ADMIN: User = { ...CUSTOMER, id: "u2", name: "Other Admin", role: "ADMIN" };
    const SUPER_ADMIN_ROW: User = { ...CUSTOMER, id: "u3", name: "The Super Admin", role: "SUPER_ADMIN" };

    beforeEach(() => {
      mockedUseAuth.mockReturnValue({
        user: ADMIN_VIEWER,
        isLoading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        refreshUser: vi.fn(),
      });
    });

    it("still fully manages a CUSTOMER row and their own row, but not another ADMIN/SUPER_ADMIN row", async () => {
      mockedFetchUsers.mockResolvedValue(paginated([CUSTOMER, OTHER_ADMIN, SUPER_ADMIN_ROW, ADMIN_VIEWER]));
      renderUsers();
      await screen.findByText("Jane Shopper");

      // A CUSTOMER row: fully manageable.
      expect(screen.getByRole("link", { name: "Jane Shopper" })).toHaveAttribute("href", "/admin/users/u1");
      const customerRow = screen.getByText("Jane Shopper").closest("tr")!;
      expect(within(customerRow).getByRole("button", { name: /^block$/i })).toBeInTheDocument();

      // Another ADMIN's row: name is plain text, actions replaced with "Restricted".
      expect(screen.queryByRole("link", { name: "Other Admin" })).not.toBeInTheDocument();
      expect(screen.getByText("Other Admin")).toBeInTheDocument();
      const otherAdminRow = screen.getByText("Other Admin").closest("tr")!;
      expect(within(otherAdminRow).queryByRole("button")).not.toBeInTheDocument();
      expect(within(otherAdminRow).getByText(/restricted/i)).toBeInTheDocument();

      // The SUPER_ADMIN row: same restriction.
      expect(screen.queryByRole("link", { name: "The Super Admin" })).not.toBeInTheDocument();
      const superAdminRow = screen.getByText("The Super Admin").closest("tr")!;
      expect(within(superAdminRow).getByText(/restricted/i)).toBeInTheDocument();

      // Their own row, even though it's role ADMIN: still fully manageable.
      const ownRow = screen.getByText(ADMIN_VIEWER.name).closest("tr")!;
      expect(within(ownRow).getByRole("link", { name: ADMIN_VIEWER.name })).toHaveAttribute(
        "href",
        `/admin/users/${ADMIN_VIEWER.id}`
      );
      expect(within(ownRow).getByRole("button", { name: /^block$/i })).toBeInTheDocument();
    });
  });
});
