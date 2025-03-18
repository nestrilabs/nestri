import { Header } from "@nestri/www/pages/team/header";
import { FullScreen } from "@nestri/www/ui/layout";

export function HomeRoute() {
    return (
        <>
            <Header />
            <FullScreen inset="header" />
        </>
    )
}