import { LibraryRoute } from "./library";
import { useOpenAuth } from "@openauthjs/solid";
import { Route, useParams } from "@solidjs/router";
import { ApiProvider } from "@nestri/www/providers/api";
import { SteamContext } from "@nestri/www/providers/context";
import { createEffect, createMemo, Match, Switch } from "solid-js";
import { NotAllowed, NotFound } from "@nestri/www/pages/not-found";
import { useAccount, useStorage } from "@nestri/www/providers/account";
import { HomeRoute } from "./home";

export const SteamRoute = (
    <Route
        // component={(props) => {
        //     const params = useParams();
        //     const account = useAccount();
        //     const storage = useStorage();
        //     const openauth = useOpenAuth();

        //     const steam = createMemo(() =>
        //         account.current.profiles.find(
        //             (item) => item.id === params.steamID,
        //         ),
        //     );

        //     createEffect(() => {
        //         const t = steam();
        //         if (!t) return;
        //         storage.set("steam", t.id);
        //     });

        //     createEffect(() => {
        //         const steamID = params.steamID;
        //         for (const item of Object.values(account.all)) {
        //             for (const profile of item.profiles) {
        //                 if (profile.id === steamID && item.id !== openauth.subject!.id) {
        //                     openauth.switch(item.id);
        //                 }
        //             }
        //         }
        //     })

        //     return (
        //         <Switch>
        //             <Match when={!steam()}>
        //                 <NotAllowed header />
        //             </Match>
        //             <Match when={steam()}>
        //                 <SteamContext.Provider value={() => steam()!}>
        //                     <ApiProvider>
        //                         {props.children}
        //                     </ApiProvider>
        //                 </SteamContext.Provider>
        //             </Match>
        //         </Switch>
        //     )
        // }}
    >
        <Route path="library" component={LibraryRoute} />
        <Route path="" component={HomeRoute} />
        <Route path="*" component={() => <NotFound header />} />
    </Route>
)