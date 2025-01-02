import { v4 } from "uuid";

export function createID(): string {
  return v4();
}