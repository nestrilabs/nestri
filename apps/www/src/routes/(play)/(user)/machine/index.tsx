import { component$ } from "@builder.io/qwik"

export default component$(() => {

    return (
        <main class="w-full">
            <div class="relative pt-32 pb-10 max-w-5xl mx-auto px-6" >
                <div class="container flex flex-col gap-6 md:flex-row" >
                    <div class="flex min-w-[209px] flex-col gap-2" >
                        <span class="text-xs font-medium text-gray-800 dark:text-gray-200 uppercase" >
                            General
                        </span>
                        <div class="flex divide-x flex-col overflow-hidden" >
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm font-medium no-underline rounded border-none bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M14.06 9.94L12 9l2.06-.94L15 6l.94 2.06L18 9l-2.06.94L15 12zM4 14l.94-2.06L7 11l-2.06-.94L4 8l-.94 2.06L1 11l2.06.94zm4.5-5l1.09-2.41L12 5.5L9.59 4.41L8.5 2L7.41 4.41L5 5.5l2.41 1.09zm-4 11.5l6-6.01l4 4L23 8.93l-1.41-1.41l-7.09 7.97l-4-4L3 19z" /></svg>
                                Performance
                            </div>
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm no-underline rounded border-none text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-17.87a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" /></svg>
                                Users
                            </div>
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm no-underline rounded border-none text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3a12 12 0 0 0 8.5 3A12 12 0 0 1 12 21A12 12 0 0 1 3.5 6A12 12 0 0 0 12 3" /></svg>
                                Security
                            </div>
                        </div>
                        <span class="text-xs font-medium text-gray-800 dark:text-gray-200 uppercase mt-6" >
                            Network
                        </span>
                        <div class="flex divide-x flex-col overflow-hidden" >
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm no-underline rounded border-none text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20.5 9.035a9.004 9.004 0 0 0-17 0m17 0c.324.928.5 1.926.5 2.965a9 9 0 0 1-.5 2.966m0-5.931h-17m0 0A9 9 0 0 0 3 12a9 9 0 0 0 .5 2.966m0 0a9.004 9.004 0 0 0 17 0m-17 0h17" /><path d="M12 21c4.97-4.97 4.97-13.03 0-18c-4.97 4.97-4.97 13.03 0 18" /></g></svg>
                                API requests
                            </div>
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm no-underline rounded border-none text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none"><path d="M24 0v24H0V0zM12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z" /><path fill="currentColor" d="M8.207 11.757a1 1 0 0 1 0 1.415L6.38 15H16a1 1 0 1 1 0 2H6.38l1.828 1.828a1 1 0 1 1-1.414 1.415l-3.536-3.536a1 1 0 0 1 0-1.414l3.536-3.536a1 1 0 0 1 1.414 0Zm7.586-8a1 1 0 0 1 1.32-.083l.094.083l3.536 3.536a1 1 0 0 1 .083 1.32l-.083.094l-3.536 3.535a1 1 0 0 1-1.497-1.32l.083-.094L17.62 9H8a1 1 0 0 1-.117-1.993L8 7h9.621l-1.828-1.83a1 1 0 0 1 0-1.414Z" /></g></svg>
                                Data transfer
                            </div>
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm no-underline rounded border-none text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" d="M2.5 5.724V8c0 .248.238.7 1.169 1.159c.874.43 2.144.745 3.62.822a.75.75 0 1 1-.078 1.498c-1.622-.085-3.102-.432-4.204-.975a6 6 0 0 1-.507-.28V12.5c0 .133.058.318.282.551c.227.237.591.483 1.101.707c1.015.447 2.47.742 4.117.742q.61 0 1.183-.052a.751.751 0 1 1 .134 1.494Q8.676 15.999 8 16c-1.805 0-3.475-.32-4.721-.869c-.623-.274-1.173-.619-1.579-1.041c-.408-.425-.7-.964-.7-1.59v-9c0-.626.292-1.165.7-1.591c.406-.42.956-.766 1.579-1.04C4.525.32 6.195 0 8 0s3.476.32 4.721.869c.623.274 1.173.619 1.579 1.041c.408.425.7.964.7 1.59s-.292 1.165-.7 1.591c-.406.42-.956.766-1.578 1.04C11.475 6.68 9.805 7 8 7s-3.475-.32-4.721-.869a6 6 0 0 1-.779-.407m0-2.224c0 .133.058.318.282.551c.227.237.591.483 1.101.707C4.898 5.205 6.353 5.5 8 5.5s3.101-.295 4.118-.742c.508-.224.873-.471 1.1-.708c.224-.232.282-.417.282-.55s-.058-.318-.282-.551c-.227-.237-.591-.483-1.101-.707C11.102 1.795 9.647 1.5 8 1.5s-3.101.295-4.118.742c-.508.224-.873.471-1.1.708c-.224.232-.282.417-.282.55" /><path fill="currentColor" d="M14.49 7.582a.375.375 0 0 0-.66-.313l-3.625 4.625a.375.375 0 0 0 .295.606h2.127l-.619 2.922a.375.375 0 0 0 .666.304l3.125-4.125A.375.375 0 0 0 15.5 11h-1.778z" /></svg>
                                WAN cache
                            </div>
                        </div>
                        <span class="text-xs font-medium text-gray-800 dark:text-gray-200 uppercase mt-6" >
                            Admin
                        </span>
                        <div class="flex divide-x flex-col overflow-hidden" >
                            <div class="[&>svg]:size-5 flex flex-row gap-2 items-center px-3 py-2.5 text-sm no-underline rounded border-none text-gray-700 dark:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3" /><path d="M13.765 2.152C13.398 2 12.932 2 12 2s-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083c-.092.223-.129.484-.143.863a1.62 1.62 0 0 1-.79 1.353a1.62 1.62 0 0 1-1.567.008c-.336-.178-.579-.276-.82-.308a2 2 0 0 0-1.478.396C4.04 5.79 3.806 6.193 3.34 7s-.7 1.21-.751 1.605a2 2 0 0 0 .396 1.479c.148.192.355.353.676.555c.473.297.777.803.777 1.361s-.304 1.064-.777 1.36c-.321.203-.529.364-.676.556a2 2 0 0 0-.396 1.479c.052.394.285.798.75 1.605c.467.807.7 1.21 1.015 1.453a2 2 0 0 0 1.479.396c.24-.032.483-.13.819-.308a1.62 1.62 0 0 1 1.567.008c.483.28.77.795.79 1.353c.014.38.05.64.143.863a2 2 0 0 0 1.083 1.083C10.602 22 11.068 22 12 22s1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.092-.223.129-.483.143-.863c.02-.558.307-1.074.79-1.353a1.62 1.62 0 0 1 1.567-.008c.336.178.579.276.819.308a2 2 0 0 0 1.479-.396c.315-.242.548-.646 1.014-1.453s.7-1.21.751-1.605a2 2 0 0 0-.396-1.479c-.148-.192-.355-.353-.676-.555A1.62 1.62 0 0 1 19.562 12c0-.558.304-1.064.777-1.36c.321-.203.529-.364.676-.556a2 2 0 0 0 .396-1.479c-.052-.394-.285-.798-.75-1.605c-.467-.807-.7-1.21-1.015-1.453a2 2 0 0 0-1.479-.396c-.24.032-.483.13-.82.308a1.62 1.62 0 0 1-1.566-.008a1.62 1.62 0 0 1-.79-1.353c-.014-.38-.05-.64-.143-.863a2 2 0 0 0-1.083-1.083Z" /></g></svg>
                                Settings
                            </div>
                        </div>
                    </div>
                    <div class="flex-1" >
                        <div class="flex flex-col gap-y-4" >
                            <div class="w-full bg-white dark:bg-black ring-gray-200 ring-2 dark:ring-gray-800 rounded-[10px]">
                                <div class="size-full ring-1 ring-gray-200 dark:ring-gray-800 rounded-md flex justify-center items-center h-[300px] gap-2 flex-col">
                                    <div class="border-2 border-gray-100 dark:border-gray-900 size-[60px] text-gray-600 dark:text-gray-400 rounded-lg justify-center flex items-center [&>svg]:size-8">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><path fill="currentColor" d="m665.216 768l110.848 192h-73.856L591.36 768H433.024L322.176 960H248.32l110.848-192H160a32 32 0 0 1-32-32V192H64a32 32 0 0 1 0-64h896a32 32 0 1 1 0 64h-64v544a32 32 0 0 1-32 32zM832 192H192v512h640zM352 448a32 32 0 0 1 32 32v64a32 32 0 0 1-64 0v-64a32 32 0 0 1 32-32m160-64a32 32 0 0 1 32 32v128a32 32 0 0 1-64 0V416a32 32 0 0 1 32-32m160-64a32 32 0 0 1 32 32v192a32 32 0 1 1-64 0V352a32 32 0 0 1 32-32" /></svg>
                                    </div>
                                    <div class="max-w-[340px] w-full text-black dark:text-white text-lg text-center font-semibold font-title flex gap-1 justify-center h-max items-center">
                                        No data yet
                                        <div class="select-none text-[#ff990a] bg-[#ff990a]/30  h-max uppercase overflow-hidden rounded-md px-2 py-1 text-xs transition-colors duration-200 ease-out font-semibold font-title">
                                            <span>Soon</span>
                                        </div>
                                    </div>
                                    <span class="text-sm text-gray-700 dark:text-gray-300 max-w-[340px] text-center" >
                                        Once you have installed a game and started playing data should start flowing into Nestri
                                    </span>
                                </div>
                            </div>
                            <div class="grid gap-3 lg:grid-cols-2">
                                <div class="bg-white p-8 dark:bg-black ring-gray-200 ring-2 dark:ring-gray-800 relative w-full rounded-[10px] h-[240px] min-h-[240px]">
                                    <div class="relative w-full h-full flex flex-col gap-2">
                                       <p class="font-medium font-title" >GPU usage</p>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                    </div>
                                </div>
                                <div class="bg-white p-8 dark:bg-black ring-gray-200 ring-2 dark:ring-gray-800 relative w-full rounded-[10px] h-[240px] min-h-[240px]">
                                    <div class="relative w-full h-full flex flex-col gap-2">
                                       <p class="font-medium font-title" >CPU usage</p>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                       <div class="animate-pulse bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-full"/>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    )
})