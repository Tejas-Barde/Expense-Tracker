import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import Modal from "./Modal";

interface ConfirmOptions { title: string; message: ReactNode; confirmLabel?: string; destructive?: boolean }
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmContext);

/** Promise-based replacement for window.confirm that matches the app's look and works well on touch screens. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback<ConfirmFn>((next) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Modal title={options.title} onClose={() => settle(false)}>
          <div className="space-y-5">
            <div className="text-sm leading-relaxed text-mute">{options.message}</div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="btn-ghost" onClick={() => settle(false)}>Cancel</button>
              <button type="button" autoFocus
                className={options.destructive ? "min-h-11 rounded-lg bg-red-500 px-4 font-semibold text-white hover:bg-red-600" : "btn"}
                onClick={() => settle(true)}>{options.confirmLabel ?? "Confirm"}</button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
