import { component$ } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { HeroSection, Cursor, MotionComponent, transition } from "@nestri/ui/react"
import { NavBar, Footer, Modal, Card } from "@nestri/ui"

const features = [
  {
    title: "Play games from shared Steam libraries",
    description: "Grant access to your Steam library, allowing everyone on your team to enjoy a wide range of games without additional purchases.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none"><circle cx="10" cy="6" r="4" stroke="currentColor" stroke-width="1.5" /><path stroke="currentColor" stroke-width="1.5" d="M18 17.5c0 2.485 0 4.5-8 4.5s-8-2.015-8-4.5S5.582 13 10 13s8 2.015 8 4.5Z" opacity=".5" /><path fill="currentColor" d="m18.089 12.539l.455-.597zM19 8.644l-.532.528a.75.75 0 0 0 1.064 0zm.912 3.895l-.456-.597zm-1.368-.597c-.487-.371-.925-.668-1.278-1.053c-.327-.357-.516-.725-.516-1.19h-1.5c0 .95.414 1.663.91 2.204c.471.513 1.077.93 1.474 1.232zM16.75 9.7c0-.412.24-.745.547-.881c.267-.118.69-.13 1.171.353l1.064-1.057c-.87-.875-1.945-1.065-2.842-.668A2.46 2.46 0 0 0 15.25 9.7zm.884 3.435c.148.113.342.26.545.376s.487.239.821.239v-1.5c.034 0 .017.011-.082-.044c-.1-.056-.212-.14-.374-.264zm2.732 0c.397-.303 1.003-.719 1.473-1.232c.497-.541.911-1.255.911-2.203h-1.5c0 .464-.189.832-.516 1.19c-.353.384-.791.681-1.278 1.052zM22.75 9.7c0-1-.585-1.875-1.44-2.253c-.896-.397-1.973-.207-2.842.668l1.064 1.057c.48-.483.904-.471 1.17-.353a.96.96 0 0 1 .548.88zm-3.294 2.242a4 4 0 0 1-.374.264c-.099.056-.116.044-.082.044v1.5c.334 0 .617-.123.82-.239c.204-.115.398-.263.546-.376z" /></g></svg>
    )
  }, {
    title: "Create a safe gaming environment for all ages",
    description: "Keep gaming safe and enjoyable for everyone. Set playtime limits and content restrictions to maintain a family-friendly environment, giving you peace of mind.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 10.417c0-3.198 0-4.797.378-5.335c.377-.537 1.88-1.052 4.887-2.081l.573-.196C10.405 2.268 11.188 2 12 2c.811 0 1.595.268 3.162.805l.573.196c3.007 1.029 4.51 1.544 4.887 2.081C21 5.62 21 7.22 21 10.417v1.574c0 5.638-4.239 8.375-6.899 9.536C13.38 21.842 13.02 22 12 22s-1.38-.158-2.101-.473C7.239 20.365 3 17.63 3 11.991z" opacity=".5" /><path stroke-linecap="round" d="M12 13.5v3m1.5-3.402a3 3 0 1 1-3-5.195a3 3 0 0 1 3 5.195Z" /></g></svg>
    )
  }, {
    title: "Experience stunning HD gameplay with zero lag",
    description: "Experience games in high definition with Real-Time Ray Tracing, while our QUIC-enhanced infrastructure ensures smooth, responsive sessions with minimal latency.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><mask id="lineMdSpeedLoop0"><path fill="none" stroke="#fff" stroke-dasharray="56" stroke-dashoffset="56" stroke-linecap="round" stroke-width="2" d="M5 19V19C4.69726 19 4.41165 18.8506 4.25702 18.5904C3.45852 17.2464 3 15.6767 3 14C3 9.02944 7.02944 5 12 5C16.9706 5 21 9.02944 21 14C21 15.6767 20.5415 17.2464 19.743 18.5904C19.5884 18.8506 19.3027 19 19 19z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="56;0" /></path><g fill-opacity="0" transform="rotate(-100 12 14)"><path d="M12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14Z"><animate fill="freeze" attributeName="d" begin="0.4s" dur="0.2s" values="M12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14Z;M16 14C16 16.21 14.21 18 12 18C9.79 18 8 16.21 8 14C8 11.79 12 0 12 0C12 0 16 11.79 16 14Z" /></path><path fill="#fff" d="M12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14Z"><animate fill="freeze" attributeName="d" begin="0.4s" dur="0.2s" values="M12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14C12 14 12 14 12 14Z;M14 14C14 15.1 13.1 16 12 16C10.9 16 10 15.1 10 14C10 12.9 12 4 12 4C12 4 14 12.9 14 14Z" /></path><set attributeName="fill-opacity" begin="0.4s" to="1" /><animateTransform attributeName="transform" begin="0.6s" dur="6s" repeatCount="indefinite" type="rotate" values="-100 12 14;45 12 14;45 12 14;45 12 14;20 12 14;10 12 14;0 12 14;35 12 14;45 12 14;55 12 14;50 12 14;15 12 14;-20 12 14;-100 12 14" /></g></mask><rect width="24" height="24" fill="currentColor" mask="url(#lineMdSpeedLoop0)" /></svg>
    )
  },
  {
    title: "Share and connect with gamers worldwide",
    description: "Post clips, screenshots, and live streams directly from your game, and join Nestri Parties to team up with friends or challenge players globally in multiplayer battles and co-op adventures.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.861 3.363C11.368 2.454 11.621 2 12 2s.632.454 1.139 1.363l.13.235c.145.259.217.388.329.473c.112.085.252.117.532.18l.254.058c.984.222 1.476.334 1.593.71c.117.376-.218.769-.889 1.553l-.174.203c-.19.223-.285.334-.328.472c-.043.138-.029.287 0 .584l.026.27c.102 1.047.152 1.57-.154 1.803c-.306.233-.767.02-1.688-.404l-.239-.11c-.261-.12-.392-.18-.531-.18s-.27.06-.531.18l-.239.11c-.92.425-1.382.637-1.688.404c-.306-.233-.256-.756-.154-1.802l.026-.271c.029-.297.043-.446 0-.584c-.043-.138-.138-.25-.328-.472l-.174-.203c-.67-.784-1.006-1.177-.889-1.553c.117-.376.609-.488 1.593-.71l.254-.058c.28-.063.42-.095.532-.18c.112-.085.184-.214.328-.473zm8.569 4.319c.254-.455.38-.682.57-.682c.19 0 .316.227.57.682l.065.117c.072.13.108.194.164.237c.056.042.126.058.266.09l.127.028c.492.112.738.167.796.356c.059.188-.109.384-.444.776l-.087.101c-.095.112-.143.168-.164.237c-.022.068-.014.143 0 .292l.013.135c.05.523.076.785-.077.901c-.153.116-.383.01-.844-.202l-.12-.055c-.13-.06-.196-.09-.265-.09c-.07 0-.135.03-.266.09l-.119.055c-.46.212-.69.318-.844.202c-.153-.116-.128-.378-.077-.901l.013-.135c.014-.15.022-.224 0-.292c-.021-.07-.069-.125-.164-.237l-.087-.101c-.335-.392-.503-.588-.444-.776c.058-.189.304-.244.796-.356l.127-.028c.14-.032.21-.048.266-.09c.056-.043.092-.108.164-.237zm-16 0C3.685 7.227 3.81 7 4 7c.19 0 .316.227.57.682l.065.117c.072.13.108.194.164.237c.056.042.126.058.266.09l.127.028c.492.112.738.167.797.356c.058.188-.11.384-.445.776l-.087.101c-.095.112-.143.168-.164.237c-.022.068-.014.143 0 .292l.013.135c.05.523.076.785-.077.901c-.153.116-.384.01-.844-.202l-.12-.055c-.13-.06-.196-.09-.265-.09c-.07 0-.135.03-.266.09l-.119.055c-.46.212-.69.318-.844.202c-.153-.116-.128-.378-.077-.901l.013-.135c.014-.15.022-.224 0-.292c-.021-.07-.069-.125-.164-.237l-.087-.101c-.335-.392-.503-.588-.445-.776c.059-.189.305-.244.797-.356l.127-.028c.14-.032.21-.048.266-.09c.056-.043.092-.108.164-.237z" /><path stroke-linecap="round" d="M4 21.388h2.26c1.01 0 2.033.106 3.016.308a14.85 14.85 0 0 0 5.33.118c.868-.14 1.72-.355 2.492-.727c.696-.337 1.549-.81 2.122-1.341c.572-.53 1.168-1.397 1.59-2.075c.364-.582.188-1.295-.386-1.728a1.887 1.887 0 0 0-2.22 0l-1.807 1.365c-.7.53-1.465 1.017-2.376 1.162c-.11.017-.225.033-.345.047m0 0a8.176 8.176 0 0 1-.11.012m.11-.012a.998.998 0 0 0 .427-.24a1.492 1.492 0 0 0 .126-2.134a1.9 1.9 0 0 0-.45-.367c-2.797-1.669-7.15-.398-9.779 1.467m9.676 1.274a.524.524 0 0 1-.11.012m0 0a9.274 9.274 0 0 1-1.814.004" opacity=".5" /></g></svg>
    )
  },
  {
    title: "Customize your entire gaming experience",
    description: "Personalize controls for your preferred device, enhance your experience with mods, and adapt game settings to match your unique style or add exciting new challenges.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="m12.636 15.262l-1.203 1.202c-1.23 1.232-1.846 1.847-2.508 1.702c-.662-.146-.963-.963-1.565-2.596l-2.007-5.45C4.152 6.861 3.55 5.232 4.39 4.392c.84-.84 2.47-.24 5.73.962l5.45 2.006c1.633.602 2.45.903 2.596 1.565c.145.662-.47 1.277-1.702 2.508l-1.202 1.203" /><path d="m12.636 15.262l3.938 3.938c.408.408.612.612.84.706c.303.126.643.126.947 0c.227-.094.431-.298.839-.706s.611-.612.706-.84a1.238 1.238 0 0 0 0-.946c-.095-.228-.298-.432-.706-.84l-3.938-3.938" opacity=".5" /></g></svg>
    )
  }, {
    title: "Access and share your progress from anywhere",
    description: "With Nestri's Cloud-based saving, you can access and share your progress with just a link, keeping you connected to your games and friends instantly wherever you are.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" d="M16.5 7.5h-3" opacity=".5" /><path d="M5 5.217c0-.573 0-.86.049-1.099c.213-1.052 1.1-1.874 2.232-2.073C7.538 2 7.847 2 8.465 2c.27 0 .406 0 .536.011c.56.049 1.093.254 1.526.587c.1.078.196.167.388.344l.385.358c.571.53.857.795 1.198.972c.188.097.388.174.594.228c.377.1.78.1 1.588.1h.261c1.843 0 2.765 0 3.363.5c.055.046.108.095.157.146C19 5.802 19 6.658 19 8.369V9.8c0 2.451 0 3.677-.82 4.438c-.82.762-2.14.762-4.78.762h-2.8c-2.64 0-3.96 0-4.78-.761C5 13.477 5 12.25 5 9.8z" /><path stroke-linecap="round" d="M22 20h-8M2 20h8m2-2v-3" opacity=".5" /><circle cx="12" cy="20" r="2" /></g></svg>
    )
  },
  {
    title: "Play on your own terms",
    description: "Nestri is fully open-source, inviting you to tweak, enhance, and contribute to the platform. Self-host and cross-play with your own gaming server for ultimate privacy at no extra cost.",
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><circle cx="12" cy="6" r="2" fill="currentColor" /><path fill="currentColor" d="M21 14.94c0-.5-.36-.93-.85-.98c-1.88-.21-3.49-1.13-4.75-2.63l-1.34-1.6c-.38-.47-.94-.73-1.53-.73h-1.05c-.59 0-1.15.26-1.53.72l-1.34 1.6c-1.25 1.5-2.87 2.42-4.75 2.63c-.5.06-.86.49-.86.99c0 .6.53 1.07 1.13 1c2.3-.27 4.32-1.39 5.87-3.19V15l-3.76 1.5c-.65.26-1.16.83-1.23 1.53A1.79 1.79 0 0 0 6.79 20H9v-.5a2.5 2.5 0 0 1 2.5-2.5h3c.28 0 .5.22.5.5s-.22.5-.5.5h-3c-.83 0-1.5.67-1.5 1.5v.5h7.1c.85 0 1.65-.54 1.85-1.37c.21-.89-.27-1.76-1.08-2.08L14 15v-2.25c1.56 1.8 3.57 2.91 5.87 3.19c.6.06 1.13-.4 1.13-1" /></svg>
    )
  }
]

const games = [
  {
    title: "Apex Legends",
    rotate: -5,
    titleWidth: 31.65,
    titleHeight: 82.87,
    id: 1172470,
  },
  {
    title: "Control Ultimate Edition",
    rotate: 3,
    titleWidth: 55.61,
    titleHeight: 100,
    id: 870780,
  },
  {
    title: "Black Myth: Wukong",
    rotate: -3,
    titleWidth: 56.30,
    titleHeight: 69.79,
    id: 2358720,
  },
  {
    title: "Shell Runner - Prelude",
    rotate: 2,
    id: 2581970,
    titleWidth: 72.64,
    titleHeight: 91.26,
  },
  {
    title: "Counter-Strike 2",
    rotate: -5,
    id: 730,
    titleWidth: 50.51,
    titleHeight: 99.65,
  },
  {
    title: "Add from Steam",
    rotate: 7,
  }
]

export default component$(() => {
  return (
    <>
      <NavBar />
      <HeroSection client:load>
        <div class="w-full flex flex-col">
          <button onClick$={() => null} class="group w-full max-w-xl focus:ring-primary-500 duration-200 outline-none rounded-xl flex items-center justify-start hover:bg-gray-200 focus:bg-gray-200 dark:hover:bg-gray-800 dark:focus:bg-gray-800 transition-all gap-2 px-4 py-3 h-[45px] ring-2 ring-gray-300 dark:ring-gray-700 mx-auto text-gray-900/70 dark:text-gray-100/70 bg-white dark:bg-black">
            <svg xmlns="http://www.w3.org/2000/svg" class="size-[20px] flex-shrink-0" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M3.464 3.464C2 4.93 2 7.286 2 12s0 7.071 1.464 8.535C4.93 22 7.286 22 12 22s7.071 0 8.535-1.465C22 19.072 22 16.714 22 12s0-7.071-1.465-8.536C19.072 2 16.714 2 12 2S4.929 2 3.464 3.464m2.96 6.056a.75.75 0 0 1 1.056-.096l.277.23c.605.504 1.12.933 1.476 1.328c.379.42.674.901.674 1.518s-.295 1.099-.674 1.518c-.356.395-.871.824-1.476 1.328l-.277.23a.75.75 0 1 1-.96-1.152l.234-.195c.659-.55 1.09-.91 1.366-1.216c.262-.29.287-.427.287-.513s-.025-.222-.287-.513c-.277-.306-.707-.667-1.366-1.216l-.234-.195a.75.75 0 0 1-.096-1.056M17.75 15a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1 0-1.5h5a.75.75 0 0 1 .75.75" clip-rule="evenodd" /></svg>
            <p class="font-bold tracking-tighter h-max overflow-hidden overflow-ellipsis whitespace-nowrap font-mono">
              curl -fsSL https://nestri.io/install | bash
            </p>
            <div class="ml-auto flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="group-focus:hidden size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15.24 2h-3.894c-1.764 0-3.162 0-4.255.148c-1.126.152-2.037.472-2.755 1.193c-.719.721-1.038 1.636-1.189 2.766C3 7.205 3 8.608 3 10.379v5.838c0 1.508.92 2.8 2.227 3.342c-.067-.91-.067-2.185-.067-3.247v-5.01c0-1.281 0-2.386.118-3.27c.127-.948.413-1.856 1.147-2.593s1.639-1.024 2.583-1.152c.88-.118 1.98-.118 3.257-.118h3.07c1.276 0 2.374 0 3.255.118A3.6 3.6 0 0 0 15.24 2" /><path fill="currentColor" d="M6.6 11.397c0-2.726 0-4.089.844-4.936c.843-.847 2.2-.847 4.916-.847h2.88c2.715 0 4.073 0 4.917.847S21 8.671 21 11.397v4.82c0 2.726 0 4.089-.843 4.936c-.844.847-2.202.847-4.917.847h-2.88c-2.715 0-4.073 0-4.916-.847c-.844-.847-.844-2.21-.844-4.936z" /></svg>
              <svg xmlns="http://www.w3.org/2000/svg" class="group-focus:block hidden text-green-500 size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z" /></svg>
            </div>
          </button>
          <p class="w-full max-w-xl py-3 font-title px-2 text-gray-600 justify-start text-sm items-center flex">
            <span class="font-semibold">System requirements:</span>&nbsp;Docker 27.3.1 or newer
          </p>
        </div>
      </HeroSection>
      <div class="items-center justify-center w-full flex">
        <section class="relative py-10 flex-col w-full overflow-hidden">
          

        </section>
      </div>
      {/* <MotionComponent
        initial={{ opacity: 0, y: 100 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={transition}
        client:load
        class="items-center justify-center w-full flex"
        as="div"
      >
        <section class="relative py-10 flex-col w-full overflow-hidden">
          <div class="grid grid-cols-3 -mx-5 max-w-7xl md:grid-cols-6 lg:mx-auto">
            {games.map((game, index) => (
              game.titleWidth ? (
                <Card
                  class={"bg-white aspect-[2/3] relative hover:ring-primary-500 focus:ring-primary-500 dark:bg-black rounded-md overflow-hidden block hover:!rotate-0 focus:!rotate-0 hover:scale-[1.17] focus:!scale-[1.17] hover:!z-10 focus:!z-10 outline-none shadow-lg shadow-gray-300 dark:shadow-gray-700 ring-2 ring-gray-300 dark:ring-gray-700 transition-all duration-200"}
                  key={game.title}
                  style={{
                    zIndex: 1 + index,
                    transform: game.rotate ? `rotate(${game.rotate}deg)` : undefined,
                  }}
                  size="xs"
                  titleWidth={game.titleWidth}
                  titleHeight={game.titleHeight}
                  game={{
                    name: game.title,
                    id: game.id,
                  }}
                />
              ) : (
                <button
                  key={game.title}
                  style={{
                    zIndex: 1 + index,
                    transform: game.rotate ? `rotate(${game.rotate}deg)` : undefined,
                  }}
                  class="aspect-[2/3] outline-none focus:ring-primary-500 hover:ring-primary-500 bg-white dark:bg-black rounded-md overflow-hidden block hover:!rotate-0 hover:scale-[1.17] hover:!z-10 shadow-lg shadow-gray-300 dark:shadow-gray-700 ring-2 ring-gray-300 dark:ring-gray-700 transition-all duration-200"
                  onClick$={() => {
                    console.log('clicked')
                  }}
                >
                  <div class="w-full text-gray-900 dark:text-gray-100 h-full flex flex-col px-3 text-center gap-3 items-center justify-center">
                    <p>Can't find your game here?</p>
                    <span class="text-gray-800 dark:text-gray-200 underline text-sm">
                      Import from Steam
                    </span>
                  </div>
                </button>
              )
            ))}
          </div>
        </section>
      </MotionComponent> */}
      {/* <section class="relative py-10 flex-col w-full justify-center items-center">
        <MotionComponent
          initial={{ opacity: 0, y: 100 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ ...transition, delay: 0.2 }}
          client:load
          class="items-center justify-center w-full flex"
          as="div"
        >
          <div class="flex flex-col items-center justify-center text-left px-4 w-full mx-auto gap-4 sm:max-w-[560px] py-8">
            <h2 class="text-5xl font-bold font-title w-full">Why Us?</h2>
            <p class="text-neutral-900/70 dark:text-neutral-100/70 text-2xl">From streaming quality to social integration, we nail the details.</p>
          </div>
        </MotionComponent>
        <div class="flex items-center flex-col px-5 gap-5 justify-between w-full mx-auto max-w-xl">
          {
            features.map((feature, index) => (
              <MotionComponent
                initial={{ opacity: 0, y: 100 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ ...transition, delay: 0.2 * index }}
                client:load
                key={feature.title}
                class="w-full"
                as="div"
              >
                <div class="w-full flex gap-4 group ">
                  <div class="size-9 [&>svg]:size-9 group-hover:scale-110 transition-all duration-200">
                    <feature.icon />
                  </div>
                  <div>
                    <h2 class="text-xl font-bold font-title">
                      {feature.title}
                    </h2>
                    <p class="text-neutral-900/70 dark:text-neutral-100/70">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </MotionComponent>
            ))
          }
        </div>
      </section> */}
      {/* <section class="relative py-10 flex-col w-full space-y-8">
        <MotionComponent
          initial={{ opacity: 0, y: 100 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={transition}
          client:load
          class="items-center justify-center w-full flex"
          as="div"
        >
          <div class="flex flex-col items-center justify-center text-left w-full mx-auto px-4 gap-4 sm:max-w-[560px] py-8">
            <h2 class="text-5xl font-bold font-title w-full">How it works</h2>
            <p class="text-neutral-900/70 dark:text-neutral-100/70 text-2xl w-full">From click → play in under three minutes</p>
          </div>
        </MotionComponent>
        <MotionComponent
          initial={{ opacity: 0, y: 100 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={transition}
          client:load
          class="items-center justify-center w-full flex"
          as="div"
        >
          <div class="w-full mx-auto max-w-xl flex items-center flex-col lg:flex-row gap-6 justify-center">
            <div class="flex cursor-default items-end group">
              <div class="flex [transform:perspective(700px)] w-[61px] [transform-style:preserve-3d] relative">
                <p class="font-bold text-[200px] text-white dark:text-black group-hover:text-primary-200 dark:group-hover:text-primary-800 group-hover:-translate-x-2 transition-all duration-200 [-webkit-text-stroke-color:theme(colors.primary.500)] [-webkit-text-stroke-width:2px] leading-[1em]">
                  1
                </p>
              </div>
              <div class="z-[1] group-hover:ring-primary-500 gap-4 flex items-center justify-center flex-col transition-all ring-2 ring-gray-300 dark:ring-gray-700 duration-200 h-[260px] aspect-square bg-white dark:bg-black rounded-2xl overflow-hidden">
                <div class="flex items-center justify-center" >
                  <div class="z-[4] flex relative items-center justify-center size-[66px] transition-all duration-200 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-500 dark:group-hover:bg-primary-800 group-hover:bg-primary-200 shadow-lg shadow-gray-300 dark:shadow-gray-700" >
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" class="size-10 flex-shrink-0 group-hover:hidden" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M6.286 19C3.919 19 2 17.104 2 14.765s1.919-4.236 4.286-4.236q.427.001.83.08m7.265-2.582a5.8 5.8 0 0 1 1.905-.321c.654 0 1.283.109 1.87.309m-11.04 2.594a5.6 5.6 0 0 1-.354-1.962C6.762 5.528 9.32 3 12.476 3c2.94 0 5.361 2.194 5.68 5.015m-11.04 2.594a4.3 4.3 0 0 1 1.55.634m9.49-3.228C20.392 8.78 22 10.881 22 13.353c0 2.707-1.927 4.97-4.5 5.52" opacity=".5" /><path stroke-linejoin="round" d="M12 22v-6m0 6l2-2m-2 2l-2-2" /></g></svg>
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" class="size-10 flex-shrink-0 transition-all duration-200 group-hover:block hidden text-primary-500" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M6.286 19C3.919 19 2 17.104 2 14.765s1.919-4.236 4.286-4.236q.427.001.83.08m7.265-2.582a5.8 5.8 0 0 1 1.905-.321c.654 0 1.283.109 1.87.309m-11.04 2.594a5.6 5.6 0 0 1-.354-1.962C6.762 5.528 9.32 3 12.476 3c2.94 0 5.361 2.194 5.68 5.015m-11.04 2.594a4.3 4.3 0 0 1 1.55.634m9.49-3.228C20.392 8.78 22 10.881 22 13.353c0 2.707-1.927 4.97-4.5 5.52" opacity=".5" /><path stroke-linejoin="round" d="m10 19.8l1.143 1.2L14 18" /></g></svg>
                  </div>
                  <div class="-mx-3 group-hover:-mx-2 ring-1 ring-gray-300 dark:ring-gray-700 transition-all duration-200 size-[90px] rounded-full bg-gray-100 dark:bg-gray-900 shadow-lg shadow-gray-300 dark:shadow-gray-700 z-10 relative flex items-center justify-center">
                    <svg
                      width="48.672001"
                      height="36.804001"
                      class="size-[50px] flex-shrink-0"
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
                  <div class="z-[4] flex relative items-center justify-center size-[66px] rounded-full bg-[#273b4b] text-gray-50 shadow-lg shadow-gray-300 dark:shadow-gray-700" >
                    <svg xmlns="http://www.w3.org/2000/svg" class="size-10 flex-shrink-0" width="28" height="32" viewBox="0 0 448 512"><path fill="currentColor" d="M395.5 177.5c0 33.8-27.5 61-61 61c-33.8 0-61-27.3-61-61s27.3-61 61-61c33.5 0 61 27.2 61 61m52.5.2c0 63-51 113.8-113.7 113.8L225 371.3c-4 43-40.5 76.8-84.5 76.8c-40.5 0-74.7-28.8-83-67L0 358V250.7L97.2 290c15.1-9.2 32.2-13.3 52-11.5l71-101.7c.5-62.3 51.5-112.8 114-112.8C397 64 448 115 448 177.7M203 363c0-34.7-27.8-62.5-62.5-62.5q-6.75 0-13.5 1.5l26 10.5c25.5 10.2 38 39 27.7 64.5c-10.2 25.5-39.2 38-64.7 27.5c-10.2-4-20.5-8.3-30.7-12.2c10.5 19.7 31.2 33.2 55.2 33.2c34.7 0 62.5-27.8 62.5-62.5m207.5-185.3c0-42-34.3-76.2-76.2-76.2c-42.3 0-76.5 34.2-76.5 76.2c0 42.2 34.3 76.2 76.5 76.2c41.9.1 76.2-33.9 76.2-76.2" /></svg>
                  </div>
                </div>
                <div class="flex flex-col gap-2 w-full items-center justify-center">
                  <p class="text-neutral-900/70 dark:text-neutral-100/70 max-w-[80%] text-center mx-auto text-2xl font-title">
                    <strong>Add</strong>&nbsp;your game from Steam
                  </p>
                </div>
              </div>
            </div>
            <div class="flex cursor-default group items-end">
              <div class="flex [transform:perspective(700px)] w-[80px] [transform-style:preserve-3d] relative">
                <p class="font-bold text-[200px] text-white dark:text-black group-hover:text-primary-200 dark:group-hover:text-primary-800 leading-[1em] group-hover:-translate-x-2 transition-all duration-200 relative [-webkit-text-stroke-color:theme(colors.primary.500)] [-webkit-text-stroke-width:2px]">
                  2
                </p>
              </div>
              <div class="z-[1] group-hover:ring-primary-500 gap-4 flex items-center justify-center flex-col transition-all ring-2 ring-gray-300 dark:ring-gray-700 duration-200 h-[260px] aspect-square bg-white dark:bg-black rounded-2xl overflow-hidden">
                <div class="flex flex-col gap-2 w-full items-center justify-center">
                  <p class="text-neutral-900/70 dark:text-neutral-100/70 max-w-[80%] text-center mx-auto text-2xl font-title">
                    <strong>Create</strong>&nbsp;or join a Nestri Party
                  </p>
                </div>
                <div class="w-full [mask-image:linear-gradient(0deg,transparent,#000_30px)] justify-center items-center p-0.5 py-1 pb-0 flex flex-col-reverse">
                  <div class="rounded-2xl rounded-b-none pt-2 px-2 pb-6 bg-white dark:bg-black relative z-[4] flex flex-col gap-2 ring-2 ring-gray-300 dark:ring-gray-700 -mb-4 w-[calc(100%-10px)]">
                    <div class="flex absolute py-2 px-1 gap-0.5" >
                      <span class="size-2.5 rounded-full bg-red-500" />
                      <span class="size-2.5 rounded-full bg-blue-500" />
                      <span class="size-2.5 rounded-full bg-green-500" />
                    </div>
                    <div class="mx-auto w-full max-w-max rounded-lg bg-gray-200 dark:bg-gray-800 justify-center items-center px-2 py-1 flex gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M2 16c0-2.828 0-4.243.879-5.121C3.757 10 5.172 10 8 10h8c2.828 0 4.243 0 5.121.879C22 11.757 22 13.172 22 16s0 4.243-.879 5.121C20.243 22 18.828 22 16 22H8c-2.828 0-4.243 0-5.121-.879C2 20.243 2 18.828 2 16" opacity=".5" /><path fill="currentColor" d="M6.75 8a5.25 5.25 0 0 1 10.5 0v2.004c.567.005 1.064.018 1.5.05V8a6.75 6.75 0 0 0-13.5 0v2.055a24 24 0 0 1 1.5-.051z" /></svg>
                      <span class="text-gray-500 text-sm">
                        /play/Lqj8a0
                      </span>
                    </div>
                  </div>
                  <div class="rounded-2xl rounded-b-none pt-1.5 px-2 pb-1 transition-all duration-200 group-hover:ring-primary-500 group-hover:-translate-y-4 bg-white dark:bg-black relative z-[3] flex flex-col gap-2 ring-2 ring-gray-300 dark:ring-gray-700 -mb-4 w-[calc(100%-25px)]">
                    <div class="flex absolute py-2 px-1 gap-0.5" >
                      <span class="size-2.5 rounded-full bg-gray-500 group-hover:bg-primary-300 dark:group-hover:bg-primary-700 transition-all duration-200" />
                      <span class="size-2.5 rounded-full bg-gray-500 group-hover:bg-primary-300 dark:group-hover:bg-primary-700 transition-all duration-200" />
                      <span class="size-2.5 rounded-full bg-gray-500 group-hover:bg-primary-300 dark:group-hover:bg-primary-700 transition-all duration-200" />
                    </div>
                    <div class="mx-auto w-full max-w-max rounded-lg h-max transition-all duration-200 group-hover:text-primary-500 group-hover:bg-primary-200 dark:group-hover:bg-primary-800 bg-gray-200 dark:bg-gray-800 justify-center items-center px-2 py-1 pb-0.5 flex gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5 flex-shrink-0 h-full" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M2 16c0-2.828 0-4.243.879-5.121C3.757 10 5.172 10 8 10h8c2.828 0 4.243 0 5.121.879C22 11.757 22 13.172 22 16s0 4.243-.879 5.121C20.243 22 18.828 22 16 22H8c-2.828 0-4.243 0-5.121-.879C2 20.243 2 18.828 2 16" opacity=".5" /><path fill="currentColor" d="M6.75 8a5.25 5.25 0 0 1 10.5 0v2.004c.567.005 1.064.018 1.5.05V8a6.75 6.75 0 0 0-13.5 0v2.055a24 24 0 0 1 1.5-.051z" /></svg>
                      <span class=" text-gray-500 text-sm transition-all duration-200 group-hover:text-primary-500">
                        /play/vgCaA2
                      </span>
                    </div>
                  </div>
                  <div class="rounded-[18px] rounded-b-none pt-1.5 px-2 pb-1 bg-white dark:bg-black relative z-[2] flex flex-col gap-2 ring-2 ring-gray-300 dark:ring-gray-700 -mb-4 w-[calc(100%-40px)]">
                    <div class="flex absolute py-2 px-1 gap-0.5" >
                      <span class="size-2.5 rounded-full bg-gray-500" />
                      <span class="size-2.5 rounded-full bg-gray-500" />
                      <span class="size-2.5 rounded-full bg-gray-500" />
                    </div>
                    <div class="mx-auto w-full max-w-max rounded-lg flex justify-center items-center bg-gray-200 dark:bg-gray-800 px-2 py-1 gap-1 pb-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M2 16c0-2.828 0-4.243.879-5.121C3.757 10 5.172 10 8 10h8c2.828 0 4.243 0 5.121.879C22 11.757 22 13.172 22 16s0 4.243-.879 5.121C20.243 22 18.828 22 16 22H8c-2.828 0-4.243 0-5.121-.879C2 20.243 2 18.828 2 16" opacity=".5" /><path fill="currentColor" d="M6.75 8a5.25 5.25 0 0 1 10.5 0v2.004c.567.005 1.064.018 1.5.05V8a6.75 6.75 0 0 0-13.5 0v2.055a24 24 0 0 1 1.5-.051z" /></svg>
                      <span class="text-gray-500 text-sm max-w-[75%] text-ellipsis whitespace-pre-wrap">
                        /play/I5kzHj
                      </span>
                    </div>
                  </div>

                </div>
              </div>
            </div>
            <div class="flex cursor-none group items-end">
              <div class="flex [transform:perspective(700px)] w-[80px] [transform-style:preserve-3d] relative">
                <p class="relative font-bold text-[200px] text-white dark:text-black group-hover:text-primary-200 dark:group-hover:text-primary-800 leading-[1em] group-hover:-translate-x-2 transition-all duration-200 [-webkit-text-stroke-color:theme(colors.primary.500)] [-webkit-text-stroke-width:2px]">
                  3
                </p>
              </div>
              <div class="z-[1] relative group-hover:ring-primary-500 gap-4 flex items-center justify-center flex-col transition-all ring-2 ring-gray-300 dark:ring-gray-700 duration-200 h-[260px] aspect-square bg-white dark:bg-black rounded-2xl overflow-hidden">
                <div class="absolute top-0 left-0 bottom-0 right-0 w-full h-full z-[3]">
                  <Cursor client:load class="absolute left-4 top-4" text="Wanjohi" />
                  <Cursor client:load color="#3a9a00" flip class="absolute right-2 top-8" text="Jd" />
                  <Cursor client:load color="#0096c7" class="absolute top-14 right-1/3" text="DatHorse" />
                  <Cursor client:load color="#FF4F01" flip class="hidden transition-all duration-200 absolute top-20 right-6 group-hover:flex" text="You" />
                </div>
                <div class="flex z-[2] flex-col gap-2 w-full items-center justify-center">
                  <p class="text-neutral-900/70 dark:text-neutral-100/70 max-w-[80%] text-center mx-auto text-2xl font-title">
                    <strong>Play</strong>&nbsp;your game with friends
                  </p>
                </div>
                <div class="w-full overflow-hidden flex items-center absolute bottom-1/2 translate-y-2/3 group-hover:translate-y-[62%] transition-all duration-200 justify-center text-gray-500 group-hover:text-primary-500">
                  <svg
                    width="700"
                    height="465"
                    viewBox="0 0 185.20833 123.03125"
                    version="1.1"
                    id="svg1"
                    xml:space="preserve"
                    xmlns="http://www.w3.org/2000/svg"><defs
                      id="defs1"><linearGradient
                        id="paint0_linear_693_16793"
                        x1="640"
                        y1="0"
                        x2="640"
                        y2="960"
                        gradientUnits="userSpaceOnUse"><stop
                          stop-color="white"
                          stop-opacity="0"
                          id="stop40" /><stop
                          offset="0.177083"
                          stop-color="white"
                          id="stop41" /><stop
                          offset="0.739583"
                          stop-color="white"
                          id="stop42" /><stop
                          offset="1"
                          stop-color="white"
                          stop-opacity="0"
                          id="stop43" /></linearGradient><clipPath
                            id="clip0_693_16793"><rect
                          width="1280"
                          height="960"
                          fill="#ffffff"
                          id="rect43"
                          x="0"
                          y="0" /></clipPath><filter
                            id="filter0_d_693_16793-0"
                            x="374"
                            y="528"
                            width="229"
                            height="230"
                            filterUnits="userSpaceOnUse"
                            color-interpolation-filters="s-rGB"><feFlood
                          flood-opacity="0"
                          result="BackgroundImageFix"
                          id="feFlood34-6" /><feColorMatrix
                          in="SourceAlpha"
                          type="matrix"
                          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                          result="hardAlpha"
                          id="feColorMatrix34-3" /><feOffset
                          id="feOffset34-2" /><feGaussianBlur
                          stdDeviation="30"
                          id="feGaussianBlur34-3" /><feComposite
                          in2="hardAlpha"
                          operator="out"
                          id="feComposite34-4" /><feColorMatrix
                          type="matrix"
                          values="0 0 0 0 0.498039 0 0 0 0 0.811765 0 0 0 0 1 0 0 0 0.5 0"
                          id="feColorMatrix35-7" /><feBlend
                          mode="normal"
                          in2="BackgroundImageFix"
                          result="effect1_dropShadow_693_16793"
                          id="feBlend35-2" /><feBlend
                          mode="normal"
                          in="SourceGraphic"
                          in2="effect1_dropShadow_693_16793"
                          result="shape"
                          id="feBlend36-5" /></filter><filter
                            id="filter1_d_693_16793-1"
                            x="534.93402"
                            y="-271.39801"
                            width="209.134"
                            height="654.79999"
                            filterUnits="userSpaceOnUse"
                            color-interpolation-filters="s-rGB"><feFlood
                          flood-opacity="0"
                          result="BackgroundImageFix"
                          id="feFlood36-1" /><feColorMatrix
                          in="SourceAlpha"
                          type="matrix"
                          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                          result="hardAlpha"
                          id="feColorMatrix36-3" /><feOffset
                          id="feOffset36-8" /><feGaussianBlur
                          stdDeviation="30"
                          id="feGaussianBlur36-6" /><feComposite
                          in2="hardAlpha"
                          operator="out"
                          id="feComposite36-7" /><feColorMatrix
                          type="matrix"
                          values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.3 0"
                          id="feColorMatrix37-8" /><feBlend
                          mode="normal"
                          in2="BackgroundImageFix"
                          result="effect1_dropShadow_693_16793"
                          id="feBlend37-1" /><feBlend
                          mode="normal"
                          in="SourceGraphic"
                          in2="effect1_dropShadow_693_16793"
                          result="shape"
                          id="feBlend38-3" /></filter><filter
                            id="filter2_d_693_16793-1"
                            x="535.31598"
                            y="304.94"
                            width="208.367"
                            height="227.076"
                            filterUnits="userSpaceOnUse"
                            color-interpolation-filters="s-rGB"><feFlood
                          flood-opacity="0"
                          result="BackgroundImageFix"
                          id="feFlood38-0" /><feColorMatrix
                          in="SourceAlpha"
                          type="matrix"
                          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                          result="hardAlpha"
                          id="feColorMatrix38-4" /><feOffset
                          id="feOffset38-7" /><feGaussianBlur
                          stdDeviation="30"
                          id="feGaussianBlur38-6" /><feComposite
                          in2="hardAlpha"
                          operator="out"
                          id="feComposite38-0" /><feColorMatrix
                          type="matrix"
                          values="0 0 0 0 0.498039 0 0 0 0 0.811765 0 0 0 0 1 0 0 0 0.5 0"
                          id="feColorMatrix39-5" /><feBlend
                          mode="normal"
                          in2="BackgroundImageFix"
                          result="effect1_dropShadow_693_16793"
                          id="feBlend39-5" /><feBlend
                          mode="normal"
                          in="SourceGraphic"
                          in2="effect1_dropShadow_693_16793"
                          result="shape"
                          id="feBlend40-9" /></filter><clipPath
                            id="clip0_693_16793-6"><rect
                          width="1280"
                          height="960"
                          fill="#ffffff"
                          id="rect43-9"
                          x="0"
                          y="0" /></clipPath></defs><g
                            id="layer1"><g
                              style="fill:none"
                              id="g5"
                              transform="matrix(0.22977648,0,0,0.22977648,-63.558251,-97.516373)"><g
                                clip-path="url(#clip0_693_16793)"
                                id="g34"
                                transform="translate(0,1.1269769)"><mask
                                  id="mask0_693_16793"
                                  maskUnits="userSpaceOnUse"
                                  x="0"
                                  y="0"
                                  width="1280"
                                  height="960"><rect
                              width="1280"
                              height="960"
                              fill="url(#paint0_linear_693_16793)"
                              id="rect1-5"
                              x="0"
                              y="0" /></mask><g
                                clip-path="url(#clip0_693_16793-6)"
                                id="g34-2"
                                transform="matrix(0.62946008,0,0,0.62946008,276.77306,424.23217)"
                                style="fill:none"><g
                                  mask="url(#mask0_693_16793-9)"
                                  id="g33"><path
                                d="m 374.298,326.6944 v -16.698 c 0,-4.161 -3.12,-7.602 -7.276,-7.792 -27.473,-1.256 -126.447,-2.398 -187.77,41.383 -2.039,1.457 -3.202,3.827 -3.202,6.333 v 29.704"
                                stroke="currentColor"
                                stroke-width="8"
                                stroke-miterlimit="10"
                                id="path1-0"
                              /><path
                                d="m 905.526,326.6944 v -16.698 c 0,-4.161 3.12,-7.602 7.276,-7.792 27.474,-1.256 126.448,-2.398 187.768,41.383 2.04,1.457 3.2,3.827 3.2,6.333 v 29.704"
                                stroke="currentColor"
                                stroke-width="8"
                                stroke-miterlimit="10"
                                id="path2"
                              /><path
                                d="m 1306.08,1004.1594 c -25.21,-191.48 -78.54,-399.327 -126.04,-523.456 -46.54,-125.091 -169.68,-150.109 -285.052,-150.109 H 384.034 c -115.377,0 -238.51,25.018 -285.048,150.109 -46.5385,125.091 -99.86388082,331.976 -126.0418,523.456 -14.5433,95.26 55.2642,153 117.3156,159.73 62.0512,6.74 136.7072,-16.35 173.5502,-110.65 36.843,-93.34 52.356,-173.21 129.92,-173.21 65.929,0 424.663,0 490.593,0 77.564,0 93.077,79.87 129.917,173.21 36.85,93.33 111.5,117.39 173.55,110.65 62.05,-6.73 132.83,-64.47 118.29,-159.73 z"
                                fill="#ffffff"
                                fill-opacity="0.05"
                                stroke="currentColor"
                                stroke-width="10"
                                stroke-miterlimit="10"
                                id="path3" /><path
                                d="m 349.335,517.7594 h -39.599 c -2.209,0 -4,-1.791 -4,-4 v -39.598 c 0,-18.408 -15.501,-33.909 -33.91,-33.909 -18.408,0 -33.909,15.501 -33.909,33.909 v 39.598 c 0,2.209 -1.791,4 -4,4 h -39.599 c -18.408,0 -33.91,15.501 -33.91,33.909 0,18.408 15.502,33.91 33.91,33.91 h 39.599 c 2.209,0 4,1.791 4,4 v 39.598 c 0,18.408 15.501,33.909 33.909,33.909 18.409,0 33.91,-15.501 33.91,-33.909 v -39.598 c 0,-2.209 1.791,-4 4,-4 h 39.599 c 18.408,0 33.91,-15.502 33.91,-33.91 0,-18.408 -14.533,-33.909 -33.91,-33.909 z"
                                stroke="currentColor"
                                stroke-width="6"
                                stroke-miterlimit="10"
                                id="path4" /><path
                                d="m 441.98,822.9794 c 43.758,0 79.231,-35.476 79.231,-79.233 0,-43.758 -35.473,-79.23 -79.231,-79.23 -43.757,0 -79.23,35.472 -79.23,79.23 0,43.757 35.473,79.233 79.23,79.233 z"
                                stroke="currentColor"
                                opacity="0.3"
                                stroke-width="2"
                                stroke-miterlimit="10"
                                id="path5" /><path
                                d="m 441.42,803.1684 c 32.818,0 59.423,-26.604 59.423,-59.422 0,-32.818 -26.605,-59.423 -59.423,-59.423 -32.819,0 -59.423,26.605 -59.423,59.423 0,32.818 26.604,59.422 59.423,59.422 z"
                                stroke="currentColor"
                                stroke-width="6"
                                stroke-miterlimit="10"
                                id="path6" /><path
                                d="m 639.5,788.3124 c 24.614,0 44.567,-19.953 44.567,-44.566 0,-24.614 -19.953,-44.567 -44.567,-44.567 -24.613,0 -44.566,19.953 -44.566,44.567 0,24.613 19.953,44.566 44.566,44.566 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path7" /><path
                                d="m 628.11,739.7604 c 13.935,-6.284 26.114,-2.496 32.619,0.679 0.61,0.297 1.341,-0.01 1.556,-0.653 l 1.902,-5.709 c 0.223,-0.667 -0.084,-1.395 -0.717,-1.704 -8.029,-3.922 -27.092,-10.177 -48.139,4.634 -0.545,0.385 -0.739,1.103 -0.468,1.712 l 4.442,9.998 c 0.299,0.674 1.069,1.001 1.762,0.747 5.084,-1.863 12.772,-3.816 20.742,-2.666 -5.394,0.913 -9.728,2.816 -13.056,4.859 -0.595,0.364 -0.83,1.11 -0.553,1.749 0,0 1.766,4.043 2.731,6.255 0.24,0.552 0.966,0.68 1.379,0.245 1.023,-1.081 2.156,-1.867 3.075,-2.401 4.305,-2.499 10.256,-4.35 18.302,-3.925 0.628,0.033 1.203,-0.358 1.401,-0.955 l 2.033,-6.1 c 0.204,-0.61 -0.032,-1.283 -0.575,-1.626 -5.967,-3.771 -15.156,-6.913 -28.472,-5.124 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path8"
                              /><path
                                d="m 837.574,822.9694 c 43.758,0 79.23,-35.468 79.23,-79.224 0,-43.757 -35.472,-79.229 -79.23,-79.229 -43.757,0 -79.229,35.472 -79.229,79.229 0,43.756 35.472,79.224 79.229,79.224 z"
                                stroke="currentColor"
                                opacity="0.3"
                                stroke-width="2"
                                stroke-miterlimit="10"
                                id="path9" /><path
                                d="m 838.156,803.7784 c 32.818,0 59.422,-26.604 59.422,-59.422 0,-32.817 -26.604,-59.421 -59.422,-59.421 -32.818,0 -59.423,26.604 -59.423,59.421 0,32.818 26.605,59.422 59.423,59.422 z"
                                stroke="currentColor"
                                stroke-width="6"
                                stroke-miterlimit="10"
                                id="path10" /><path
                                d="m 506.295,479.8024 c 13.031,0 23.788,-11.067 23.788,-24.284 0,-13.216 -10.757,-24.283 -23.788,-24.283 h -35.654 c -13.031,0 -23.787,11.067 -23.787,24.283 0,13.217 10.756,24.284 23.787,24.284 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path11"
                                style="fill:none;stroke:currentColor;stroke-opacity:1" /><path
                                d="m 478.565,455.3004 c 0,2.735 -2.217,4.952 -4.952,4.952 -2.735,0 -4.952,-2.217 -4.952,-4.952 0,-2.735 2.217,-4.952 4.952,-4.952 2.735,0 4.952,2.217 4.952,4.952 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path12"
                              /><path
                                d="m 493.42,455.3004 c 0,2.735 -2.217,4.952 -4.951,4.952 -2.735,0 -4.952,-2.217 -4.952,-4.952 0,-2.735 2.217,-4.952 4.952,-4.952 2.734,0 4.951,2.217 4.951,4.952 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path13"
                              /><path
                                d="m 508.276,455.3004 c 0,2.735 -2.217,4.952 -4.952,4.952 -2.735,0 -4.952,-2.217 -4.952,-4.952 0,-2.735 2.217,-4.952 4.952,-4.952 2.735,0 4.952,2.217 4.952,4.952 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path14"
                              /><path
                                d="m 545.415,582.3724 c 16.146,0 29.235,-13.089 29.235,-29.235 0,-16.147 -13.089,-29.236 -29.235,-29.236 -16.146,0 -29.235,13.089 -29.235,29.236 0,16.146 13.089,29.235 29.235,29.235 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path15" /><path
                                d="m 559.135,548.7664 c -0.602,0 -1.119,-0.204 -1.552,-0.613 -0.41,-0.434 -0.614,-0.951 -0.614,-1.553 0,-0.602 0.204,-1.107 0.614,-1.516 0.433,-0.434 0.95,-0.65 1.552,-0.65 0.602,0 1.108,0.216 1.517,0.65 0.433,0.409 0.65,0.914 0.65,1.516 0,0.602 -0.217,1.119 -0.65,1.553 -0.409,0.409 -0.915,0.613 -1.517,0.613 z m -6.499,7.222 c -1.204,0 -2.227,-0.421 -3.069,-1.264 -0.843,-0.842 -1.264,-1.865 -1.264,-3.069 0,-1.204 0.421,-2.227 1.264,-3.069 0.842,-0.843 1.865,-1.264 3.069,-1.264 1.204,0 2.227,0.421 3.069,1.264 0.843,0.842 1.264,1.865 1.264,3.069 0,1.204 -0.421,2.227 -1.264,3.069 -0.842,0.843 -1.865,1.264 -3.069,1.264 z m 0,11.554 c -1.396,0 -2.588,-0.493 -3.575,-1.48 -0.987,-0.987 -1.48,-2.179 -1.48,-3.575 0,-1.396 0.493,-2.587 1.48,-3.574 0.987,-0.987 2.179,-1.481 3.575,-1.481 1.396,0 2.588,0.494 3.575,1.481 0.987,0.987 1.48,2.178 1.48,3.574 0,1.396 -0.493,2.588 -1.48,3.575 -0.987,0.987 -2.179,1.48 -3.575,1.48 z m -14.443,-11.554 c -2.407,0 -4.453,-0.843 -6.138,-2.528 -1.685,-1.685 -2.528,-3.731 -2.528,-6.138 0,-2.407 0.843,-4.453 2.528,-6.138 1.685,-1.685 3.731,-2.528 6.138,-2.528 2.407,0 4.453,0.843 6.138,2.528 1.685,1.685 2.528,3.731 2.528,6.138 0,2.407 -0.843,4.453 -2.528,6.138 -1.685,1.685 -3.731,2.528 -6.138,2.528 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path16" /><path
                                d="m 732.802,582.3714 c 16.146,0 29.235,-13.089 29.235,-29.235 0,-16.146 -13.089,-29.235 -29.235,-29.235 -16.146,0 -29.236,13.089 -29.236,29.235 0,16.146 13.09,29.235 29.236,29.235 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path17" /><path
                                d="m 719.349,566.0984 v -9.145 h 3.249 v 5.895 h 5.896 v 3.25 z m 0,-16.898 v -9.099 h 9.145 v 3.249 h -5.896 v 5.85 z m 16.898,16.898 v -3.25 h 5.849 v -5.895 h 3.25 v 9.145 z m 5.849,-16.898 v -5.85 h -5.849 v -3.249 h 9.099 v 9.099 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path18" /><path
                                d="m 808.203,479.8024 c 13.031,0 23.788,-11.067 23.788,-24.284 0,-13.216 -10.757,-24.283 -23.788,-24.283 H 772.55 c -13.031,0 -23.788,11.067 -23.788,24.283 0,13.217 10.757,24.284 23.788,24.284 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path19" /><path
                                d="m 774.747,465.8234 v -3.157 h 31.568 v 3.157 z m 0,-8.944 v -3.157 h 31.568 v 3.157 z m 0,-8.945 v -3.156 h 31.568 v 3.156 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path20" /><path
                                d="m 1019.24,676.4204 c 22.99,0 41.62,-18.632 41.62,-41.615 0,-22.983 -18.63,-41.615 -41.62,-41.615 -22.97898,0 -41.611,18.632 -41.611,41.615 0,22.983 18.63202,41.615 41.611,41.615 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path21" /><path
                                d="m 1006.98,648.4234 10.69,-28.365 h 4.95 l 10.74,28.365 h -4.79 l -2.62,-7.29 h -11.57 l -2.61,7.29 z m 17.51,-11.33 -3.13,-8.676 -1.07,-3.248 h -0.24 l -1.07,3.248 -3.13,8.676 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path22" /><path
                                d="m 935.374,592.1454 c 22.983,0 41.614,-18.632 41.614,-41.615 0,-22.983 -18.631,-41.615 -41.614,-41.615 -22.984,0 -41.615,18.632 -41.615,41.615 0,22.983 18.631,41.615 41.615,41.615 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path23" /><path
                                d="m 923.628,535.8774 h 5.348 l 6.299,10.181 h 0.237 l 6.339,-10.181 h 5.308 l -8.834,13.627 9.468,14.737 h -5.308 l -6.973,-11.052 h -0.237 l -6.972,11.052 h -5.309 l 9.468,-14.737 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path24" /><path
                                d="m 1019.24,508.0574 c 22.99,0 41.62,-18.632 41.62,-41.615 0,-22.983 -18.63,-41.615 -41.62,-41.615 -22.97898,0 -41.611,18.632 -41.611,41.615 0,22.983 18.63202,41.615 41.611,41.615 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path25" /><path
                                d="m 1017.49,479.9514 v -13.152 l -9.59,-15.212 h 5.15 l 6.46,10.696 h 0.24 l 6.3,-10.696 h 5.19 l -9.43,15.212 v 13.152 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path26" /><path
                                d="m 1103.74,592.1454 c 22.98,0 41.61,-18.632 41.61,-41.615 0,-22.983 -18.63,-41.615 -41.61,-41.615 -22.99,0 -41.62,18.632 -41.62,41.615 0,22.983 18.63,41.615 41.62,41.615 z"
                                stroke="currentColor"
                                stroke-width="4"
                                stroke-miterlimit="10"
                                id="path27" /><path
                                d="m 1095.17,564.2414 v -28.364 h 10.61 c 1.56,0 2.97,0.33 4.24,0.99 1.27,0.661 2.27,1.558 3.01,2.694 0.77,1.136 1.15,2.417 1.15,3.843 0,1.452 -0.36,2.694 -1.07,3.724 -0.71,1.03 -1.64,1.809 -2.77,2.337 v 0.198 c 1.42,0.475 2.59,1.294 3.48,2.456 0.9,1.162 1.35,2.549 1.35,4.16 0,1.584 -0.41,2.971 -1.23,4.159 -0.79,1.189 -1.87,2.126 -3.24,2.813 -1.35,0.66 -2.83,0.99 -4.44,0.99 z m 4.35,-12.558 v 8.517 h 6.74 c 0.95,0 1.77,-0.198 2.45,-0.594 0.69,-0.396 1.21,-0.924 1.55,-1.584 0.37,-0.661 0.55,-1.347 0.55,-2.06 0,-0.766 -0.18,-1.466 -0.55,-2.1 -0.37,-0.66 -0.91,-1.188 -1.62,-1.585 -0.69,-0.396 -1.54,-0.594 -2.54,-0.594 z m 0,-3.882 h 6.06 c 0.93,0 1.71,-0.185 2.34,-0.555 0.66,-0.396 1.16,-0.898 1.51,-1.505 0.34,-0.634 0.51,-1.281 0.51,-1.941 0,-0.66 -0.17,-1.281 -0.51,-1.862 -0.32,-0.607 -0.79,-1.096 -1.43,-1.466 -0.63,-0.396 -1.39,-0.594 -2.26,-0.594 h -6.22 z"
                                fill="currentColor"
                                opacity="0.5"
                                id="path28" /><g
                                filter="url(#filter1_d_693_16793)"
                                id="g31"
                                style="filter:url(#filter1_d_693_16793-1)"
                                transform="translate(1.8206821e-7,-187.9906)" /><g
                                filter="url(#filter2_d_693_16793)"
                                id="g32"
                                style="filter:url(#filter2_d_693_16793-1)"
                                transform="translate(1.8206821e-7,-187.9906)" /></g><g
                              filter="url(#filter0_d_693_16793)"
                              id="g1"
                              style="filter:url(#filter0_d_693_16793-0)" /><mask
                                id="mask0_693_16793-9"
                                maskUnits="userSpaceOnUse"
                                x="0"
                                y="0"
                                width="1280"
                                height="960"><rect
                                width="1280"
                                height="960"
                                fill="url(#paint0_linear_693_16793)"
                                id="rect1-6"
                                x="0"
                                y="0" />
                            </mask>
                          </g>
                        </g>
                      </g>
                    </g>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </MotionComponent>
      </section> */}
      <Footer />
    </>
  );
});

export const head: DocumentHead = {
  title: "Welcome to Qwik",
  meta: [
    {
      name: "description",
      content: "Qwik site description",
    },
  ],
};
