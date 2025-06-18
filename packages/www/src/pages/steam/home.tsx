import { FullScreen } from "@nestri/www/ui"
import { Header } from "@nestri/www/pages/steam/header";


export const HomeRoute = () => {
    return (
        <Header>
            <FullScreen>
                HOEM
            </FullScreen>
        </Header>
    )
}