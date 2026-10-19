/**
 * ProviderRadio — the small radio button used in the AI provider list.
 *
 * Kept in its own file (rather than co-located inside
 * IntegrationsSettings.tsx) so the a11y test for audit #953 can import
 * just this component, instead of pulling the whole 60-line page module
 * into the coverage denominator with no other tests to balance it.
 *
 * @module pages/settings/ProviderRadio
 */

interface ProviderRadioProps {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  /** Screen-reader name for this radio — provider display name. The visible
   *  name lives in a sibling <span> and is not programmatically associated
   *  with the button, so without aria-label SRs hear only
   *  "radio button, not checked" (audit #953). */
  label: string;
}

export function ProviderRadio({
  checked,
  disabled,
  onChange,
  label,
}: ProviderRadioProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`vm-hit-expand relative w-3.5 h-3.5 rounded-full border flex-shrink-0
        flex items-center justify-center transition-colors
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${checked
          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
          : "border-[var(--text-tertiary)] bg-transparent hover:border-[var(--text-secondary)]"
        } focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2`}
    >
      {checked && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--contrast-text)]" />
      )}
    </button>
  );
}

/**
 * RadioMark — ProviderRadio's look as a NON-interactive mark.
 *
 * Purpose: Settings → Servers makes the WHOLE ROW the radio (`role="radio"` on
 * the row's body), so a second focusable radio inside it would be a tab stop
 * that does nothing the row does not already do — and two `role="radio"` nodes
 * for one choice is a lie to a screen reader. This draws the same ring/fill as
 * `ProviderRadio` so both lists read as one design, and states nothing: the
 * row owns the semantics.
 *
 * Kept beside `ProviderRadio` because the two must not drift apart.
 *
 * @coordinates-with pages/settings/ServerRow.tsx — the row that renders it
 * @module pages/settings/ProviderRadio
 */
export function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative w-3.5 h-3.5 rounded-full border flex-shrink-0
        flex items-center justify-center transition-colors
        ${checked
          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
          : "border-[var(--text-tertiary)] bg-transparent"
        }`}
    >
      {checked && <span className="w-1.5 h-1.5 rounded-full bg-[var(--contrast-text)]" />}
    </span>
  );
}
