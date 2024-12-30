import { ulid } from "ulid";

export const prefixes = {
  user: "usr",
  machine: "mchn",
  team: "tm",
  subscription: 'sub',
  product: 'prd',
  productVariant: 'var'
} as const;

export function createID(prefix: keyof typeof prefixes): string {
  return [prefixes[prefix], ulid()].join("_");
}