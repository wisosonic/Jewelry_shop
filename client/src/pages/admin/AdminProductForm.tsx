import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createProduct, fetchProduct, updateProduct, uploadProductImage, type ProductInput } from "../../api/products";
import { CheckIcon } from "../../components/icons/Icon";
import { useToast } from "../../context/ToastContext";
import { CATEGORIES_BY_TYPE } from "../../lib/catalog";
import type { ProductType } from "../../types";

const EMPTY: ProductInput = {
  sku: "",
  name: "",
  description: "",
  productType: "JEWELRY",
  category: "RING",
  metalType: "GOLD",
  purity: 0.75,
  weightGrams: 1,
  makingChargeCents: 0,
  stockQuantity: 0,
  imageUrl: "",
  isActive: true,
};

/**
 * Admin form for creating or editing a product (route param `id` of `"new"`
 * means create). Handles image upload/URL entry; the resulting price is
 * always computed server-side from metal price, purity, weight and commission.
 */
export function AdminProductForm() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id) && id !== "new";
  const [form, setForm] = useState<ProductInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    if (isEditing && id) {
      fetchProduct(id)
        .then((p) => {
          setForm({
            sku: p.sku,
            name: p.name,
            description: p.description,
            productType: p.productType,
            category: p.category,
            metalType: p.metalType,
            purity: p.purity,
            weightGrams: p.weightGrams,
            makingChargeCents: p.makingChargeCents,
            stockQuantity: p.stockQuantity,
            imageUrl: p.imageUrl ?? "",
            isActive: p.isActive,
          });
          setHasLoaded(true);
        })
        // On failure, `hasLoaded` never becomes true - the form itself (which
        // still shows `EMPTY`'s defaults) is never rendered, per the guard
        // below. Without this, an admin could otherwise submit an "edit"
        // form that silently overwrote a real product with unrelated
        // new-product defaults.
        .catch(() => setLoadError(true));
    } else {
      setHasLoaded(true);
    }
  }, [id, isEditing]);

  const [isUploading, setIsUploading] = useState(false);

  /** Uploads the selected file and stores the returned URL as the product's image. */
  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setError(null);
    try {
      const url = await uploadProductImage(file);
      setForm((prev) => ({ ...prev, imageUrl: url }));
    } catch {
      setError("Could not upload image.");
    } finally {
      setIsUploading(false);
    }
  }

  /** Creates or updates the product depending on whether an existing id is being edited. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (isEditing && id) {
        await updateProduct(id, form);
      } else {
        await createProduct(form);
      }
      showToast(isEditing ? "Product updated." : "Product created.");
      navigate("/admin/products");
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? "Could not save product.");
    }
  }

  /** Returns a controlled-input `value`/`onChange` pair for one form field, coercing numeric fields to `Number`. */
  function field<K extends keyof ProductInput>(key: K) {
    return {
      value: form[key] as never,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const raw = e.target.value;
        const numeric = ["purity", "weightGrams", "makingChargeCents", "stockQuantity"].includes(key as string);
        setForm({ ...form, [key]: numeric ? Number(raw) : raw });
      },
    };
  }

  /**
   * Switches product type, resetting category to the first option valid for
   * the new type. Also zeroes `makingChargeCents` when switching to
   * BULLION - the making-charge input is hidden for bullion below (it has
   * no effect on price - see `pricing.ts`'s `computePriceCents()`), so a
   * value left over from JEWELRY shouldn't linger unseen in the form state.
   */
  function handleProductTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const productType = e.target.value as ProductType;
    setForm({
      ...form,
      productType,
      category: CATEGORIES_BY_TYPE[productType][0],
      makingChargeCents: productType === "BULLION" ? 0 : form.makingChargeCents,
    });
  }

  if (loadError) {
    return (
      <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load this product.{" "}
        <button onClick={() => navigate("/admin/products")} className="font-medium underline">
          Back to products
        </button>
      </div>
    );
  }

  if (!hasLoaded) return <p className="text-ink-900/60">Loading...</p>;

  return (
    <div className="max-w-xl">
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">{isEditing ? "Edit product" : "New product"}</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input required placeholder="SKU" {...field("sku")} className="w-full rounded-lg border border-brand-300 px-3 py-2" />
        <input required placeholder="Name" {...field("name")} className="w-full rounded-lg border border-brand-300 px-3 py-2" />
        <textarea required placeholder="Description" rows={3} {...field("description")} className="w-full rounded-lg border border-brand-300 px-3 py-2" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select value={form.productType} onChange={handleProductTypeChange} className="rounded-lg border border-brand-300 px-3 py-2">
            <option value="JEWELRY">Jewelry</option>
            <option value="BULLION">Bullion (bars/coins)</option>
          </select>
          <select {...field("metalType")} className="rounded-lg border border-brand-300 px-3 py-2">
            {["GOLD", "SILVER"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <select {...field("category")} className="w-full rounded-lg border border-brand-300 px-3 py-2">
          {CATEGORIES_BY_TYPE[form.productType].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div className={`grid grid-cols-1 gap-3 ${form.productType === "JEWELRY" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <label className="text-sm text-ink-900/70">
            Purity (0-1)
            <input type="number" step="0.001" min={0} max={1} required {...field("purity")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
          </label>
          <label className="text-sm text-ink-900/70">
            Weight (g)
            <input type="number" step="0.01" min={0} required {...field("weightGrams")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
          </label>
          {form.productType === "JEWELRY" && (
            <label className="text-sm text-ink-900/70">
              Making charge (cents)
              <input type="number" min={0} required {...field("makingChargeCents")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
            </label>
          )}
        </div>
        {form.productType === "BULLION" && (
          <p className="text-xs text-ink-900/50">
            Bullion has no making charge - it's bought for its raw metal content, not crafted.
          </p>
        )}

        <label className="block text-sm text-ink-900/70">
          Stock quantity
          <input type="number" min={0} required {...field("stockQuantity")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
        </label>

        <div className="flex flex-wrap items-center gap-4">
          {form.imageUrl && (
            <img src={form.imageUrl} alt="" loading="lazy" decoding="async" className="h-16 w-16 rounded-lg object-cover" />
          )}
          <div className="flex-1 space-y-2">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleImageSelected}
              disabled={isUploading}
              className="block w-full text-sm text-ink-900/70"
            />
            <input placeholder="or paste an image URL" {...field("imageUrl")} className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm" />
          </div>
        </div>
        {isUploading && <p className="text-xs text-ink-900/50">Uploading image...</p>}

        <label className="flex items-center gap-2 text-sm text-ink-900/70">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active (visible in the storefront)
        </label>

        <p className="text-xs text-ink-900/50">
          Price is calculated automatically from the current metal price, purity, weight and
          commission, and will update whenever those change.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700">
          <CheckIcon className="h-4 w-4" /> Save product
        </button>
      </form>
    </div>
  );
}
