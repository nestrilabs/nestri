import { char, customType, timestamp as rawTs } from "drizzle-orm/pg-core";
import { Token } from "../utils";

export const ulid = (name: string) => char(name, { length: 26 + 4 });

export const id = {
  get id() {
    return ulid("id").primaryKey().notNull();
  },
};

export const teamID = {
  get id() {
    return ulid("id").notNull();
  },
  get teamID() {
    return ulid("team_id").notNull();
  },
};

export const userID = {
  get id() {
    return ulid("id").notNull();
  },
  get userID() {
    return ulid("user_id").notNull();
  },
};

export const utc = (name: string) =>
  rawTs(name, {
    withTimezone: true,
    // mode: "date"
  });

export const encryptedText =
  customType<{ data: string; driverData: string; }>({
    dataType() {
      return 'text';
    },
    fromDriver(val) {
      return Token.decrypt(val);
    },
    toDriver(val) {
      return Token.encrypt(val);
    },
  });

export const timestamps = {
  timeCreated: utc("time_created").notNull().defaultNow(),
  timeUpdated: utc("time_updated").notNull().defaultNow(),
  timeDeleted: utc("time_deleted"),
};