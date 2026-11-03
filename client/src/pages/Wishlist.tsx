import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWishlist } from "../api/wishlist";
import { ProductGridSkeleton } from "../components/common/Skeleton";
import { ProductCard } from "../components/product/ProductCard";
import { useToast } from "../context/ToastContext";
import { useCartStore } from "../store/cartStore";
import type { Product } from "../types";

/** The signed-in user's saved products, toggled on/off from the heart button on `ProductCard`. */
export function Wishlist() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState(false);
  const { showToast } = useToast();
  const addItem = useCartStore((s) => s.addItem);

  const load = useCallback(() => {
    setError(false);
    setProducts(null);
    fetchWishlist()
      .then(setProducts)
      .catch(() => {
        setError(true);
        showToast("Couldn't load your wishlist.", "error");
      });
  }, [showToast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Adds every in-stock wishlisted product to the cart, skipping out-of-stock ones. */
  function handleAddAllToCart() {
    if (!products) return;
    const inStock = products.filter((p) => p.stockQuantity > 0);
    const outOfStockCount = products.length - inStock.length;
    inStock.forEach((product) => addItem(product, 1));

    if (inStock.length === 0) {
      showToast("All wishlisted items are out of stock.", "error");
    } else if (outOfStockCount > 0) {
      showToast(
        `Added ${inStock.length} item${inStock.length === 1 ? "" : "s"} to cart — ${outOfStockCount} ${
          outOfStockCount === 1 ? "is" : "are"
        } out of stock.`
      );
    } else {
      showToast(`Added ${inStock.length} item${inStock.length === 1 ? "" : "s"} to cart.`);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Wishlist</h1>
        <p className="mt-6 text-sm text-ink-900/60">
          Couldn't load your wishlist.{" "}
          <button onClick={load} className="text-brand-600 hover:underline">
            Try again
          </button>
        </p>
      </div>
    );
  }

  if (!products) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Wishlist</h1>
        <div className="mt-6">
          <ProductGridSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Wishlist</h1>
        {products.length > 0 && (
          <button
            onClick={handleAddAllToCart}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm text-white hover:bg-brand-700"
          >
            Add all to cart
          </button>
        )}
      </div>

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-ink-900/60">
          You haven't saved any products yet.{" "}
          <Link to="/shop" className="text-brand-600 hover:underline">
            Browse the shop
          </Link>
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
