/**
 * The preview / source switch for a markdown or HTML document.
 *
 * Floated at the top of the screen only once the top bar has scrolled away
 * with the document; hidden while the top bar is in view.
 *
 * @module components/ModeSwitch
 */
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";

export function ModeSwitch({ className = "" }: { className?: string }) {
  const mode = useReaderStore((s) => s.docMode);
  return (
    <div className={`mode-switch ${className}`} role="radiogroup" aria-label={t("doc.mode")}>
      {(["preview", "source"] as const).map((m) => (
        <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => useReaderStore.getState().setDocMode(m)}>
          {m === "preview" ? t("doc.preview") : t("doc.source")}
        </button>
      ))}
    </div>
  );
}
