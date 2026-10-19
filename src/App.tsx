/**
 * App — the root component: routes each window to the main editor layout, the
 * settings page or the PDF export page, under a top-level error boundary.
 * @module App
 */

import { lazy, Suspense, type CSSProperties } from "react";
import { FeatureErrorBoundary } from "@/components/FeatureErrorBoundary";
import { useTranslation } from "react-i18next";
import { Routes, Route } from "react-router-dom";
import { ThemedToaster } from "@/components/ThemedToaster";
import { DropOverlay, ErrorBoundary } from "@/AppChrome";
import { DocumentSplitContainer } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { SidebarResizeHandle } from "@/components/Sidebar/SidebarResizeHandle";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import {
  shellSideWidth,
  shellChromeVars,
  railColumnWidth,
  remoteLeadingColumns,
  remoteSideWidth,
  COLLAPSED_STRIP_WIDTH,
} from "@/shell/shellChrome";
import { usesOverlayTitleBar } from "@/utils/platform";
import { BottomBar } from "@/components/BottomBar/BottomBar";
import { AppShell, EditorArea } from "@/shell";
import { appShellClassName } from "@/shell/appShellClassName";
import { GeniePickerOverlay } from "@/components/GeniePicker/GeniePickerOverlay";
import { EditorContextMenu } from "@/components/Editor/EditorContextMenu/EditorContextMenu";
import { ApprovalDialog } from "@/components/WorkflowApproval/ApprovalDialog";
import { BrowserApprovalDialog } from "@/components/Browser/BrowserApprovalDialog";
import { WorkspaceApprovalDialog } from "@/components/Workspace/WorkspaceApprovalDialog";
import { AppTitleBar } from "@/components/Browser/AppTitleBar";
import { QuickOpen } from "@/components/QuickOpen/QuickOpen";
import { ContentSearch } from "@/components/ContentSearch/ContentSearch";
import { QuickLookOverlay } from "@/components/QuickLook/QuickLookOverlay";
import { KnowledgeBaseOverlay } from "@/components/KnowledgeBasePanel/KnowledgeBaseOverlay";
import { WindowStatusOverlay } from "@/components/WindowStatusPanel/WindowStatusOverlay";
import { CoherenceOverlays } from "@/components/CoherenceOverlays";
import { useWindowStatus } from "@/hooks/useWindowStatus";
import { CommandPalette } from "@/components/CommandPalette";
import { WindowProvider, useIsDocumentWindow, useWindowLabel } from "@/contexts/WindowContext";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/hooks/useTheme";
import { useTerminalPosition } from "@/components/Terminal/useTerminalPosition";
import { useTabModeSync } from "@/hooks/useTabModeSync";
import { useBrowserWorkspaceActive } from "@/components/Browser/useBrowserWorkspaceState";
import {
  useWorkspaceLifecycle,
  useEditorLifecycle,
  DocumentWindowMount,
  MainWindowRunners,
} from "@/hooks/lifecycle";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";

const TerminalPanel = lazy(() =>
  import("@/components/Terminal").then((m) => ({ default: m.TerminalPanel }))
);
// Lazy-load page routes so non-document windows don't evaluate stores they don't need.
// SettingsPage → aiProviderStore (credentials); must not evaluate in pdf-export window.
const SettingsPage = lazy(() => import("@/pages/Settings").then(m => ({ default: m.SettingsPage })));
const PdfExportPage = lazy(() => import("@/pages/PdfExportPage").then(m => ({ default: m.PdfExportPage })));
// The remote shell drags the read-only document stack (markdown, katex,
// highlight.js) behind it, so it loads when a window first switches to a
// server — never at cold start.
const RemoteWindowSurface = lazy(() =>
  import("@/components/RemoteBrowser/RemoteShell").then((m) => ({ default: m.RemoteWindowSurface })),
);

/**
 * The last argument carries the chunk's STATE, not content — which is why the
 * pending node is built here, as a plain element, instead of being a component
 * in the tree. No mount is added (and none leaves) when the chunk arrives: the
 * column keeps the box it already had and the spinner goes away.
 */
function remotePending(label: string) {
  return (
    <div className="vm-chunk-pending" aria-busy="true" role="status" aria-label={label}>
      <span className="vm-spinner" aria-hidden="true" />
    </div>
  );
}


export function MainLayout() {
  const { t } = useTranslation("dialog");
  // Window context + store selectors. State reads only, not lifecycle hooks.
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const focusModeEnabled = useUIStore((state) => state.focusModeEnabled);
  const typewriterModeEnabled = useUIStore((state) => state.typewriterModeEnabled);
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);
  const findBarOpen = useUIStore((state) => state.search.isOpen);
  const terminalPosition = useUIStore((state) => state.effectiveTerminalPosition);
  // Primitive boolean selector — the shell re-renders only when this flips, not
  // on every tab-metadata change (a full-projection read would do the latter).
  const browserWorkspaceActive = useBrowserWorkspaceActive();
  const workspaceRailMode = useSettingsStore((state) => state.general.workspaceRailMode);
  const showWorkspaceRail = isDocumentWindow && workspaceRailMode;
  // Which Mac this window shows. A remote server replaces what the three
  // columns RENDER; it never touches the local stores, so switching back is a
  // return to the same tabs, unsaved edits and sidebar.
  const remoteServerId = useRemoteSessionStore((state) => state.active[windowLabel] ?? null);
  const railSettingsWidth = useSettingsStore((s) => s.general.workspaceRailWidth);
  const railCollapsed = useSettingsStore((s) => s.general.workspaceRailCollapsed);
  const workspaceRailWidth = railColumnWidth(railSettingsWidth, railCollapsed);
  // A hidden sidebar folds to a strip in document windows; the shared maths knows (see shellChrome).
  // A remote server sizes its leading columns from the SAME state the remote
  // columns render at — sizing them from the LOCAL sidebar's flags (as this did)
  // reserved a 28px strip for a file tree that was painted 240px wide, and the
  // tree was squeezed out of the card.
  const sideWidth =
    remoteServerId !== null
      ? remoteSideWidth(
          remoteLeadingColumns({
            railWidth: railSettingsWidth,
            railCollapsed,
            sidebarVisible,
            sidebarWidth,
          }),
        )
      : shellSideWidth({ workspaceRailVisible: showWorkspaceRail, workspaceRailWidth, sidebarVisible, sidebarWidth, sidebarStrip: isDocumentWindow });
  const overlayTitleBar = usesOverlayTitleBar();

  // T03 lifecycle composites — every per-document/per-window hook now
  // lives in src/hooks/lifecycle/. Adding a shortcut or sync hook
  // edits a composite, not App.tsx.
  useWorkspaceLifecycle();
  useEditorLifecycle();
  useTheme();
  useTerminalPosition();
  useTabModeSync();
  useWindowStatus();

  const className = appShellClassName({ focusMode: focusModeEnabled, typewriterMode: typewriterModeEnabled, findBarOpen, browserWorkspaceActive, workspaceRailVisible: showWorkspaceRail });

  return (
    <AppShell
      className={className}
      // Single source for the shell's chrome geometry: descendants inherit
      // these instead of restating the numbers in CSS (see shellChrome).
      style={shellChromeVars(overlayTitleBar, workspaceRailWidth) as CSSProperties}
      // Only macOS overlays the native title bar, so only macOS needs the app
      // to draw one. Elsewhere the OS already did, and a second strip below the
      // menu bar is the empty band reported in #1296.
      chrome={overlayTitleBar ? <AppTitleBar /> : null}
      sidebar={
        // While remote, this column is the remote shell's — whatever the local
        // rail mode says: the server's groups stand where the rail's did.
        remoteServerId !== null ? (
          <Suspense fallback={remotePending(t("sidebar:remote.loading"))}>
            <RemoteWindowSurface serverId={remoteServerId} column="leading" windowLabel={windowLabel} />
          </Suspense>
        ) : showWorkspaceRail || sidebarVisible || isDocumentWindow ? (
          <div className="app-sidebar-stack">
            {showWorkspaceRail && (
              <div className="app-sidebar-stack__rail">
                <WorkspaceRail windowLabel={windowLabel} />
              </div>
            )}
            {(sidebarVisible || isDocumentWindow) && (
              <div className="app-sidebar-stack__sidebar" style={{ width: sidebarVisible ? sidebarWidth : COLLAPSED_STRIP_WIDTH }}>
                <Sidebar />
                {sidebarVisible && <SidebarResizeHandle width={sidebarWidth} />}
              </div>
            )}
          </div>
        ) : null
      }
      sidebarWidth={sideWidth}
      primary={
        remoteServerId !== null ? (
          <FeatureErrorBoundary feature={t("errorBoundary.feature.editor")}>
            <Suspense fallback={remotePending(t("sidebar:remote.loading"))}>
              <RemoteWindowSurface serverId={remoteServerId} column="main" windowLabel={windowLabel} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : (
        <EditorArea
          editor={
            <FeatureErrorBoundary feature={t("errorBoundary.feature.editor")}>
              <DocumentSplitContainer />
            </FeatureErrorBoundary>
          }
          bottomBar={<BottomBar />}
          panel={
            <FeatureErrorBoundary feature={t("errorBoundary.feature.terminal")}>
              <Suspense fallback={null}>
                <TerminalPanel />
              </Suspense>
            </FeatureErrorBoundary>
          }
          panelPosition={terminalPosition}
          sidePanel={<KnowledgeBaseOverlay />}
        />
        )
      }
      overlays={
        <>
          {isDocumentWindow && <DocumentWindowMount />}
          {windowLabel === "main" && <MainWindowRunners />}

          <DropOverlay />
          <QuickOpen windowLabel={windowLabel} />
          <ContentSearch windowLabel={windowLabel} />
          <QuickLookOverlay />
          <WindowStatusOverlay />
          <CoherenceOverlays />
          <GeniePickerOverlay />
          <EditorContextMenu />
          <ApprovalDialog />
          <BrowserApprovalDialog />
          <WorkspaceApprovalDialog />
          <CommandPalette />
        </>
      }
    />
  );
}

function AppRoutes() {
  const { t } = useTranslation("dialog");
  return (
    <Routes>
      <Route path="/" element={<MainLayout />} />
      <Route
        path="/settings"
        element={
          <FeatureErrorBoundary feature={t("errorBoundary.feature.settings")}>
            <Suspense fallback={null}>
              <SettingsPage />
            </Suspense>
          </FeatureErrorBoundary>
        }
      />
      <Route
        path="/pdf-export"
        element={
          <FeatureErrorBoundary feature={t("errorBoundary.feature.pdfExport")}>
            <Suspense fallback={null}>
              <PdfExportPage />
            </Suspense>
          </FeatureErrorBoundary>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <WindowProvider>
        <AppRoutes />
        <ThemedToaster />
      </WindowProvider>
    </ErrorBoundary>
  );
}

export default App;
