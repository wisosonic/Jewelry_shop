type Props = {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

/**
 * A +/- quantity control that always clamps to `[min, max]`, including for
 * a typed value in the middle number field - unlike a bare
 * `<input type="number">`, whose `min`/`max` attributes are only soft UI
 * hints and don't stop a typed or programmatic out-of-range value from
 * reaching `onChange`. Used on `Cart.tsx` and `ProductDetail.tsx` so both
 * clamp identically.
 */
export function QuantityStepper({ value, min = 1, max, onChange, disabled = false }: Props) {
  function clamp(next: number) {
    if (!Number.isFinite(next)) return value;
    return Math.max(min, Math.min(max, Math.round(next)));
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-brand-300">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        className="flex h-9 w-9 items-center justify-center text-lg text-ink-900/70 hover:bg-brand-50 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        &minus;
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label="Quantity"
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="h-9 w-12 border-x border-brand-300 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        className="flex h-9 w-9 items-center justify-center text-lg text-ink-900/70 hover:bg-brand-50 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        +
      </button>
    </div>
  );
}
