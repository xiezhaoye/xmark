/**
 * AppChrome — the root component's non-layout chrome, split out so `App.tsx`
 * stays a composition root: the top-level error boundary, and the file-drop
 * overlay that covers the window while a drag is over it.
 *
 * Both mount in every window, both are independent of the layout, and both
 * were the bulk of App.tsx's non-composition code (rule 50: one component per
 * concern; the file-size gate counted them as layout).
 *
 * @coordinates-with App.tsx — renders both
 * @module AppChrome
 */

import { Component, type ReactNode } from "react";
import { withTranslation, useTranslation, type WithTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { cssVars } from "@/theme";
import { appError } from "@/utils/debug";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";

// Error Boundary to catch and display React errors
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<
  { children: ReactNode } & WithTranslation<"dialog">,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    appError("Caught error:", error);
    appError("Error info:", errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      const { t } = this.props;
      return (
        <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ color: cssVars.color.semantic.error, marginBottom: 16 }}>{t("errorBoundary.title")}</h1>
          <pre style={{
            padding: 16,
            background: cssVars.color.semantic.errorBg,
            borderRadius: 8,
            overflow: "auto",
            fontSize: 14,
          }}>
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export const ErrorBoundary = withTranslation("dialog")(ErrorBoundaryInner);

// ADR-014 sample migration — visual values come from the typed accessor
// in `@/theme`. Non-token literals (z-index, border width, viewport
// margins) stay literal per the ADR's "what stays literal" exemption.
const DROP_OVERLAY_BORDER_WIDTH = 3;
const DROP_OVERLAY_Z = 9998;
const DROP_OVERLAY_MARGIN = 8;
const DROP_LABEL_FONT_SIZE = 14;

export function DropOverlay() {
  const { t } = useTranslation();
  const isDragging = useUIStore((state) => state.isDraggingFiles);
  // The native browser view paints over all React DOM in its rect, so freeze every
  // mounted browser tab while this overlay is up.
  useBrowserOccluder(isDragging, "file-drop");
  if (!isDragging) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: cssVars.color.accent.bg,
        border: `${DROP_OVERLAY_BORDER_WIDTH}px dashed ${cssVars.color.accent.primary}`,
        borderRadius: cssVars.radius.lg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: DROP_OVERLAY_Z,
        pointerEvents: "none",
        margin: DROP_OVERLAY_MARGIN,
      }}
    >
      <div
        style={{
          padding: `${cssVars.space[4]} ${cssVars.space[6]}`,
          backgroundColor: cssVars.color.bg.primary,
          borderRadius: cssVars.radius.md,
          boxShadow: cssVars.shadow.popup,
          color: cssVars.color.text.primary,
          fontSize: DROP_LABEL_FONT_SIZE,
          fontWeight: 500,
        }}
      >
        {t("dropToOpen")}
      </div>
    </div>
  );
}

/** Exported for the composition-root test — see App.chrome.test.tsx. */
