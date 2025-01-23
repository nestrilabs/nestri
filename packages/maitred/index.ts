import { log } from "@/utils"
import { Auth } from "@/auth";
import { Party } from "@nestri/core/party/index";
import { Resource } from "sst"


const handler = async () => {
    // log.Info(hostname)
    const teamID = process.argv[2];
    const topic = `${Resource.App.name}/${Resource.App.stage}/chat`

    if (!teamID) {
        log.Error(new Error("Please provide the team ID to register this container to"))
        process.exit(1)
    }

    const ws = new WebSocket("ws://localhost:8080")
    ws.on("open",()=>{console.log("hello there")})

    // const credentials = await Auth.getCredentials(teamID)
    // log.Info(`Credentials ${credentials.access_token}`)
    //TODO: Use MQTT to connect to remote IoT service
    //TODO: Listen for commands to start a certain game
    //TODO: Start the certain game :)

    // await Connection.create()
    // const party = await Party.create(Resource.Party.endpoint, Resource.Party.authorizer, credentials.access_token)

    // party.on("connect", async () => {
    //     try {
    //         await party.subscribeAsync(topic, { qos: 1 });
    //     } catch (e) { }
    // });

    // party.on("message", (_fullTopic, payload) => {
    //     const message = new TextDecoder("utf8").decode(new Uint8Array(payload));
    //     console.log("messages", message)
    // });

    // party.on("error", log.Error);

    // party.connect();

    // party.publish(topic, "Hello there", { qos: 1 });
}

handler()
