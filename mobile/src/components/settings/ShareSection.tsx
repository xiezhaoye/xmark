/**
 * The share section: one row that hands the open document's original bytes to
 * the system sheet, with its own inline outcome. A document or server switch
 * clears a stale notice; a second tap is ignored while the sheet is up.
 *
 * @module components/settings/ShareSection
 */
import { t } from "../../i18n";
import { useShareDocument } from "./useShareDocument";
import { Icon } from "../Icon";

export function ShareSection() {
  const { usable, busy, notice, send } = useShareDocument();
  return (
    <div className="share">
      <button type="button" className="button small share-action" disabled={!usable || busy} aria-busy={busy} onClick={() => void send()}>
        <Icon name="share" size={18} />
        {busy ? t("share.sending") : t("share.sendFile")}
      </button>
      {!usable && <p className="hint share-hint">{t("settings.shareUnavailable")}</p>}
      {notice && (
        <p className={notice.kind === "error" ? "error share-notice" : "ok share-notice"} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.text}
        </p>
      )}
    </div>
  );
}
