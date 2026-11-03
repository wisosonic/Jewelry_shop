import { ChevronLeftIcon, ChevronRightIcon } from "../icons/Icon";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

/** Prev/next pager for paginated list endpoints; renders nothing when everything fits on one page. */
export function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-300 text-ink-900 hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>
      <span className="text-sm text-ink-900/70">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-300 text-ink-900 hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </nav>
  );
}
