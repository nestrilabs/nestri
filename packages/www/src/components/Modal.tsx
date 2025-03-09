import { Component, JSX, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui/theme";

const ModalContainer = styled("div", {
  base: {
    width: "100%",
    maxWidth: 370,
    maxHeight: "75vh",
    height: "auto",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: theme.color.gray.d400,
    backgroundColor: theme.color.gray.d200,
    boxShadow: theme.color.boxShadow,
    backdropFilter: "blur(20px)",
    padding: "20px 25px"
  }
})

export interface ModalProps {
  isOpen?: boolean;
  onClose?: ((value: boolean) => void) | (() => void);
  children: JSX.Element;
  mountPoint?: HTMLElement;
  containerClass?: string;
  overlayClass?: string;
}

export function createModalController() {
  const [isOpen, setIsOpen] = createSignal(false);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(!isOpen()),
  };
}

export const Modal: Component<ModalProps> = (props) => {
  const mountPoint = props.mountPoint || document.getElementById("styled") || document.body;
  const isOpen = () => props.isOpen ?? false;

  const defaultOverlayStyle = `
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 50;
  `;

  return (
    <Portal mount={mountPoint}>
      <Show when={isOpen()}>
        <div
          class={props.overlayClass}
          style={!props.overlayClass ? defaultOverlayStyle : undefined}
          onClick={(e) => {
            if (e.target === e.currentTarget && props.onClose) {
              if (props.onClose.length > 0) {
                (props.onClose as (value: boolean) => void)(false);
              } else {
                (props.onClose as () => void)();
              }
            }
          }}
        >
          <ModalContainer>
            {props.children}
          </ModalContainer>
        </div>
      </Show>
    </Portal>
  );
};
