/* eslint-disable qwik/no-react-props */
/** @jsxImportSource react */
import { qwikify$ } from "@builder.io/qwik-react";
import { motion } from "framer-motion"
import { ReactDisplay } from "./display"
import * as React from "react"

const transition = {
    type: "spring",
    stiffness: 100,
    damping: 15,
    restDelta: 0.001,
    duration: 0.01,
}

type Props = {
    children?: React.ReactNode;
}

export function ReactHeroSection({ children }: Props) {
    return (
        <>
            <section className="px-4 w-screen pt-10 sm:pt-0" >
                <header className="mx-auto flex flex-col justify-center items-center max-w-[600px] pt-20 pb-1">
                    <motion.img
                        initial={{
                            opacity: 0,
                            y: 120
                        }}
                        whileInView={{
                            y: 0,
                            opacity: 1
                        }}
                        viewport={{ once: true }}
                        transition={{
                            ...transition
                        }}
                        src="/logo.webp" alt="Nestri Logo" height={80} width={80} draggable={false} className="w-[50px] md:w-[80px] aspect-[90/69] select-none" />
                    <div className="my-4 sm:mt-8 w-full flex flex-col justify-center items-center">
                        <ReactDisplay className="mb-4 sm:text-[5.6rem] text-[3.2rem] text-balance text-center tracking-tight leading-none" >
                            <motion.span
                                initial={{
                                    opacity: 0,
                                    y: 100
                                }}
                                whileInView={{
                                    y: 0,
                                    opacity: 1
                                }}
                                transition={{
                                    delay: 0.1,
                                    ...transition
                                }}
                                viewport={{ once: true }}
                                className="inline-block" >
                                Your games
                            </motion.span>
                            <motion.span
                                initial={{
                                    opacity: 0,
                                    y: 80
                                }}
                                transition={{
                                    delay: 0.2,
                                    ...transition
                                }}
                                whileInView={{
                                    y: 0,
                                    opacity: 1
                                }}
                                viewport={{ once: true }}
                                className="inline-block" >
                                Your rules
                            </motion.span>
                        </ReactDisplay>
                        <motion.p
                            initial={{
                                opacity: 0,
                                y: 50
                            }}
                            transition={{
                                delay: 0.3,
                                ...transition
                            }}
                            whileInView={{
                                y: 0,
                                opacity: 1
                            }}
                            viewport={{ once: true }}
                            className="dark:text-gray-50/70 text-gray-950/70 text-base font-normal text-center leading-tight text-balance tracking-tight sm:text-xl"
                        >
                            Nestri is an open-source cloud gaming platform that lets you play games on your own terms — invite friends to join your gaming sessions, share your game library, and take even more control by running it on your own GPU instance
                        </motion.p>
                        <motion.div
                            initial={{
                                opacity: 0,
                                y: 60
                            }}
                            transition={{
                                delay: 0.4,
                                ...transition
                            }}
                            whileInView={{
                                y: 0,
                                opacity: 1
                            }}
                            viewport={{ once: true }}
                            className="flex items-center justify-center mt-4 w-full"
                        >
                            {children}
                        </motion.div>
                    </div>
                </header>
            </section>
        </>
    )
}

export const HeroSection = qwikify$(ReactHeroSection)