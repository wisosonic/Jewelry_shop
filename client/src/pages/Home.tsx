import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProducts } from "../api/products";
import logoWideUrl from "../assets/logo-wide.png";
import { ProductGridSkeleton } from "../components/common/Skeleton";
import { useToast } from "../context/ToastContext";
import { FeaturedCarousel } from "../components/home/FeaturedCarousel";
import { BarsIcon, ShieldCheckIcon, ShopIcon, TagIcon, TrendingUpIcon } from "../components/icons/Icon";
import { MetalPricesPanel } from "../components/metals/MetalPricesPanel";
import type { Product } from "../types";

const HERO_IMAGE_URL = "https://images.unsplash.com/photo-1758995116383-f51775896add?w=1600&q=80";

const VALUE_PROPS = [
  {
    icon: TrendingUpIcon,
    title: "Live market pricing",
    body: "Prices track gold and silver spot rates, updated regularly.",
  },
  {
    icon: TagIcon,
    title: "Transparent commission",
    body: "Our markup is fixed and published, not hidden in the price tag.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Crafted to last",
    body: "Each piece is finished by hand and checked before it ships.",
  },
];

/** Storefront landing page: hero banner with a dimmed background image, a featured-products carousel, and value-proposition highlights. */
export function Home() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    fetchProducts({ page: 1, pageSize: 9 })
      .then((res) => setFeatured(res.items))
      .catch(() => showToast("Couldn't load featured pieces.", "error"))
      .finally(() => setIsLoadingFeatured(false));
  }, [showToast]);

  return (
    <div>
      <section
        className="relative overflow-hidden bg-ink-900 bg-cover bg-center pt-4 pb-20 sm:pb-28"
        style={{ backgroundImage: `url('${HERO_IMAGE_URL}')` }}
      >
        {/* Dimmed overlay so the hero copy stays readable over the background photo. */}
        <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
        <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
          <img src={logoWideUrl} alt="Naya Sophia" className="mx-auto h-24 w-auto sm:h-36" />
          <p className="mt-6 text-sm uppercase tracking-[0.3em] text-brand-200">Fine jewelry, honest pricing</p>
          <h1 className="mt-4 font-serif text-4xl text-white sm:text-5xl lg:text-6xl">
            A refined destination for timeless elegance and distinctive jewelry
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/80">
            Every ring, chain and pair of earrings we sell is priced transparently from
            live gold and silver rates, plus a fair, published commission.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/bullion"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-brand-600 px-8 py-3 text-white hover:bg-brand-700 sm:w-auto"
            >
              <BarsIcon className="h-5 w-5" /> Shop Gold &amp; Silver
            </Link>
            <Link
              to="/shop"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-white px-8 py-3 text-brand-800 hover:bg-brand-50 sm:w-auto"
            >
              <ShopIcon className="h-5 w-5" /> Shop the collection
            </Link>
          </div>
          <div className="mt-10">
            <MetalPricesPanel variant="hero" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="mb-6 text-center font-serif text-2xl text-ink-900 sm:text-3xl">Featured pieces</h2>
        {isLoadingFeatured ? <ProductGridSkeleton count={9} /> : <FeaturedCarousel products={featured} />}
      </section>

      <section className="bg-brand-100/60 py-16">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3 sm:px-6 lg:px-8">
          {VALUE_PROPS.map((item) => (
            <div key={item.title} className="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <item.icon className="h-8 w-8 text-brand-600" />
              <h3 className="mt-3 font-serif text-lg text-brand-700">{item.title}</h3>
              <p className="mt-2 text-sm text-ink-900/70">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
