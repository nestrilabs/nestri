import type * as Party from "partykit/server";

export interface HonoBindings {
    room: Party.Room;
}

export type WSMessage = {
    type: "START_GAME" | "END_GAME" | "GAME_STATUS";
    sessionID: string;
    payload?: any;
  };