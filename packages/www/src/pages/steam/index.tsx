import { LibraryRoute } from "./library";
import { useOpenAuth } from "@openauthjs/solid";
import { Route, useParams } from "@solidjs/router";
import { ApiProvider } from "@nestri/www/providers/api";
import { SteamContext } from "@nestri/www/providers/context";
import { createEffect, createMemo, Match, Switch } from "solid-js";
import { NotAllowed, NotFound } from "@nestri/www/pages/not-found";
import { useAccount, useStorage } from "@nestri/www/providers/account";

export const SteamRoute = (
    <Route
        // component={(props) => {
        //     const params = useParams();
        //     const account = useAccount();
        //     const storage = useStorage();
        //     const openauth = useOpenAuth();

        //     const team = createMemo(() =>
        //         account.current.teams.find(
        //             (item) => item.id === params.steamID,
        //         ),
        //     );

        //     createEffect(() => {
        //         const t = team();
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
        //             <Match when={!team()}>
        //                 {/* TODO: Add a public page for (other) teams */}
        //                 <NotAllowed header />
        //             </Match>
        //             <Match when={team()}>
        //                 <TeamContext.Provider value={() => team()!}>
        //                         <ApiProvider>
        //                             {props.children}
        //                         </ApiProvider>
        //                 </TeamContext.Provider>
        //             </Match>
        //         </Switch>
        //     )
        // }}
    >
        <Route path="library" component={LibraryRoute} />
        <Route path="*" component={() => <NotFound header />} />
    </Route>
)