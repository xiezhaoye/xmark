/**
 * The reading section: how large the document's text is. One row, the size it
 * is now between a minus and a plus; each tap moves it by one px, and a button
 * at the end of its range is disabled rather than wrapping.
 *
 * The document reads the value from the store (`--reading-size` is set where
 * the document is shown), so the page, its rows and every other surface keep
 * the app's own size.
 *
 * @module components/settings/ReadingSection
 */
import { MAX_READING_SIZE, MIN_READING_SIZE } from "../../state/storage";
import { useReaderStore } from "../../state/readerStore";
import { t } from "../../i18n";

export function ReadingSection() {
  const size = useReaderStore((s) => s.readingSize);
  const change = useReaderStore((s) => s.changeReadingSize);
  const atMin = size <= MIN_READING_SIZE;
  const atMax = size >= MAX_READING_SIZE;

  return (
    <div className="setting-row">
      <span className="setting-label">{t("reading.size")}</span>
      <div className="stepper" role="group" aria-label={t("reading.size")}>
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
    </div>
  );
}
