/**
 * Shares the current document's original server-saved bytes through the
 * system share sheet. A document or server switch invalidates stale notices;
 * repeated taps are ignored until the current action finishes.
 *
 * @module components/settings/ShareSection
 */
import { useEffect, useRef, useState } from "react";
import { useActiveProfile, useReaderStore } from "../../state/readerStore";
import { errorText, t } from "../../i18n";
import { sendOriginal } from "../../shareActions";
import { Icon } from "../Icon";

/** An inline outcome; cancellation leaves no notice. */
type Notice = { kind: "ok" | "error"; text: string } | null;

export function ShareSection() {
  const doc = useReaderStore((s) => s.doc);
  const profile = useActiveProfile();
  const makeClient = useReaderStore((s) => s.makeClient);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const docKey = doc && profile ? `${profile.id}/${doc.rootId}/${doc.relPath}` : null;

  useEffect(() => {
    generation.current += 1;
    running.current = false;
    setBusy(false);
    setNotice(null);
    return () => { generation.current += 1; };
  }, [docKey]);

  const usable = !!doc && !!profile;
  const send = async () => {
    if (!doc || !profile || running.current) return;
    running.current = true;
    const request = ++generation.current;
    setBusy(true);
    setNotice({ kind: "ok", text: t("share.sending") });
    const result = await sendOriginal(doc, profile, { makeClient });
    if (request !== generation.current) return;
    running.current = false;
    setBusy(false);
    if (result.status === "sent") setNotice({ kind: "ok", text: t("share.sent") });
    else if (result.status === "cancelled") setNotice(null);
    else setNotice({ kind: "error", text: errorText(result.code) });
  };

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
