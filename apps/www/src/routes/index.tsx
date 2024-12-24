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
          <div class="w-full max-w-xl focus:ring-primary-500 duration-200 outline-none rounded-xl flex items-center justify-between hover:bg-gray-200 dark:hover:bg-gray-800 transition-all gap-2 px-4 py-3 h-[45px] ring-2 ring-gray-300 dark:ring-gray-700 mx-auto text-gray-900/70 dark:text-gray-100/70 bg-white dark:bg-black">
            <span class="flex items-center font-bold tracking-tighter gap-3 h-max justify-center overflow-hidden overflow-ellipsis whitespace-nowrap font-mono">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-[20px] flex-shrink-0" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M3.464 3.464C2 4.93 2 7.286 2 12s0 7.071 1.464 8.535C4.93 22 7.286 22 12 22s7.071 0 8.535-1.465C22 19.072 22 16.714 22 12s0-7.071-1.465-8.536C19.072 2 16.714 2 12 2S4.929 2 3.464 3.464m2.96 6.056a.75.75 0 0 1 1.056-.096l.277.23c.605.504 1.12.933 1.476 1.328c.379.42.674.901.674 1.518s-.295 1.099-.674 1.518c-.356.395-.871.824-1.476 1.328l-.277.23a.75.75 0 1 1-.96-1.152l.234-.195c.659-.55 1.09-.91 1.366-1.216c.262-.29.287-.427.287-.513s-.025-.222-.287-.513c-.277-.306-.707-.667-1.366-1.216l-.234-.195a.75.75 0 0 1-.096-1.056M17.75 15a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1 0-1.5h5a.75.75 0 0 1 .75.75" clip-rule="evenodd" /></svg>
              curl -fsSL https://nestri.io/install | bash
            </span>
            <span class="flex items-center gap-2">
              <div class="flex items-center gap-2 text-base font-title font-bold">
                <svg xmlns="http://www.w3.org/2000/svg" class="size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15.24 2h-3.894c-1.764 0-3.162 0-4.255.148c-1.126.152-2.037.472-2.755 1.193c-.719.721-1.038 1.636-1.189 2.766C3 7.205 3 8.608 3 10.379v5.838c0 1.508.92 2.8 2.227 3.342c-.067-.91-.067-2.185-.067-3.247v-5.01c0-1.281 0-2.386.118-3.27c.127-.948.413-1.856 1.147-2.593s1.639-1.024 2.583-1.152c.88-.118 1.98-.118 3.257-.118h3.07c1.276 0 2.374 0 3.255.118A3.6 3.6 0 0 0 15.24 2" /><path fill="currentColor" d="M6.6 11.397c0-2.726 0-4.089.844-4.936c.843-.847 2.2-.847 4.916-.847h2.88c2.715 0 4.073 0 4.917.847S21 8.671 21 11.397v4.82c0 2.726 0 4.089-.843 4.936c-.844.847-2.202.847-4.917.847h-2.88c-2.715 0-4.073 0-4.916-.847c-.844-.847-.844-2.21-.844-4.936z" /></svg>
              </div>
            </span>
          </div>
          <p class="w-full max-w-xl py-3 font-title px-2 text-gray-600 justify-start text-sm items-center flex">
            <span class="font-semibold">System requirements:</span>&nbsp;Docker 27.3.1 or newer
          </p>
        </div>
      </HeroSection>
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
