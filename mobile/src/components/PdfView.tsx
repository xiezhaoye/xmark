/**
 * A PDF, shown from its own bytes: fetched fresh through `/api/download`,
 * wrapped in a blob, and handed to the WebView's PDF viewer in an iframe.
 * The reader has no cached copy, so what is shown is what the Mac has saved.
 *
 * The blob URL lives exactly as long as the document being shown: a new
 * document (or a retry) revokes the old one, and a slow answer for a document
 * the user already left is dropped instead of replacing the newer preview.
 *
 * @module components/PdfView
 */
import { useEffect, useState } from "react";
import type { Client } from "../api/client";
import { ApiError } from "../api/client";
import { errorText, t } from "../i18n";
import { StatusMessage } from "./StatusMessage";
import { useClient } from "./useClient";

/** One fetched preview: the document it belongs to, plus its blob URL. */
interface Preview {
  key: string;
  url: string;
  name: string;
}

const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : "network");

export function PdfView({
  rootId,
  relPath,
  reloadToken,
  onRetry,
}: {
  rootId: string;
  relPath: string;
  reloadToken: number;
  /** Asks the reader to read the document again; the token then changes. */
  onRetry: () => void;
}) {
  const client: Client | null = useClient();
  // The reload counter is part of the identity: a retry fetches again.
  const key = `${rootId}/${relPath}#${reloadToken}`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState<{ key: string; code: string } | null>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    let made: string | null = null;
    client
      .download(rootId, relPath)
      .then(({ bytes, name, mimeType }) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mimeType }));
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { key, url: made as string, name };
        });
      })
      .catch((err: unknown) => live && setFailed({ key, code: codeOf(err) }));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [client, rootId, relPath, key]);

  const failure = failed?.key === key ? failed.code : null;
  if (failure) return <StatusMessage tone="error" text={errorText(failure)} onRetry={onRetry} />;
  const current = preview?.key === key ? preview : null;
  if (!current) return <StatusMessage text={t("doc.loading")} />;
  return <iframe className="pdf-view" title={current.name} src={current.url} />;
}
