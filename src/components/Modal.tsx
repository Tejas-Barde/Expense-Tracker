import { ReactNode, useEffect, useId, useRef } from "react";

/**
 * Dialog on desktop, bottom sheet on phones. Escape or a tap on the backdrop closes it.
 * `footer` stays pinned at the bottom while the content scrolls, so the main action is always reachable.
 */
export default function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 px-5 pt-3 sm:pt-5">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id={titleId} className="min-w-0 truncate text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="-mr-2 grid size-11 shrink-0 place-items-center rounded-lg text-mute hover:bg-ink hover:text-text">✕</button>
          </div>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 ${footer ? "pb-4" : "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"}`}>{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-panel px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}
