import { Team } from "@nestri/core/team/index";
import { Accessor, createContext, useContext } from "solid-js";

export const TeamContext = createContext<Accessor<Team.Info>>();

export function useTeam() {
  const context = useContext(TeamContext);
  if (!context) throw new Error("No team context");
  return context;
}