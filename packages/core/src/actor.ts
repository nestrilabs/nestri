import { z } from "zod";
import { createContext } from "./context";

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
    userID: z.string(),
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