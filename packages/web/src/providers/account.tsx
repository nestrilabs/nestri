import { createStore } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { ParentProps, createContext, useContext } from "solid-js";

type Context = ReturnType<typeof init>;
const context = createContext<Context>();

function init() {
  const [store, setStore] = makePersisted(
    createStore({
      account: "",
      workspace: "",
      dummy: "",
    })
  );

  return {
    value: store,
    set: setStore,
  };
}

export function StorageProvider(props: ParentProps) {
  const ctx = init();
  return <context.Provider value={ctx}>{props.children}</context.Provider>;
}

export function useStorage() {
  const ctx = useContext(context);
  if (!ctx) {
    throw new Error("No storage context");
  }
  return ctx;
}