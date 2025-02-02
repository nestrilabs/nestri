import Nestri from "@nestri/sdk";
import { cn } from "@nestri/ui/design";
import { server$ } from "@builder.io/qwik-city";
import { $, component$ } from "@builder.io/qwik";
import { HomeFriendsSection, HomeGamesSection, HomeMachineSection } from "@nestri/ui";

export const getUserSubscriptions = server$(
    async function () {

        const access = this.cookie.get("access_token")
        if (access) {
            const bearerToken = access.value

            const nestriClient = new Nestri({ bearerToken, maxRetries: 5 })
            const subscriptions = await nestriClient.subscriptions.list().then(t => t.data.length > 0 ? "Pro" : "Free").catch(async (err) => {
                if (err instanceof Nestri.APIError) {
                    if (err.status == 404) {
                        return "Free"
                    } else {
                        throw err
                    }
                } else {
                    throw err;
                }
            })

            return subscriptions as "Free" | "Pro"
        }
    }
);

export const getActiveUsers = server$(
    async function () {

        const access = this.cookie.get("access_token")
        if (access) {
            const bearerToken = access.value

            const nestriClient = new Nestri({ bearerToken, maxRetries: 5 })
            const users = await nestriClient.users.list().then(t => t.data) as any
            return users as Nestri.Users.UserListResponse.Data[]
        }
    }
);

export const getSession = server$(
    async function (profileID: string) {

        const access = this.cookie.get("access_token")
        if (access) {
            const bearerToken = access.value

            const nestriClient = new Nestri({ bearerToken, maxRetries: 5 })
            const session = await nestriClient.users.session(profileID)
            return session
        }
    }
);

export default component$(() => {

    return (
        <main class="flex w-screen h-full flex-col relative">
            <section class="max-w-[750px] w-full mx-auto flex flex-col gap-3 px-5 pt-20 pb-14 min-h-screen">
                {/* <HomeMachineSection getUserSubscription$={$(async () => { return await getUserSubscriptions() })} /> */}

                {/* <HomeFriendsSection getActiveUsers$={$(async () => { return await getActiveUsers() })} getSession$={$(async (profileID: string) => { return await getSession(profileID) })} /> */}
                <HomeGamesSection getUserSubscription$={$(async () => { return await getUserSubscriptions() })} />
            </section >
        </main >
    )
})