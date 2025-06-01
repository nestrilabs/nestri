import { Log } from "./utils";
import { createContext } from "./context";
import { ErrorCodes, VisibleError } from "./error";

export namespace Actor {

  export interface User {
    type: "user";
    properties: {
      userID: string;
      email: string;
    };
  }
  
  export interface Steam {
    type: "steam";
    properties: {
      steamID: string;
    };
  }

  export interface Machine {
    type: "machine";
    properties: {
      machineID: string;
      fingerprint: string;
    };
  }

  export interface Token {
    type: "member";
    properties: {
      userID: string;
      steamID: string;
    };
  }

  export interface Public {
    type: "public";
    properties: {};
  }

  export type Info = User | Public | Token | Machine | Steam;

  export const Context = createContext<Info>();

  export function userID() {
    const actor = Context.use();
    if ("userID" in actor.properties) return actor.properties.userID;
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      `You don't have permission to access this resource.`,
    );
  }

  export function steamID() {
    const actor = Context.use();
    if ("steamID" in actor.properties) return actor.properties.steamID;
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      `You don't have permission to access this resource.`,
    );
  }

  export function user() {
    const actor = Context.use();
    if (actor.type == "user") return actor.properties;
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      `You don't have permission to access this resource.`,
    );
  }

  export function teamID() {
    const actor = Context.use();
    if ("teamID" in actor.properties) return actor.properties.teamID;
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      `You don't have permission to access this resource.`,
    );
  }

  export function fingerprint() {
    const actor = Context.use();
    if ("fingerprint" in actor.properties) return actor.properties.fingerprint;
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      `You don't have permission to access this resource.`,
    );
  }

  export function use() {
    try {
      return Context.use();
    } catch {
      return { type: "public", properties: {} } as Public;
    }
  }

  export function assert<T extends Info["type"]>(type: T) {
    const actor = use();
    if (actor.type !== type)
      throw new VisibleError(
        "authentication",
        ErrorCodes.Authentication.UNAUTHORIZED,
        `Actor is not "${type}"`,
      );
    return actor as Extract<Info, { type: T }>;
  }

  export function provide<
    T extends Info["type"],
    Next extends (...args: any) => any,
  >(type: T, properties: Extract<Info, { type: T }>["properties"], fn: Next) {
    return Context.provide({ type, properties } as any, () =>
      Log.provide(
        {
          actor: type,
          ...properties,
        },
        fn,
      ),
    );
  }
}