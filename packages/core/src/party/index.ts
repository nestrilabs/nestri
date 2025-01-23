import mqtt from "mqtt"
import { ulid } from "ulid";
// import { iot, mqtt } from "aws-iot-device-sdk-v2";


export module Party {
    export async function create(endpoint: string, authorizer: string, credentials: string) {
        return mqtt.connect(`mqtt://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`, {
            protocolVersion: 5,
            manualConnect: true,
            username: "", // Must be empty for the authorizer
            password: credentials, // Passed as the token to the authorizer
            clientId: `client_${ulid()}`,
        });

        // const config = iot.AwsIotMqttConnectionConfigBuilder.new_with_websockets()
        //     .with_clean_session(true)
        //     .with_client_id(`client_${ulid()}`)
        //     .with_endpoint(endpoint)
        //     .with_custom_authorizer("", authorizer, "", "PLACEHOLDER_TOKEN")
        //     .with_keep_alive_seconds(1200)
        //     .build();

        // const client = new mqtt.MqttClient();
        // return client.new_connection(config);
    }
}