import Nestri from '@nestri/sdk';
import { routeLoader$ } from '@builder.io/qwik-city';
import { component$, useVisibleTask$ } from '@builder.io/qwik';

// function getCookie(cname: string) {
//     const name = cname + "=";
//     const ca = document.cookie.split(';');
//     for (let i = 0; i < ca.length; i++) {
//         let c = ca[i];
//         while (c.charAt(0) == ' ') {
//             c = c.substring(1);
//         }
//         if (c.indexOf(name) == 0) {
//             return c.substring(name.length, c.length);
//         }
//     }
//     return "";
// }

// function getParams(url: URL) {
//     const urlString = url.toString()
//     const hash = urlString.substring(urlString.indexOf('?') + 1); // Extract the part after the #
//     const params = new URLSearchParams(hash);
//     const paramsObj = {} as any;
//     for (const [key, value] of params.entries()) {
//         paramsObj[key] = decodeURIComponent(value);
//     }
//     console.log(paramsObj)
//     return paramsObj;
// }

//FIXME: There is an issue where the cookie cannot be found, tbh, i dunno what drugs Qwik is on
export const useSubscribe = routeLoader$(async ({ url, cookie }) => {
    const access = cookie.get("access_token")
    if (access) {
        const bearerToken = access.value
        console.log("bearerToken", bearerToken)

        const nestriClient = new Nestri({
            bearerToken,
            baseURL: "https://api.nestri.io"
        })

        const checkout_id = url.searchParams.get("checkout")

        if (checkout_id) {
            console.log("checkout", checkout_id)

            await nestriClient.subscriptions.create({
                checkoutID: checkout_id
            })

            return "okey"
        }
    }
})

export default component$(() => {
    const subscribe = useSubscribe()
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
        console.log("subscribe", subscribe)
    })
    //     const bearerToken = getCookie("access_token")
    //     // console.log("bearerToken", bearerToken)
    //     const nestriClient = new Nestri({
    //         bearerToken,
    //         baseURL: "https://api.lauryn.dev.nestri.io"
    //     })
    //     const urlObj = new URL(window.location.href)
    //     const checkout_id = getParams(urlObj).checkout

    //     if (checkout_id) {
    //         await nestriClient.subscriptions.create({
    //             checkoutID: checkout_id
    //         })
    //     }
    // })

    return (
        <div class="w-screen h-full pt-20 flex justify-center items-center" >
            <h1 class="text-3xl">Thank you, now check your email for more details</h1>
        </div>
    )
})