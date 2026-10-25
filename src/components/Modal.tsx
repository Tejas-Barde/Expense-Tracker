import { ReactNode, useEffect } from "react";
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 overscroll-contain" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full sm:max-w-md bg-panel border border-line rounded-t-2xl sm:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between mb-4"><h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-mute">✕</button></div>
        {children}
      </div>
    </div>
  );
}
