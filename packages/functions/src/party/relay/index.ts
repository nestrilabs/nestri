import type * as Party from "partykit/server";

export default class Server implements Party.Server {
    constructor(readonly room: Party.Room) { }

    options: Party.ServerOptions = {
        hibernate: true,
    };

    getConnectionTags(conn: Party.Connection, ctx: Party.ConnectionContext) {

        return [conn.id, ctx.request.cf?.country as any]
    }

    onConnect(conn: Party.Connection, ctx: Party.ConnectionContext): void | Promise<void> {
        console.log(`Connected:, id:${conn.id}, room: ${this.room.id}, url: ${new URL(ctx.request.url).pathname}`);

        this.getConnectionTags(conn, ctx)
    }

    async onRequest(req: Party.Request) {

        return new Response(`${req.cf?.country}`, { status: 200 });
    }

    onMessage(message: string, sender: Party.Connection) {
        // let's log the message
        console.log(`connection ${sender.id} sent message: ${message}`);
        // console.log("tags", this.room.getConnections())
        // for (const british of this.room.getConnections(sender.id)) {
        //   british.send(`Pip-pip!`);
        // }
        // // as well as broadcast it to all the other connections in the room...
        // this.room.broadcast(
        //   `${sender.id}: ${message}`,
        //   // ...except for the connection it came from
        //   [sender.id]
        // );
    }

}