import type { ReactNode, SVGProps } from "react";

/**
 * Small, dependency-free line-icon set (no icon library added - the project
 * intentionally keeps its dependency footprint minimal). Every icon is a
 * plain outlined SVG using `currentColor`, so it inherits the surrounding
 * text color and sizes via the `className` you pass in (e.g. `h-5 w-5`).
 * Icons are marked `aria-hidden` since every usage in this app sits next to
 * a visible text label - the label alone is what screen readers should
 * announce, not the icon too.
 */
type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps, children: ReactNode) {
  const { className = "h-5 w-5", ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  );
}

export function BarsIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="4" y="14" width="16" height="5" rx="1" />
      <rect x="6" y="9" width="12" height="5" rx="1" />
      <rect x="8" y="4" width="8" height="5" rx="1" />
    </>
  );
}

export function ShopIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6 8V6a6 6 0 0 1 12 0v2" />
      <path d="M4 8h16l-1.2 12.5a2 2 0 0 1-2 1.5H7.2a2 2 0 0 1-2-1.5L4 8Z" />
    </>
  );
}

export function CartIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M3 4h2l2.2 11.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" />
    </>
  );
}

export function UserIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
    </>
  );
}

export function UsersIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c1-3.2 3-5 5.5-5s4.5 1.8 5.5 5" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M14.8 14.2c2-.3 4 1 4.7 4.8" />
    </>
  );
}

export function MenuIcon(props: IconProps) {
  return base(
    props,
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  );
}

export function CloseIcon(props: IconProps) {
  return base(
    props,
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  );
}

export function DashboardIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  );
}

export function BoxIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </>
  );
}

export function ClipboardListIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" />
      <path d="M9 11h6M9 14.5h6M9 17.5h3.5" />
    </>
  );
}

export function SettingsIcon(props: IconProps) {
  return base(
    props,
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="7" cy="18" r="1.8" fill="currentColor" stroke="none" />
    </>
  );
}

export function TrendingUpIcon(props: IconProps) {
  return base(
    props,
    <>
      <polyline points="3,17 9,11 13,15 21,6" />
      <polyline points="15,6 21,6 21,12" />
    </>
  );
}

export function TagIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 11.5 12.5 20 3 11.5Z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  );
}

export function SearchIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="21" y1="21" x2="15.5" y2="15.5" />
    </>
  );
}

export function TrashIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M6.5 7 7.3 20a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1L17.5 7" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  );
}

export function PencilIcon(props: IconProps) {
  return base(props, <path d="M4 20.5 4.8 16 16 4.8a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8 19 4 20.5Z" />);
}

export function PlusIcon(props: IconProps) {
  return base(
    props,
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  );
}

export function CheckIcon(props: IconProps) {
  return base(props, <polyline points="4,13 9,18 20,6" />);
}

export function ChevronLeftIcon(props: IconProps) {
  return base(props, <polyline points="15,5 8,12 15,19" />);
}

export function ChevronRightIcon(props: IconProps) {
  return base(props, <polyline points="9,5 16,12 9,19" />);
}

export function LogoutIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="15,17 20,12 15,7" />
      <line x1="20" y1="12" x2="9" y2="12" />
    </>
  );
}

export function RefreshIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.6" />
      <polyline points="4,4 4,8.6 8.6,8.6" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.4" />
      <polyline points="20,20 20,15.4 15.4,15.4" />
    </>
  );
}

export function HeartIcon(props: IconProps) {
  return base(props, <path d="M12 20.5s-7.5-4.6-10-9.3C.6 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3a.5.5 0 0 0 1 0c1.1-1.8 3.1-2.7 5.1-2.3 3.4.7 4.8 4.2 3.4 7.4-2.5 4.7-10 9.3-10 9.3Z" />);
}

export function HeartFilledIcon(props: IconProps) {
  return base(
    { ...props, fill: "currentColor" },
    <path d="M12 20.5s-7.5-4.6-10-9.3C.6 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3a.5.5 0 0 0 1 0c1.1-1.8 3.1-2.7 5.1-2.3 3.4.7 4.8 4.2 3.4 7.4-2.5 4.7-10 9.3-10 9.3Z" />
  );
}

export function StarIcon(props: IconProps) {
  return base(props, <path d="M12 3.5 14.5 9.2 20.7 9.9 16 14 17.4 20.2 12 16.9 6.6 20.2 8 14 3.3 9.9 9.5 9.2 12 3.5Z" />);
}

export function StarFilledIcon(props: IconProps) {
  return base(
    { ...props, fill: "currentColor" },
    <path d="M12 3.5 14.5 9.2 20.7 9.9 16 14 17.4 20.2 12 16.9 6.6 20.2 8 14 3.3 9.9 9.5 9.2 12 3.5Z" />
  );
}

export function ClockIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  );
}

export function BellIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6 9.5a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  );
}
