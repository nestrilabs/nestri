import mqtt from "mqtt";


export module Connection {
    export async function create(endpoint: string, authorizer: string){
        return mqtt.connect(`wss://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`, {
            protocolVersion: 5,
            manualConnect: true,
            username: "", // Must be empty for the authorizer
            password: "PLACEHOLDER_TOKEN", // Passed as the token to the authorizer
            clientId: `client_${window.crypto.randomUUID()}`,
          });
    }
}