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
            aria-expanded={modal.show()}
            data-open={modal.show() ? '' : undefined}
            data-closed={!modal.show() ? '' : undefined}
            onClick={[handleClick, props.onClick]}
            {...props}
        >
            {props.children}
        </button>
    );
};