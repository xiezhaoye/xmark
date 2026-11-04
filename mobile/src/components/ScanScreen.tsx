/**
 * The camera screen: scrim, reticle, and the way out.
 *
 * Tauri's iOS scanner draws only the live preview, and in its default mode that
 * preview covers everything — a user who opened it by mistake had no control to
 * press. The camera therefore runs in WINDOWED mode (see `platform.scanQrCode`),
 * which inserts the preview behind a transparent webview, and this component
 * paints the chrome on top. The page itself must go transparent while scanning,
 * or its background would hide the camera: hence the `scanning` class on <html>.
 *
 * @module components/ScanScreen
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { cancelScan } from "../platform";
import { isScanning, subscribeScanning } from "../scan/scanSession";

export function ScanScreen() {
  const [active, setActive] = useState(isScanning);

  useEffect(() => subscribeScanning(() => setActive(isScanning())), []);

  // While the camera is up the page must not paint over it.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add("scanning");
    return () => root.classList.remove("scanning");
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div className="scan" role="dialog" aria-modal="true" aria-label={t("scan.title")}>
      {/* Four masks around a clear window: the preview shows through the hole. */}
      <div className="scan-mask scan-mask--top" aria-hidden="true" />
      <div className="scan-mask scan-mask--bottom" aria-hidden="true" />
      <div className="scan-mask scan-mask--left" aria-hidden="true" />
      <div className="scan-mask scan-mask--right" aria-hidden="true" />
      <div className="scan-reticle" aria-hidden="true" />
      <header className="scan-top">
        <button type="button" className="scan-cancel" onClick={() => void cancelScan()}>
          {t("scan.cancel")}
        </button>
        <span className="scan-title">{t("scan.title")}</span>
      </header>
      <p className="scan-hint">{t("scan.hint")}</p>
    </div>,
    document.body,
  );
}
