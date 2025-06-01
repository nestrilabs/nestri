import { Steam } from "@nestri/core/steam/index";
import { Accessor, createContext, useContext } from "solid-js";

export const SteamContext = createContext<Accessor<Steam.Info>>();

export function useSteam() {
  const context = useContext(SteamContext);
  if (!context) throw new Error("No steam context");
  return context;
}