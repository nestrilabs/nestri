import { useModal } from './modal-context';
import { ComponentProps } from 'solid-js';

export const HModalTrigger = (props: ComponentProps<"button">) => {
    const modal = useModal();

    const handleClick = () => {
        modal.setShow((prev) => !prev);
    };

    return (
        <button
            aria-haspopup="dialog"
            aria-label="Open Theme Customization Panel"
            aria-expanded={modal.showSig()}
            data-open={modal.showSig() ? '' : undefined}
            data-closed={!modal.showSig() ? '' : undefined}
            onClick={[handleClick, props.onClick]}
            {...props}
        >
            {props.children}
        </button>
    );
};