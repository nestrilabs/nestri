import { Header } from "./header";
import { FullScreen } from "@nestri/www/ui/layout";

export function HomeRoute() {
    return (
        <>
            <Header />
            <FullScreen inset="header" />
        </>
    )
}