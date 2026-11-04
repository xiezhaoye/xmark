/**
 * The document's type size, one row wide: the current size between a minus and
 * a plus. Each tap moves it by one px, and a button at the end of its range is
 * disabled rather than wrapping.
 *
 * Two homes, one control: the settings popover used to carry it, and the
 * floating pill above the document carries it now — where the preview/source
 * switch used to sit, which moved into the popover. The document reads the
 * value from the store (`--reading-size` is set where the document is shown),
 * so the page, its rows and every other surface keep the app's own size.
 *
 * @module components/ReadingStepper
 */
import { MAX_READING_SIZE, MIN_READING_SIZE } from "../state/storage";
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";

export function ReadingStepper({ className = "" }: { className?: string }) {
  const size = useReaderStore((s) => s.readingSize);
  const change = useReaderStore((s) => s.changeReadingSize);
  const atMin = size <= MIN_READING_SIZE;
  const atMax = size >= MAX_READING_SIZE;

  return (
    <div className={`stepper ${className}`} role="group" aria-label={t("reading.size")}>
      <button type="button" className="stepper-button" aria-label={t("reading.smaller")} disabled={atMin} onClick={() => change(-1)}>
        −
      </button>
      <span className="stepper-value" aria-live="polite">
        {size}
      </span>
      <button type="button" className="stepper-button" aria-label={t("reading.larger")} disabled={atMax} onClick={() => change(1)}>
        ＋
      </button>
    </div>
  );
}
