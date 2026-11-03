import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useDisplayPrice } from "../../hooks/useDisplayPrice";
import { isAdminRole } from "../../lib/roles";
import { useCartStore } from "../../store/cartStore";
import { useWishlistStore } from "../../store/wishlistStore";
import type { Product } from "../../types";
import { CartIcon, HeartFilledIcon, HeartIcon } from "../icons/Icon";
import { StarRating } from "../common/StarRating";

/** Stock level at/below which the card shows an urgency message instead of just "in stock" - matches nothing server-side, purely a display nudge. */
const LOW_STOCK_THRESHOLD = 3;

/** Clickable product tile showing image, metal/category, name, rating, price and stock status; links to the product detail page. */
export function ProductCard({ product }: { product: Product }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const formatPrice = useDisplayPrice();
  const isWishlisted = useWishlistStore((s) => s.productIds.has(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const addItem = useCartStore((s) => s.addItem);
  // Wishlist/cart are shopping features, not relevant to an admin's own
  // account - hidden entirely (not just disabled) rather than shown as a
  // dead control. Signed-out visitors still see both (clicking prompts
  // sign-in, unchanged) - this only hides them for a signed-in admin
  // specifically. The wishlist restriction is also enforced server-side
  // (`wishlist.service.ts`'s `addToWishlist()`); cart has no server
  // endpoint at all (pure client state), so hiding this button is the only
  // enforcement that's possible or needed.
  const isAdmin = isAdminRole(user?.role);

  /** Toggles the wishlist heart without following the card's link, prompting sign-in if the shopper isn't authenticated. */
  async function handleWishlistClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      showToast("Sign in to save items to your wishlist.", "error");
      return;
    }
    try {
      await toggleWishlist(product.id);
    } catch {
      showToast("Couldn't update your wishlist. Try again.", "error");
    }
  }

  /** Adds one unit straight from the grid, without following the card's link into the product detail page. */
  function handleQuickAdd(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    addItem(product, 1);
    showToast(`${product.name} added to cart.`);
  }

  const isOutOfStock = product.stockQuantity <= 0;
  const isLowStock = !isOutOfStock && product.stockQuantity <= LOW_STOCK_THRESHOLD;

  return (
    <Link
      to={`/shop/${product.id}`}
      className="group relative block overflow-hidden rounded-xl border border-brand-200 bg-white transition-shadow hover:shadow-lg"
    >
      {!isAdmin && (
        <button
          type="button"
          onClick={handleWishlistClick}
          aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
          aria-pressed={isWishlisted}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-brand-600 shadow hover:bg-white"
        >
          {isWishlisted ? <HeartFilledIcon className="h-4 w-4" /> : <HeartIcon className="h-4 w-4" />}
        </button>
      )}

      {!isOutOfStock && !isAdmin && (
        <button
          type="button"
          onClick={handleQuickAdd}
          aria-label={`Add ${product.name} to cart`}
          className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-brand-600 opacity-0 shadow transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100"
        >
          <CartIcon className="h-4 w-4" />
        </button>
      )}

      <div className="aspect-square overflow-hidden bg-brand-100">
        {product.imageUrl && (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-brand-500">
          {product.metalType.toLowerCase()} · {product.category.toLowerCase()}
        </p>
        <h3 className="mt-1 font-serif text-lg text-ink-900">{product.name}</h3>
        {!!product.reviewCount && (
          <div className="mt-1 flex items-center gap-1.5">
            <StarRating rating={product.averageRating ?? 0} size="h-3.5 w-3.5" />
            <span className="text-xs text-ink-900/50">({product.reviewCount})</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-lg font-semibold text-brand-700">{formatPrice(product.currentPriceCents)}</span>
          {isOutOfStock && <span className="text-xs font-medium text-red-600">Out of stock</span>}
          {isLowStock && <span className="text-xs font-medium text-amber-600">Only {product.stockQuantity} left</span>}
        </div>
      </div>
    </Link>
  );
}
