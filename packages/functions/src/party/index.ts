import app from "./hono"
import type * as Party from "partykit/server";
import { tryAuthentication } from "./utils";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) { }

  static async onBeforeRequest(req: Party.Request, lobby: Party.Lobby) {
    const docs = new URL(req.url).toString().endsWith("/doc")
    if (docs) {
      return req
    }

    try {
      return await tryAuthentication(req, lobby)
    } catch (e: any) {
      // authentication failed!
      return new Response(e, { status: 401 });
    }
  }

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    try {
      return await tryAuthentication(request, lobby)
    } catch (e: any) {
      // authentication failed!
      return new Response(e, { status: 401 });
    }
  }

  onRequest(req: Party.Request): Response | Promise<Response> {

    return app.fetch(req as any, { room: this.room })
  }

  getConnectionTags(conn: Party.Connection, ctx: Party.ConnectionContext) {

    return [conn.id, ctx.request.cf?.country as any]
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext): void | Promise<void> {
    this.getConnectionTags(conn, ctx)

    console.log(`Connected:, id:${conn.id}, room: ${this.room.id}, url: ${new URL(ctx.request.url).pathname}`);

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
