import { useModal } from './use-modal';
import { useModal as useModalContext } from './modal-context';
import { Accessor, ComponentProps, createEffect, createSignal, onCleanup } from 'solid-js';

export type ModalProps = Omit<ComponentProps<'dialog'>, 'open'> & {
    onShow?: () => void;
    onClose?: () => void;
    onKeyDown?: () => void;
    'bind:show': Accessor<boolean>;
    closeOnBackdropClick?: boolean;
    alert?: boolean;
};

export const HModalPanel = (props: ComponentProps<'dialog'>) => {
    const {
        activateFocusTrap,
        closeModal,
        deactivateFocusTrap,
        showModal,
        trapFocus,
        wasModalBackdropClicked,
    } = useModal();
    const context = useModalContext();

    const [panelRef, setPanelRef] = createSignal<HTMLDialogElement>();
    let focusTrapRef: any = null;

    createEffect(async () => {
        const dialog = panelRef();
        if (!dialog) return;

        if (context.show()) {
            // Handle iOS scroll position issue
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            let originalRAF;

            if (isIOS) {
                originalRAF = window.requestAnimationFrame;
                window.requestAnimationFrame = () => 42;
            }

            await showModal(dialog);

            if (isIOS && originalRAF) {
                window.requestAnimationFrame = originalRAF;
            }

            // Setup focus trap after showing modal
            focusTrapRef = await trapFocus(dialog);
            activateFocusTrap(focusTrapRef);

            // Trigger show callback
            context.onShow?.();
        } else {
            await closeModal(dialog);
            // Trigger close callback
            context.onClose?.();
        }

    });


    onCleanup(() => {
        if (focusTrapRef) {
            deactivateFocusTrap(focusTrapRef);
        }
    });

    const handleBackdropClick = async (e: MouseEvent) => {
        if (context.alert === true || context.closeOnBackdropClick === false) {
            return;
        }

        // Only close if the backdrop itself was clicked (not content)
        if (e.target instanceof HTMLDialogElement && await wasModalBackdropClicked(panelRef(), e)) {
            context.setShow(false);
        }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        // Prevent spacebar/enter from triggering if dialog itself is focused
        if (e.target instanceof HTMLDialogElement && [' ', 'Enter'].includes(e.key)) {
            e.preventDefault();
        }

        // Handle escape key to close modal
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            context.setShow(false);
        }
        
        // Allow other keydown handlers to run
        // props.onKeyDown?.(e);
    };

    return (
        <dialog
            {...props}
            id={`${context.localId}-root`}
            aria-labelledby={`${context.localId}-title`}
            aria-describedby={`${context.localId}-description`}
            data-state={context.show() ? 'open' : 'closed'}
            data-open={context.show() ? '' : undefined}
            data-closed={!context.show() ? '' : undefined}
            role={context.alert === true ? 'alertdialog' : 'dialog'}
            onKeyDown={handleKeyDown}
            ref={setPanelRef}
            onClick={(e) => {
                e.stopPropagation();
                handleBackdropClick(e);
            }}
        >
            {props.children}
        </dialog>
    );
};