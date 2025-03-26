
import { ModalContext } from './modal-context';
import { Accessor, ComponentProps, createSignal, createUniqueId, splitProps } from 'solid-js';

type ModalRootProps = {
    onShow?: () => void;
    onClose?: () => void;
    'bind:show'?: Accessor<boolean>;
    closeOnBackdropClick?: boolean;
    alert?: boolean;
} & ComponentProps<'div'>;

export const HModalRoot = (props: ModalRootProps) => {
    const localId = createUniqueId();

    const [modalProps, divProps] = splitProps(props, [
        'bind:show',
        'closeOnBackdropClick',
        'onShow',
        'onClose',
        'alert',
    ]);

    const [defaultShowSig, setDefaultShowSig] = createSignal<boolean>(false);
    const show = props["bind:show"] ?? defaultShowSig;

    return (
        <ModalContext.Provider value={{ ...modalProps, setShow: setDefaultShowSig, show, localId }} >
            <div {...divProps}>
                {props.children}
            </div>
        </ModalContext.Provider>
    );
};