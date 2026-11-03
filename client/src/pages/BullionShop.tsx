import { useEffect, useState } from "react";
import { fetchProducts } from "../api/products";
import { CloseIcon } from "../components/icons/Icon";
import { MetalPricesPanel } from "../components/metals/MetalPricesPanel";
import { Pagination } from "../components/common/Pagination";
import { ProductCard } from "../components/product/ProductCard";
import { ProductGridSkeleton } from "../components/common/Skeleton";
import { Breadcrumbs } from "../components/common/Breadcrumbs";
import { useToast } from "../context/ToastContext";
import type { MetalType, Product } from "../types";

const METALS: MetalType[] = ["GOLD", "SILVER"];
const CATEGORIES: Array<"BAR" | "COIN"> = ["BAR", "COIN"];
const PAGE_SIZE = 24;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "weight-asc", label: "Weight: low to high" },
  { value: "weight-desc", label: "Weight: high to low" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

/** Formats a gram amount for a filter option label, e.g. "1g" or "31.1g". */
function formatWeightOption(grams: number) {
  return `${Number(grams.toFixed(2))}g`;
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * Storefront page for bullion (gold/silver bars, coins, etc.) as opposed to
 * jewelry - a separate catalog reachable from its own navbar link. Metal type
 * and category filter the catalog server-side; the weight filter's options
 * are derived from whichever metal/category is currently selected (fetched
 * separately so choosing a weight doesn't shrink its own option list).
 */
export function BullionShop() {
  const { showToast } = useToast();
  const [metalType, setMetalType] = useState<MetalType | "">("");
  const [category, setCategory] = useState<"BAR" | "COIN" | "">("");
  const [weightGrams, setWeightGrams] = useState<number | "">("");
  const [sort, setSort] = useState<SortValue>("newest");

  const [weightOptions, setWeightOptions] = useState<number[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Reset back to page 1 whenever a filter (not the page itself) changes.
  useEffect(() => {
    setPage(1);
  }, [metalType, category, weightGrams, sort]);

  // Weight options for the current metal/category filter, independent of
  // whichever weight (if any) is currently selected.
  useEffect(() => {
    fetchProducts({
      productType: "BULLION",
      metalType: metalType || undefined,
      category: category || undefined,
      pageSize: 100,
    })
      .then((res) => {
        const distinct = Array.from(new Set(res.items.map((p) => p.weightGrams))).sort((a, b) => a - b);
        setWeightOptions(distinct);
      })
      .catch(() => {
        showToast("Couldn't load products. Try again.", "error");
      });
  }, [metalType, category, showToast]);

  useEffect(() => {
    setIsLoading(true);
    const [sortBy, sortOrder] = sort === "newest" ? [undefined, undefined] : (sort.split("-") as ["price" | "weight", "asc" | "desc"]);
    fetchProducts({
      productType: "BULLION",
      metalType: metalType || undefined,
      category: category || undefined,
      weightGrams: weightGrams || undefined,
      sortBy,
      sortOrder,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        setProducts(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        showToast("Couldn't load products. Try again.", "error");
      })
      .finally(() => {
        setIsLoading(false);
        setHasLoaded(true);
      });
  }, [metalType, category, weightGrams, sort, page, showToast]);

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (metalType) chips.push({ key: "metalType", label: `Metal: ${titleCase(metalType)}`, onClear: () => setMetalType("") });
  if (category) chips.push({ key: "category", label: `Type: ${titleCase(category)}`, onClear: () => setCategory("") });
  if (weightGrams) chips.push({ key: "weight", label: `Weight: ${formatWeightOption(weightGrams)}`, onClear: () => setWeightGrams("") });

  function clearAllFilters() {
    setMetalType("");
    setCategory("");
    setWeightGrams("");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Gold & Silver" }]} />
      <h1 className="mt-2 font-serif text-3xl text-ink-900 sm:text-4xl">Gold &amp; Silver</h1>
      <p className="mt-2 text-ink-900/70">
        Bullion bars, coins, and rounds priced directly off today's gold and silver spot rates.
      </p>

      <div className="mt-4">
        <MetalPricesPanel variant="compact" />
      </div>

      <button
        type="button"
        onClick={() => setIsFilterOpen((v) => !v)}
        aria-expanded={isFilterOpen}
        aria-controls="bullion-filters"
        className="mt-6 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-brand-300 bg-white px-4 py-2.5 text-sm font-medium text-ink-900 sm:hidden"
      >
        Filters
        <span aria-hidden="true" className={`transition-transform ${isFilterOpen ? "rotate-180" : ""}`}>
          &#9662;
        </span>
      </button>

      <div
        id="bullion-filters"
        className={`mt-3 flex-wrap gap-3 sm:mt-6 sm:flex ${isFilterOpen ? "flex" : "hidden"}`}
      >
        <select
          value={metalType}
          onChange={(e) => setMetalType(e.target.value as MetalType | "")}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          <option value="">All metals</option>
          {METALS.map((m) => (
            <option key={m} value={m}>{titleCase(m)}</option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as "BAR" | "COIN" | "")}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          <option value="">All types</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{titleCase(c)}</option>
          ))}
        </select>
        <select
          value={weightGrams}
          onChange={(e) => setWeightGrams(e.target.value ? Number(e.target.value) : "")}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          <option value="">All weights</option>
          {weightOptions.map((w) => (
            <option key={w} value={w}>{formatWeightOption(w)}</option>
          ))}
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
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-xs text-ink-900/80 hover:bg-brand-200"
            >
              {chip.label}
              <CloseIcon className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {isLoading && !hasLoaded ? (
        <div className="mt-8">
          <ProductGridSkeleton count={8} />
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-ink-900/60">
            {total === 0 ? "No products found" : `${total} product${total === 1 ? "" : "s"} found`}
          </p>
          {products.length === 0 ? (
            <p className="mt-10 text-center text-ink-900/60">No products match your filters.</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </>
          )}
        </>
      )}
    </div>
  );
}
