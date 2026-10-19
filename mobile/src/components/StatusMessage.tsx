/**
 * A centred message for empty and error states, with an optional retry.
 *
 * @module components/StatusMessage
 */
import { t } from "../i18n";

export function StatusMessage({ text, onRetry, action, tone = "muted" }: { text: string; onRetry?: () => void; action?: { label: string; onClick: () => void }; tone?: "muted" | "error" }) {
  return (
    <div className={`status status-${tone}`} role={tone === "error" ? "alert" : undefined}>
      <p>{text}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {t("error.retry")}
        </button>
      )}
      {action && (
        <button type="button" className="button primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
