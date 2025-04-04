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

export const Actor = z.discriminatedUnion("type", [
  MemberActor,
  UserActor,
  PublicActor,
  SystemActor,
]);
export type Actor = z.infer<typeof Actor>;

const ActorContext = createContext<Actor>("actor");

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

export function useTeam() {
  const actor = useActor();
  if ("teamID" in actor.properties) return actor.properties.teamID;
  throw new Error(`Expected actor to have teamID`);
}

/**
 * Asserts that the current user possesses the specified flag.
 *
 * This function executes a database transaction that queries the user table for the current user's flags.
 * If the flags are missing, it throws a {@link VisibleError} with the code {@link ErrorCodes.Validation.MISSING_REQUIRED_FIELD}
 * and a message indicating that the required flag is absent.
 *
 * @param flag - The name of the user flag to verify.
 *
 * @throws {VisibleError} If the user's flag is missing.
 */
export async function assertUserFlag(flag: keyof UserFlags) {
  return useTransaction((tx) =>
    tx
      .select({ flags: userTable.flags })
      .from(userTable)
      .where(eq(userTable.id, useUserID()))
      .then((rows) => {
        const flags = rows[0]?.flags;
        if (!flags)
          throw new VisibleError(
            "not_found",
            ErrorCodes.Validation.MISSING_REQUIRED_FIELD,
            "Actor does not have " + flag + " flag",
          );
      }),
  );
}