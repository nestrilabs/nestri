import { ulid } from "ulid";

export const prefixes = {
  user: "usr",
  credentials:"crd",
  team: "tem",
  product: "prd",
  session: "ses",
  machine: "mch",
  member: "mbr",
  variant: "var",
  gpu: "gpu",
  game: "gme",
  usage: "usg",
  subscription: "sub",
  // task: "tsk",
  // invite: "inv",
  // product: "prd",
} as const;

/**
 * Generates a unique identifier by concatenating a predefined prefix with a ULID.
 *
 * Given a key from the predefined prefixes mapping (e.g., "user", "team", "member", "steam"),
 * this function retrieves the corresponding prefix and combines it with a ULID using an underscore
 * as a separator. The resulting identifier is formatted as "prefix_ulid".
 *
 * @param prefix - A key from the prefixes mapping.
 * @returns A unique identifier string.
 */
export function createID(prefix: keyof typeof prefixes): string {
  return [prefixes[prefix], ulid()].join("_");
}