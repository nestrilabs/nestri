import { z } from "zod";
import { eq } from "./drizzle";
import { VisibleError } from "./error";
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

export function useUserID() {
  const actor = ActorContext.use();
  if (actor.type === "user") return actor.properties.userID;
  throw new VisibleError(
    "unauthorized",
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

export function useMachine() {
  const actor = useActor();
  if ("machineID" in actor.properties) return actor.properties.fingerprint;
  throw new Error(`Expected actor to have fingerprint`);
}

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
            "user.flags",
            "Actor does not have " + flag + " flag",
          );
      }),
  );
}