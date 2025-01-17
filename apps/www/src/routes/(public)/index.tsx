import { Footer } from "@nestri/ui"
import { cn } from "@nestri/ui/design";
import { component$ } from "@builder.io/qwik";
import { HeroSection, MotionComponent, transition } from "@nestri/ui/react"
import { type RequestHandler, type DocumentHead } from "@builder.io/qwik-city";


const tags = [
  {
    name: "All",
    total: undefined
  },
  {
    name: "Playing Now",
    total: 12
  },
  {
    name: "Action",
    total: 47
  },
  {
    name: "Free To Play",
    total: 53
  },
  {
    name: "Adventure",
    total: 21
  },
  {
    name: "Casual",
    total: 26
  },
  {
    name: "Indie",
    total: 74
  }
]

const games = [
  "https://assets-prd.ignimgs.com/2020/07/16/cyberpunk-2077-button-fin-1594877291453.jpg",
  "https://assets-prd.ignimgs.com/2023/03/22/keyart-wide-1-1679503853654-1679505306655.jpeg",
  "https://assets-prd.ignimgs.com/2022/11/09/coffee-talk-episode-1-button-fin-1668033710468.jpg",
  "https://assets-prd.ignimgs.com/2022/06/15/stalker2chornobyl-1655253282275.jpg",
  "https://assets-prd.ignimgs.com/2022/05/24/call-of-duty-modern-warfare-2-button-02-1653417394041.jpg",
  "https://assets-prd.ignimgs.com/2023/02/16/apexrevelry-1676588335122.jpg"
]

export const onGet: RequestHandler = async ({ request, send }) => {
  const userAgent = request.headers.get('user-agent') || ''
  const isCurl = userAgent.toLowerCase().includes('curl');

  //TODO:
  if (isCurl) {
    const response = new Response(
      `#!/bin/bash

echo "Not yet ready 😅\n"

echo "Consider joining our Discord channel (https://discord.com/invite/Y6etn3qKZ3) for the latest updates \n"
      `, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="nestri.sh"'
      }
    })
    send(response)
  } 
};

// FIXME: Change up the copy
//TODO: Add the demo video/gif

export default component$(() => {

  return (
    <div class="w-screen relative">
      <HeroSection client:load>
        <div class="w-full flex flex-col">
          <button onClick$={() => {
            //@ts-ignore
            navigator.clipboard.writeText("curl -fsSL https://nestri.io | sh")
          }} class="group w-full max-w-xl focus:ring-primary-500 duration-200 outline-none rounded-xl flex items-center justify-start hover:bg-gray-200 focus:bg-gray-200 dark:hover:bg-gray-800 dark:focus:bg-gray-800 transition-all gap-2 px-4 py-3 h-[45px] ring-2 ring-gray-300 dark:ring-gray-700 mx-auto text-gray-900/70 dark:text-gray-100/70 bg-white dark:bg-black">
            <svg xmlns="http://www.w3.org/2000/svg" class="size-[20px] flex-shrink-0" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M3.464 3.464C2 4.93 2 7.286 2 12s0 7.071 1.464 8.535C4.93 22 7.286 22 12 22s7.071 0 8.535-1.465C22 19.072 22 16.714 22 12s0-7.071-1.465-8.536C19.072 2 16.714 2 12 2S4.929 2 3.464 3.464m2.96 6.056a.75.75 0 0 1 1.056-.096l.277.23c.605.504 1.12.933 1.476 1.328c.379.42.674.901.674 1.518s-.295 1.099-.674 1.518c-.356.395-.871.824-1.476 1.328l-.277.23a.75.75 0 1 1-.96-1.152l.234-.195c.659-.55 1.09-.91 1.366-1.216c.262-.29.287-.427.287-.513s-.025-.222-.287-.513c-.277-.306-.707-.667-1.366-1.216l-.234-.195a.75.75 0 0 1-.096-1.056M17.75 15a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1 0-1.5h5a.75.75 0 0 1 .75.75" clip-rule="evenodd" /></svg>
            <p class="font-bold tracking-tighter h-max overflow-hidden overflow-ellipsis whitespace-nowrap font-mono">
              curl -fsSL https://nestri.io | sh
            </p>
            <div class="ml-auto flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="group-focus:hidden size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15.24 2h-3.894c-1.764 0-3.162 0-4.255.148c-1.126.152-2.037.472-2.755 1.193c-.719.721-1.038 1.636-1.189 2.766C3 7.205 3 8.608 3 10.379v5.838c0 1.508.92 2.8 2.227 3.342c-.067-.91-.067-2.185-.067-3.247v-5.01c0-1.281 0-2.386.118-3.27c.127-.948.413-1.856 1.147-2.593s1.639-1.024 2.583-1.152c.88-.118 1.98-.118 3.257-.118h3.07c1.276 0 2.374 0 3.255.118A3.6 3.6 0 0 0 15.24 2" /><path fill="currentColor" d="M6.6 11.397c0-2.726 0-4.089.844-4.936c.843-.847 2.2-.847 4.916-.847h2.88c2.715 0 4.073 0 4.917.847S21 8.671 21 11.397v4.82c0 2.726 0 4.089-.843 4.936c-.844.847-2.202.847-4.917.847h-2.88c-2.715 0-4.073 0-4.916-.847c-.844-.847-.844-2.21-.844-4.936z" /></svg>
              <svg xmlns="http://www.w3.org/2000/svg" class="group-focus:block hidden text-green-500 size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z" /></svg>
            </div>
          </button>
          <p class="w-full max-w-xl py-3 font-title px-2 text-gray-600 dark:text-gray-400 justify-start text-sm items-center flex">
            <span class="font-semibold">System requirements:</span>&nbsp;Docker 27.3.1 or newer
          </p>
        </div>
      </HeroSection>
      <MotionComponent
        initial={{ opacity: 0, y: 100 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={transition}
        client:load
        class="items-center justify-center w-full flex py-8 px-4 flex-col"
        as="div"
      >
        <section class="sticky w-full max-w-4xl px-1 mx-auto py-3 md:overflow-hidden overflow-x-scroll flex gap-1.5">
          <button class="bg-transparent text-gray-900/70 focus:ring-primary-500 outline-none dark:text-gray-100/70 ring-2 mt-[1px] ring-gray-300 dark:ring-gray-700 w-48 h-max py-2 rounded-full flex text-sm px-4 items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-900 transition-all duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" class="size-[14px] -mt-[1px] flex-shrink-0"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="11.5" cy="11.5" r="9.5"></circle><path stroke-linecap="round" d="M18.5 18.5L22 22"></path></g></svg>
            Search...
          </button>
          {tags.map((tag, key) => (
            <button key={`tags-${key}`} class={cn("bg-white dark:bg-black text-gray-900/70 hover:ring-primary-500 outline-none dark:text-gray-100/70 ring-2 text-sm h-max ring-gray-300 dark:ring-gray-700 py-2 px-4 rounded-full flex items-center hover:bg-gray-100 dark:hover:bg-gray-900 transition-all duration-200 focus:bg-primary-100 dark:focus:bg-primary-900 focus:text-primary-500 focus:ring-primary-500 focus:!bg-[url:none]", key == 1 && "bg-[url:linear-gradient(135deg,theme(colors.gray.100),theme(colors.gray.300)_20%,theme(colors.gray.100)_40%,theme(colors.gray.300)_60%,theme(colors.gray.100)_80%,theme(colors.gray.300))] dark:bg-[url:linear-gradient(135deg,theme(colors.gray.900),theme(colors.gray.700)_20%,theme(colors.gray.900)_40%,theme(colors.gray.700)_60%,theme(colors.gray.900)_80%,theme(colors.gray.700))]")}>
              <p class="whitespace-nowrap"> {tag.name}</p>
              {tag.total && <sup class="pl-1 font-title" >{tag.total}</sup>}
            </button>
          ))}

        </section>
        <section class="w-full md:max-w-[70%] px-1 py-2">
          <div class="w-full grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(280px,.5fr))] auto-cols-[1fr] place-items-start mb-2 md:gap-6 gap-3">
            {games.map((game, key) => (
              <button key={key} class="hover:shadow-2xl hover:shadow-gray-800 dark:hover:shadow-gray-200 hover:ring-primary-500 transition-all duration-200 w-full rounded-[20px] relative md:ring-[.4375em] ring-[.275em] ring-gray-300 dark:ring-gray-700 overflow-hidden bg-gradient-to-b from-gray-300 dark:from-gray-700 to-white dark:to-black">
                <div class="py-[50%] w-full relative min-w-full min-h-full flex items-center justify-center overflow-visible">
                  <img src={game} class="mx-auto w-full absolute" height={80} width={80} />
                </div>
              </button>
            ))}
          </div>
        </section>
      </MotionComponent>
      <Footer />
    </div>
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
