import type * as Party from "partykit/server";
import app from "./hono"
export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) { }

  onRequest(request: Party.Request): Response | Promise<Response> {

    return app.fetch(request as any, { room: this.room, connections:this.room.getConnections() })
  }

  getConnectionTags(
    conn: Party.Connection,
    ctx: Party.ConnectionContext
  ) {
    console.log("Tagging", conn.id)
    // const country = (ctx.request.cf?.country as string) ?? "unknown";
    // return [country];
    return [conn.id]
    // return ["AF"]
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // A websocket just connected!
    this.getConnectionTags(conn, ctx)

    console.log(
      `Connected:
  id: ${conn.id}
  room: ${this.room.id}
  url: ${new URL(ctx.request.url).pathname}`
    );

    // let's send a message to the connection
    conn.send("hello from server");
  }

  onMessage(message: string, sender: Party.Connection) {
    // let's log the message
    console.log(`connection ${sender.id} sent message: ${message}`);
    // console.log("tags", this.room.getConnections())
    for (const british of this.room.getConnections(sender.id)) {
      british.send(`Pip-pip!`);
    }
    // as well as broadcast it to all the other connections in the room...
    this.room.broadcast(
      `${sender.id}: ${message}`,
      // ...except for the connection it came from
      [sender.id]
    );
  }
}

Server satisfies Party.Worker;
