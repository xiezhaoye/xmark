/**
 * A centred card over a dimmed page — the one shape for "answer this first".
 *
 * Used where an inline control would be squeezed into a narrow column (renaming
 * a group) or where a choice must be made before anything else happens (how to
 * pair a Mac). Backdrop, Escape and the card's own buttons all close it; the
 * card stops its own clicks so a tap inside never dismisses.
 *
 * @module components/Modal
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({
  label,
  onClose,
  children,
}: {
  /** Accessible name: the modal's own title text. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
