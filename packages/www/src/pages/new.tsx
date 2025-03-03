import { Text } from "@nestri/www/ui/text";
import { Container, FullScreen } from "@nestri/www/ui/layout";

export function CreateTeamComponent() {
    return (
        <FullScreen>
            <Container highlighted space="5" rounded="3.5" >
                <Text align="center" spacing="lg" size="4xl" weight="semibold">
                    Your first deploy is just a sign-up away.
                </Text>
                
            </Container>
        </FullScreen>
    )
}