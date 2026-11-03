import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { fetchMyNotifications, markNotificationRead } from "../../api/notifications";
import logoUrl from "../../assets/logo2.png";
import { useAuth } from "../../context/AuthContext";
import { useCurrencyRateSync } from "../../hooks/useCurrencyRateSync";
import { formatRelativeTime } from "../../lib/format";
import { isAdminRole } from "../../lib/roles";
import { useCartStore } from "../../store/cartStore";
import { useCurrencyStore } from "../../store/currencyStore";
import { useNotificationStore } from "../../store/notificationStore";
import type { Notification } from "../../types";
import {
  BarsIcon,
  BellIcon,
  CartIcon,
  ClipboardListIcon,
  CloseIcon,
  DashboardIcon,
  HeartIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  ShieldCheckIcon,
  ShopIcon,
  UserIcon,
} from "../icons/Icon";

const NOTIFICATION_PREVIEW_COUNT = 5;

/**
 * Bell icon with a click-to-open dropdown previewing the 5 latest
 * notifications (same click-outside/Escape pattern as `AccountMenu`),
 * plus a small corner badge for the unread count. Rendered only when
 * signed in, right before the account control/sign-in link. Fetches fresh
 * on every open, rather than trying to keep the preview list live while
 * open - the badge count itself still updates in real time regardless
 * (see `notificationStore.ts`).
 */
function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const decrementUnreadCount = useNotificationStore((s) => s.decrementUnreadCount);
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<Notification[] | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  function loadPreview() {
    setPreviewError(false);
    fetchMyNotifications({ page: 1, pageSize: NOTIFICATION_PREVIEW_COUNT })
      .then((result) => setPreview(result.items))
      .catch(() => setPreviewError(true));
  }

  function handleToggle() {
    setIsOpen((v) => {
      const next = !v;
      if (next) loadPreview();
      return next;
    });
  }

  /** Marks the clicked notification read (if it wasn't already), closes the dropdown, and navigates to its link, if any. */
  async function handleSelect(notification: Notification) {
    setIsOpen(false);
    if (!notification.isRead) {
      try {
        await markNotificationRead(notification.id);
        decrementUnreadCount();
      } catch {
        // Non-fatal - the notification just stays marked unread until the next successful attempt.
      }
    }
    if (notification.link) navigate(notification.link);
  }

  function handleViewAll() {
    setIsOpen(false);
    navigate("/notifications");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-900/70 hover:bg-brand-100 hover:text-brand-700"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-brand-200 bg-white py-1 shadow-lg">
          {previewError ? (
            <p className="px-4 py-6 text-center text-sm text-red-600">
              Couldn't load notifications.{" "}
              <button onClick={loadPreview} className="font-medium underline">
                Try again
              </button>
            </p>
          ) : preview === null ? (
            <p className="px-4 py-6 text-center text-sm text-ink-900/50">Loading...</p>
          ) : preview.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-900/50">You have no notifications yet.</p>
          ) : (
            <ul>
              {preview.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(notification)}
                    className={`flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm hover:bg-brand-50 ${
                      notification.isRead ? "text-ink-900/70" : "font-medium text-ink-900"
                    }`}
                  >
                    {!notification.isRead && (
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                    )}
                    <span className="flex-1">
                      <span className="block">{notification.message}</span>
                      <span className="block text-xs font-normal text-ink-900/50">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={handleViewAll}
            className="block w-full border-t border-brand-100 px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Switch between USD and LBP display prices, storewide (see
 * `currencyStore.ts`) - a pure presentation choice, never sent to the
 * server. Rendered as an actual toggle switch (`role="switch"`, a sliding
 * thumb) rather than a two-button pair, so its on/off state reads at a
 * glance. `useCurrencyRateSync()` keeps the conversion rate fresh
 * regardless of which page is currently mounted.
 */
function CurrencyToggle() {
  const currency = useCurrencyStore((s) => s.currency);
  const toggleCurrency = useCurrencyStore((s) => s.toggleCurrency);
  const isLbp = currency === "LBP";

  useCurrencyRateSync();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLbp}
      onClick={toggleCurrency}
      aria-label={`Prices shown in ${currency}. Switch to ${isLbp ? "USD" : "LBP"}`}
      title={`Showing prices in ${currency} - click to switch`}
      className="relative h-8 w-[72px] shrink-0 rounded-full border border-brand-300 bg-brand-100 p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0.5 left-0.5 w-[34px] rounded-full bg-brand-600 shadow-sm transition-transform duration-200 ease-out ${
          isLbp ? "translate-x-full" : "translate-x-0"
        }`}
      />
      <span className="relative z-10 flex h-full items-center justify-between px-1.5 text-[11px] font-semibold">
        <span className={isLbp ? "text-ink-900/50" : "text-white"}>USD</span>
        <span className={isLbp ? "text-white" : "text-ink-900/50"}>LBP</span>
      </span>
    </button>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "text-brand-700" : "text-ink-900/70 hover:text-brand-600"
  }`;

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${
    isActive ? "bg-brand-100 text-brand-700" : "text-ink-900/70 hover:bg-brand-100"
  }`;

const menuLinkClass = "flex items-center gap-2 px-4 py-2.5 text-sm text-ink-900/80 hover:bg-brand-50";

/**
 * The signed-in user's name in the navbar, with a click-to-open dropdown for
 * profile-related navigation, including signing out (also available from
 * the profile page itself - both call the same `useAuth().logout()`).
 */
function AccountMenu() {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  if (!user) return null;

  /** Signs out and closes the dropdown, redirecting home. */
  async function handleLogout() {
    setIsOpen(false);
    await logout();
    navigate("/");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((v) => !v)}
        className="flex min-h-11 items-center gap-1.5 px-1 text-sm text-ink-900/70 hover:text-brand-700"
        aria-expanded={isOpen}
      >
        <UserIcon className="h-5 w-5" />
        {user.name}
        <span aria-hidden="true" className={`text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>
          &#9662;
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-brand-200 bg-white py-1 shadow-lg">
          <Link to="/profile" className={menuLinkClass} onClick={() => setIsOpen(false)}>
            <UserIcon className="h-4 w-4" /> My account
          </Link>
          <Link to="/notifications" className={menuLinkClass} onClick={() => setIsOpen(false)}>
            <BellIcon className="h-4 w-4" /> Notifications
          </Link>
          {!user.isVerified && (
            <Link
              to="/verify-otp"
              className={`${menuLinkClass} text-amber-700 hover:bg-amber-50`}
              onClick={() => setIsOpen(false)}
            >
              <ShieldCheckIcon className="h-4 w-4" /> Verify phone number
            </Link>
          )}
          {/* Order history and wishlist are shopping features, not relevant to an admin's own account - see ProductCard.tsx's identical note. */}
          {!isAdminRole(user.role) && (
            <>
              <Link to="/orders" className={menuLinkClass} onClick={() => setIsOpen(false)}>
                <ClipboardListIcon className="h-4 w-4" /> Order history
              </Link>
              <Link to="/wishlist" className={menuLinkClass} onClick={() => setIsOpen(false)}>
                <HeartIcon className="h-4 w-4" /> Wishlist
              </Link>
            </>
          )}
          {isAdminRole(user.role) && (
            <Link to="/admin" className={menuLinkClass} onClick={() => setIsOpen(false)}>
              <DashboardIcon className="h-4 w-4" /> Admin
            </Link>
          )}
          <button type="button" onClick={handleLogout} className={`${menuLinkClass} w-full border-t border-brand-100 text-left`}>
            <LogoutIcon className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Sticky top navigation bar showing primary nav links, cart item count, and
 * auth-aware sign-in/account controls. The account control comes before the
 * cart (the more frequent, identity-first action for a signed-in shopper),
 * mirroring the flow of most storefronts. The account dropdown includes a
 * "Log out" item alongside profile navigation. Below `sm` the primary links move
 * into a toggleable drawer under the bar (closed by default) instead of
 * disappearing outright, so the storefront stays navigable on a phone.
 */
export function Navbar() {
  const { user } = useAuth();
  const cartCount = useCartStore((s) => s.lines.reduce((sum, l) => sum + l.quantity, 0));
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && isMenuOpen) {
        setIsMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isMenuOpen]);

  return (
    <header className="border-b border-brand-200 bg-brand-50/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <img src={logoUrl} alt="Naya Sophia" className="h-9 w-auto sm:h-10" />
          {/* Decorative echo of the img's alt text - hidden from screen readers so the link's accessible name isn't announced twice on screens wide enough to show both. */}
          <span aria-hidden="true" className="hidden font-serif text-xl tracking-wide text-brand-800 sm:inline">
            Naya Sophia
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <NavLink to="/" end className={linkClass}>
            <HomeIcon className="h-4 w-4" /> Home
          </NavLink>
          <NavLink to="/bullion" className={linkClass}>
            <BarsIcon className="h-4 w-4" /> Gold &amp; Silver
          </NavLink>
          <NavLink to="/shop" className={linkClass}>
            <ShopIcon className="h-4 w-4" /> Shop
          </NavLink>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <CurrencyToggle />

          {user && <NotificationBell />}

          {user ? (
            <AccountMenu />
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700 sm:px-4"
            >
              <UserIcon className="h-4 w-4" /> <span className="hidden sm:inline">Sign in</span>
            </Link>
          )}

          {/* Shopping features aren't relevant to an admin's own account - see the identical note on ProductCard.tsx. */}
          {!isAdminRole(user?.role) && (
            <Link
              to="/cart"
              className="relative flex items-center gap-1.5 rounded-full border border-brand-300 px-3 py-2 text-sm text-brand-800 hover:bg-brand-100 sm:px-4"
            >
              <CartIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && (
                <span className="ml-0.5 rounded-full bg-brand-600 px-1.5 text-xs text-white">{cartCount}</span>
              )}
            </Link>
          )}

          <button
            ref={menuToggleRef}
            type="button"
            onClick={() => setIsMenuOpen((v) => !v)}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
            aria-label="Toggle navigation menu"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-brand-300 text-ink-900 sm:hidden"
          >
            {isMenuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <nav id="mobile-nav" className="space-y-1 border-t border-brand-200 px-4 py-2 sm:hidden">
          <NavLink to="/" end className={mobileLinkClass} onClick={() => setIsMenuOpen(false)}>
            <HomeIcon className="h-4 w-4" /> Home
          </NavLink>
          <NavLink to="/bullion" className={mobileLinkClass} onClick={() => setIsMenuOpen(false)}>
            <BarsIcon className="h-4 w-4" /> Gold &amp; Silver
          </NavLink>
          <NavLink to="/shop" className={mobileLinkClass} onClick={() => setIsMenuOpen(false)}>
            <ShopIcon className="h-4 w-4" /> Shop
          </NavLink>
        </nav>
      )}
    </header>
  );
}
