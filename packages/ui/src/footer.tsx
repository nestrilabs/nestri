/* eslint-disable qwik/jsx-img */
import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { MotionComponent, transition } from "@nestri/ui/react"
import { FooterBanner } from "./footer-banner";

const socialMedia = [
  {
    link: "https://github.com/nestriness/nestri",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 .999c-6.074 0-11 5.05-11 11.278c0 4.983 3.152 9.21 7.523 10.702c.55.104.727-.246.727-.543v-2.1c-3.06.683-3.697-1.33-3.697-1.33c-.5-1.304-1.222-1.65-1.222-1.65c-.998-.7.076-.686.076-.686c1.105.08 1.686 1.163 1.686 1.163c.98 1.724 2.573 1.226 3.201.937c.098-.728.383-1.226.698-1.508c-2.442-.286-5.01-1.253-5.01-5.574c0-1.232.429-2.237 1.132-3.027c-.114-.285-.49-1.432.107-2.985c0 0 .924-.303 3.026 1.156c.877-.25 1.818-.375 2.753-.38c.935.005 1.876.13 2.755.38c2.1-1.459 3.023-1.156 3.023-1.156c.598 1.554.222 2.701.108 2.985c.706.79 1.132 1.796 1.132 3.027c0 4.332-2.573 5.286-5.022 5.565c.394.35.754 1.036.754 2.088v3.095c0 .3.176.652.734.542C19.852 21.484 23 17.258 23 12.277C23 6.048 18.075.999 12 .999" /></svg>
    )
  },
  {
    link: "https://discord.com/invite/Y6etn3qKZ3",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.6 18.6 0 0 0-5.487 0a12 12 0 0 0-.617-1.23A.08.08 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.1.1 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055a20 20 0 0 0 5.993 2.98a.08.08 0 0 0 .084-.026a14 14 0 0 0 1.226-1.963a.074.074 0 0 0-.041-.104a13 13 0 0 1-1.872-.878a.075.075 0 0 1-.008-.125q.19-.14.372-.287a.08.08 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.08.08 0 0 1 .079.009q.18.148.372.288a.075.075 0 0 1-.006.125q-.895.515-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.08.08 0 0 0 .084.028a20 20 0 0 0 6.002-2.981a.08.08 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028M8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38c0-1.312.956-2.38 2.157-2.38c1.21 0 2.176 1.077 2.157 2.38c0 1.312-.956 2.38-2.157 2.38m7.975 0c-1.183 0-2.157-1.069-2.157-2.38c0-1.312.955-2.38 2.157-2.38c1.21 0 2.176 1.077 2.157 2.38c0 1.312-.946 2.38-2.157 2.38" /></svg>)
  },
  {
    link: "https://www.reddit.com/r/nestri",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286A.72.72 0 0 0 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0m4.388 3.199a1.999 1.999 0 1 1-1.947 2.46v.002a2.37 2.37 0 0 0-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363a2.802 2.802 0 1 1 2.908 4.753c-.088 3.256-3.637 5.876-7.997 5.876c-4.361 0-7.905-2.617-7.998-5.87a2.8 2.8 0 0 1 1.189-5.34c.645 0 1.239.218 1.712.585c1.275-.79 2.881-1.291 4.64-1.365v-.01a3.23 3.23 0 0 1 2.88-3.207a2 2 0 0 1 1.959-1.595m-8.085 8.376c-.784 0-1.459.78-1.506 1.797s.64 1.429 1.426 1.429s1.371-.369 1.418-1.385s-.553-1.841-1.338-1.841m7.406 0c-.786 0-1.385.824-1.338 1.841s.634 1.385 1.418 1.385c.785 0 1.473-.413 1.426-1.429c-.046-1.017-.721-1.797-1.506-1.797m-3.703 4.013c-.974 0-1.907.048-2.77.135a.222.222 0 0 0-.183.305a3.2 3.2 0 0 0 2.953 1.964a3.2 3.2 0 0 0 2.953-1.964a.222.222 0 0 0-.184-.305a28 28 0 0 0-2.769-.135" /></svg>)
  },
  {
    link: "https://x.com/nestriness",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M8 2H1l8.26 11.015L1.45 22H4.1l6.388-7.349L16 22h7l-8.608-11.478L21.8 2h-2.65l-5.986 6.886zm9 18L5 4h2l12 16z" /></svg>
    )
  },
]

type Props = {
  showBanner?: boolean
}

export const Footer = component$(({ showBanner = true }: Props) => {
  return (
    <>
      {showBanner && <FooterBanner />}
      <footer class="flex justify-center flex-col items-center w-full pt-8 sm:pb-0 pb-8 [&>*]:w-full px-3">
        <MotionComponent
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={transition}
          client:load
          as="div"
          class="w-full max-w-xl mx-auto z-[5] flex flex-col border-t-2 dark:border-gray-50/50 border-gray-950/50">
          <section class="flex justify-between items-center py-6 border-b-2 dark:border-gray-50/50 border-gray-950/50" >
            <div class="flex flex-row gap-1 h-max items-center justify-center">
              <svg
                width={40} height={40}
                viewBox="0 0 12.8778 9.7377253"
                version="1.1"
                id="svg1"
                xmlns="http://www.w3.org/2000/svg">
                <g id="layer1">
                  <path
                    d="m 2.093439,1.7855532 h 8.690922 V 2.2639978 H 2.093439 Z m 0,2.8440874 h 8.690922 V 5.1080848 H 2.093439 Z m 0,2.8440866 h 8.690922 V 7.952172 H 2.093439 Z"
                    style="font-size:12px;fill:#ff4f01;fill-opacity:1;fill-rule:evenodd;stroke:#ff4f01;stroke-width:1.66201;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                </g>
              </svg>
              <h3 class="text-lg font-extrabold font-title">Nestri</h3>
            </div>
            <p class="text-gray-950 dark:text-gray-50">Your games. Your rules.</p>
          </section>
          <section class="gap-4 grid grid-cols-2 sm:grid-cols-3 justify-around py-6 items-start" >
            <div class="flex flex-col gap-2">
              <h2 class="font-title text-sm font-bold" >Product</h2>
              <div class="text-gray-950/50 dark:text-gray-50/50 flex flex-col gap-2" >
                <p class="text-base opacity-50 cursor-not-allowed" >Docs</p>
                <Link href="/pricing" class="text-base hover:text-gray-950 dark:hover:text-gray-50 transition-all duration-200 hover:underline hover:underline-offset-4" >Pricing</Link>
                <Link href="/changelog" class="text-base hover:text-gray-950 dark:hover:text-gray-50 transition-all duration-200 hover:underline hover:underline-offset-4" >Changelog</Link>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <h2 class="font-title text-sm font-bold" >Company</h2>
              <div class="text-gray-950/50 dark:text-gray-50/50 flex flex-col gap-2" >
                <Link href="/blog" class="text-base hover:text-gray-950 dark:hover:text-gray-50 transition-all duration-200 hover:underline hover:underline-offset-4" >Blog</Link>
                <Link href="/contact" class="text-base hover:text-gray-950 dark:hover:text-gray-50 transition-all duration-200 hover:underline hover:underline-offset-4" >Contact Us</Link>
                <p class="text-base opacity-50 cursor-not-allowed" >Open Startup</p>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <h2 class="font-title text-sm font-bold" >Relations</h2>
              <div class="text-gray-950/50 dark:text-gray-50/50 flex flex-col gap-2" >
                <Link href="/privacy" class="text-base hover:text-gray-950 dark:hover:text-gray-50 hover:underline underline-offset-4 transition-all duration-200" >Privacy Policy</Link>
                <Link href="/terms" class="text-base hover:text-gray-950 dark:hover:text-gray-50 hover:underline underline-offset-4 transition-all duration-200" >Terms of Service</Link>
                {/**Social Media Icons with Links */}
                <div class="flex flex-row gap-3">
                  {socialMedia.map((item) => (
                    <Link key={item.link} href={item.link} class=" hover:text-gray-950 dark:hover:text-gray-50" target="_blank" rel="noopener noreferrer">
                      {item.icon()}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </MotionComponent>
        <MotionComponent
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{
            ...transition,
            duration: 0.8,
            delay: 0.7
          }}
          client:load
          as="div" class="w-full sm:flex z-[1] hidden pointer-events-none overflow-hidden -mt-[100px] justify-center items-center flex-col" >
          <section class='my-0 bottom-0 text-[100%] max-w-[1440px] pointer-events-none w-full flex items-center translate-y-[45%] justify-center relative overflow-hidden px-2 z-10 [&_svg]:w-full [&_svg]:max-w-[1440px] [&_svg]:h-full [&_svg]:opacity-70' >
            <svg viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg" height={157} width={695} class="" >
              <g stroke-linecap="round" fill-rule="evenodd" font-size="9pt" stroke="currentColor" stroke-width="0.25mm" fill="currentColor" style="stroke:currentColor;stroke-width:0.25mm;fill:currentColor">
                <path
                  fill="url(#paint1)"
                  pathLength="1"
                  stroke="url(#paint1)"
                  d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
              </g>
              <defs>
                <linearGradient gradientUnits="userSpaceOnUse" id="paint1" x1="317.5" x2="314.007" y1="-51.5" y2="126">
                  <stop stop-color="white"></stop>
                  <stop offset="1" stop-opacity="0"></stop>
                </linearGradient>
              </defs>
            </svg>
          </section>
        </MotionComponent>
      </footer>
    </>
  );
});