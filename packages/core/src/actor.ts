import { z } from "zod";
import { eq } from "./drizzle";
import { ErrorCodes, VisibleError } from "./error";
import { createContext } from "./context";
import { UserFlags, userTable } from "./user/user.sql";
import { useTransaction } from "./drizzle/transaction";

export const PublicActor = z.object({
  type: z.literal("public"),
  properties: z.object({}),
});
export type PublicActor = z.infer<typeof PublicActor>;

export const UserActor = z.object({
  type: z.literal("user"),
  properties: z.object({
    userID: z.string(),
    email: z.string().nonempty(),
  }),
});
export type UserActor = z.infer<typeof UserActor>;

export const MemberActor = z.object({
  type: z.literal("member"),
  properties: z.object({
    memberID: z.string(),
    teamID: z.string(),
  }),
});
export type MemberActor = z.infer<typeof MemberActor>;

export const SystemActor = z.object({
  type: z.literal("system"),
  properties: z.object({
    teamID: z.string(),
  }),
});
export type SystemActor = z.infer<typeof SystemActor>;

export const MachineActor = z.object({
  type: z.literal("machine"),
  properties: z.object({
    fingerprint: z.string(),
    machineID: z.string(),
  }),
});
export type MachineActor = z.infer<typeof MachineActor>;

export const Actor = z.discriminatedUnion("type", [
  MemberActor,
  UserActor,
  PublicActor,
  SystemActor,
  MachineActor
]);
export type Actor = z.infer<typeof Actor>;

export const ActorContext = createContext<Actor>("actor");

export const useActor = ActorContext.use;
export const withActor = ActorContext.with;

/**
 * Retrieves the user ID of the current actor.
 *
 * This function accesses the actor context and returns the `userID` if the current
 * actor is of type "user". If the actor is not a user, it throws a `VisibleError`
 * with an authentication error code, indicating that the caller is not authorized
 * to access user-specific resources.
 *
 * @throws {VisibleError} When the current actor is not of type "user".
 */
export function useUserID() {
  const actor = ActorContext.use();
  if (actor.type === "user") return actor.properties.userID;
  throw new VisibleError(
    "authentication",
    ErrorCodes.Authentication.UNAUTHORIZED,
    `You don't have permission to access this resource`,
  );
}

/**
 * Retrieves the properties of the current user actor.
 *
 * This function obtains the current actor from the context and returns its properties if the actor is identified as a user.
 * If the actor is not of type "user", it throws a {@link VisibleError} with an authentication error code,
 * indicating that the user is not authorized to access user-specific resources.
 *
 * @returns The properties of the current user actor, typically including user-specific details such as userID and email.
 * @throws {VisibleError} If the current actor is not a user.
 */
export function useUser() {
  const actor = ActorContext.use();
  if (actor.type === "user") return actor.properties;
  throw new VisibleError(
    "authentication",
    ErrorCodes.Authentication.UNAUTHORIZED,
    `You don't have permission to access this resource`,
  );
}

export function assertActor<T extends Actor["type"]>(type: T) {
  const actor = useActor();
  if (actor.type !== type) {
    throw new Error(`Expected actor type ${type}, got ${actor.type}`);
  }

  return actor as Extract<Actor, { type: T }>;
}

/**
 * Returns the current actor's team ID.
 *
 * @returns The team ID associated with the current actor.
 * @throws {VisibleError} If the current actor does not have a {@link teamID} property.
 */
export function useTeam() {
  const actor = useActor();
  if ("teamID" in actor.properties) return actor.properties.teamID;
  throw new VisibleError(
    "authentication",
    ErrorCodes.Authentication.UNAUTHORIZED,
    `Expected actor to have teamID`
  );
}

/**
 * Returns the fingerprint of the current actor if the actor has a machine identity.
 *
 * @returns The fingerprint of the current machine actor.
 * @throws {VisibleError} If the current actor does not have a machine identity.
 */
export function useMachine() {
  const actor = useActor();
  if ("machineID" in actor.properties) return actor.properties.fingerprint;
  throw new VisibleError(
    "authentication",
    ErrorCodes.Authentication.UNAUTHORIZED,
    `Expected actor to have fingerprint`
  );
}