import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../types";
import { FeaturedCarousel } from "./FeaturedCarousel";

// Shallow-rendered - FeaturedCarousel's own pagination/autoplay/a11y logic
// is what's under test here, not ProductCard's (which has its own
// wishlist/cart/toast dependencies, irrelevant to this component).
vi.mock("../product/ProductCard", () => ({
  ProductCard: ({ product }: { product: Product }) => <div>{product.name}</div>,
}));

/**
 * A faithful-enough fake `window.matchMedia`: each query gets its own
 * `MediaQueryList` backed by a registry entry, and `addEventListener`
 * actually stores the callback rather than discarding it - so
 * `simulateViewportChange()` below can flip `.matches` and fire real
 * `"change"` callbacks, exercising `useMediaQuery`'s live-update path
 * (registering a no-op listener would make every test pass trivially
 * without ever proving the hook reacts to a real viewport change).
 */
let mqlRegistry: Map<string, { matches: boolean; listeners: Set<() => void> }>;

function mockMatchMedia(matchingQueries: string[]) {
  mqlRegistry = new Map();
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    if (!mqlRegistry.has(query)) {
      mqlRegistry.set(query, { matches: matchingQueries.includes(query), listeners: new Set() });
    }
    const entry = mqlRegistry.get(query)!;
    return {
      get matches() {
        return entry.matches;
      },
      media: query,
      addEventListener: (_event: string, cb: () => void) => entry.listeners.add(cb),
      removeEventListener: (_event: string, cb: () => void) => entry.listeners.delete(cb),
    };
  });
}

/** Flips every registered query's `.matches` to reflect a new viewport and fires their `"change"` listeners - simulates a real resize/orientation change. */
function simulateViewportChange(matchingQueries: string[]) {
  for (const [query, entry] of mqlRegistry) {
    entry.matches = matchingQueries.includes(query);
  }
  for (const entry of mqlRegistry.values()) {
    entry.listeners.forEach((cb) => cb());
  }
}

function makeProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    sku: `SKU-${i + 1}`,
    name: `Product ${i + 1}`,
    description: "d",
    productType: "JEWELRY",
    category: "RING",
    metalType: "GOLD",
    purity: 0.75,
    weightGrams: 2,
    makingChargeCents: 0,
    currentPriceCents: 1000,
    stockQuantity: 5,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  }));
}

const DESKTOP = ["(min-width: 1024px)", "(min-width: 640px)"];
const TABLET = ["(min-width: 640px)"];
const MOBILE: string[] = [];

/**
 * Looks up a slide by its "Slide X of Y" label - by the raw `aria-label`
 * *attribute*, not `getByRole`'s name-matching. An `aria-hidden` element's
 * *computed* accessible name is empty per the ARIA spec (correctly: hidden
 * content isn't exposed to assistive tech at all) even with `{ hidden:
 * true }` passed (that option only stops `getByRole` from excluding the
 * element outright - it doesn't change how its name is computed), so
 * name-based matching can never find an inactive (aria-hidden) slide no
 * matter what. Querying by role broadly, then filtering on the attribute
 * directly, sidesteps that without giving up an assertion that the element
 * genuinely has `role="group"`.
 */
function getSlide(name: string) {
  const slide = screen
    .getAllByRole("group", { hidden: true })
    .find((el) => el.getAttribute("aria-label") === name);
  if (!slide) throw new Error(`No slide with aria-label "${name}" found`);
  return slide;
}

describe("FeaturedCarousel", () => {
  beforeEach(() => {
    mockMatchMedia(DESKTOP);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing for an empty product list", () => {
    const { container } = render(<FeaturedCarousel products={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single slide with no navigation when everything fits on one page", () => {
    render(<FeaturedCarousel products={makeProducts(3)} />);
    expect(screen.getByText("Product 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next featured products/i })).not.toBeInTheDocument();
  });

  describe("responsive items-per-slide", () => {
    it("shows 3 products per slide on desktop (>=1024px)", () => {
      mockMatchMedia(DESKTOP);
      render(<FeaturedCarousel products={makeProducts(6)} />);
      // 6 products / 3 per slide = 2 pages -> 2 dots, and the first slide has 3 visible products.
      expect(screen.getAllByRole("button", { name: /show featured products, page/i })).toHaveLength(2);
      const firstSlide = getSlide("Slide 1 of 2");
      expect(within(firstSlide).getAllByText(/^Product \d$/)).toHaveLength(3);
    });

    it("shows 2 products per slide on tablet (640-1023px)", () => {
      mockMatchMedia(TABLET);
      render(<FeaturedCarousel products={makeProducts(6)} />);
      // 6 / 2 per slide = 3 pages.
      expect(screen.getAllByRole("button", { name: /show featured products, page/i })).toHaveLength(3);
      const firstSlide = getSlide("Slide 1 of 3");
      expect(within(firstSlide).getAllByText(/^Product \d$/)).toHaveLength(2);
    });

    it("shows 1 product per slide on mobile (<640px)", () => {
      mockMatchMedia(MOBILE);
      render(<FeaturedCarousel products={makeProducts(6)} />);
      // 6 / 1 per slide = 6 pages.
      expect(screen.getAllByRole("button", { name: /show featured products, page/i })).toHaveLength(6);
      const firstSlide = getSlide("Slide 1 of 6");
      expect(within(firstSlide).getAllByText(/^Product \d$/)).toHaveLength(1);
    });
  });

  describe("navigation", () => {
    it("advances to the next slide and wraps around past the last one", async () => {
      const user = userEvent.setup();
      render(<FeaturedCarousel products={makeProducts(6)} />); // desktop: 2 pages

      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");
      await user.click(screen.getByRole("button", { name: /next featured products/i }));
      expect(getSlide("Slide 2 of 2")).toHaveAttribute("aria-hidden", "false");
      // Wraps back to slide 1 from the last one.
      await user.click(screen.getByRole("button", { name: /next featured products/i }));
      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");
    });

    it("goes to the previous slide, wrapping to the last one from the first", async () => {
      const user = userEvent.setup();
      render(<FeaturedCarousel products={makeProducts(6)} />);
      await user.click(screen.getByRole("button", { name: /previous featured products/i }));
      expect(getSlide("Slide 2 of 2")).toHaveAttribute("aria-hidden", "false");
    });

    it("jumps to a specific page via its dot", async () => {
      const user = userEvent.setup();
      render(<FeaturedCarousel products={makeProducts(9)} />); // desktop: 3 pages
      await user.click(screen.getByRole("button", { name: "Show featured products, page 3" }));
      expect(getSlide("Slide 3 of 3")).toHaveAttribute("aria-hidden", "false");
      expect(screen.getByRole("button", { name: "Show featured products, page 3" })).toHaveAttribute("aria-current", "true");
    });

    it("navigates with the Left/Right arrow keys", async () => {
      const user = userEvent.setup();
      render(<FeaturedCarousel products={makeProducts(6)} />);
      const nextButton = screen.getByRole("button", { name: /next featured products/i });
      nextButton.focus();
      await user.keyboard("{ArrowRight}");
      expect(getSlide("Slide 2 of 2")).toHaveAttribute("aria-hidden", "false");
      await user.keyboard("{ArrowLeft}");
      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");
    });

    it("clamps back to the first page when a viewport change leaves it pointing past the new last page", async () => {
      mockMatchMedia(MOBILE);
      const user = userEvent.setup();
      render(<FeaturedCarousel products={makeProducts(6)} />); // mobile: 6 pages, one product each

      // Navigate to page 5 of 6 (index 4) - out of bounds once the page
      // count shrinks to 2 on a desktop-sized viewport.
      await user.click(screen.getByRole("button", { name: "Show featured products, page 5" }));
      expect(getSlide("Slide 5 of 6")).toHaveAttribute("aria-hidden", "false");

      act(() => simulateViewportChange(DESKTOP));
      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");
    });
  });

  describe("autoplay", () => {
    it("auto-advances on a timer", () => {
      vi.useFakeTimers();
      render(<FeaturedCarousel products={makeProducts(6)} />);
      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");
      // The interval callback's setState needs to run inside `act()` to be
      // flushed before the assertion - `vi.advanceTimersByTime` on its own
      // runs the callback synchronously but outside React's batching, so
      // the DOM wouldn't reflect it yet without this.
      act(() => vi.advanceTimersByTime(5000));
      expect(getSlide("Slide 2 of 2")).toHaveAttribute("aria-hidden", "false");
    });

    it("pauses on hover and resumes on mouse leave", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<FeaturedCarousel products={makeProducts(6)} />);
      const region = screen.getByRole("region", { name: /featured products/i });

      await user.hover(region);
      act(() => vi.advanceTimersByTime(10000));
      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");

      await user.unhover(region);
      act(() => vi.advanceTimersByTime(5000));
      expect(getSlide("Slide 2 of 2")).toHaveAttribute("aria-hidden", "false");
    });

    it("never auto-advances when the visitor prefers reduced motion", () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)" || DESKTOP.includes(query),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      vi.useFakeTimers();
      render(<FeaturedCarousel products={makeProducts(6)} />);
      act(() => vi.advanceTimersByTime(20000));
      expect(getSlide("Slide 1 of 2")).toHaveAttribute("aria-hidden", "false");
    });
  });

  describe("accessibility", () => {
    it("exposes the carousel/slide ARIA roles and labels", () => {
      render(<FeaturedCarousel products={makeProducts(6)} />);
      expect(screen.getByRole("region", { name: "Featured products" })).toHaveAttribute(
        "aria-roledescription",
        "carousel"
      );
      const slide = getSlide("Slide 1 of 2");
      expect(slide).toHaveAttribute("aria-roledescription", "slide");
    });

    it("marks every non-active slide inert so it's out of the tab order and accessibility tree", () => {
      render(<FeaturedCarousel products={makeProducts(6)} />);
      expect(getSlide("Slide 1 of 2")).not.toHaveAttribute("inert");
      // The second slide is off-screen - queryable only because inert
      // doesn't remove it from the DOM, just from focus/AT interaction.
      expect(getSlide("Slide 2 of 2")).toHaveAttribute("inert");
    });

    it("marks the current page's dot with aria-current", async () => {
      const user = userEvent.setup();
      render(<FeaturedCarousel products={makeProducts(6)} />);
      expect(screen.getByRole("button", { name: "Show featured products, page 1" })).toHaveAttribute(
        "aria-current",
        "true"
      );
      await user.click(screen.getByRole("button", { name: /next featured products/i }));
      expect(screen.getByRole("button", { name: "Show featured products, page 2" })).toHaveAttribute(
        "aria-current",
        "true"
      );
    });
  });
});
