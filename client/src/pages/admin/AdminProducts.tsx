import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bulkDeleteProducts, bulkSetProductsActive, deleteProduct, fetchProducts } from "../../api/products";
import { Pagination } from "../../components/common/Pagination";
import { PencilIcon, PlusIcon, TrashIcon } from "../../components/icons/Icon";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { CATEGORIES_BY_TYPE } from "../../lib/catalog";
import { formatCents } from "../../lib/format";
import type { Category, MetalType, Product, ProductType } from "../../types";

const PAGE_SIZE = 20;

const TABS: { value: ProductType | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "JEWELRY", label: "Jewelry" },
  { value: "BULLION", label: "Bullion" },
];

const METALS: MetalType[] = ["GOLD", "SILVER"];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "weight-asc", label: "Weight: low to high" },
  { value: "weight-desc", label: "Weight: high to low" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * Admin product listing (including inactive products), split into
 * Jewelry/Bullion/All tabs for easier management, with search/category/
 * metal/price filters, sorting, pagination, and per-row and bulk edit/
 * delete/activate actions.
 */
export function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<ProductType | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [category, setCategory] = useState<Category | "">("");
  const [metalType, setMetalType] = useState<MetalType | "">("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<SortValue>("newest");
  const confirm = useConfirm();
  const { showToast } = useToast();

  const categoryOptions = tab === "ALL" ? [...CATEGORIES_BY_TYPE.JEWELRY, ...CATEGORIES_BY_TYPE.BULLION] : CATEGORIES_BY_TYPE[tab];

  /** (Re)loads the current page of the product list, including inactive products, from the server. */
  function load() {
    const [sortBy, sortOrder] = sort === "newest" ? [undefined, undefined] : (sort.split("-") as ["price" | "weight", "asc" | "desc"]);
    const minPriceCents = minPrice ? Math.round(Number(minPrice) * 100) : undefined;
    const maxPriceCents = maxPrice ? Math.round(Number(maxPrice) * 100) : undefined;
    fetchProducts({
      page,
      pageSize: PAGE_SIZE,
      includeInactive: true,
      productType: tab === "ALL" ? undefined : tab,
      category: category || undefined,
      metalType: metalType || undefined,
      search: debouncedSearch || undefined,
      minPriceCents: minPriceCents !== undefined && !Number.isNaN(minPriceCents) ? minPriceCents : undefined,
      maxPriceCents: maxPriceCents !== undefined && !Number.isNaN(maxPriceCents) ? maxPriceCents : undefined,
      sortBy,
      sortOrder,
    })
      .then((res) => {
        setProducts(res.items);
        setTotal(res.total);
        setSelectedIds(new Set());
      })
      .catch(() => showToast("Couldn't load products.", "error"));
  }

  useEffect(load, [page, tab, category, metalType, debouncedSearch, minPrice, maxPrice, sort]);

  // Reset back to page 1 whenever a filter/tab (not the page itself) changes.
  useEffect(() => {
    setPage(1);
  }, [tab, category, metalType, debouncedSearch, minPrice, maxPrice, sort]);

  /** Switches the tab, resetting the category filter if it no longer applies to the new tab. */
  function handleTabChange(next: ProductType | "ALL") {
    setTab(next);
    if (next !== "ALL" && category && !CATEGORIES_BY_TYPE[next].includes(category)) {
      setCategory("");
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => (current.size === products.length ? new Set() : new Set(products.map((p) => p.id))));
  }

  /** Confirms with the user, then deletes the product and refreshes the list. */
  async function handleDelete(id: string) {
    const confirmed = await confirm("Delete this product? This cannot be undone.", {
      title: "Delete product",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteProduct(id);
      load();
      showToast("Product deleted.");
    } catch {
      showToast("Couldn't delete that product.", "error");
    }
  }

  async function handleBulkSetActive(isActive: boolean) {
    try {
      await bulkSetProductsActive([...selectedIds], isActive);
      load();
      showToast(isActive ? "Products activated." : "Products deactivated.");
    } catch {
      showToast("Couldn't update the selected products.", "error");
    }
  }

  async function handleBulkDelete() {
    const confirmed = await confirm(`Delete ${selectedIds.size} selected product(s)? This cannot be undone.`, {
      title: "Delete products",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await bulkDeleteProducts([...selectedIds]);
      load();
      showToast("Products deleted.");
    } catch {
      showToast("Couldn't delete the selected products.", "error");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Products</h1>
        <Link
          to="/admin/products/new"
          className="flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
        >
          <PlusIcon className="h-4 w-4" /> New product
        </Link>
      </div>

      <div className="mt-4 flex gap-1 border-b border-brand-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTabChange(t.value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-ink-900/60 hover:text-ink-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or description..."
          aria-label="Search products"
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "")}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>{titleCase(c)}</option>
          ))}
        </select>
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
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-ink-900/60">$</span>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="Min"
            aria-label="Minimum price"
            className="w-20 rounded-full border border-brand-300 px-3 py-2 text-sm"
          />
          <span className="text-sm text-ink-900/40">–</span>
          <span className="text-sm text-ink-900/60">$</span>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max"
            aria-label="Maximum price"
            className="w-20 rounded-full border border-brand-300 px-3 py-2 text-sm"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortValue)}
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="text-sm text-ink-900/50">{total} product{total === 1 ? "" : "s"}</span>
      </div>

      {selectedIds.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-ink-900">{selectedIds.size} selected</span>
          <button
            onClick={() => handleBulkSetActive(true)}
            className="rounded-full border border-brand-300 bg-white px-3 py-1.5 text-ink-900/80 hover:bg-brand-100"
          >
            Activate
          </button>
          <button
            onClick={() => handleBulkSetActive(false)}
            className="rounded-full border border-brand-300 bg-white px-3 py-1.5 text-ink-900/80 hover:bg-brand-100"
          >
            Deactivate
          </button>
          <button
            onClick={handleBulkDelete}
            className="rounded-full border border-red-300 bg-white px-3 py-1.5 text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-brand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-brand-100/60 text-left text-ink-900/60">
            <tr>
              <th className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={products.length > 0 && selectedIds.size === products.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all products on this page"
                />
              </th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Stock</th>
              <th className="px-4 py-2">Active</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-900/50">
                  No products match your filters.
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t border-brand-100">
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelected(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </td>
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2 text-ink-900/60">{p.sku}</td>
                <td className="px-4 py-2 text-ink-900/60">
                  {p.productType === "BULLION" ? "Bullion" : "Jewelry"} &middot; {titleCase(p.category)}
                </td>
                <td className="px-4 py-2">{formatCents(p.currentPriceCents)}</td>
                <td className="px-4 py-2">{p.stockQuantity}</td>
                <td className="px-4 py-2">{p.isActive ? "Yes" : "No"}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <Link
                    to={`/admin/products/${p.id}`}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-brand-600 hover:bg-brand-50 hover:underline"
                  >
                    <PencilIcon className="h-3.5 w-3.5" /> Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50 hover:underline"
                  >
                    <TrashIcon className="h-3.5 w-3.5" /> Delete
                  </button>
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
