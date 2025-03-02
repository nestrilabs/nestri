import { theme } from "./theme";

export const utility = {
  textLine() {
    return {
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
    } as any;
  },
  stack(space: keyof (typeof theme)["space"]) {
    return {
      display: "flex",
      flexDirection: "column",
      gap: theme.space[space],
    } as any;
  },
  row(space: keyof (typeof theme)["space"]) {
    return {
      display: "flex",
      gap: theme.space[space],
    } as any;
  },

  text: {
    line: {
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
    } as any,
    label: {
      fontWeight: 500,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      fontFamily: theme.font.family.code,
    } as any,
    pre: {
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    } as any,
  },
};