/* eslint-disable qwik/no-react-props */
/** @jsxImportSource react */
import { qwikify$ } from "@builder.io/qwik-react";
import { motion } from "framer-motion"
import { ReactDisplay } from "./display"
// type Props = {
//     children?: React.ReactElement[]
// }

const transition = {
    type: "spring",
    stiffness: 100,
    damping: 15,
    restDelta: 0.001,
    duration: 0.01,
}

type Props = {
    title: string
    description?: string | string[]
}

export function ReactTitleSection({ title, description }: Props) {
    return (
        <>
            <section className="px-4" >
                <header className="overflow-hidden mx-auto max-w-xl pt-20 pb-4 flex justify-center items-center flex-col">
                    <motion.img
                        initial={{
                            opacity: 0,
                            y: 120
                        }}
                        whileInView={{
                            y: 0,
                            opacity: 1
                        }}
                        transition={{
                            ...transition
                        }}
                        viewport={{ once: true }}
                        src="/logo.webp" alt="Nestri Logo" height={80} width={80} draggable={false} className="w-[70px] md:w-[80px] aspect-[90/69]" />
                    <div className="my-4 sm:my-8 flex justify-center items-center flex-col text-center">
                        <ReactDisplay className="mb-4 sm:text-8xl text-[3.5rem] text-balance tracking-tight leading-none" >
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
                                {title}
                            </motion.span>
                        </ReactDisplay>
                        {description && (<motion.p
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
                            className="dark:text-gray-50/70 text-gray-950/70 text-lg font-normal tracking-tight sm:text-xl"
                        >
                            {Array.isArray(description) ? description.map((item, index) => {
                                return <span key={`id-${index}`}>{item} <br /> </span>
                            }) : description}
                        </motion.p>)}
                    </div>
                </header>
            </section>
        </>
    )
}
export const TitleSection = qwikify$(ReactTitleSection)