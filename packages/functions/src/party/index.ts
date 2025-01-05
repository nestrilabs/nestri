import app from "./hono"
import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) { }


  onRequest(req: Party.Request): Response | Promise<Response> {
    try {
      const docs = new URL(req.url).toString().endsWith("/doc")

      if(docs){
        return app.fetch(req as any, { room: this.room })
      }

      const authHeader = req.headers.get("authorization") ?? new URL(req.url).searchParams.get("authorization")
      if (authHeader) {
        const match = authHeader.match(/^Bearer (.+)$/);
        
        if (!match || !match[1]) {
          throw new Error("Bearer token not found or improperly formatted");
        }

        const bearerToken = match[1];

        if (bearerToken !== this.room.env.AUTH_FINGERPRINT) {
          throw new Error("Invalid authorization token");
        }

        return app.fetch(req as any, { room: this.room })
      }
      throw new Error("You are not authorized to be here")
    } catch (e: any) {
      // authentication failed!
      return new Response(e, { status: 401 });
    }

  }

  getConnectionTags(
    conn: Party.Connection,
    ctx: Party.ConnectionContext
  ) {

    return [conn.id]
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
    // conn.send("hello from server");
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

Server satisfies Party.Worker;
