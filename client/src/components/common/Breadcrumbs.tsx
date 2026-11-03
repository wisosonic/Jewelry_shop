import { Link } from "react-router-dom";
import { ChevronRightIcon } from "../icons/Icon";

type Crumb = { label: string; to?: string };

/** Simple breadcrumb trail - the last item (no `to`) renders as plain text with `aria-current="page"`. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-ink-900/60">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1">
          {i > 0 && <ChevronRightIcon className="h-3 w-3 text-ink-900/30" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-brand-600 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-ink-900">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
