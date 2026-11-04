/**
 * SplitPaneEditor — the side-by-side source and preview editor for
 * non-markdown formats.
 *
 * Mounted by Editor.tsx for FormatConfig.kind === "split-pane"
 * or "viewer". Composes:
 *
 *   ┌──────────────────────────┬──────────────────────────┐
 *   │ SourcePane               │ Preview slot             │
 *   │ (CodeMirror)             │ (genericPreview or       │
 *   │                          │  schemaRenderers)        │
 *   │                          │                          │
 *   └──────────────────────────┴──────────────────────────┘
 *                              ▲
 *                              │
 *                          resize handle
 *                          (keyboard ArrowLeft/Right)
 *
 * Validation: SourcePane runs the adapter's validator and reports its
 * diagnostics (`onDiagnostics`); this component renders them in
 * ValidationGutter beside the source pane, with click-to-jump back into the
 * source. The split fraction is held in component state and clamped to
 * [0.2, 0.8].
 *
 * @module components/Editor/SplitPaneEditor/SplitPaneEditor
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SourcePane } from "./SourcePane";
import type { CSSProperties } from "react";
import { usePreviewModel } from "./usePreviewModel";
import { PreviewZoomBar, usePreviewZoom } from "@/components/PreviewZoom/PreviewZoom";
import { ValidationGutter } from "./ValidationGutter";
import { ViewModeToggle } from "./ViewModeToggle";
import { SplitPaneFrame } from "./SplitPaneFrame";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { errorMessage } from "@/utils/errorMessage";
import { LockOpen, ExternalLink } from "lucide-react";
import { presentDiagnostics } from "@/lib/formats/diagnosticPresentation";
import { isSplitViewMode, type FormatConfig, type SplitViewMode, type ValidationDiagnostic } from "@/lib/formats/types";

interface SplitPaneEditorProps {
  tabId: string;
  formatConfig: FormatConfig;
}

const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.8;
const STEP = 0.05;
const DEFAULT_FRACTION = 0.5;

function clamp(n: number): number {
  if (n < MIN_FRACTION) return MIN_FRACTION;
  if (n > MAX_FRACTION) return MAX_FRACTION;
  return n;
}

export function SplitPaneEditor({ tabId, formatConfig }: SplitPaneEditorProps) {
  const { t } = useTranslation("editor");
  const [fraction, setFraction] = useState(DEFAULT_FRACTION);
  const [diagnostics, setDiagnostics] = useState<ValidationDiagnostic[]>([]);
  // Imperative cursor-jump handle exposed by SourcePane. ValidationGutter
  // row clicks call this to move the editor cursor to (line, column).
  const jumpHandleRef = useRef<((line: number, column: number) => void) | null>(
    null,
  );
  const handleJump = useCallback((line: number, column: number) => {
    jumpHandleRef.current?.(line, column);
  }, []);
  // Stable identity: SourcePane re-emits the handle in an effect keyed on this
  // callback, so an inline arrow would re-run that effect on every keystroke.
  const handleJumpHandleReady = useCallback(
    (jump: (line: number, column: number) => void) => {
      jumpHandleRef.current = jump;
    },
    [],
  );
  // Per-tab editing override sourced from tabStore so it
  // survives tab switches. The Tab.editingEnabled flag persists in
  // the store; SplitPaneEditor reads it and dispatches to set it.
  const editingEnabled = useTabStore((s) => {
    const found = s.findTabById?.(tabId) ?? null;
    return found?.kind === "document" ? Boolean(found.editingEnabled) : false;
  });

  // Schema-aware preview dispatch. When the format declares a
  // schemaDetector AND the active document matches a registered
  // schemaRenderer, prefer the schema renderer over the generic preview.
  const content = useDocumentStore(
    (state) => state.documents?.[tabId]?.content ?? "",
  );
  const filePath = useDocumentStore(
    (state) => state.documents?.[tabId]?.filePath ?? null,
  );
  // The list presents findings through the same trust-aware mapping as
  // CodeMirror's lint (lib/formats/diagnosticPresentation.ts); grant and path
  // are both reactive, so Save As re-presents them too.
  const trusted = useHtmlTrustStore((s) => s.tokenFor(filePath) !== null);
  const shownDiagnostics = useMemo(
    () => presentDiagnostics(diagnostics, formatConfig.infoWhenTrusted, trusted),
    [diagnostics, formatConfig.infoWhenTrusted, trusted],
  );
  // An explicit schema choice (set via setTabActiveSchemaId, and
  // restored verbatim by hot-exit so the pick survives a restart) outranks the
  // detector. `null`/`undefined` means "let the detector decide on each render".
  const activeSchemaId = useTabStore((s) => {
    const found = s.findTabById?.(tabId) ?? null;
    return found?.kind === "document" ? (found.activeSchemaId ?? null) : null;
  });
  // Renderer, preview content and preview diagnostics come from ONE snapshot —
  // see usePreviewModel for why deriving them separately was a defect.
  const preview = usePreviewModel({
    formatConfig,
    content,
    filePath,
    activeSchemaId,
  });
  const { Preview, hasPreview } = preview;
  const { scale: previewZoom } = usePreviewZoom();

  // Per-tab view mode (Source/Split/Preview), falling back to the global
  // default setting, then "split". Clamped to "source" for formats without a
  // preview so a stale "preview" on a now-preview-less tab can't blank the
  // editor. See .claude/adr/plans/20260703-split-pane-view-modes.md.
  const tabViewMode = useTabStore((s) => {
    const t = s.findTabById?.(tabId);
    return t?.kind === "document" ? t.viewMode : undefined;
  });
  const defaultViewMode = useSettingsStore((s) => s.formats.defaultViewMode);
  // Normalize via the guard so a corrupt persisted setting can't yield an
  // out-of-range mode (which would leave the toggle with no active radio).
  const requestedMode = tabViewMode ?? defaultViewMode;
  const viewMode: SplitViewMode = hasPreview
    ? (isSplitViewMode(requestedMode) ? requestedMode : "split")
    : "source";
  const showSource = viewMode !== "preview";
  const showPreview = hasPreview && viewMode !== "source";
  const showResizeHandle = showSource && showPreview;

  // The preview's own hints come from `usePreviewModel`, computed from the
  // same (deferred) content the renderer draws. They deliberately do NOT come
  // from the SourcePane's live `diagnostics`, which track the caret: mixing
  // the two annotated one revision with another's findings, and went stale
  // outright in preview-only mode where the SourcePane is unmounted.

  const handleViewModeChange = useCallback(
    (mode: SplitViewMode) => {
      useTabStore.getState().setTabViewMode(tabId, mode);
    },
    [tabId],
  );

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFraction((f) => clamp(f - STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setFraction((f) => clamp(f + STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFraction(MIN_FRACTION);
    } else if (e.key === "End") {
      e.preventDefault();
      setFraction(MAX_FRACTION);
    }
  }, []);


  // Read-only is a MODE, not a banner: for a viewer format the two actions used
  // to sit in a full-width row at the top. They now ride in the floating row,
  // which costs no height and only appears on hover.
  const readOnlyDefault =
    formatConfig.kind === "viewer" && Boolean(formatConfig.adapters.readOnlyDefault);

  const openExternal = useCallback(() => {
    if (!filePath) return;
    // Read at click time so a settings change while the tab is open applies.
    const editorOverride = useSettingsStore.getState().formats.externalEditor.trim() || null;
    invoke("open_in_external_editor", { path: filePath, editorOverride }).catch((error: unknown) => {
      toast.error(errorMessage(error));
    });
  }, [filePath]);

  const enableEditing = useCallback(() => {
    useTabStore.getState().setTabEditingEnabled(tabId, true);
  }, [tabId]);

  return (
    <SplitPaneFrame
      ariaLabel={t("splitPane.editorLabel", { format: formatConfig.id })}
      formatId={formatConfig.id}
      // The CSS pairs `flex-grow: var(--f)` on the source with
      // `flex-grow: calc(1 - var(--f))` on the preview, both with
      // `flex-basis: 0`. A single-pane mode must therefore hand the whole
      // share to the mounted pane: 1 when only the source shows, 0 when
      // only the preview shows (1 would give the preview grow: 0 → a
      // zero-width, invisible preview).
      sourceFraction={showResizeHandle ? fraction : showSource ? 1 : 0}

      leftControls={
        readOnlyDefault && !editingEnabled ? (
          <div className="editor-readonly-actions">
            <button type="button" className="editor-readonly-actions__btn" onClick={enableEditing}>
              <LockOpen size={12} aria-hidden="true" /> {t("readOnly.enableEditing")}
            </button>
            <button type="button" className="editor-readonly-actions__btn" onClick={openExternal} aria-label={t("readOnly.openExternal")} title={t("readOnly.openExternal")}>
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </div>
        ) : undefined
      }
      centerControls={hasPreview ? <PreviewZoomBar variant="inline" /> : undefined}
      header={hasPreview ? <ViewModeToggle mode={viewMode} onChange={handleViewModeChange} /> : undefined}
      source={
        showSource ? (
          <>
            <SourcePane
              tabId={tabId}
              formatId={formatConfig.id}
              formatConfig={formatConfig}
              onDiagnostics={setDiagnostics}
              onJumpHandleReady={handleJumpHandleReady}
              editingEnabled={editingEnabled}
            />
            {shownDiagnostics.length > 0 && (
              <ValidationGutter diagnostics={shownDiagnostics} onJump={handleJump} />
            )}
          </>
        ) : undefined
      }
      resizeHandle={
        showResizeHandle ? (
          <div
            className="split-pane-editor__resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("splitPane.resize")}
            aria-valuemin={MIN_FRACTION * 100}
            aria-valuemax={MAX_FRACTION * 100}
            aria-valuenow={Math.round(fraction * 100)}
            tabIndex={0}
            onKeyDown={onKeyDown}
          />
        ) : undefined
      }
      previewStyle={{ "--preview-zoom": String(previewZoom) } as CSSProperties}
      preview={
        showPreview && Preview ? (
          <>
            <Preview
              content={preview.content}
              liveContent={preview.liveContent}
              path={filePath}
              diagnostics={preview.diagnostics}
              tabId={tabId}
            />
          </>
        ) : undefined
      }
    />
  );
}
