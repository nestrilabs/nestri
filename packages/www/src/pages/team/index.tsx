import { HomeRoute } from "./home";
import { useOpenAuth } from "@openauthjs/solid";
import { Route, useParams } from "@solidjs/router";
import { ApiProvider } from "@nestri/www/providers/api";
import { SteamRoute } from "@nestri/www/pages/team/steam";
import { ZeroProvider } from "@nestri/www/providers/zero";
import { TeamContext } from "@nestri/www/providers/context";
import { SteamProvider } from "@nestri/www/providers/steam";
import { createEffect, createMemo, Match, Switch } from "solid-js";
import { NotAllowed, NotFound } from "@nestri/www/pages/not-found";
import { useAccount, useStorage } from "@nestri/www/providers/account";

export const TeamRoute = (
    <Route
        component={(props) => {
            const params = useParams();
            const account = useAccount();
            const storage = useStorage();
            const openauth = useOpenAuth();

            const team = createMemo(() =>
                account.current.teams.find(
                    (item) => item.slug === params.teamSlug,
                ),
            );

            createEffect(() => {
                const t = team();
                if (!t) return;
                storage.set("team", t.id);
            });

            createEffect(() => {
                const teamSlug = params.teamSlug;
                for (const item of Object.values(account.all)) {
                    for (const team of item.teams) {
                        if (team.slug === teamSlug && item.id !== openauth.subject!.id) {
                            openauth.switch(item.email);
                        }
                    }
                }
            })

            return (
                <Switch>
                    <Match when={!team()}>
                        {/* TODO: Add a public page for (other) teams */}
                        <NotAllowed header />
                    </Match>
                    <Match when={team()}>
                        <TeamContext.Provider value={() => team()!}>
                            <ZeroProvider>
                                <ApiProvider>
                                    <SteamProvider>
                                        {props.children}
                                    </SteamProvider>
                                </ApiProvider>
                            </ZeroProvider>
                        </TeamContext.Provider>
                    </Match>
                </Switch>
            )
        }}
        >
        <Route path="" component={HomeRoute} />
        <Route path="steam" component={SteamRoute} />
        <Route path="*" component={() => <NotFound header />} />
    </Route>
)