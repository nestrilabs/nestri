/** @jsxImportSource react */

import React from "react"
import {
    display,
    type DisplayProps as DisplayVariants,
    type TextAlignProp,
    type TextWeightProp
} from "@nestri/ui/design"
import * as ReactBalancer from "react-wrap-balancer"
import { cn } from "@nestri/ui/design"
import { qwikify$ } from "@builder.io/qwik-react"

type DisplaySize = DisplayVariants["size"]
type DisplaySizeProp = DisplaySize | {
    initial?: DisplaySize,
    sm?: DisplaySize,
    md?: DisplaySize,
    lg?: DisplaySize,
    xl?: DisplaySize,
    xxl?: DisplaySize,
}

export interface DisplayProps extends React.HTMLAttributes<HTMLHeadingElement> {
    as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div" | "span",
    className?: string,
    size?: DisplaySizeProp;
    align?: TextAlignProp;
    weight?: TextWeightProp
}

export const ReactDisplay = ({
    size,
    as = "h1",
    weight,
    align,
    children,
    className,
    ...props
}: DisplayProps) => {
    const DisplayElement = as
    return (
        <DisplayElement className={display({
            size,
            weight,
            align,
            className: cn("font-basement font-extrabold", className)
        })} {...props}>
            <ReactBalancer.Balancer>
                {children}
            </ReactBalancer.Balancer>
        </DisplayElement>
    )
}

ReactDisplay.displayName = "Display"

export const Display = qwikify$(ReactDisplay)