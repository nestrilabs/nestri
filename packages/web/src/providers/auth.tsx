import { type Team } from "@nestri/core/team/index";
import { makePersisted } from "@solid-primitives/storage";
import { useLocation, useNavigate } from "@solidjs/router";
import { createClient } from "@openauthjs/openauth/client";
import { createInitializedContext } from "../common/context";
import { createEffect, createMemo, onMount } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";

interface AccountInfo {
  id: string;
  email: string;
  name: string;
  access: string;
  refresh: string;
  avatarUrl: string;
  teams: Team.Info[];
  discriminator: number;
  polarCustomerID: string | null;
}

interface Storage {
  accounts: Record<string, AccountInfo>;
  current?: string;
}

export const client = createClient({
  issuer: import.meta.env.VITE_AUTH_URL,
  clientID: "web",
});

export const { use: useAuth, provider: AuthProvider } =
  createInitializedContext("AuthContext", () => {
    const [store, setStore] = makePersisted(
      createStore<Storage>({
        accounts: {},
      }),
      {
        name: "radiant.auth",
      },
    );
    const location = useLocation();
    const params = createMemo(
      () => new URLSearchParams(location.hash.substring(1)),
    );
    const accessToken = createMemo(() => params().get("access_token"));
    const refreshToken = createMemo(() => params().get("refresh_token"));


    createEffect(async () => {
      // if (!result.current && Object.keys(store.accounts).length) {
      //   result.switch(Object.keys(store.accounts)[0])
      //   navigate("/")
      // }
    })

    createEffect(async () => {
      if (accessToken()) return;
      if (Object.keys(store.accounts).length) return;
      const redirect = await client.authorize(window.location.origin, "token");
      window.location.href = redirect.url
    });

    createEffect(async () => {
      const current = store.current;
      const accounts = store.accounts;
      if (!current) return;
      const match = accounts[current];
      if (match) return;
      const keys = Object.keys(accounts);
      if (keys.length) {
        setStore("current", keys[0]);
        navigate("/");
        return
      }
      const redirect = await client.authorize(window.location.origin, "token");
      window.location.href = redirect.url
    });

    async function refresh() {
      for (const account of [...Object.values(store.accounts)]) {
        if (!account.refresh) continue;
        const result = await client.refresh(account.refresh, {
          access: account.access,
        })
        if (result.err) {
          if ("id" in account)
            setStore(produce((state) => {
              delete state.accounts[account.id];
            }))
          continue
        };
        const tokens = result.tokens || {
          access: account.access,
          refresh: account.refresh,
        }
        fetch(import.meta.env.VITE_API_URL + "/account", {
          headers: {
            authorization: `Bearer ${tokens.access}`,
          },
        }).then(async (response) => {
          await new Promise((resolve) => setTimeout(resolve, 5000));

          if (response.ok) {
            const info = await response.json();
            setStore(
              "accounts",
              info.id,
              reconcile({
                ...info,
                ...tokens,
              }),
            );
          }

          if (!response.ok)
            setStore(
              produce((state) => {
                delete state.accounts[account.id];
              }),
            );
        })
      }
    }

    onMount(async () => {
      if (refreshToken() && accessToken()) {
        const result = await fetch(import.meta.env.VITE_API_URL + "/account", {
          headers: {
            authorization: `Bearer ${accessToken()}`,
          },
        }).catch(() => { })
        if (result?.ok) {
          const info = await result.json();
          setStore(
            "accounts",
            info.id,
            reconcile({
              ...info,
              access: accessToken(),
              refresh: refreshToken(),
            }),
          );
          setStore("current", info.id);
        }
        window.location.hash = "";
      }

      await refresh();
    })


    const navigate = useNavigate();

    // const bar = useCommandBar()

    // bar.register("auth", async () => {
    //   return [
    //     {
    //       category: "Account",
    //       title: "Logout",
    //       icon: IconLogout,
    //       run: async (bar) => {
    //         result.logout();
    //         setStore("current", undefined);
    //         navigate("/");
    //         bar.hide()
    //       },
    //     },
    //     {
    //       category: "Add Account",
    //       title: "Add Account",
    //       icon: IconUserAdd,
    //       run: async () => {
    //         const redir = await client.authorize(window.location.origin, "token");
    //         window.location.href = redir.url
    //         bar.hide()
    //       },
    //     },
    //     ...result.all()
    //       .filter((item) => item.id !== result.current.id)
    //       .map((item) => ({
    //         category: "Account",
    //         title: "Switch to " + item.email,
    //         icon: IconUser,
    //         run: async () => {
    //           result.switch(item.id);
    //           navigate("/");
    //           bar.hide()
    //         },
    //       })),
    //   ]
    // })

    const result = {
      get current() {
        return store.accounts[store.current!]!;
      },
      switch(accountID: string) {
        setStore("current", accountID);
      },
      all() {
        return Object.values(store.accounts);
      },
      refresh,
      logout() {
        setStore(
          produce((state) => {
            if (!state.current) return;
            delete state.accounts[state.current];
            state.current = Object.keys(state.accounts)[0];
          }),
        );
      },
      get ready() {
        return Boolean(!accessToken() && store.current);
      },
    };
    return result;
  });