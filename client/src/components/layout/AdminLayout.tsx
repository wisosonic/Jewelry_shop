import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  BellIcon,
  BoxIcon,
  ClipboardListIcon,
  ClockIcon,
  DashboardIcon,
  SettingsIcon,
  TagIcon,
  TrendingUpIcon,
  UsersIcon,
} from "../icons/Icon";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${
    isActive ? "bg-brand-600 text-white" : "text-ink-900/70 hover:bg-brand-100"
  }`;

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true, icon: DashboardIcon },
  { to: "/admin/products", label: "Products", end: false, icon: BoxIcon },
  { to: "/admin/orders", label: "Orders", end: false, icon: ClipboardListIcon },
  { to: "/admin/revenue", label: "Revenue", end: false, icon: TrendingUpIcon },
  { to: "/admin/commission", label: "Commission", end: false, icon: TagIcon },
  { to: "/admin/users", label: "Users", end: false, icon: UsersIcon },
  { to: "/admin/notifications", label: "Notifications", end: false, icon: BellIcon },
  { to: "/admin/business", label: "Business info", end: false, icon: ClockIcon },
  { to: "/admin/settings", label: "Settings", end: false, icon: SettingsIcon },
];

/**
 * Admin panel shell: renders the section sidebar nav alongside the active
 * admin page (via `Outlet`). Below `md`, the sidebar collapses into a
 * toggleable section (closed by default) instead of squeezing a fixed-width
 * column next to the content, and closes itself again once a link is picked
 * so navigating doesn't leave the menu covering the page.
 */
export function AdminLayout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8 md:flex-row md:gap-6 lg:px-8">
      <button
        type="button"
        onClick={() => setIsMenuOpen((v) => !v)}
        aria-expanded={isMenuOpen}
        aria-controls="admin-nav"
        className="flex min-h-11 items-center justify-between rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-900 md:hidden"
      >
        Admin menu
        <span aria-hidden="true" className={`transition-transform ${isMenuOpen ? "rotate-180" : ""}`}>
          &#9662;
        </span>
      </button>
      <aside
        id="admin-nav"
        className={`w-full shrink-0 space-y-1 md:block md:w-48 ${isMenuOpen ? "block" : "hidden"}`}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={linkClass}
            onClick={() => setIsMenuOpen(false)}
          >
            <item.icon className="h-4 w-4" /> {item.label}
          </NavLink>
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
