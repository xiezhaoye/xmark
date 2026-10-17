/**
 * Full-text search over the current workspace or all of them.
 *
 * Debounced as you type; a tap opens the file and scrolls to the match.
 * A late answer for an older query is dropped.
 *
 * @module components/SearchPage
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import type { SearchResult } from "../api/types";
import { useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { Icon } from "./Icon";
import { StatusMessage } from "./StatusMessage";
import { useClient } from "./useClient";

const DEBOUNCE_MS = 300;

export function SearchPage() {
  const client = useClient();
  const selectedRootId = useReaderStore((s) => s.selectedRootId);
  const groups = useReaderStore((s) => s.groups);
  const folders = useMemo(() => groups.flatMap((g) => g.folders), [groups]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"current" | "all">(selectedRootId ? "current" : "all");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (!q || !client) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      client
        .search(q, scope === "current" && selectedRootId ? selectedRootId : undefined)
        .then((r) => {
          if (mine !== seq.current) return;
          setResults(r.results);
          setTruncated(r.truncated);
          setError(null);
        })
        .catch((err: unknown) => {
          if (mine === seq.current) setError(err instanceof ApiError ? err.code : "network");
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, scope, client, selectedRootId]);

  const active = query.trim().length > 0;
  const shown = active ? results : null;
  const folderName = (rootId: string) => folders.find((f) => f.rootId === rootId)?.name ?? "";

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label={t("search.back")} onClick={() => useReaderStore.getState().setView("reader")}>
          <Icon name="back" />
        </button>
        <input ref={input} className="search-input" type="search" inputMode="search" enterKeyHint="search" placeholder={t("search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} autoCapitalize="off" autoCorrect="off" />
      </header>
      <div className="segmented" role="radiogroup">
        {(["current", "all"] as const).map((s) => (
          <button type="button" key={s} role="radio" aria-checked={scope === s} className={scope === s ? "on" : ""} disabled={s === "current" && !selectedRootId} onClick={() => setScope(s)}>
            {s === "current" ? t("search.scopeCurrent") : t("search.scopeAll")}
          </button>
        ))}
      </div>
      <div className="scroll results">
        {active && error && <StatusMessage tone="error" text={errorText(error)} />}
        {shown && !shown.length && !error && <StatusMessage text={t("search.noResults")} />}
        {shown?.map((r) => (
          <section key={`${r.rootId}/${r.relPath}`} className="result">
            <h3>
              {r.relPath} <span className="muted">· {folderName(r.rootId)}</span>
            </h3>
            {r.matches.slice(0, 5).map((m) => (
              <button type="button" key={m.lineNumber} className="match" onClick={() => void useReaderStore.getState().openDoc(r.rootId, r.relPath, query.trim())}>
                <span className="line">{m.lineNumber}</span>
                <span>{m.lineContent}</span>
              </button>
            ))}
          </section>
        ))}
        {shown && truncated && <p className="muted center">{t("search.truncated")}</p>}
      </div>
    </div>
  );
}
