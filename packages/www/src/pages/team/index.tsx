import { HomeRoute } from "../home";
import { LibraryRoute } from "./library";
import { useOpenAuth } from "@openauthjs/solid";
import { Route, useParams } from "@solidjs/router";
import { ApiProvider } from "@nestri/www/providers/api";
import { TeamContext } from "@nestri/www/providers/context";
import { createEffect, createMemo, Match, Switch } from "solid-js";
import { NotAllowed, NotFound } from "@nestri/www/pages/not-found";
import { useAccount, useStorage } from "@nestri/www/providers/account";

export const TeamRoute = (
    <Route
        // component={(props) => {
        //     const params = useParams();
        //     const account = useAccount();
        //     const storage = useStorage();
        //     const openauth = useOpenAuth();

        //     const team = createMemo(() =>
        //         account.current.teams.find(
        //             (item) => item.id === params.teamID,
        //         ),
        //     );

        //     createEffect(() => {
        //         const t = team();
        //         if (!t) return;
        //         storage.set("team", t.id);
        //     });

        //     createEffect(() => {
        //         const teamID = params.teamID;
        //         for (const item of Object.values(account.all)) {
        //             for (const team of item.teams) {
        //                 if (team.id === teamID && item.id !== openauth.subject!.id) {
        //                     openauth.switch(item.email);
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
        <Route path="" component={HomeRoute} />
        <Route path="library" component={LibraryRoute} />
        <Route path="*" component={() => <NotFound header />} />
    </Route>
)