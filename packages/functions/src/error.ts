export class VisibleError extends Error {
    constructor(
      public kind: "input" | "auth",
      public code: string,
      public message: string,
    ) {
      super(message);
    }
  }