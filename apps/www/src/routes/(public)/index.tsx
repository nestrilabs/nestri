/* eslint-disable qwik/jsx-img */
import { Footer } from "@nestri/ui"
import { Link } from "@builder.io/qwik-city";
import { component$ } from "@builder.io/qwik";
import ImgVictor from '~/images/avatars/victor.png?jsx';
import ImgJanried from '~/images/avatars/janried.png?jsx';
import ImgWanjohi from '~/images/avatars/wanjohi.png?jsx';
import ImgDatHorse from '~/images/avatars/dathorse.png?jsx';
import ImgMainDark from '~/images/screenshots/main-dark.png?jsx';
import ImgMainLight from '~/images/screenshots/main-light.png?jsx';
import { HeroSection, MotionComponent, transition } from "@nestri/ui/react"

export default component$(() => {

  return (
    <div class="w-screen relative">
      <HeroSection client:load>
        <div class="sm:w-full flex gap-3 justify-center pt-4 sm:flex-row flex-col w-auto items-center">
          <Link href="https://discord.gg/6um5K6jrYj" prefetch={false} class="flex ring-2 ring-primary-500 font-bricolage text-sm sm:text-base rounded-full bg-primary-500 px-5 py-4 font-semibold text-white transition-all hover:scale-105 active:scale-95 sm:px-6" >
            Join our Discord
          </Link>
          <Link href="/links/github" prefetch={false} class="sm:flex text-sm sm:text-base hidden font-bricolage items-center gap-2 rounded-full font-semibold text-gray-900/70 dark:text-gray-100/70 bg-white dark:bg-black px-5 py-4 ring-2 ring-gray-300 dark:ring-gray-700 transition-all hover:scale-105 active:scale-95 sm:px-6" >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-5 w-5 fill-content3-light"><path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clip-rule="evenodd"></path><path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clip-rule="evenodd"></path></svg>
            Star us on Github
          </Link>
        </div>
      </HeroSection>
      <MotionComponent
        initial={{ opacity: 0, y: 100 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={transition}
        client:load
        as="section"
        class="relative container py-10 min-[1280px]:max-w-[80rem] mx-auto overflow-x-clip" >
        <div class="w-max h-max relative mx-auto">
          <div class="absolute inset-0 bg-radial-gradient" />
          <ImgMainDark alt="Nestri screenshot in dark mode" draggable={false} class="dark:block hidden shadow-browser relative z-10 mx-auto w-full max-w-[848px] " />
          <ImgMainLight alt="Nestri screenshot in light mode" draggable={false} class="dark:hidden shadow-browser relative z-10 mx-auto w-full max-w-[848px] " />
        </div>
      </MotionComponent>
      {/* <section class="relative container py-10 max-w-[600px] px-4 mx-auto overflow-hidden z-20" >
        <div class="flex flex-col gap-2 justify-center text-center items-center" >
          <h2 class="sm:text-2xl font-bold font-bricolage text-lg" >
            Easily integrate with the Game Stores you already use
          </h2>
          <p class="dark:text-gray-50/70 text-gray-950/70 text-sm sm:text-base">It takes 1-3 minutes to setup your favorite game store and start playing on Nestri</p>
        </div>
        <div class="mt-8 flex flex-wrap justify-center gap-6 sm:gap-8 items-center [&>svg]:size-8 sm:[&>svg]:size-10 text-gray-800/70 dark:text-gray-200/70" >
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M15.974 0C7.573 0 .682 6.479.031 14.714l8.573 3.547a4.5 4.5 0 0 1 2.552-.786c.083 0 .167.005.25.005l3.813-5.521v-.078c0-3.328 2.703-6.031 6.031-6.031s6.036 2.708 6.036 6.036a6.04 6.04 0 0 1-6.036 6.031h-.135l-5.438 3.88c0 .073.005.141.005.214c0 2.5-2.021 4.526-4.521 4.526c-2.177 0-4.021-1.563-4.443-3.635L.583 20.36c1.901 6.719 8.063 11.641 15.391 11.641c8.833 0 15.995-7.161 15.995-16s-7.161-16-15.995-16zm-5.922 24.281l-1.964-.813a3.4 3.4 0 0 0 1.755 1.667a3.404 3.404 0 0 0 4.443-1.833a3.38 3.38 0 0 0 .005-2.599a3.36 3.36 0 0 0-1.839-1.844a3.38 3.38 0 0 0-2.5-.042l2.026.839c1.276.536 1.88 2 1.349 3.276s-2 1.88-3.276 1.349zm15.219-12.406a4.025 4.025 0 0 0-4.016-4.021a4.02 4.02 0 1 0 0 8.042a4.02 4.02 0 0 0 4.016-4.021m-7.026-.005c0-1.672 1.349-3.021 3.016-3.021s3.026 1.349 3.026 3.021c0 1.667-1.359 3.021-3.026 3.021s-3.016-1.354-3.016-3.021" /></svg>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M4.719 0C2.886 0 2.214.677 2.214 2.505v22.083q.002.313.027.579c.047.401.047.792.421 1.229c.036.052.412.328.412.328c.203.099.343.172.572.265l11.115 4.656c.573.261.819.371 1.235.355h.005c.421.016.667-.093 1.24-.355l11.109-4.656c.235-.093.369-.167.577-.265c0 0 .376-.287.412-.328c.375-.437.375-.828.421-1.229q.025-.266.027-.573V2.506c0-1.828-.677-2.505-2.505-2.505zm17.808 4.145h.905c1.511 0 2.251.735 2.251 2.267v2.505H23.85V6.51c0-.489-.224-.713-.699-.713h-.312c-.489 0-.713.224-.713.713v7.749c0 .489.224.713.713.713h.349c.468 0 .692-.224.692-.713v-2.771h1.833v2.86c0 1.525-.749 2.276-2.265 2.276h-.921c-1.521 0-2.267-.756-2.267-2.276V6.425c0-1.525.745-2.281 2.267-2.281zm-16.251.106h4.151v1.703H8.14v3.468h2.204v1.699H8.14v3.697h2.319v1.704H6.276zm5.088 0h2.928c1.515 0 2.265.755 2.265 2.28v3.261c0 1.525-.751 2.276-2.265 2.276h-1.057v4.453h-1.871zm6.037 0h1.864v12.271h-1.864zm-4.172 1.65v4.52H14c.469 0 .693-.228.693-.719V6.619c0-.489-.224-.719-.693-.719zM8.088 19.437h.276l.063.011h.1l.052.016h.052l.047.015l.052.011l.041.011l.093.021l.053.015l.036.011l.041.016l.052.016l.036.015l.053.021l.047.021l.041.025l.047.021l.036.025l.053.027l.041.025l.041.021l.041.031l.043.027l.036.031l.125.095l-.032.041l-.036.036l-.032.037l-.036.041l-.025.036l-.032.037l-.036.036l-.032.041l-.025.036l-.037.043l-.031.036l-.036.041l-.032.037l-.025.041l-.037.036l-.031.043l-.036.036l-.032.036l-.036-.025l-.041-.037l-.043-.025l-.077-.052l-.047-.027l-.043-.025l-.047-.027l-.036-.021l-.041-.02l-.084-.032l-.052-.009l-.041-.011l-.047-.011l-.053-.011l-.052-.005h-.052l-.061-.011h-.1l-.052.005h-.052l-.052.016l-.041.011l-.047.016l-.047.009l-.043.021l-.052.021l-.072.052l-.043.025l-.036.032l-.036.025l-.037.032l-.025.036l-.043.036l-.052.073l-.025.041l-.021.047l-.025.037l-.027.047l-.016.047l-.02.041l-.016.052l-.005.052l-.015.048l-.011.052v.052l-.005.052v.12l.005.052v.041l.005.052l.009.047l.016.041l.005.053l.016.041l.015.036l.021.052l.027.052l.02.037l.052.083l.032.041l.025.037l.043.031l.025.036l.036.032l.084.063l.036.02l.041.027l.048.021l.052.02l.036.021l.104.031l.047.005l.052.016l.052.005h.224l.063-.005h.047l.053-.021l.052-.005l.052-.015l.041-.011l.047-.021l.041-.02l.047-.021l.032-.021l.041-.025v-.464h-.735v-.744h1.661v1.667l-.036.025l-.036.031l-.037.027l-.041.031l-.041.021l-.036.032l-.084.052l-.052.025l-.083.052l-.053.021l-.041.02l-.047.021l-.104.041l-.041.021l-.095.031l-.047.011l-.047.016l-.052.016l-.041.009l-.156.032l-.048.005l-.104.011l-.057.005l-.052.004l-.057.005h-.26l-.052-.009h-.052l-.052-.011h-.047l-.052-.016l-.152-.031l-.041-.016l-.047-.005l-.052-.021l-.095-.031l-.093-.041l-.052-.021l-.036-.021l-.052-.02l-.037-.032l-.052-.02l-.031-.027l-.041-.025l-.084-.063l-.041-.027l-.032-.031l-.041-.032l-.068-.067l-.036-.032l-.031-.036l-.037-.037l-.025-.041l-.032-.031l-.025-.043l-.032-.041l-.025-.036l-.027-.041l-.025-.048l-.021-.041l-.021-.047l-.02-.041l-.041-.095l-.016-.036l-.021-.047l-.011-.047l-.009-.041l-.011-.052l-.016-.048l-.011-.052l-.005-.041l-.009-.052l-.011-.093l-.011-.104v-.276l.011-.053v-.052l.016-.052v-.052l.015-.047l.016-.052l.021-.093l.015-.052l.016-.047l.063-.141l.02-.041l.021-.047l.027-.048l.02-.041l.027-.036l.052-.084l.031-.041l.032-.036l.025-.041l.068-.068l.031-.037l.037-.036l.031-.036l.043-.032l.072-.063l.041-.031l.043-.027l.036-.031l.041-.027l.043-.02l.047-.027l.052-.025l.036-.027l.052-.02l.047-.021l.047-.025l.043-.011l.052-.016l.041-.021l.047-.009l.047-.016l.052-.011l.043-.016l.052-.011h.052l.047-.015h.052L8 19.444h.047zm15.985.011h.276l.063.011h.099l.052.015h.057l.052.016l.093.021l.052.011l.047.009l.053.016l.047.016l.041.011l.047.015l.052.016l.041.021l.052.02l.048.021l.047.027l.036.02l.047.027l.047.02l.043.027l.047.031l.036.027l.084.063l.041.025l-.032.041l-.025.043l-.031.036l-.032.041l-.025.047l-.027.043l-.031.036l-.032.041l-.025.043l-.032.041l-.025.036l-.032.041l-.025.048l-.032.041l-.031.036l-.032.041l-.025.043l-.041-.032l-.048-.025l-.036-.027l-.041-.025l-.047-.021l-.043-.027l-.047-.02l-.036-.021l-.052-.02l-.037-.021l-.041-.016l-.093-.031l-.104-.032l-.156-.031l-.052-.005l-.095-.011h-.109l-.057.011l-.052.011l-.047.011l-.041.02l-.037.021l-.041.036l-.031.047l-.021.048v.124l.027.057l.02.032l.032.031l.052.027l.041.025l.047.021l.052.02l.068.016l.036.016l.043.011l.052.011l.041.015l.047.011l.057.016l.052.016l.057.015l.057.011l.047.016l.057.015l.052.011l.047.011l.157.047l.041.016l.052.016l.047.02l.052.027l.104.041l.047.027l.084.052l.077.057l.048.031l.036.036l.036.043l.037.036l.025.036l.037.052l.025.037l.021.052l.02.031l.016.052l.016.043l.011.047l.02.104l.005.052l.005.047v.125l-.005.057l-.011.104l-.011.052l-.015.047l-.011.052l-.016.052l-.015.047l-.021.037l-.021.047l-.025.041l-.032.037l-.052.083l-.063.073l-.036.025l-.041.037l-.032.031l-.041.031l-.041.021l-.041.032l-.048.025l-.093.047l-.052.021l-.047.02l-.052.016l-.047.016l-.043.011l-.104.02l-.036.011l-.052.011h-.052l-.047.011h-.052l-.052.011h-.371l-.156-.016l-.052-.011l-.047-.005l-.104-.02l-.057-.011l-.047-.011l-.052-.016l-.053-.011l-.047-.015l-.052-.016l-.052-.021l-.041-.015l-.052-.016l-.052-.021l-.037-.02l-.052-.016l-.041-.027l-.052-.02l-.041-.027l-.037-.025l-.052-.027l-.036-.02l-.041-.032l-.041-.025l-.043-.032l-.036-.031l-.041-.032l-.037-.025l-.041-.037l.032-.041l.036-.036l.031-.037l.037-.041l.025-.036l.032-.041l.036-.037l.031-.036l.037-.041l.025-.037l.037-.036l.031-.041l.032-.037l.036-.041l.025-.036l.037-.037l.036-.041l.036.032l.048.031l.036.031l.052.027l.036.027l.047.031l.043.027l.047.02l.036.027l.047.015l.052.021l.043.021l.047.015l.041.021l.052.016l.047.015l.052.016l.052.005l.048.016l.052.005h.057l.047.015h.281l.047-.009l.052-.011l.036-.005l.043-.016l.036-.02l.047-.032l.027-.036l.02-.041l.016-.048v-.12l-.021-.047l-.025-.041l-.032-.031l-.047-.032l-.036-.015l-.047-.021l-.052-.021l-.057-.025l-.037-.011l-.041-.011l-.052-.016l-.036-.009l-.052-.016l-.052-.005l-.053-.021l-.052-.005l-.057-.015l-.047-.011l-.052-.016l-.052-.011l-.052-.015l-.047-.016l-.052-.011l-.041-.016l-.095-.031l-.052-.021l-.052-.015l-.104-.043l-.047-.025l-.052-.027l-.036-.025l-.048-.027l-.036-.025l-.047-.027l-.068-.068l-.036-.031l-.063-.073l-.027-.036l-.02-.036l-.032-.048l-.015-.036l-.048-.125l-.009-.052l-.011-.047v-.047l-.011-.052v-.213l.011-.104l.011-.043l.009-.047l.016-.041l.011-.052l.021-.036l.02-.053l.021-.041l.02-.052l.027-.036l.036-.041l.027-.043l.041-.036l.031-.036l.032-.043l.047-.036l.032-.027l.041-.031l.083-.052l.047-.027l.095-.047l.041-.015l.047-.016l.052-.021l.052-.015l.037-.011l.047-.011l.041-.011l.047-.011l.052-.011l.104-.009l.048-.005zm-12.318.036h.943l.043.095l.02.041l.016.052l.021.047l.015.041l.027.047l.031.095l.027.047l.041.093l.011.041l.083.188l.016.047l.021.043l.025.047l.011.047l.027.052l.009.047l.048.093l.02.037l.021.052l.016.052l.015.036l.027.052l.016.043l.02.052l.016.036l.021.052l.047.093l.015.047l.011.048l.021.047l.025.041l.021.052l.021.047l.015.041l.043.095l.015.047l.021.047l.016.047l.02.041l.027.048l.02.047l.021.041l.011.052l.041.093l.021.043l.015.047l.043.093l.025.052l.011.041l.027.053l.009.036l.021.052l.027.052l.02.036l.016.052l.021.043l.015.052l.027.036l.031.104l.021.037l.02.052l.027.041l.021.052l.009.047l.016.041l.021.047l.025.043h-1.041l-.025-.043l-.016-.047l-.021-.047l-.02-.052l-.011-.041l-.043-.093l-.015-.043l-.041-.093l-.016-.041l-.021-.052l-.031-.095l-.021-.041h-1.448l-.02.047l-.016.043l-.021.052l-.02.047l-.011.041l-.021.052l-.02.041l-.016.047l-.021.043l-.02.052l-.016.036l-.021.052l-.015.052l-.021.037l-.016.052h-1.031l.015-.048l.043-.093l.015-.052l.016-.041l.027-.047l.02-.047l.021-.043l.011-.047l.02-.052l.027-.041l.02-.047l.032-.095l.047-.093l.016-.047l.02-.041l.016-.048l.063-.14l.021-.052l.015-.041l.016-.047l.027-.043l.02-.052l.016-.047l.016-.041l.02-.052l.027-.037l.016-.052l.02-.041l.016-.047l.021-.052l.025-.041l.016-.052l.02-.037l.016-.052l.021-.052l.02-.036l.021-.052l.016-.043l.02-.052l.016-.036l.027-.052l.02-.052l.021-.041l.011-.047l.02-.048l.027-.047l.02-.041l.011-.052l.021-.047l.021-.043l.041-.093l.015-.041l.043-.104l.02-.037l.021-.052l.016-.041l.015-.052l.021-.047l.027-.041l.02-.052l.016-.037l.016-.052l.02-.041l.027-.047l.016-.052l.015-.043l.021-.052l.02-.036l.027-.052l.016-.052l.015-.036l.021-.052zm2.928.027h1.031l.032.041l.052.084l.025.047l.027.036l.025.047l.027.041l.025.048l.027.041l.025.036l.027.047l.025.043l.037.041l.015.041l.032.047l.025.043l.032.036l.021.047l.025.041l.032.043l.015.041l.037.047l.077.125l.021.041l.031.041l.027.041l.025.048l.079.124l.025.048l.027.041l.031-.041l.021-.053l.031-.036l.027-.047l.025-.036l.021-.052l.036-.037l.027-.047l.021-.036l.025-.043l.032-.047l.025-.036l.027-.052l.025-.036l.032-.048l.02-.036l.027-.052l.025-.031l.027-.043l.031-.052l.027-.036l.02-.047l.032-.037l.025-.052l.027-.031l.031-.041l.027-.052l.025-.037l.027-.047l.025-.036l.027-.052l.031-.037l.021-.047l.027-.036h1.047v3.719h-.98V21.04l-.025.037l-.032.052l-.025.031l-.032.041l-.02.052l-.032.037l-.025.036l-.032.052l-.052.073l-.031.041l-.027.052l-.031.037l-.027.036l-.02.052l-.032.036l-.025.037l-.032.052l-.025.036l-.032.041l-.025.047l-.021.037l-.031.041l-.027.047l-.031.036l-.032.043l-.02.041l-.027.047l-.031.037l-.032.041l-.02.052l-.037.031l-.02.041l-.032.053l-.025.036H16.6l-.031-.047l-.027-.043l-.025-.047l-.027-.036l-.031-.047l-.027-.041l-.031-.043l-.027-.041l-.025-.047l-.027-.036l-.036-.048l-.021-.041l-.031-.047l-.027-.036l-.025-.047l-.032-.043l-.025-.052l-.032-.036l-.025-.047l-.027-.043l-.025-.047l-.032-.036l-.025-.047l-.032-.041l-.02-.043l-.032-.041l-.025-.047l-.032-.036l-.025-.048l-.032-.041l-.02-.047l-.037-.036l-.02-.048l-.032-.041v2.193h-.963v-3.683zm4.624 0h2.933v.839h-1.959v.599h1.76v.792h-1.76v.635h1.984v.844h-2.953v-3.677zm-7.094 1.14l-.016.047l-.015.043l-.021.052l-.021.047l-.015.047l-.043.093l-.02.052l-.016.043l-.016.052l-.02.036l-.016.052l-.021.052l-.02.037l-.016.052l-.02.041l-.016.052l-.027.047l-.011.041l-.02.052l-.021.048l-.016.041l-.02.052h.859l-.02-.052l-.016-.047l-.041-.095l-.016-.047l-.021-.041l-.015-.052l-.021-.047l-.016-.047l-.02-.043l-.016-.047l-.021-.052l-.015-.041l-.043-.093l-.009-.048l-.021-.047l-.021-.052l-.015-.036l-.043-.104l-.015-.047zm-1.53 6.964h10.681l-5.452 1.797z" /></svg>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M7.15 15.24H4.36a.4.4 0 0 0-.4.4v2c0 .21.18.4.4.4h2.8v1.32h-3.5c-.56 0-1.02-.46-1.02-1.03v-3.39c0-.56.46-1.02 1.03-1.02h3.48zm1.01-3.7c0 .58-.47 1.05-1.05 1.05H2.63v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4H4.39a.4.4 0 0 0-.41.4v2.02c0 .23.18.4.4.4H6v1.35H3.68c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04H7.1c.58 0 1.05.47 1.05 1.04v5.86zm13.2 7.82h-1.32v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.42c0-.56.46-1.02 1.03-1.02h5.61zm.01-7.82c0 .58-.47 1.05-1.05 1.05h-4.48v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4h-2.03a.4.4 0 0 0-.4.4v2.02c0 .23.18.4.4.4h1.62v1.35H16.9c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04h3.43c.58 0 1.05.47 1.05 1.04v5.86zm-7.65-6.9h-3.44c-.58 0-1.04.47-1.04 1.04v3.44c0 .58.46 1.04 1.04 1.04h3.44c.57 0 1.04-.46 1.04-1.04V5.68c0-.57-.47-1.04-1.04-1.04m-.3 1.75v2.02a.4.4 0 0 1-.4.4h-2.03a.4.4 0 0 1-.4-.4V6.4c0-.22.17-.4.4-.4H13c.23 0 .4.18.4.4zm-.79 7.53H9.24c-.57 0-1.03.46-1.03 1.02v3.39c0 .57.46 1.03 1.03 1.03h3.39c.57 0 1.03-.46 1.03-1.03v-3.39c0-.56-.46-1.02-1.03-1.02m-.3 1.72v2a.4.4 0 0 1-.4.4v-.01H9.94a.4.4 0 0 1-.4-.4v-1.99c0-.22.18-.4.4-.4h2c.22 0 .4.18.4.4zM23.49 1.1a1.74 1.74 0 0 0-1.24-.52H1.75A1.74 1.74 0 0 0 0 2.33v19.34a1.74 1.74 0 0 0 1.75 1.75h20.5A1.74 1.74 0 0 0 24 21.67V2.33c0-.48-.2-.92-.51-1.24m0 20.58a1.23 1.23 0 0 1-1.24 1.24H1.75A1.23 1.23 0 0 1 .5 21.67V2.33a1.23 1.23 0 0 1 1.24-1.24h20.5a1.24 1.24 0 0 1 1.24 1.24v19.34z" /></svg>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 291.29 134.46" fill="currentColor">
            <path fill-rule="evenodd" d="M50.38,59.78c1.09-3.68,1-8.31,1-13.08V12.56c0-1.64.4-6.32-.25-7.29s-3.15-.75-4.9-.75c-5,0-7.22-.69-7.67,4.08l-.19.13c-3.92-3-7.65-5.85-14.84-5.72l-2.39.19a22.76,22.76,0,0,0-4.08,1A19.69,19.69,0,0,0,6.31,15a36.62,36.62,0,0,0-2.08,7.36,23.87,23.87,0,0,0-.38,7.54c.38,2.36.15,4.42.63,6.48,1.74,7.39,5.21,13.15,11.57,15.9a20.21,20.21,0,0,0,11.13,1.39A21,21,0,0,0,34.35,51l2.7-2h.06A22.54,22.54,0,0,1,37,55.75c-1.12,6.39-3,8.54-9.37,9.68a18,18,0,0,1-5.41.13l-5.28-.69L9.2,63a1.69,1.69,0,0,0-1.26,1.07,40.2,40.2,0,0,0,.25,7.8c.89,1.48,3.75,2.07,5.54,2.64,6,1.91,15.69,2.83,22.19.57C43.36,72.52,48.07,67.51,50.38,59.78ZM37.17,22.87V40.41a15.23,15.23,0,0,1-4.33,2.14c-10.59,3.32-14.59-4.12-14.59-13.89a25.33,25.33,0,0,1,1.13-8.87c.93-2.4,2.37-4.5,4.72-5.47.84-.34,1.85-.26,2.76-.63a21.18,21.18,0,0,1,7.8,1.2L37,16C37.57,17,37.17,21.31,37.17,22.87ZM79.74,56.32a25.65,25.65,0,0,0,8.36-3.21l3.33-2.45c.86,1.11.52,2.8,1.63,3.65s9.68,1.16,10.5,0,.44-3.67.44-5.41V26.46c0-4.37.33-9.26-.69-12.7C100.92,5.67,94.08,2.89,83.51,3l-5.66.37a62,62,0,0,0-9.56,2.08c-1.36.47-3.44.82-4,2.07s-.45,7.84.31,8.36c1.12.77,6.5-1,8-1.32,4.34-.94,14.24-1.9,16.66,1.2C91,18,90.71,22.37,90.67,26.39c-1,.24-2.72-.42-3.77-.63l-4.78-.5a18,18,0,0,0-5.28.19c-8.2,1.41-14,4.53-15.9,12.13C58,49.27,68.13,58.77,79.74,56.32ZM77.35,34.63c1.19-.7,2.67-.51,4.15-1.07,3.35,0,6.18.51,9,.63.51,1.12.14,6.83.12,8.55-2.39,3.17-12,6.33-15.27,1.82C73,41.23,74.57,36.26,77.35,34.63Zm38.53,16c0,1.75-.21,3.48.88,4.15.62.37,2.09.19,3,.19,2.09,0,9.28.44,10.06-.57,1-1.25.44-7.82.44-10.12V16.84a19.35,19.35,0,0,1,6.1-2.27c3.38-.79,7.86-.8,9.55,1.45,1.49,2,1.26,5.56,1.26,9.05v19c0,2.58-.58,9.79.88,10.69.9.54,5,.19,6.41.19s5.54.34,6.42-.32c1.18-.89.69-7.28.69-9.56q0-14.13.06-28.29c.48-.79,2.45-1.11,3.4-1.44,4.14-1.46,10.62-2.42,12.63,1.63,1,2.1.69,5.92.69,9V44.81c0,2.24-.5,8.33.44,9.56.55.71,1.83.57,3.08.57,1.88,0,9.33.33,10.19-.32,1.24-.94.75-4.74.75-6.85V28.22c0-8.24.64-15.75-3-20.44-6.52-8.5-23.71-3.95-30,1.45h-.25C157.15,5.18,153,2.9,146.44,3l-2.64.19a30.21,30.21,0,0,0-5.28,1.19,40.58,40.58,0,0,0-6.35,3l-3.08,1.89c-1.12-1.35-.44-3.54-2-4.46-.61-.37-8.67-.47-9.8-.19a2,2,0,0,0-1.07.69c-.66,1-.32,7.59-.32,9.49Zm96.32,2.13c6.17,3.87,17.31,4.71,26.09,2.52,2.21-.55,6.52-1.33,7.29-3.14a48.27,48.27,0,0,0,.12-7.55,1.83,1.83,0,0,0-.81-.94c-.79-.34-2,.24-2.77.44l-6.48,1.19a23.66,23.66,0,0,1-7.16.26,39.37,39.37,0,0,1-5-.7c-4.92-1.49-8.19-5.16-8.24-11.44,1.17-.53,5-.12,6.6-.12h16c2.3,0,6,.47,7.41-.57,1.89-1.41,1.75-10.85,1.14-13.89-2.07-10.3-8.28-16-20.75-15.78l-1.51.06-4.53.63c-4.86,1.22-9.05,3.46-11.75,6.85a25.69,25.69,0,0,0-3.71,6C201.68,22.42,201,33,203.08,40,204.76,45.59,207.71,49.93,212.2,52.73Zm3.7-32.56c1.13-3.25,3-5.62,6.29-6.66L225,13c7.46-.07,9.52,3.79,9.43,11.26-1,.46-4.25.12-5.66.12H215.21C214.8,23.33,215.58,21.1,215.9,20.17Zm77.65,13.2c-3-5.2-9.52-7.23-15.34-9.62-2.76-1.13-7.28-2.08-7.93-5.28-1.37-6.84,12.69-4.86,16.85-3.83,1.16.28,3.85,1.33,4.59.37s.38-3.29.38-4.77c0-1.23.16-2.8-.32-3.59-.72-1.21-2.61-1.55-4.08-2A36.6,36.6,0,0,0,276,3l-3.59.25A29.08,29.08,0,0,0,265.88,5a14.84,14.84,0,0,0-8,7.79c-2.23,5.52-.14,12.84,3.21,15.53,4,3.23,9.43,5.07,14.58,7.17,2.6,1.06,5.55,1.67,6.1,4.78,1.49,8.45-14.51,5.39-19.3,4.15-1-.27-4.16-1.34-5-.88-1.14.65-.69,3.85-.69,5.59,0,1-.15,2.42.25,3.08,1.2,2,7.83,3.26,10.75,3.84,11.6,2.3,21.92-1.62,25.65-8.93C295.3,43.59,295.64,37,293.55,33.37ZM252.81,83l-2.2.13a37.54,37.54,0,0,0-6.35.69,43.91,43.91,0,0,0-13.52,4.72c-1,.61-5,2.58-4.27,4.4.57,1.46,6.36.25,8.23.12,3.7-.25,5.51-.57,9-.56h6.41a35.9,35.9,0,0,1,5.73.37,8.52,8.52,0,0,1,3.45,1.64c1.46,1.25,1.19,5.49.69,7.48a139.33,139.33,0,0,1-5.78,18.86c-.41,1-3.64,7.3-.06,6.54,1.62-.35,4.9-4,5.91-5.22,5-6.39,8.15-13.75,10.5-23,.54-2.15,1.78-10.6.56-12.57C269.11,83.34,258.52,82.89,252.81,83ZM245,101l-5.72,2.51-9.49,3.58c-8.44,3.27-17.84,5.41-27.23,7.74l-11,2.07-12.95,1.7-4.15.31c-1.66.35-3.61.15-5.47.44a83.4,83.4,0,0,1-12.38.51l-9.37.06-6.73-.25-4.33-.25c-1-.2-2.18-.06-3.27-.26l-13.14-1.44c-3.89-.73-8.07-1-11.76-2l-3.08-.51L93.5,112.65c-8.16-2.55-16.27-4.54-23.89-7.48-8.46-3.27-17.29-6.84-24.77-11.26l-7.41-4.27c-1.35-.81-2.44-2-4.59-2-1.6.79-2.09,1.83-1,3.71a12.73,12.73,0,0,0,2.89,2.83l3.4,3.14c4.9,3.9,9.82,7.91,15.15,11.38,4.6,3,9.5,5.55,14.33,8.36l7.23,3.46c4.13,1.82,8.42,3.7,12.76,5.4l11.13,3.71c6,2,12.53,3,19,4.59l13.64,2,4.4.32,7.42.56h2.7a30.39,30.39,0,0,0,7.92.07l2.83-.07,3.46-.06,11.82-.94c5.3-1.18,10.88-1,15.9-2.52l11.57-2.82a195.36,195.36,0,0,0,20.31-7.11,144.13,144.13,0,0,0,23.63-12.57c2.56-1.72,6.18-3,6.86-6.6C250.75,101.43,247.63,100.27,245,101Z" transform="translate(-3.69 -3)" />
          </svg>
        </div>
      </section> */}
      <section class="w-full pt-24 pb-12 sm:pb-16">
        <div class="relative mx-auto max-w-[980px]">
          <div class="relative px-4 z-10 gap-1 sm:gap-2 mx-auto flex flex-col items-center text-balance text-center max-w-[680px]">
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
                y: 100
              }}
              transition={{
                ...transition,
                delay: 0.5,
              }}
              whileInView={{
                y: 0,
                opacity: 1
              }}
              viewport={{ once: true }}
              as="h3" class="sm:text-5xl font-mona font-extrabold text-2xl mb-2 sm:tracking-tighter">Play Co-Op or Stream to Friends with Nestri Parties</MotionComponent>
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
                y: 100
              }}
              transition={{
                ...transition,
                delay: 0.6,
              }}
              whileInView={{
                y: 0,
                opacity: 1
              }}
              viewport={{ once: true }}
              as="p"
              class="p1 sm:text-xl dark:text-gray-50/70 text-gray-950/70">Invite friends to watch your gameplay live, join multiplayer lobbies, or jump into co-op sessions</MotionComponent>
          </div>
          <div class="mx-auto overflow-x-hidden">
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
              }}
              transition={{
                ...transition,
                delay: 0.6,
              }}
              whileInView={{
                opacity: 1
              }}
              viewport={{ once: true }} class="pt-24 pb-11 select-none sm:[padding-inline:16px] mx-auto w-full relative max-w-[720px]" >
              <div class="top-12 z-[1] scale-[.8] left-0 absolute w-full h-1/2 [transform-origin:top_center] ring-2 ring-gray-200 dark:ring-gray-800 dark:bg-black bg-white rounded-xl aspect-[4/2.5] bg-clip-padding p-4" />
              <div class="absolute left-0 top-[70px] scale-90 z-[2] w-full h-1/2 [transform-origin:top_center] ring-2 ring-gray-200 dark:ring-gray-800 dark:bg-black bg-white rounded-xl aspect-[4/2.5] bg-clip-padding p-4" />
              <div class="relative z-[3] [transform-origin:top_center] border-2 border-gray-200 dark:border-gray-800 dark:bg-black bg-white rounded-xl aspect-[4/2.5] bg-clip-padding p-4 [mask-image:linear-gradient(0deg,rgba(0,0,0,0)_10%,rgba(0,0,0,1)_20%,rgba(0,0,0,1))]">
                <div class="relative flex justify-center w-full">
                  <div class="absolute left-0 top-1 items-center gap-1 flex group [&>:first-child]:bg-[hsla(358,75%,59%,1)] [&>:nth-child(2)]:bg-[hsla(208,100%,66%,1)] [&>:last-child]:bg-[hsla(170,70%,57%,1)]">
                    {new Array(3).fill(0).map((_, key) => (
                      <div key={`toolbar-${key}`} class="size-2.5 rounded-full" />
                    ))}
                  </div>
                  <div class="flex items-center gap-2 dark:text-gray-50/70 text-gray-950/70">
                    <svg xmlns="http://www.w3.org/2000/svg" class="-mt-0.5" width="16" height="16" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0-2 0m-3-5V7a4 4 0 1 1 8 0v4" /></g></svg>
                    <p class="text-sm leading-none tracking-tighter">app.nestri.io/play</p>
                  </div>
                </div>
                <div class="rounded-md relative w-full h-full border border-gray-200 dark:border-gray-800 mt-4 overflow-hidden">
                  <img width={100} draggable={false} height={100} src="/images/screenshots/movie.avifs" class="h-full w-full" />
                </div>
              </div>
              <div class="absolute z-[3] w-max top-[27%] sm:top-[35%] sm:-left-16 left-2">
                <div class="px-3 rounded-xl bg-[rgb(18,162,24)] flex py-1.5 w-min items-center gap-1">
                  <div class="items-start flex gap-0.5">
                    <svg width="28" height="24" viewBox="0 0 28 24" fill="none">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 6C12 4.89543 12.8954 4 14 4C15.1046 4 16 4.89543 16 6V11C16 12.1046 15.1046 13 14 13C12.8954 13 12 12.1046 12 11V6ZM15 17C15 16.9534 15.0322 16.9117 15.0781 16.9034C17.8773 16.3955 20 13.9457 20 11C20 10.4477 19.5523 10 19 10C18.4477 10 18 10.4477 18 11C18 13.2091 16.2091 15 14 15C11.7909 15 10 13.2091 10 11C10 10.4477 9.55228 10 9 10C8.44772 10 8 10.4477 8 11C8 13.9457 10.1227 16.3955 12.9219 16.9034C12.9678 16.9117 13 16.9534 13 17V17V19C13 19.5523 13.4477 20 14 20C14.5523 20 15 19.5523 15 19V17V17Z" fill="white"></path>
                      <rect class="animate-pulse duration-75" x="18.5" y="16.5" width="5" height="5" rx="2.5" fill="#00FF0B" stroke="#13A318"></rect>
                    </svg>
                    <svg xmlns="http://www.w3.org/2000/svg" class="text-white/50" width="28" height="24" viewBox="0 0 24 24"><path d="M4 19h10.879L2.145 6.265A1.977 1.977 0 0 0 2 7v10c0 1.103.897 2 2 2zM18 7c0-1.103-.897-2-2-2H6.414L3.707 2.293L2.293 3.707l18 18l1.414-1.414L18 16.586v-2.919L22 17V7l-4 3.333V7z" fill="currentColor" /></svg>
                  </div>
                  <hr class="w-[1px] h-5 bg-white/50 border-none" />
                  <div class="flex h-9 cursor-pointer items-center justify-center rounded-full w-max">
                    <ImgWanjohi draggable={false} alt="Wanjohi Ryan's Avatar" class="size-6 rounded-full border-2 border-[#FF9300]" />
                    <ImgVictor draggable={false} alt="Victor's Pahuus Avatar" class="size-6 -ml-2 border-2 border-[#9340D5] rounded-full" />
                    <ImgDatHorse draggable={false} alt="DatCaptainHorse's Avatar" class="bg-white size-6 -ml-2 border-2 border-[#006FFE] rounded-full" />
                  </div>
                  <div>
                  </div>
                </div>
              </div>
              <div class="absolute z-[3] bottom-[40%] right-0 sm:-right-24">
                <div class="bg-white dark:bg-black py-3 px-4 rounded-[20px] ring-gray-200 dark:ring-gray-800 ring-2 relative">
                  <svg aria-hidden="true" class="absolute dark:hidden -bottom-[3px] -right-[7px]" fill="none" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 0H24V24H0z" fill="#f5f5f5 " transform="matrix(-1 0 0 1 24 0)"></path>
                    <mask height="24" id="ad" maskUnits="userSpaceOnUse" width="24" x="0" y="0" style="mask-type: alpha;"><path d="M24 0H0v24h24V0z" fill="#D9D9D9"></path></mask>
                    <g filter="url(#filter0_d_1762_122304)" mask="url(#ad)">
                      <mask fill="#000" height="42" id="ba" maskUnits="userSpaceOnUse" width="46" x="-24" y="-20">
                        <path d="M-24 -20H22V22H-24z" fill="#fff"></path>
                        <path clip-rule="evenodd" d="M-3-19c11.046 0 20 8.954 20 20 0 .335-.008.669-.025 1H17v10a15 15 0 003 9 14.952 14.952 0 01-10.555-4.342A19.915 19.915 0 01-3 21c-11.046 0-20-8.954-20-20s8.954-20 20-20z" fill-rule="evenodd"></path>
                      </mask>
                      <path clip-rule="evenodd" d="M-3-19c11.046 0 20 8.954 20 20 0 .335-.008.669-.025 1H17v10a15 15 0 003 9 14.952 14.952 0 01-10.555-4.342A19.915 19.915 0 01-3 21c-11.046 0-20-8.954-20-20s8.954-20 20-20z" fill="#FFF" fill-rule="evenodd"></path>
                      <path stroke-width={2} stroke="#e5e5e5" d="M16.975 2v1h-1.05l.052-1.05.998.05zM17 2V1h1v1h-1zm3 19l.8-.6L22 22h-2v-1zM9.445 16.658l-.623-.783.695-.553.631.625-.703.71zM16 1C16-9.493 7.493-18-3-18v-2c11.598 0 21 9.402 21 21h-2zm-.023.95C15.992 1.637 16 1.32 16 1h2c0 .352-.009.702-.026 1.05l-1.997-.1zM17 3h-.025V1H17v2zm-1 9V2h2v10h-2zm3.2 9.6A16 16 0 0116 12h2a14 14 0 002.8 8.4l-1.6 1.2zm-9.052-5.653A13.952 13.952 0 0020 20v2c-4.39 0-8.37-1.77-11.259-4.632l1.407-1.42zM-3 20c4.47 0 8.577-1.542 11.822-4.125l1.245 1.565A20.915 20.915 0 01-3 22v-2zM-22 1c0 10.493 8.507 19 19 19v2c-11.598 0-21-9.402-21-21h2zm19-19c-10.493 0-19 8.507-19 19h-2c0-11.598 9.402-21 21-21v2z" fill="#e5e5e5" mask="url(#ba)"></path>
                    </g>
                    <defs>
                      <filter color-interpolation-filters="s-rGB" filterUnits="userSpaceOnUse" height="46" id="filter0_d_1762_122304" width="50" x="-26" y="-21">
                        <feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"></feColorMatrix>
                        <feOffset dy="1"></feOffset><feGaussianBlur stdDeviation="1"></feGaussianBlur>
                        <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0"></feColorMatrix>
                        <feBlend in2="BackgroundImageFix" result="effect1_dropShadow_1762_12230"></feBlend>
                        <feBlend in="SourceGraphic" in2="effect1_dropShadow_1762_12230" result="shape"></feBlend>
                      </filter>
                    </defs>
                  </svg>
                  <svg aria-hidden="true" class="absolute dark:block hidden -bottom-[3px] -right-[7px]" style={{ transform: "scale(-1,1)" }} fill="none" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
                    <rect fill="#171717" height="24" width="24"></rect>
                    <mask height="24" id="mask0_1762_12230" maskUnits="userSpaceOnUse" width="24" x="0" y="0" style="mask-type: alpha;">
                      <path d="M0 0H24V24H0V0Z" fill="#D9D9D9"></path>
                    </mask>
                    <g mask="url(#mask0_1762_12230)">
                      <g filter="url(#filter0_d_1762_12230)">
                        <mask fill="black" height="42" id="path-3-outside-1_1762_12230" maskUnits="userSpaceOnUse" width="46" x="2" y="-20">
                          <rect fill="white" height="42" width="46" x="2" y="-20"></rect>
                          <path clip-rule="evenodd" d="M27 -19C15.9543 -19 7 -10.0457 7 1C7 1.33533 7.00825 1.66872 7.02456 2H7V12C7 15.2456 5.94733 18.4036 4 21C8.11612 21 11.845 19.3421 14.5553 16.6576C17.9708 19.3758 22.2957 21 27 21C38.0457 21 47 12.0457 47 1C47 -10.0457 38.0457 -19 27 -19Z" fill-rule="evenodd"></path>
                        </mask>
                        <path clip-rule="evenodd" d="M27 -19C15.9543 -19 7 -10.0457 7 1C7 1.33533 7.00825 1.66872 7.02456 2H7V12C7 15.2456 5.94733 18.4036 4 21C8.11612 21 11.845 19.3421 14.5553 16.6576C17.9708 19.3758 22.2957 21 27 21C38.0457 21 47 12.0457 47 1C47 -10.0457 38.0457 -19 27 -19Z" fill="#000" fill-rule="evenodd"></path>
                        <path stroke-width={2} stroke="#262626" d="M7.02456 2V3H8.07502L8.02335 1.95082L7.02456 2ZM7 2V1H6V2H7ZM4 21L3.2 20.4L2 22H4V21ZM14.5553 16.6576L15.178 15.8752L14.4829 15.3219L13.8516 15.9471L14.5553 16.6576ZM8 1C8 -9.49341 16.5066 -18 27 -18V-20C15.402 -20 6 -10.598 6 1H8ZM8.02335 1.95082C8.00785 1.63591 8 1.31892 8 1H6C6 1.35173 6.00866 1.70153 6.02578 2.04918L8.02335 1.95082ZM7 3H7.02456V1H7V3ZM8 12V2H6V12H8ZM4.8 21.6C6.87715 18.8305 8 15.4619 8 12H6C6 15.0292 5.01751 17.9767 3.2 20.4L4.8 21.6ZM13.8516 15.9471C11.3209 18.4537 7.84202 20 4 20V22C8.39022 22 12.3691 20.2305 15.259 17.3681L13.8516 15.9471ZM27 20C22.5299 20 18.4229 18.4576 15.178 15.8752L13.9326 17.4401C17.5187 20.2941 22.0615 22 27 22V20ZM46 1C46 11.4934 37.4934 20 27 20V22C38.598 22 48 12.598 48 1H46ZM27 -18C37.4934 -18 46 -9.49341 46 1H48C48 -10.598 38.598 -20 27 -20V-18Z" fill="#262626" mask="url(#path-3-outside-1_1762_12230)"></path>
                      </g>
                    </g>
                    <defs>
                      <filter color-interpolation-filters="s-rGB" filterUnits="userSpaceOnUse" height="46" id="filter0_d_1762_12230" width="50" x="0" y="-21">
                        <feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood>
                        <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"></feColorMatrix>
                        <feOffset dy="1"></feOffset>
                        <feGaussianBlur stdDeviation="1"></feGaussianBlur>
                        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0"></feColorMatrix>
                        <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow_1762_12230"></feBlend>
                        <feBlend in="SourceGraphic" in2="effect1_dropShadow_1762_12230" mode="normal" result="shape"></feBlend>
                      </filter>
                    </defs>
                  </svg>
                  <div class="flex flex-col items-stretch gap-2">
                    <div class="flex flex-row justify-between">
                      <div class="flex flex-row items-center gap-1">
                        <ImgWanjohi draggable={false} alt="Wanjohi Ryan's Avatar" class="size-5 rounded-full border-2 border-[#FF9300]" />
                        <span class="text-sm font-medium dark:text-gray-50/70 text-gray-950/70">Wanjohi Ryan</span>
                      </div>
                      <span class="text-gray-950/50 dark:text-gray-50/50 ml-3 text-sm min-h-6 flex items-center justify-center">3 minutes ago</span>
                      <div>
                      </div>
                    </div>
                    <p class="text-sm text-gray-950/50 dark:text-gray-50/50" >
                      Wow! You did it!
                    </p>
                  </div>
                </div>
              </div>
              <div class="sm:block hidden absolute -left-24 bottom-[25%] z-[3]" >
                <div class="p-4 bg-white dark:bg-black ring-2 ring-gray-200 dark:ring-gray-800 rounded-xl flex flex-row gap-2" >
                  <div class="size-6 rounded-full ring-2 ring-[hsla(274,71%,43%)] flex justify-center items-center">
                    <ImgJanried alt="Janried's Avatar" class="rounded-full" />
                  </div>
                  <span class="text-sm text-gray-600 dark:text-gray-400 h-6 flex justify-center items-center">
                    <span class="text-[hsla(274,71%,43%)]">JanRied#33</span>&nbsp;is requesting to join this Party
                  </span>
                </div>
              </div>
              <div class="absolute right-5 sm:-right-20 bottom-[12%] sm:bottom-[20%] z-[3]" >
                <div class="p-4 bg-white dark:bg-black ring-2 ring-gray-200 dark:ring-gray-800 rounded-xl flex gap-3 items-center" >
                  <div class="size-6 rounded-full bg-[hsla(358,75%,59%,1)] text-white flex justify-center items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                      <g fill="currentColor" fill-rule="evenodd" stroke-width="1.5" clip-rule="evenodd">
                        <path d="M14.752 1.914a5.25 5.25 0 0 0 4.07 8.333v.011c.015.198.03.401.05.597c.237 2.247.777 3.79 1.296 4.803c.345.675.684 1.123.924 1.394a3.4 3.4 0 0 0 .34.335l.01.006A.75.75 0 0 1 21 18.75H3a.75.75 0 0 1-.441-1.356l.008-.007l.064-.054c.06-.054.157-.145.277-.281c.24-.27.579-.718.924-1.393C4.522 14.31 5.25 12.03 5.25 8.4c0-1.881.7-3.694 1.96-5.038C8.472 2.016 10.194 1.25 12 1.25q.574 0 1.133.101c.238.043 1.018.286 1.619.563" />
                        <path d="M15.25 5a3.75 3.75 0 1 1 7.5 0a3.75 3.75 0 0 1-7.5 0M9.894 20.351a.75.75 0 0 1 1.025.273a1.25 1.25 0 0 0 2.162 0a.75.75 0 1 1 1.298.753a2.75 2.75 0 0 1-4.758 0a.75.75 0 0 1 .273-1.026" />
                      </g>
                    </svg>
                  </div>
                  <div class="text-sm text-gray-600 dark:text-gray-400">
                    <span class="text-[#006FFE]">DatHorse#77</span>&nbsp;is requesting pointer access
                  </div>
                </div>
              </div>
            </MotionComponent>
          </div>
        </div>
      </section>
      <section class="w-full pb-12 sm:pb-16">
        <div class="relative mx-auto max-w-[980px]">
          <div class="relative px-4 z-10 gap-1 sm:gap-2 mx-auto flex flex-col items-center text-balance text-center max-w-[680px]">
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
                y: 100
              }}
              transition={{
                ...transition,
                delay: 0.5,
              }}
              whileInView={{
                y: 0,
                opacity: 1
              }}
              viewport={{ once: true }}
              as="h3" class="sm:text-5xl font-mona font-extrabold text-2xl mb-2 sm:tracking-tighter">Team Up with Friends on a Shared Gaming Machine</MotionComponent>
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
                y: 100
              }}
              transition={{
                ...transition,
                delay: 0.6,
              }}
              whileInView={{
                y: 0,
                opacity: 1
              }}
              viewport={{ once: true }}
              as="p"
              class="p1 sm:text-xl dark:text-gray-50/70 text-gray-950/70">Form a team of up to 5 players, share a GPU instance and storage, and play games remotely together</MotionComponent>
          </div>
          <MotionComponent
            client:load
            initial={{
              opacity: 0,
            }}
            transition={{
              ...transition,
              delay: 0.6,
            }}
            whileInView={{
              opacity: 1
            }}
            viewport={{ once: true }}
            class="absolute z-20 block rounded-full text-xs sm:text-base px-4 py-2 text-white shadow-lg bg-red-500 -bottom-16 left-0">
            Jd the 65th
            <span class="absolute -right-4 -top-4 rotate-45 text-red-500">
              <svg width="24" height="20" fill="none" viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.6268 0.755784C11.2467 -0.251929 12.7533 -0.251928 13.3732 0.755785L23.7722 17.6588C24.4072 18.691 23.6394 20 22.3989 20H1.60105C0.360604 20 -0.407208 18.691 0.227812 17.6588L10.6268 0.755784Z"></path>
              </svg>
            </span>
          </MotionComponent>
          <MotionComponent
            client:load
            initial={{
              opacity: 0,
            }}
            transition={{
              ...transition,
              delay: 0.6,
            }}
            whileInView={{
              opacity: 1
            }}
            viewport={{ once: true }}
            class="absolute z-20 hidden md:block rounded-full px-4 py-2 text-white shadow-lg bg-blue-500 bottom-6 right-20">
            Ryan
            <span class="absolute -left-4 -top-4 -rotate-45 text-blue-500">
              <svg width="24" height="20" fill="none" viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.6268 0.755784C11.2467 -0.251929 12.7533 -0.251928 13.3732 0.755785L23.7722 17.6588C24.4072 18.691 23.6394 20 22.3989 20H1.60105C0.360604 20 -0.407208 18.691 0.227812 17.6588L10.6268 0.755784Z"></path>
              </svg>
            </span>
          </MotionComponent>
          <MotionComponent
            client:load
            initial={{
              opacity: 0,
            }}
            transition={{
              ...transition,
              delay: 0.6,
            }}
            whileInView={{
              opacity: 1
            }}
            viewport={{ once: true }}
            class="absolute z-20 block text-xs sm:text-base rounded-full px-4 py-2 text-white shadow-lg bg-amber-500 top-30 right-0">
            WORMS
            <span class="absolute -left-4 -top-4 -rotate-45 text-amber-500">
              <svg width="24" height="20" fill="none" viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.6268 0.755784C11.2467 -0.251929 12.7533 -0.251928 13.3732 0.755785L23.7722 17.6588C24.4072 18.691 23.6394 20 22.3989 20H1.60105C0.360604 20 -0.407208 18.691 0.227812 17.6588L10.6268 0.755784Z"></path></svg>
            </span>
          </MotionComponent>
          <MotionComponent
            client:load
            initial={{
              opacity: 0,
            }}
            transition={{
              ...transition,
              delay: 0.6,
            }}
            whileInView={{
              opacity: 1
            }}
            viewport={{ once: true }}
            class="absolute z-20 hidden md:block rounded-full px-4 py-2 text-white shadow-lg bg-indigo-500 top-10 left-10">
            Aqua Wolf
            <span class="absolute -right-4 -top-4 rotate-45 text-indigo-500">
              <svg width="24" height="20" fill="none" viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.6268 0.755784C11.2467 -0.251929 12.7533 -0.251928 13.3732 0.755785L23.7722 17.6588C24.4072 18.691 23.6394 20 22.3989 20H1.60105C0.360604 20 -0.407208 18.691 0.227812 17.6588L10.6268 0.755784Z"></path></svg>
            </span>
          </MotionComponent>
          <MotionComponent
            client:load
            initial={{
              opacity: 0,
            }}
            transition={{
              ...transition,
              delay: 0.6,
            }}
            whileInView={{
              opacity: 1
            }}
            viewport={{ once: true }} class="flex flex-col items-center [mask-image:linear-gradient(0deg,transparent,black_30px)] pt-5 sm:pt-10">
            <div style={{ "--index": 4 }} class="rounded-t-[13px] sm:p-[11px_17px_15px] p-[6px_10px_15px] z-[6] items-center flex relative bg-white dark:bg-black border-2 border-gray-200 dark:border-gray-800 w-[calc(100%-16px*var(--index))] sm:w-[calc(100%-48px*var(--index))] -mb-6">
              <div class="absolute items-center gap-0.5 sm:gap-2.5 flex group [&>div]:bg-gray-200 [&>div]:dark:bg-gray-800">
                {new Array(3).fill(0).map((_, key) => (
                  <div key={`toolbar-${key}`} class="size-2.5 sm:size-4 rounded-full" />
                ))}
              </div>
              <div style={{ "--width": "256px", "--height": "42px" }} class="sm:w-[--width] sm:h-[--height] w-[calc(var(--width)-172px)] h-[calc(var(--height)-12px)] bg-gray-100 dark:bg-gray-900 rounded-[8px] mx-auto flex flex-row gap-2 items-center justify-center text-gray-600 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2M9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2z" /></svg>
                <span class="font-mono sm:text-sm tracking-tighter text-xs truncate">app.nestri.io/myteam/aqua</span>
              </div>
            </div>
            <div style={{ "--index": 3 }} class="rounded-t-[13px] sm:p-[12px_18px_15px] p-[7px_11px_15px] z-[7] items-center flex relative bg-white dark:bg-black border-2 border-gray-200 dark:border-gray-800 w-[calc(100%-16px*var(--index))] sm:w-[calc(100%-48px*var(--index))] -mb-6">
              <div class="absolute items-center gap-0.5 sm:gap-2.5 flex group [&>div]:bg-gray-200 [&>div]:dark:bg-gray-800">
                {new Array(3).fill(0).map((_, key) => (
                  <div key={`toolbar-${key}`} class="size-2.5 sm:size-4 rounded-full" />
                ))}
              </div>
              <div style={{ "--width": "272px", "--height": "42px" }} class="sm:w-[--width] sm:h-[--height] w-[calc(var(--width)-172px)] h-[calc(var(--height)-12px)] bg-gray-100 dark:bg-gray-900 rounded-[8px] mx-auto flex flex-row gap-2 items-center justify-center text-gray-600 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2M9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2z" /></svg>
                <span class="font-mono sm:text-sm tracking-tighter text-xs truncate">app.nestri.io/myteam/jd</span>
              </div>
            </div>
            <div style={{ "--index": 2 }} class="rounded-t-[14px] sm:p-[13px_19px_15px] p-[7px_12px_15px] z-[8] items-center flex relative bg-white dark:bg-black border-2 border-gray-200 dark:border-gray-800 w-[calc(100%-16px*var(--index))] sm:w-[calc(100%-48px*var(--index))] -mb-6">
              <div class="absolute items-center gap-0.5 sm:gap-2.5 flex group [&>div]:bg-gray-200 [&>div]:dark:bg-gray-800">
                {new Array(3).fill(0).map((_, key) => (
                  <div key={`toolbar-${key}`} class="size-2.5 sm:size-4 rounded-full" />
                ))}
              </div>
              <div style={{ "--width": "288px", "--height": "42px" }} class="sm:w-[--width] sm:h-[--height] w-[calc(var(--width)-172px)] h-[calc(var(--height)-12px)] bg-gray-100 dark:bg-gray-900 rounded-[8px] mx-auto flex flex-row gap-2 items-center justify-center text-gray-600 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2M9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2z" /></svg>
                <span class="font-mono sm:text-sm tracking-tighter text-xs truncate">app.nestri.io/myteam/worms</span>
              </div>
            </div>
            <div style={{ "--index": 1 }} class="rounded-t-[15px] sm:p-[14px_18px_15px] p-[8px_13px_15px] z-[9] items-center flex relative bg-white dark:bg-black border-2 border-gray-200 dark:border-gray-800 w-[calc(100%-16px*var(--index))] sm:w-[calc(100%-48px*var(--index))] -mb-6">
              <div class="absolute items-center gap-0.5 sm:gap-2.5 flex group [&>div]:bg-gray-200 [&>div]:dark:bg-gray-800">
                {new Array(3).fill(0).map((_, key) => (
                  <div key={`toolbar-${key}`} class="size-2.5 sm:size-4 rounded-full" />
                ))}
              </div>
              <div style={{ "--width": "302px", "--height": "42px" }} class="sm:w-[--width] sm:h-[--height] w-[calc(var(--width)-172px)] h-[calc(var(--height)-12px)] bg-gray-100 dark:bg-gray-900 rounded-[8px] mx-auto flex flex-row gap-2 items-center justify-center text-gray-600 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2M9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2z" /></svg>
                <span class="font-mono sm:text-sm tracking-tighter text-xs truncate">app.nestri.io/myteam/ryan</span>
              </div>
            </div>
            <div style={{ "--index": 0 }} class="rounded-t-[16px] sm:p-[15px_20px_45px] p-[10px_15px_25px] z-10 items-center flex relative bg-white dark:bg-black border-2 border-gray-200 dark:border-gray-800 w-[calc(100%-16px*var(--index))] sm:w-[calc(100%-48px*var(--index))] -mb-[15px]">
              <div class="absolute items-center gap-0.5 sm:gap-2.5 flex group [&>:first-child]:bg-[hsla(358,75%,59%,1)] [&>:nth-child(2)]:bg-[hsla(208,100%,66%,1)] [&>:last-child]:bg-[hsla(170,70%,57%,1)]">
                {new Array(3).fill(0).map((_, key) => (
                  <div key={`toolbar-${key}`} class="size-2.5 sm:size-4 rounded-full" />
                ))}
              </div>
              <div style={{ "--width": "320px", "--height": "42px" }} class="sm:w-[--width] sm:h-[--height] w-[calc(var(--width)-172px)] h-[calc(var(--height)-12px)] bg-gray-100 dark:bg-gray-900 rounded-[8px] mx-auto flex flex-row gap-2 items-center justify-center text-gray-600 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2M9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2z" /></svg>
                <span class="font-mono sm:text-sm tracking-tighter text-xs truncate">app.nestri.io/myteam/claire</span>
              </div>
            </div>
          </MotionComponent>
        </div>
      </section>
      <section class="w-full pt-12 pb-3 sm:py-16">
        <div class="relative mx-auto w-full max-w-[980px]">
          <div class="relative px-4 z-10 gap-1 sm:gap-2 mx-auto flex flex-col items-center text-balance text-center max-w-[680px]">
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
                y: 100
              }}
              transition={{
                ...transition,
                delay: 0.5,
              }}
              whileInView={{
                y: 0,
                opacity: 1
              }}
              viewport={{ once: true }}
              as="h3" class="sm:text-5xl font-mona font-extrabold text-2xl mb-2 sm:tracking-tighter">Run Nestri on Your Own GPU</MotionComponent>
            <MotionComponent
              client:load
              initial={{
                opacity: 0,
                y: 100
              }}
              transition={{
                ...transition,
                delay: 0.6,
              }}
              whileInView={{
                y: 0,
                opacity: 1
              }}
              viewport={{ once: true }}
              as="p"
              class="p1 sm:text-xl dark:text-gray-50/70 text-gray-950/70">Install Nestri-server on your GPU instance, connect to our network in minutes, and only pay for bandwidth and API calls</MotionComponent>
          </div>
          <MotionComponent
            client:load
            initial={{
              opacity: 0,
            }}
            transition={{
              ...transition,
              delay: 0.6,
            }}
            whileInView={{
              opacity: 1
            }}
            viewport={{ once: true }} class="w-full flex select-none justify-between max-[600px]:flex-col items-center max-w-[700px] mx-auto my-5 sm:my-20" >
            <div class="relative h-[264px] flex flex-[1_1] max-[600px]:pb-[64px] max-[600px]:max-w-[264px] max-[600px]:w-full">
              <div class="justify-between items-start inline-flex md:flex-col min-[600px]:h-full max-[600px]:flex-[1_1]">
                <div class="ring-gray-200 md:justify-start max-[600px]:size-9 text-gray-600 dark:text-gray-400 dark:ring-gray-800 ring-2 bg-white dark:bg-black rounded-xl flex items-center justify-center md:p-[8px_14px_8px_12px] xl:p-[8px_14px_8px_12px] gap-2" >
                  <svg class="size-6 text-[#85B737]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M1.635 7.146S3.08 5.012 5.97 4.791v-.774C2.77 4.273 0 6.983 0 6.983s1.57 4.536 5.97 4.952v-.824c-3.23-.406-4.335-3.965-4.335-3.965M5.97 9.475v.753c-2.44-.435-3.118-2.972-3.118-2.972S4.023 5.958 5.97 5.747v.828h-.004c-1.021-.123-1.82.83-1.82.83s.448 1.607 1.824 2.07M6 2l-.03 2.017A7 7 0 0 1 6.252 4c3.637-.123 6.007 2.983 6.007 2.983s-2.722 3.31-5.557 3.31q-.39-.002-.732-.065v.883q.292.039.61.04c2.638 0 4.546-1.348 6.394-2.943c.307.246 1.561.842 1.819 1.104c-1.757 1.47-5.852 2.657-8.173 2.657a7 7 0 0 1-.65-.034V14H16l.03-12zm-.03 3.747v-.956a6 6 0 0 1 .282-.015c2.616-.082 4.332 2.248 4.332 2.248S8.73 9.598 6.743 9.598c-.286 0-.542-.046-.773-.123v-2.9c1.018.123 1.223.572 1.835 1.593L9.167 7.02s-.994-1.304-2.67-1.304a5 5 0 0 0-.527.031" /></svg>
                  <span class="max-[600px]:hidden" >RTX 4090</span>
                </div>
                <div class="ring-gray-200 md:justify-start max-[600px]:size-9 text-gray-600 dark:text-gray-400 dark:ring-gray-800 ring-2 bg-white dark:bg-black rounded-xl flex items-center justify-center md:p-[8px_14px_8px_12px] xl:p-[8px_14px_8px_12px] gap-2" >
                  <svg class="size-5 text-[#0068b5]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="currentColor" d="M9.427 14.401v5.167H7.781v-6.495h3.396c1.443 0 1.932 1.021 1.932 1.943v4.552h-1.641v-4.542c0-.391-.198-.625-.682-.625zm11.188-.078c-.568 0-1 .286-1.182.682a1.6 1.6 0 0 0-.156.703h2.531c-.031-.703-.354-1.385-1.193-1.385m-1.339 2.505c0 .839.521 1.464 1.458 1.464c.724 0 1.083-.203 1.505-.625l1.016.974c-.646.641-1.333 1.031-2.536 1.031c-1.573 0-3.078-.859-3.078-3.359c0-2.141 1.313-3.349 3.042-3.349c1.755 0 2.766 1.417 2.766 3.271v.589h-4.172zm-3.026 2.729c-1.339 0-1.906-.932-1.906-1.854v-6.401h1.641v1.771h1.234v1.328h-1.234v3.198c0 .38.177.589.568.589h.667v1.37zm-9.932-7.38H4.662v-1.578h1.656zm.005 7.458c-1.24-.12-1.661-.87-1.661-1.74v-4.823h1.656v6.568zm19.74-.14c-1.24-.12-1.656-.87-1.656-1.734v-7.38h1.656v9.12zm5.796-8.047c-1.5-7.328-15.724-7.792-24.885-2.214v.62c9.151-4.708 22.141-4.677 23.323 2.063c.391 2.234-.865 4.557-3.109 5.896v1.75c2.703-.99 5.474-4.198 4.672-8.115zM15.198 24.26c-6.323.583-12.917-.339-13.839-5.276c-.448-2.438.667-5.021 2.13-6.625v-.854C.843 13.828-.594 16.771.234 20.245c1.057 4.458 6.714 6.984 15.344 6.146c3.417-.333 7.891-1.432 10.995-3.141v-2.422c-2.818 1.682-7.49 3.073-11.375 3.432m12.781-13.395c0-.078-.052-.104-.156-.104h-.104v.229h.104c.104 0 .156-.031.156-.109zm.162.567h-.125a.03.03 0 0 1-.026-.016l-.167-.286a.04.04 0 0 0-.026-.01h-.073v.281c0 .016-.016.031-.031.031h-.109c-.016 0-.031-.016-.031-.031v-.714c0-.036.021-.057.052-.063q.102-.006.203-.005c.203 0 .328.057.328.25v.01c0 .12-.063.182-.151.214l.172.292c0 .005.005.016.005.021c.005.01-.005.026-.021.026m-.292-.948a.547.547 0 0 0-.547.547c.005.302.25.547.552.547a.545.545 0 0 0 .542-.542a.55.55 0 0 0-.547-.552m0 1.209a.657.657 0 1 1 0-1.317c.359 0 .661.297.661.661s-.302.656-.661.656" /></svg>
                  <span class="max-[600px]:hidden" >Arc A770</span>
                </div>
                <div class="ring-gray-200 md:justify-start max-[600px]:size-9 text-gray-600 dark:text-gray-400 dark:ring-gray-800 ring-2 bg-white dark:bg-black rounded-xl flex items-center justify-center md:p-[8px_14px_8px_12px] xl:p-[8px_14px_8px_12px] gap-2" >
                  <svg class="size-6 text-[#85B737]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M1.635 7.146S3.08 5.012 5.97 4.791v-.774C2.77 4.273 0 6.983 0 6.983s1.57 4.536 5.97 4.952v-.824c-3.23-.406-4.335-3.965-4.335-3.965M5.97 9.475v.753c-2.44-.435-3.118-2.972-3.118-2.972S4.023 5.958 5.97 5.747v.828h-.004c-1.021-.123-1.82.83-1.82.83s.448 1.607 1.824 2.07M6 2l-.03 2.017A7 7 0 0 1 6.252 4c3.637-.123 6.007 2.983 6.007 2.983s-2.722 3.31-5.557 3.31q-.39-.002-.732-.065v.883q.292.039.61.04c2.638 0 4.546-1.348 6.394-2.943c.307.246 1.561.842 1.819 1.104c-1.757 1.47-5.852 2.657-8.173 2.657a7 7 0 0 1-.65-.034V14H16l.03-12zm-.03 3.747v-.956a6 6 0 0 1 .282-.015c2.616-.082 4.332 2.248 4.332 2.248S8.73 9.598 6.743 9.598c-.286 0-.542-.046-.773-.123v-2.9c1.018.123 1.223.572 1.835 1.593L9.167 7.02s-.994-1.304-2.67-1.304a5 5 0 0 0-.527.031" /></svg>
                  <span class="max-[600px]:hidden" >RTX 5000 Ada</span>
                </div>
                <div class="ring-gray-200 md:justify-start max-[600px]:size-9 text-gray-600 dark:text-gray-400 dark:ring-gray-800 ring-2 bg-white dark:bg-black rounded-xl flex items-center justify-center md:p-[8px_14px_8px_12px] xl:p-[8px_14px_8px_12px] gap-2" >
                  <svg class="size-4 text-black dark:text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="m.334 0l4.358 4.359h7.15v7.15l4.358 4.358V0zM.2 9.72l4.487-4.488v6.281h6.28L6.48 16H.2z" /></svg>
                  <span class="max-[600px]:hidden" >Radeon RX 7900</span>
                </div>
              </div>
              <div class="absolute max-[600px]:right-1/2 max-[600px]:translate-x-1/2 max-[600px]:w-[calc(100%-36px)] max-[600px]:bottom-0 min-[600px]:-right-[30px] w-[calc(100%-96px+40px)] min-[600px]:top-1/2 -z-[1] min-[600px]:-translate-y-1/2 max-[600px]:top-[unset] ">
                <div class="min-[600px]:hidden h-16 relative">
                  <svg class="absolute inset-0 text-gray-500" fill="none" height="64" preserveAspectRatio="none" viewBox="0 0 230 64" width="100%" xmlns="http://www.w3.org/2000/svg">
                    <path d="M111 64L111 56.9516C111 43.5878 104.93 30.9476 94.5 22.5925L85.3167 15.236C80.6917 11.5311 78 5.92592 78 -1.44248e-06V-1.44248e-06" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M103 64V64C103 53.2897 95.7597 43.9337 85.392 41.2467L19.7552 24.2356C8.712 21.3735 1 11.408 1 -4.45856e-06V-4.45856e-06" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M127 64V64C127 53.2897 134.24 43.9337 144.608 41.2467L210.245 24.2356C221.288 21.3735 229 11.408 229 -4.45856e-06V-4.45856e-06" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M119 64L119 57.7409C119 43.9291 125.479 30.9169 136.5 22.5925L146.519 15.025C151.231 11.4665 154 5.9042 154 1.5299e-06V1.5299e-06" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                  </svg>
                  <svg class="[-webkit-mask:linear-gradient(270deg,black_0,black)] absolute inset-0" fill="none" height="64" preserveAspectRatio="none" viewBox="0 0 230 64" width="100%" xmlns="http://www.w3.org/2000/svg">
                    <path d="M111 64L111 56.9516C111 43.5878 104.93 30.9476 94.5 22.5925L85.3167 15.236C80.6917 11.5311 78 5.92592 78 -1.44248e-06V-1.44248e-06" stroke="#E5484D" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M103 64V64C103 53.2897 95.7597 43.9337 85.392 41.2467L19.7552 24.2356C8.712 21.3735 1 11.408 1 -4.45856e-06V-4.45856e-06" stroke="#52AEFF" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M127 64V64C127 53.2897 134.24 43.9337 144.608 41.2467L210.245 24.2356C221.288 21.3735 229 11.408 229 -4.45856e-06V-4.45856e-06" stroke="#45DEC4" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M119 64L119 57.7409C119 43.9291 125.479 30.9169 136.5 22.5925L146.519 15.025C151.231 11.4665 154 5.9042 154 1.5299e-06V1.5299e-06" stroke="#FFB224" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                  </svg>
                </div>
                <div class="h-[231px] relative min-[600px]:block hidden">
                  <svg class="absolute inset-0 text-gray-500" fill="none" height="231" preserveAspectRatio="none" viewBox="0 0 175 231" width="100%" xmlns="http://www.w3.org/2000/svg">
                    <path d="M175 103V103C137.929 103 102.537 87.5452 77.3391 60.3545L34.7984 14.4487C26.8521 5.87384 15.6907 1 4 1V1" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M175 111H142.698C118.994 111 95.4785 106.786 73.2496 98.5553L23.9035 80.2834C16.2524 77.4504 8.1587 76 0 76V76" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M175 119H148.986C127.989 119 107.414 124.89 89.597 136L78.7424 142.769C68.0198 149.455 55.6366 153 43 153V153" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M175 127H174.002C139.072 127 107.233 147.02 92.097 178.5L76.5806 210.772C70.9294 222.525 59.0417 230 46 230V230" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
                  </svg>
                  <svg class="[-webkit-mask:linear-gradient(270deg,black_0,black)] absolute inset-0" fill="none" height="231" preserveAspectRatio="none" viewBox="0 0 175 231" width="100%" xmlns="http://www.w3.org/2000/svg">
                    <path d="M175 103V103C137.929 103 102.537 87.5452 77.3391 60.3545L34.7984 14.4487C26.8521 5.87384 15.6907 1 4 1V1" stroke="#52AEFF " stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M175 111H142.698C118.994 111 95.4785 106.786 73.2496 98.5553L23.9035 80.2834C16.2524 77.4504 8.1587 76 0 76V76" stroke="#E5484D " stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M175 119H148.986C127.989 119 107.414 124.89 89.597 136L78.7424 142.769C68.0198 149.455 55.6366 153 43 153V153" stroke="#FFB224 " stroke-width="2" vector-effect="non-scaling-stroke"></path>
                    <path d="M175 127H174.002C139.072 127 107.233 147.02 92.097 178.5L76.5806 210.772C70.9294 222.525 59.0417 230 46 230V230" stroke="#45DEC4 " stroke-width="2" vector-effect="non-scaling-stroke"></path>
                  </svg>
                </div>
              </div>
            </div>
            <div class="size-[100px] max-[600px]:-top-2 relative max-[600px]:size-[64px] max-[600px]:[&>svg]:size-8 z-[3] min-[600px]:-left-[2px] grid [place-items:center] ring-2 ring-gray-300 dark:ring-gray-700 bg-white dark:bg-black rounded-2xl">
              <svg
                height={64}
                width={64}
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
            </div>
            <div class="flex-1 flex justify-end max-[600px]:flex-col relative max-[600px]:pt-6">
              <div class="w-[212px] absolute left-0 top-1/2 -translate-y-1/2 -z-[1] max-[600px]:left-1/2 max-[600px]:top-0 max-[600px]:-translate-x-1/2">
                <svg class="max-[600px]:left-1/2 max-[600px]:top-0 max-[600px]:w-10 max-[600px]:-translate-x-1/2 max-[600px]:rotate-90 text-gray-400 dark:text-gray-600 absolute inset-0 left-0 w-full top-1/2 -translate-y-1/2 -z-[1]" fill="none" height="26" preserveAspectRatio="none" viewBox="0 0 112 26" width="100%" xmlns="http://www.w3.org/2000/svg">
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="17" y2="17"></line>
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="9" y2="9"></line>
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="1" y2="1"></line>
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="25" y2="25"></line>
                </svg>
                <svg class="max-[600px]:left-1/2 max-[600px]:top-0 max-[600px]:w-10 max-[600px]:-translate-x-1/2 max-[600px]:rotate-90 text-gray-400 dark:text-gray-600 absolute inset-0 left-0 w-full top-1/2 -translate-y-1/2 -z-[1] [-webkit-mask:linear-gradient(270deg,black_0,black)]" fill="none" height="26" preserveAspectRatio="none" viewBox="0 0 112 26" width="100%" xmlns="http://www.w3.org/2000/svg">
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="17" y2="17"></line>
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="9" y2="9"></line>
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="1" y2="1"></line>
                  <line stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" x2="112" y1="25" y2="25"></line>
                </svg>
              </div>
              <div class="h-[172px] w-[200px] max-[600px]:-top-1 bg-white dark:bg-black rounded-xl ring-gray-200 ring-2 dark:ring-gray-800 gap-3 flex flex-col p-4" >
                <div class="relative">
                  <div class="items-center gap-1 flex group [&>:first-child]:bg-[hsla(358,75%,59%,1)] [&>:nth-child(2)]:bg-[hsla(208,100%,66%,1)] [&>:last-child]:bg-[hsla(170,70%,57%,1)]">
                    {new Array(3).fill(0).map((_, key) => (
                      <div key={`toolbar-${key}`} class="size-2.5 rounded-full" />
                    ))}
                  </div>
                </div>
                <div class="size-full relative bg-gray-100 dark:bg-gray-900 rounded-md ring-1 ring-gray-200 dark:ring-gray-800"></div>
              </div>
            </div>
          </MotionComponent>
        </div>
      </section>
      <Footer client:load>
        <div class="w-full flex justify-center flex-col items-center gap-3">
          <Link href="https://discord.gg/6um5K6jrYj" prefetch={false} class="ring-2 ring-primary-500 flex font-bricolage text-sm sm:text-base rounded-full bg-primary-500 px-5 py-4 font-semibold text-white transition-all hover:scale-105 active:scale-95 sm:px-6" >
            Join our Discord
          </Link>
          <div class="mt-6 flex w-full items-center justify-center gap-2 text-xs sm:text-sm font-medium text-neutral-600 dark:text-neutral-400">
            <span class="hover:text-primary-500 transition-colors duration-200">
              <Link rel="noreferrer" href="/terms" >Terms of Service</Link></span>
            <span class="text-gray-400 dark:text-gray-600">•</span>
            <span class="hover:text-primary-500 transition-colors duration-200">
              <Link href="/privacy">Privacy Policy</Link>
            </span>
          </div>
        </div>
      </Footer>
    </div >
  );
});

