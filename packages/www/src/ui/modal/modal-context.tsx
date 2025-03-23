import { Accessor, createContext, Setter, useContext } from "solid-js";

export const ModalContext = createContext<ModalContext>();

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("No modal context");
  return ctx;
}

export type ModalContext = {
  // core state
  localId: string;
  show: Accessor<boolean>;
  setShow: Setter<boolean>;
  onShow?: () => void;
  onClose?: () => void;
  closeOnBackdropClick?: boolean;
  alert?: boolean;
};