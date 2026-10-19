/**
 * A short message at the bottom of the screen that goes away by itself: the
 * answer to a tap that changes nothing else on the page ("selected", "added").
 *
 * @module components/Toast
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

type Tone = "ok" | "error";

export function useToast(): {
  toast: ReactElement | null;
  show: (text: string, tone?: Tone, durationMs?: number) => void;
} {
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A caller can ask for a shorter or longer stay; without one, the tone decides.
  const show = useCallback((text: string, tone: Tone = "ok", durationMs?: number) => {
    clearTimeout(timer.current);
    setMessage({ text, tone });
    timer.current = setTimeout(() => setMessage(null), durationMs ?? (tone === "error" ? 4000 : 1800));
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toast = message ? (
    <div className={`toast toast-${message.tone}`} role="status">
      {message.text}
    </div>
  ) : null;
  return { toast, show };
}
