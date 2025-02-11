/** @jsxImportSource react */
// import { FooterBanner } from "../footer-banner";
import { motion } from "framer-motion"
import { ReactDisplay } from "./display"
import { qwikify$ } from "@builder.io/qwik-react";

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

export function ReactFooter({ children }: Props) {
  return (
    <>
      <footer className="flex justify-center flex-col items-center w-screen py-20 sm:pb-0 [&>*]:w-full px-3">
        <section className="mx-auto flex flex-col justify-center items-center max-w-[600px] pt-20">
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

        </section>
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{
            ...transition,
            duration: 0.8,
            delay: 0.7
          }}
          className="w-full sm:flex z-[1] hidden pointer-events-none overflow-hidden -mt-[80px] justify-center items-center flex-col" >
          <section className='my-0 bottom-0 text-[100%] max-w-[1440px] pointer-events-none w-full flex items-center translate-y-[40%] justify-center relative overflow-hidden px-2 z-10 [&_svg]:w-full [&_svg]:max-w-[1440px] [&_svg]:h-full [&_svg]:opacity-70' >
            <svg viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg" height={157} width={695} >
              <g strokeLinecap="round" fillRule="evenodd" fontSize="9pt" stroke="currentColor" strokeWidth="0.25mm" fill="currentColor">
                <path
                  fill="url(#paint1)"
                  pathLength="1"
                  stroke="url(#paint1)"
                  d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
              </g>
              <defs>
                <linearGradient gradientUnits="userSpaceOnUse" id="paint1" x1="317.5" x2="314.007" y1="-51.5" y2="126">
                  <stop stopColor="white"></stop>
                  <stop offset="1" stopOpacity="0"></stop>
                </linearGradient>
              </defs>
            </svg>
          </section>
        </motion.div>
      </footer>
    </>
  );
}
export const Footer = qwikify$(ReactFooter)