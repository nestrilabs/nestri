import { Route } from "@solidjs/router";
import { HomeRoute } from "./home";

export const TeamRoute = (
    <Route>
        <Route path="" component={HomeRoute} />
    </Route>
)