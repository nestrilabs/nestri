/** @jsxImportSource react */
import { qwikify$ } from '@builder.io/qwik-react';
import { type MotionProps, AnimatePresence } from 'framer-motion';
import React, { type ReactNode } from 'react';

interface ReactAnimateComponentProps extends MotionProps {
    // as?: keyof JSX.IntrinsicElements;
    children?: ReactNode;
    // class?: string;
    // id: string;
}


export const ReactAnimateComponent = ({
    // as = 'div',
    // id,
    children,
    // class: className,
    // ...motionProps
}: ReactAnimateComponentProps) => {
    // const MotionTag = motion[as as keyof typeof motion] as React.ComponentType<any>;

    return (
        <AnimatePresence mode='wait'>
            {children}
            {/* <MotionTag id={id} className={className} {...(motionProps as any)}>
            </MotionTag> */}
        </AnimatePresence>
    );
};

export const AnimateComponent = qwikify$(ReactAnimateComponent);