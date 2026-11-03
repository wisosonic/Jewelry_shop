import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons/Icon";
import { ProductCard } from "../product/ProductCard";
import type { Product } from "../../types";

const AUTO_ADVANCE_MS = 5000;

/** Splits a flat list into consecutive chunks of at most `size` items each. */
function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/**
 * Auto-advancing carousel of featured products, with manual prev/next
 * arrows and dot navigation - one dot per page, not per product. Auto-advance
 * pauses while hovered or focused, stops entirely with a single page
 * (nothing to advance to), and is skipped altogether for a visitor with the
 * OS-level "reduce motion" preference set (`prefers-reduced-motion`) - the
 * carousel is then fully manual, and the slide transition itself becomes
 * instant (Tailwind's `motion-reduce:` variant, not a JS branch, since
 * that's a pure CSS concern).
 *
 * **Items per slide is responsive, not a fixed constant**: 1 on mobile
 * (below Tailwind's `sm`, 640px), 2 from `sm` up to `lg` (640-1023px), 3 at
 * `lg` and above (1024px+) - tracked live via `useMediaQuery` so resizing
 * the window (or rotating a device) re-paginates immediately, matching
 * whatever the per-slide grid's own `sm:`/`lg:` column classes show at that
 * width. The two must always stay in lock-step (chunk size in JS == grid
 * column count in CSS) - a mismatch is exactly the bug this fixed: showing
 * 3-item chunks through a single-column mobile grid stacked all 3 products
 * vertically inside one nominal "slide", making the carousel's height wildly
 * inconsistent between slides and effectively broken on small screens.
 *
 * **Accessibility**: the whole thing is one `role="region"` with
 * `aria-roledescription="carousel"`; each slide is a `role="group"` with
 * `aria-roledescription="slide"` and a `"Slide X of Y"` label. The
 * non-active slide(s) are marked `inert` (removes their buttons/links from
 * both the tab order and the accessibility tree - React 19's native `inert`
 * prop, not a manual `tabIndex`/`aria-hidden` combination on every
 * descendant) so a keyboard or screen-reader user tabbing through the page
 * never lands on an off-screen product card. Left/Right arrow keys move to
 * the previous/next slide whenever focus is anywhere inside the carousel
 * (the prev/next buttons, a dot, or - via event bubbling - any focused
 * control within the visible slide).
 */
export function FeaturedCarousel({ products }: { products: Product[] }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 640px)");
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const productsPerSlide = isDesktop ? 3 : isTablet ? 2 : 1;

  const pages = chunk(products, productsPerSlide);
  const pageCount = pages.length;

  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const goTo = useCallback(
    (next: number) => setIndex(((next % pageCount) + pageCount) % pageCount),
    [pageCount]
  );

  // The number of pages changes whenever `productsPerSlide` does (a resize
  // crossing a breakpoint) - clamp back to a valid page rather than pointing
  // past the end of a now-shorter page list.
  useEffect(() => {
    setIndex((i) => (i >= pageCount ? 0 : i));
  }, [pageCount]);

  useEffect(() => {
    if (pageCount <= 1 || isPaused || prefersReducedMotion) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % pageCount), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [pageCount, isPaused, prefersReducedMotion]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(index + 1);
    }
  }

  if (pageCount === 0) return null;

  return (
    <div
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured products"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
    >
      <div className="overflow-hidden">
        <div
          // Only `transform` is set inline (the one value that has to be
          // computed dynamically) - the transition itself stays in classes
          // on purpose: an inline `style` always wins over a class
          // regardless of specificity or media queries, so putting
          // `transitionProperty`/`transitionDuration` inline here would
          // silently defeat `motion-reduce:transition-none` below for
          // anyone with the OS "reduce motion" preference set.
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {pages.map((page, pageIndex) => (
            <div
              key={pageIndex}
              role="group"
              aria-roledescription="slide"
              aria-label={`Slide ${pageIndex + 1} of ${pageCount}`}
              aria-hidden={pageIndex !== index}
              inert={pageIndex !== index}
              className="grid w-full shrink-0 grid-cols-1 gap-6 px-1 sm:grid-cols-2 lg:grid-cols-3"
            >
              {page.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {pageCount > 1 && (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label="Previous featured products"
            className="absolute -left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-brand-200 bg-white text-ink-900 shadow hover:bg-brand-50 sm:-left-5"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label="Next featured products"
            className="absolute -right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-brand-200 bg-white text-ink-900 shadow hover:bg-brand-50 sm:-right-5"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>

          <div className="mt-6 flex justify-center gap-2">
            {pages.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show featured products, page ${i + 1}`}
                aria-current={i === index}
                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                  i === index ? "bg-brand-600" : "bg-brand-200 hover:bg-brand-300"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
