import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchProduct, fetchRelatedProducts } from "../api/products";
import { deleteReview, fetchReviews, submitReview } from "../api/reviews";
import { CartIcon, CheckIcon, HeartFilledIcon, HeartIcon } from "../components/icons/Icon";
import { MetalPricesPanel } from "../components/metals/MetalPricesPanel";
import { ProductCard } from "../components/product/ProductCard";
import { ProductDetailSkeleton } from "../components/common/Skeleton";
import { QuantityStepper } from "../components/common/QuantityStepper";
import { StarRating } from "../components/common/StarRating";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDisplayPrice } from "../hooks/useDisplayPrice";
import { isAdminRole } from "../lib/roles";
import { useCartStore } from "../store/cartStore";
import { useWishlistStore } from "../store/wishlistStore";
import type { Product, Review } from "../types";

/** Matches `ProductCard.tsx`'s low-stock threshold so the urgency wording is consistent across the shop and detail pages. */
const LOW_STOCK_THRESHOLD = 3;

/** Single product page with details, a quantity picker (clamped to stock), an add-to-cart action, a wishlist toggle, reviews and related products. */
export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const addItem = useCartStore((s) => s.addItem);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const formatPrice = useDisplayPrice();
  const isWishlisted = useWishlistStore((s) => (product ? s.productIds.has(product.id) : false));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  // See ProductCard.tsx's identical note - wishlist/cart aren't relevant to
  // an admin's own account, hidden entirely for a signed-in admin only.
  const isAdmin = isAdminRole(user?.role);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [ratingInput, setRatingInput] = useState(0);
  const [commentInput, setCommentInput] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchProduct(id)
      .then(setProduct)
      .catch(() => {
        showToast("That product couldn't be found.", "error");
        navigate("/shop");
      });
    fetchRelatedProducts(id).then(setRelatedProducts).catch(() => setRelatedProducts([]));
  }, [id, navigate, showToast]);

  const loadReviews = () => {
    if (!id) return;
    setReviewsLoading(true);
    fetchReviews(id)
      .then((res) => {
        setReviews(res.reviews);
        setAverageRating(res.averageRating);
        setReviewCount(res.reviewCount);
      })
      .catch(() => showToast("Couldn't load reviews.", "error"))
      .finally(() => setReviewsLoading(false));
  };

  useEffect(loadReviews, [id]);

  /** Adds the selected quantity to the cart and briefly swaps the button to a "Added" confirmation state. Shared by the main and sticky mobile add-to-cart buttons. */
  function handleAddToCart() {
    if (!product) return;
    addItem(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  const myReview = user ? reviews.find((r) => r.userId === user.id) : undefined;

  useEffect(() => {
    setRatingInput(myReview?.rating ?? 0);
    setCommentInput(myReview?.comment ?? "");
    // Only re-seed the form when the loaded review itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReview?.id]);

  /** Toggles the wishlist heart, prompting sign-in if the shopper isn't authenticated. */
  async function handleWishlistClick() {
    if (!product) return;
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

  async function handleReviewSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id || ratingInput < 1) return;
    setIsSubmittingReview(true);
    try {
      await submitReview(id, { rating: ratingInput, comment: commentInput.trim() || undefined });
      showToast(myReview ? "Your review was updated." : "Thanks for your review!");
      loadReviews();
    } catch {
      showToast("Couldn't submit your review. Try again.", "error");
    } finally {
      setIsSubmittingReview(false);
    }
  }

  async function handleReviewDelete() {
    if (!id) return;
    try {
      await deleteReview(id);
      showToast("Your review was deleted.");
      loadReviews();
    } catch {
      showToast("Couldn't delete your review. Try again.", "error");
    }
  }

  if (!product) return <ProductDetailSkeleton />;

  const isOutOfStock = product.stockQuantity <= 0;
  const isLowStock = !isOutOfStock && product.stockQuantity <= LOW_STOCK_THRESHOLD;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 pb-20 sm:px-6 sm:pb-10 lg:px-8">
      <div className="grid gap-6 sm:gap-10 sm:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-xl bg-brand-100">
          {product.imageUrl && (
            <img src={product.imageUrl} alt={product.name} decoding="async" className="h-full w-full object-cover" />
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-brand-500">
            {product.metalType.toLowerCase()} · {product.category.toLowerCase()}
          </p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">{product.name}</h1>
            {!isAdmin && (
              <button
                type="button"
                onClick={handleWishlistClick}
                aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
                aria-pressed={isWishlisted}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-600 shadow-sm hover:bg-brand-50"
              >
                {isWishlisted ? <HeartFilledIcon className="h-5 w-5" /> : <HeartIcon className="h-5 w-5" />}
              </button>
            )}
          </div>
          {averageRating !== null && (
            <div className="mt-2 flex items-center gap-2">
              <StarRating rating={averageRating} size="h-4 w-4" />
              <span className="text-sm text-ink-900/60">
                {averageRating.toFixed(1)} ({reviewCount} review{reviewCount === 1 ? "" : "s"})
              </span>
            </div>
          )}
          <p className="mt-4 text-2xl font-semibold text-brand-700">{formatPrice(product.currentPriceCents)}</p>

          <details className="mt-2 text-sm text-ink-900/60">
            <summary className="cursor-pointer select-none text-brand-600 hover:underline">
              How is this price calculated?
            </summary>
            <p className="mt-2">
              This price reflects {product.weightGrams}g of {Math.round(product.purity * 1000)}/1000 purity{" "}
              {product.metalType.toLowerCase()}, priced against today's spot rate plus our commission, with a
              making charge added.
            </p>
          </details>

          <div className="mt-4">
            <MetalPricesPanel variant="compact" />
          </div>

          <p className="mt-4 text-ink-900/70">{product.description}</p>

          <dl className="mt-6 grid grid-cols-2 gap-y-2 text-sm text-ink-900/70">
            <dt>Purity</dt>
            <dd>{Math.round(product.purity * 1000)} / 1000</dd>
            <dt>Weight</dt>
            <dd>{product.weightGrams}g</dd>
            <dt>SKU</dt>
            <dd>{product.sku}</dd>
            <dt>Availability</dt>
            <dd>
              {isOutOfStock ? (
                "Out of stock"
              ) : isLowStock ? (
                <span className="font-medium text-amber-600">Only {product.stockQuantity} left in stock</span>
              ) : (
                `${product.stockQuantity} in stock`
              )}
            </dd>
          </dl>

          {!isAdmin && (
            <div className="mt-8 flex items-center gap-3">
              <QuantityStepper
                value={quantity}
                max={product.stockQuantity}
                onChange={setQuantity}
                disabled={product.stockQuantity <= 0}
              />
              <button
                disabled={product.stockQuantity <= 0}
                onClick={handleAddToCart}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-300"
              >
                {added ? <CheckIcon className="h-5 w-5" /> : <CartIcon className="h-5 w-5" />}
                {added ? "Added to cart" : "Add to cart"}
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="mt-16 border-t border-brand-200 pt-10">
        <h2 className="font-serif text-2xl text-ink-900">Reviews</h2>
        <div className="mt-2 flex items-center gap-2">
          {averageRating !== null ? (
            <>
              <StarRating rating={averageRating} />
              <span className="text-sm text-ink-900/60">
                {averageRating.toFixed(1)} out of 5 ({reviewCount} review{reviewCount === 1 ? "" : "s"})
              </span>
            </>
          ) : (
            <span className="text-sm text-ink-900/60">No reviews yet.</span>
          )}
        </div>

        {user && (
          <form onSubmit={handleReviewSubmit} className="mt-6 rounded-xl border border-brand-200 bg-white p-4 sm:p-6">
            <p className="text-sm font-medium text-ink-900">
              {myReview ? "Update your review" : "Write a review"}
            </p>
            <div className="mt-2">
              <StarRating rating={ratingInput} onChange={setRatingInput} />
            </div>
            <textarea
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="Share your thoughts about this product (optional)"
              rows={3}
              className="mt-3 w-full rounded-lg border border-brand-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="submit"
                disabled={ratingInput < 1 || isSubmittingReview}
                className="rounded-full bg-brand-600 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-300"
              >
                {myReview ? "Update review" : "Submit review"}
              </button>
              {myReview && (
                <button
                  type="button"
                  onClick={handleReviewDelete}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete my review
                </button>
              )}
            </div>
          </form>
        )}

        <div className="mt-8 space-y-6">
          {reviewsLoading ? (
            <p className="text-sm text-ink-900/60">Loading reviews...</p>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-ink-900/60">Be the first to review this product.</p>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="border-b border-brand-100 pb-6 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <StarRating rating={review.rating} size="h-4 w-4" />
                  <span className="text-sm font-medium text-ink-900">{review.user.name}</span>
                </div>
                {review.comment && <p className="mt-2 text-sm text-ink-900/70">{review.comment}</p>}
              </div>
            ))
          )}
        </div>
      </section>

      {relatedProducts.length > 0 && (
        <section className="mt-16 border-t border-brand-200 pt-10">
          <h2 className="font-serif text-2xl text-ink-900">You might also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {relatedProducts.map((related) => (
              <ProductCard key={related.id} product={related} />
            ))}
          </div>
        </section>
      )}

      {/* Sticky mobile add-to-cart bar: the page runs long past reviews and related products, so the button above can scroll out of view. Not shown to an admin - see the note by `isAdmin`'s declaration. */}
      {!isAdmin && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-brand-200 bg-white p-3 shadow-lg sm:hidden">
          <span className="flex-1 truncate text-lg font-semibold text-brand-700">
            {formatPrice(product.currentPriceCents)}
          </span>
          <button
            disabled={product.stockQuantity <= 0}
            onClick={handleAddToCart}
            className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-300"
          >
            {added ? <CheckIcon className="h-5 w-5" /> : <CartIcon className="h-5 w-5" />}
            {added ? "Added" : "Add to cart"}
          </button>
        </div>
      )}
    </div>
  );
}
