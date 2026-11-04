/**
 * Whether a path's tab will mount the WYSIWYG editing surface.
 *
 * Purpose: the StatusBar's "Opening large file…" indicator is cleared by ONE
 * consumer — `TiptapEditor`, once its document is parsed and interactive. A
 * large file that opens on any other surface (HTML preview, PDF, code, CSV,
 * SVG split pane) therefore never clears it, and the indicator sits in the
 * status bar for the rest of the session. The gate belongs where the indicator
 * is STARTED, so the read is reported only when something will report its end.
 *
 * A format declares a WYSIWYG surface by registering `wysiwygComponent`; only
 * the markdown adapter does. `dispatchEditor` throws when the registry has not
 * been bootstrapped, and the indicator is cosmetic — an unanswered throw must
 * not cost the user their file open, so a failure reads as "no indicator".
 *
 * @coordinates-with services/navigation/fileOpen.ts — the size-gated open
 * @coordinates-with services/navigation/replaceTabWithFile.ts — the same gate
 * @coordinates-with components/Editor/TiptapEditor.tsx — the only endLoad caller
 * @module lib/formats/openProgressGate
 */

import { dispatchEditor } from "./registry";

/**
 * The one WYSIWYG family. Used ONLY as the fallback below — the registry is the
 * authority whenever it can answer.
 */
const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

function extensionOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * True when `filePath` opens on a surface that will clear the load indicator.
 *
 * A registry that cannot answer (not bootstrapped — never in the app, routinely
 * in a unit test that mounts one open path) falls back to the extension: only
 * markdown declares a WYSIWYG surface, and answering "no" there would clear the
 * indicator under a document that would have cleared it itself.
 */
export function mountsWysiwygEditor(filePath: string): boolean {
  try {
    return dispatchEditor(filePath).wysiwygComponent !== undefined;
  } catch {
    return MARKDOWN_EXTS.has(extensionOf(filePath));
  }
}
