import { StarFilledIcon, StarIcon } from "../icons/Icon";

type Props = {
  rating: number;
  /** Omit for a read-only display; pass to render clickable stars for submitting a rating. */
  onChange?: (rating: number) => void;
  size?: string;
};

/** Five-star rating display, or an interactive picker when `onChange` is given (used on `ProductDetail`'s review form). */
export function StarRating({ rating, onChange, size = "h-5 w-5" }: Props) {
  const stars = [1, 2, 3, 4, 5];

  if (!onChange) {
    return (
      <div className="flex items-center gap-0.5 text-amber-500" aria-label={`Rated ${rating} out of 5`}>
        {stars.map((star) =>
          star <= Math.round(rating) ? (
            <StarFilledIcon key={star} className={size} />
          ) : (
            <StarIcon key={star} className={size} />
          )
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 text-amber-500" role="radiogroup" aria-label="Rating">
      {stars.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={star === Math.round(rating)}
          aria-label={`${star} star${star > 1 ? "s" : ""}`}
          onClick={() => onChange(star)}
        >
          {star <= Math.round(rating) ? <StarFilledIcon className={size} /> : <StarIcon className={size} />}
        </button>
      ))}
    </div>
  );
}
