/**
 * A scroll container that refreshes when pulled down from the top.
 *
 * @module components/PullToRefresh
 */
import { useRef, useState, type ReactNode } from "react";
import { pullDistance, shouldRefresh } from "../gestures/pullToRefresh";
import { t } from "../i18n";

export function PullToRefresh({ onRefresh, onScroll, children, className = "" }: { onRefresh: () => Promise<void>; onScroll?: (scrollTop: number) => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [distance, setDistance] = useState(0);
  const [busy, setBusy] = useState(false);

  const end = async () => {
    const d = distance;
    startY.current = null;
    setDistance(0);
    if (!shouldRefresh(d) || busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? t("doc.refreshing") : shouldRefresh(distance) ? t("doc.releaseToRefresh") : t("doc.pullToRefresh");

  return (
    <div
      ref={ref}
      className={`scroll ${className}`}
      onTouchStart={(e) => {
        startY.current = (ref.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null;
      }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        setDistance(pullDistance({ startY: startY.current, y: e.touches[0].clientY, scrollTop: ref.current?.scrollTop ?? 0 }));
      }}
      onTouchEnd={() => void end()}
      onScroll={onScroll ? (e) => onScroll(e.currentTarget.scrollTop) : undefined}
    >
      <div className="pull" style={{ height: busy ? 40 : distance }} aria-live="polite">
        {(busy || distance > 8) && <span>{label}</span>}
      </div>
      {children}
    </div>
  );
}
