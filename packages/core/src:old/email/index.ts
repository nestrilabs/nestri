import { LoopsClient } from "loops";
import { Resource } from "sst/resource"
export namespace Email {
    export const Client = () => new LoopsClient(Resource.LoopsApiKey.value);

    export async function send(
        to: string,
        body: string,
    ) {

        try {
            await Client().sendTransactionalEmail(
                {
                    transactionalId: "cm58pdf8d03upb5ecirnmvrfb",
                    email: to,
                    dataVariables: {
                        logincode: body
                    }
                }
            );
        } catch (error) {
            console.log("error sending email", error)
        }
    }

    export async function sendWelcome(
        to: string,
        name: string,
    ) {

        try {
            await Client().sendTransactionalEmail(
                {
                    transactionalId: "cm61jrbbx02twlstfwfcywt5u",
                    email: to,
                    dataVariables: {
                        name
                    }
                }
            );
        } catch (error) {
            console.log("error sending email", error)
        }
    }
}