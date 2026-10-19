/**
 * RemoteChrome — the parts of the remote browser that are not a tree or a
 * document: the read-only banner, and the error/retry card every region shows
 * instead of a blank pane.
 *
 * Key decisions:
 *   - **The banner is in flow, at the top of the main column.** It is the one
 *     thing that says the window is not editing this Mac, so it belongs in the
 *     pane's chrome rather than floating over the text (rule 32: a control
 *     that belongs to a pane goes IN the pane's chrome, never `position:
 *     absolute` over its content).
 *   - **Errors name the failure and offer a retry.** A blank column reads as
 *     "this folder is empty", which is a different fact.
 *
 * @coordinates-with components/RemoteBrowser/RemoteShell.tsx — the caller
 * @module components/RemoteBrowser/RemoteChrome
 */

import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./remote-chrome.css";

/** `Read-only · <server name>` — the one-line statement of what this window is. */
export function RemoteBanner({ serverName }: { serverName: string }) {
  const { t } = useTranslation("sidebar");
  return (
    <div className="remote-banner" role="status">
      <span className="remote-banner__badge">{t("remote.readOnly")}</span>
      <span className="remote-banner__name" title={serverName}>
        {serverName}
      </span>
    </div>
  );
}

export interface RemoteErrorProps {
  message: string;
  onRetry: () => void;
}

/** A failed region: what went wrong, and the way to try again. */
export function RemoteError({ message, onRetry }: RemoteErrorProps) {
  const { t } = useTranslation("sidebar");
  return (
    <div className="remote-error" role="alert">
      <p className="remote-error__text">{message}</p>
      <button type="button" className="vm-btn vm-btn--compact" onClick={onRetry}>
        <RotateCw size={12} aria-hidden="true" />
        {t("remote.retry")}
      </button>
    </div>
  );
}
