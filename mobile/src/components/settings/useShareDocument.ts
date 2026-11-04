/**
 * Sharing the open document's original bytes, as a hook.
 *
 * The action moved to the popover's HEADER (a share icon beside the word
 * 分享), so its state cannot live inside a section component any more: the
 * header owns the button, and the notice renders directly under it.
 *
 * A document or server switch invalidates stale notices; repeated taps are
 * ignored until the current action finishes.
 *
 * @module components/settings/useShareDocument
 */
import { useEffect, useRef, useState } from "react";
import { useActiveProfile, useReaderStore } from "../../state/readerStore";
import { errorText, t } from "../../i18n";
import { sendOriginal } from "../../shareActions";

/** An inline outcome; cancellation leaves no notice. */
export type ShareNotice = { kind: "ok" | "error"; text: string } | null;

export interface ShareDocument {
  /** False until a document on a server is open: nothing to send. */
  usable: boolean;
  busy: boolean;
  notice: ShareNotice;
  send: () => Promise<void>;
}

export function useShareDocument(): ShareDocument {
  const doc = useReaderStore((s) => s.doc);
  const profile = useActiveProfile();
  const makeClient = useReaderStore((s) => s.makeClient);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const [notice, setNotice] = useState<ShareNotice>(null);
  const docKey = doc && profile ? `${profile.id}/${doc.rootId}/${doc.relPath}` : null;

  useEffect(() => {
    generation.current += 1;
    running.current = false;
    setBusy(false);
    setNotice(null);
    return () => {
      generation.current += 1;
    };
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

  return { usable, busy, notice, send };
}
