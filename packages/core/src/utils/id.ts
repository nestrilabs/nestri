import { ulid } from "ulid";

export const prefixes = {
  user: "usr",
  team: "tea",
  task: "tsk",
  machine: "mch",
  member: "mbr",
} as const;

export function createID(prefix: keyof typeof prefixes): string {
  return [prefixes[prefix], ulid()].join("_");
}