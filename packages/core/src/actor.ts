import { createContext } from "./context";
import { VisibleError } from "./error";

export interface UserActor {
    type: "user";
    properties: {
        accessToken: string;
        userID: string;
        auth?:
        | {
            type: "personal";
            token: string;
        }
        | {
            type: "oauth";
            clientID: string;
        };
    };
}

export interface DeviceActor {
    type: "device";
    properties: {
        teamSlug: string;
        hostname: string;
        auth?:
        | {
            type: "personal";
            token: string;
        }
        | {
            type: "oauth";
            clientID: string;
        };
    };
}

export interface PublicActor {
    type: "public";
    properties: {};
}

type Actor = UserActor | PublicActor | DeviceActor;
export const ActorContext = createContext<Actor>();

export function useCurrentUser() {
    const actor = ActorContext.use();
    if (actor.type === "user") return {
      id:actor.properties.userID,
      token: actor.properties.accessToken
    };
    
    throw new VisibleError(
        "auth",
        "unauthorized",
        `You don't have permission to access this resource`,
    );
}

export function useCurrentDevice() {
    const actor = ActorContext.use();
    if (actor.type === "device") return {
      hostname:actor.properties.hostname,
      teamSlug: actor.properties.teamSlug
    };
    throw new VisibleError(
        "auth",
        "unauthorized",
        `You don't have permission to access this resource`,
    );
}

export function useActor() {
    try {
      return ActorContext.use();
    } catch {
      return { type: "public", properties: {} } as PublicActor;
    }
  }
  
  export function assertActor<T extends Actor["type"]>(type: T) {
    const actor = useActor();
    if (actor.type !== type)
      throw new VisibleError("auth", "actor.invalid", `Actor is not "${type}"`);
    return actor as Extract<Actor, { type: T }>;
  }