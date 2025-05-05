import config from "../tailwind.config"
import * as Email from "@react-email/components";

export default function WelcomeEmail() {
    return (
        <Email.Html>
            <Email.Head />
            <Email.Preview>Welcome to Nestri</Email.Preview>
            <Email.Tailwind config={config}>
                <Email.Body>
                    <Email.Section>
                        
                    </Email.Section>
                </Email.Body>
            </Email.Tailwind>
        </Email.Html >
    )
}