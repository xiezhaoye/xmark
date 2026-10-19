/**
 * ServersSettings — the remote Macs this desktop can browse read-only.
 *
 * Purpose: one place to pair with another Mac's `xmark-mobile-server`, see
 * whether each one answers, and keep the list tidy. The pairing link is the
 * one the server prints (`xmark-mobile-server pair`), so the desktop and the
 * phone are paired by the same string.
 *
 * Key decisions:
 *   - **Verify before saving.** Adding probes `/api/health` through Rust and
 *     stores nothing when the probe fails: a list of servers that cannot be
 *     reached is worse than an empty one, and the user gets the reason
 *     (unreachable / timed out / token rejected / not a pairing link).
 *   - **One row per Mac.** Re-adding the same `host:port` updates the token and
 *     the name instead of listing it twice, and says "updated".
 *   - **Status is probed once, on open.** No polling: a settings page has no
 *     business holding a socket open, and the switcher re-probes on demand.
 *   - **Order is the switcher's order**, set by move-up/move-down buttons —
 *     the same list keyboard users can reorder without a drag.
 *   - **This page also CHOOSES the server**, as the phone's settings page
 *     does: one radio per row, with "This Mac" first. The choice belongs to a
 *     document window in another webview, so it is handed over as an event
 *     (`useSettingsSelection`) and the row is marked here at once.
 *
 * @coordinates-with hooks/useRemoteSelectionBridge.ts — mounts the selection
 *   listener while this page is open (a document window mounts it too)
 * @coordinates-with pages/settings/useSettingsSelection.ts — the radio state
 * @coordinates-with services/remoteServers/selection.ts — the cross-window events
 * @coordinates-with stores/remoteServersStore.ts — the list, persisted
 * @coordinates-with services/remoteServers/parsePairLink.ts — link validation
 * @module pages/settings/ServersSettings
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Server } from "lucide-react";
import { Button, SearchInput, SettingsGroup } from "./components";
import { useRemoteServersStore, type RemoteServer } from "@/stores/remoteServersStore";
import { PAIR_LINK_NAME_MAX, parsePairLink } from "@/services/remoteServers/parsePairLink";
import { defaultServerName } from "@/services/remoteServers/serverIdentity";
import { classifyRemoteFailure, remoteFailureKey, remoteFailureParams, remoteHealth } from "@/services/remoteServers/client";
import { useServerProbes } from "./serverProbes";
import { LocalServerRow } from "./LocalServerRow";
import { ServerRow } from "./ServerRow";
import { useSettingsSelection } from "./useSettingsSelection";
import { useContext } from "react";
import { WindowContext } from "@/contexts/WindowContext";
import { useRemoteSelectionBridge } from "@/hooks/useRemoteSelectionBridge";
import "./ServersSettings.css";
import { isImeKeyEvent } from "@/utils/imeGuard";

type Feedback = { kind: "ok" | "error"; text: string } | null;


export function ServersSettings() {
  const { t } = useTranslation("settings");
  const servers = useRemoteServersStore((s) => s.servers);
  const corrupt = useRemoteServersStore((s) => s.corrupt);
  // `null` outside a window context (a page rendered on its own by a test):
  // the bridge does nothing then, and nothing here depends on WHICH window
  // this is — only on the server it is handed.
  useRemoteSelectionBridge(useContext(WindowContext)?.windowLabel ?? null);
  const { activeId, choose, forget } = useSettingsSelection();
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  // One probe per server per opening — never a poll.
  const { status, probeAll, probeOne } = useServerProbes(servers);
  const probedOnOpen = useRef(false);

  useEffect(() => {
    if (probedOnOpen.current) return;
    probedOnOpen.current = true;
    probeAll();
  }, [probeAll]);

  const add = useCallback(async () => {
    if (adding) return;
    const parsed = parsePairLink(link);
    if (!parsed) {
      setFeedback({ kind: "error", text: t("servers.error.notPairLink") });
      return;
    }
    setAdding(true);
    setFeedback(null);
    try {
      await remoteHealth(parsed.connection);
    } catch (error) {
      const code = classifyRemoteFailure(error);
      const status = remoteFailureParams(error);
      setFeedback({
        kind: "error",
        // The failure vocabulary is shared with the remote browser, so it is
        // read from the app-wide instance rather than this component's scope.
        // A refusal carries the server's status: "…refused the request (502)".
        text:
          status === undefined
            ? i18n.t(`settings:${remoteFailureKey(code)}`)
            : i18n.t(`settings:${remoteFailureKey(code)}`, status),
      });
      return;
    } finally {
      setAdding(false);
    }
    const result = useRemoteServersStore.getState().addServer({
      host: parsed.connection.host,
      port: parsed.connection.port,
      token: parsed.connection.token,
      name: parsed.name,
    });
    const saved = useRemoteServersStore.getState().serverAt(result.id);
    setLink("");
    setFeedback({
      kind: "ok",
      text: t(result.status === "added" ? "servers.added" : "servers.updated", {
        name: saved?.name ?? defaultServerName(parsed.connection.host),
      }),
    });
    if (saved) probeOne(saved);
  }, [adding, link, probeOne, t]);

  const move = (index: number, delta: number) =>
    useRemoteServersStore.getState().moveServer(index, delta);

  const remove = (server: RemoteServer) => {
    useRemoteServersStore.getState().removeServer(server.id);
    // A window that was looking at it falls back to this Mac: a selection of a
    // server that no longer exists would render an empty remote shell.
    forget(server.id);
  };

  return (
    <>
      <SettingsGroup title={t("servers.group.remoteServers")}>
        <p className="text-xs text-[var(--text-secondary)]">{t("servers.hint")}</p>
        <div className="flex items-center gap-2 py-2">
          <SearchInput
            value={link}
            onChange={(v) => setLink(v.slice(0, 2048))}
            onKeyDown={(e) => {
              if (isImeKeyEvent(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder={t("servers.pasteLink")}
            aria-label={t("servers.pasteLink")}
            mono
            className="flex-1"
          />
          <Button variant="primary" onClick={() => void add()} disabled={adding || link.trim() === ""}>
            {adding ? t("servers.verifying") : t("servers.add")}
          </Button>
        </div>
        {feedback && (
          <p
            role={feedback.kind === "error" ? "alert" : "status"}
            className={`text-xs ${feedback.kind === "error" ? "text-[var(--error-color)]" : "text-[var(--text-secondary)]"}`}
          >
            {feedback.text}
          </p>
        )}
        {corrupt && (
          <p role="alert" className="text-xs text-[var(--warning-color)]">
            {t("servers.corrupt")}
          </p>
        )}
        {servers.length === 0 && (
          <p className="py-2 text-sm text-[var(--text-secondary)]">{t("servers.empty")}</p>
        )}
        {/* The radiogroup always has "This Mac" in it: it is how the remote
            mode is left, so it cannot disappear with the last server. */}
        <ul className="py-1" role="radiogroup" aria-label={t("servers.group.remoteServers")}>
          <LocalServerRow
            current={activeId === null}
            tabbable={activeId === null}
            onSelect={() => choose(null)}
          />
          {servers.map((server, index) => (
            <ServerRow
              key={server.id}
              server={server}
              state={status[server.id] ?? "checking"}
              current={activeId === server.id}
              tabbable={activeId === server.id}
              canMoveUp={index > 0}
              canMoveDown={index < servers.length - 1}
              onSelect={() => choose(server.id)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => remove(server)}
              onRename={(name) => useRemoteServersStore.getState().renameServer(server.id, name)}
              onRefresh={() => probeOne(server)}
            />
          ))}
        </ul>
      </SettingsGroup>
      <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <Server size={12} aria-hidden="true" />
        {t("servers.maxName", { max: PAIR_LINK_NAME_MAX })}
      </p>
    </>
  );
}

