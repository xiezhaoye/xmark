/**
 * Settings, as a popover under its own icon rather than a page of its own:
 * the document stays mounted behind it, so whatever is being read — and
 * where it was scrolled to — is still there when the popover closes.
 *
 * It hangs from the icon's outer edge, about half a phone wide, grows upwards
 * in height only as far as the visible screen allows (the soft keyboard shrinks
 * that), and scrolls inside once its content is longer. It closes on the icon
 * again, on a tap outside it, on Escape, or on Back; each of those gives focus
 * back to the icon. A section's own dialog (a rename field, a confirm) is
 * inside the popover, so its Escape closes that dialog and leaves the popover
 * up. The popover itself is a non-modal `dialog`: it never dims the page and
 * never traps focus, for the same reason.
 *
 * @module components/settings/SettingsPopover
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "../../i18n";
import { Icon } from "../Icon";
import { anchorPopover, cornerClass, type PopoverGeometry } from "./popoverLayout";
import { SETTINGS_SECTIONS } from "./sections";

/** The icon the popover hangs from, so it can be measured. */
export type AnchorRect = { top: number; bottom: number; left: number; right: number };

/** Where the icon is on screen right now; null when there is no such icon. */
export function measureAnchor(el: HTMLElement | null): AnchorRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

/** Geometry for the popover from the icon and the current visual viewport. */
export function currentGeometry(anchor: AnchorRect | null): PopoverGeometry | null {
  if (!anchor) return null;
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const viewport = { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight, top: vv?.offsetTop ?? 0 };
  return anchorPopover({ anchor, viewport, viewportWidth: window.innerWidth });
}

export function SettingsPopover({ anchor, onClose }: { anchor: () => HTMLElement | null; onClose: () => void }) {
  const [geometry, setGeometry] = useState<PopoverGeometry | null>(() => currentGeometry(measureAnchor(anchor())));
  const panel = useRef<HTMLDivElement>(null);

  // Re-measure on rotation and on the keyboard: the visual viewport changes
  // size, not the window.
  useLayoutEffect(() => {
    const measure = () => setGeometry(currentGeometry(measureAnchor(anchor())));
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener?.("resize", measure);
    vv?.addEventListener?.("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      vv?.removeEventListener?.("resize", measure);
      vv?.removeEventListener?.("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);

  // The popover takes focus when it opens, so its first control is reachable
  // by keyboard and a screen reader announces it.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  const style = geometry
    ? ({
        top: geometry.top,
        right: geometry.right,
        width: geometry.width,
        maxHeight: geometry.maxHeight,
        "--popover-max-height": `${geometry.maxHeight}px`,
      } as CSSProperties)
    : undefined;
  return (
    <div
      ref={panel}
      className={`settings-popover ${cornerClass(geometry?.corner ?? "top-right")}`}
      style={style}
      role="dialog"
      aria-modal="false"
      aria-label={t("settings.title")}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.stopPropagation();
        onClose();
      }}
    >
      <header className="settings-popover-head">
        <h1 className="settings-popover-title">{t("settings.title")}</h1>
        <button type="button" className="icon-button" aria-label={t("settings.close")} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="scroll settings settings-popover-body">
        {SETTINGS_SECTIONS.map(({ id, titleKey, showsTitle, Component }) => (
          <section key={id} aria-label={t(titleKey)} aria-labelledby={showsTitle ? `settings-${id}` : undefined}>
            {showsTitle && (
              <h2 className="section-title" id={`settings-${id}`}>
                {t(titleKey)}
              </h2>
            )}
            <Component />
          </section>
        ))}
      </div>
    </div>
  );
}
