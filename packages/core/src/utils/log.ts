import { createContext } from "../context";

export namespace Log {
  const ctx = createContext<{
    tags: Record<string, any>;
  }>();

  export function create(tags?: Record<string, any>) {
    tags = tags || {};

    const result = {
      info(msg: string, extra?: Record<string, any>) {
        const prefix = Object.entries({
          ...use().tags,
          ...tags,
          ...extra,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
        console.log(prefix, msg);
        return result;
      },
      warn(msg: string, extra?: Record<string, any>) {
        const prefix = Object.entries({
          ...use().tags,
          ...tags,
          ...extra,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
        console.warn(prefix, msg);
        return result;
      },
      error(error: Error) {
        const prefix = Object.entries({
          ...use().tags,
          ...tags,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
        console.error(prefix, error);
        return result;
      },
      tag(key: string, value: string) {
         // Immutable update: return a fresh logger with updated tags
        return Log.create({ ...tags, [key]: value });
      },
      clone() {
        return Log.create({ ...tags });
      },
    };

    return result;
  }

  export function provide<R>(tags: Record<string, any>, cb: () => R) {
    const existing = use();
    return ctx.provide(
      {
        tags: {
          ...existing.tags,
          ...tags,
        },
      },
      cb,
    );
  }

  function use() {
    try {
      return ctx.use();
    } catch (e) {
      return { tags: {} };
    }
  }
}