/** @jsxImportSource hono/jsx */
import {
  type PasswordChangeError,
  type PasswordConfig,
  type PasswordLoginError,
  type PasswordRegisterError,
} from "../adapters"
// import { Layout } from "@openauthjs/openauth/ui/base"
import { Layout } from "./base"
import "@openauthjs/openauth/ui/form"
// import { FormAlert } from "@openauthjs/openauth/ui/form"

const DEFAULT_COPY = {
  error_email_taken: "There is already an account with this email.",
  error_username_taken: "There is already an account with this username.",
  error_invalid_code: "Code is incorrect.",
  error_invalid_email: "Email is not valid.",
  error_invalid_password: "Password is incorrect.",
  error_invalid_username: "Username can only contain letters.",
  error_password_mismatch: "Passwords do not match.",
  register_title: "Welcome to the app",
  register_description: "Sign in with your email",
  login_title: "Welcome to the app",
  login_description: "Sign in with your email",
  register: "Register",
  register_prompt: "Don't have an account?",
  login_prompt: "Already have an account?",
  login: "Login",
  change_prompt: "Forgot your password?",
  change: "Well that sucks",
  code_resend: "Resend code",
  code_return: "Back to",
  logo: "A",
  input_email: "john@doe.com",
  input_password: "●●●●●●●●●●●",
  input_code: "●●●●●●",
  input_username: "john",
  input_repeat: "●●●●●●●●●●●",
  button_continue: "Continue",
} satisfies {
  [key in `error_${| PasswordLoginError["type"]
  | PasswordRegisterError["type"]
  | PasswordChangeError["type"]}`]: string
} & Record<string, string>

export type PasswordUICopy = typeof DEFAULT_COPY

export interface PasswordUIOptions {
  sendCode: PasswordConfig["sendCode"]
  copy?: Partial<PasswordUICopy>
}

export function PasswordUI(input: PasswordUIOptions) {
  const copy = {
    ...DEFAULT_COPY,
    ...input.copy,
  }
  return {
    sendCode: input.sendCode,
    login: async (_req, form, error): Promise<Response> => {
      const emailError = ["invalid_email", "email_taken"].includes(
        error?.type || "",
      )
      const passwordError = ["invalid_password", "password_mismatch"].includes(
        error?.type || "",
      )
      const jsx = (
        <Layout page="password">
          <div data-component="form-header">
            <h1>Login</h1>
            <span>
              {copy.register_prompt}{" "}
              <a data-component="link" href="register">
                {copy.register}
              </a>
            </span>
            <hr />
          </div>
          <form data-component="form" method="post">
            {/* <FormAlert message={error?.type && copy?.[`error_${error.type}`]} /> */}
            <div
              data-component="input-container"
            >
              <span>Email</span>
              <div data-error={emailError} data-component="input-wrapper">
                <span data-component="input-icon">
                  <svg width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="currentColor">
                    <path d="M7 9l5 3.5L17 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    </path>
                    <path d="M2 17V7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.5">
                    </path>
                  </svg>
                </span>
                <input
                  data-component="input"
                  type="email"
                  name="email"
                  required
                  placeholder={copy.input_email}
                  autofocus={!error}
                  value={form?.get("email")?.toString()}
                />
              </div>
              <small>{error?.type && emailError && copy?.[`error_${error.type}`]}</small>
            </div>
            <div
              data-component="input-container"
            >
              <span>Password</span>
              <div data-error={passwordError} data-component="input-wrapper">
                <span data-component="input-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="M12 16.5v-2m-7.732 4.345c.225 1.67 1.608 2.979 3.292 3.056c1.416.065 2.855.099 4.44.099s3.024-.034 4.44-.1c1.684-.076 3.067-1.385 3.292-3.055c.147-1.09.268-2.207.268-3.345s-.121-2.255-.268-3.345c-.225-1.67-1.608-2.979-3.292-3.056A95 95 0 0 0 12 9c-1.585 0-3.024.034-4.44.1c-1.684.076-3.067 1.385-3.292 3.055C4.12 13.245 4 14.362 4 15.5s.121 2.255.268 3.345" /><path d="M7.5 9V6.5a4.5 4.5 0 0 1 9 0V9" /></g></svg>
                </span>
                <input
                  data-component="input"
                  autofocus={error?.type === "invalid_password"}
                  required
                  type="password"
                  name="password"
                  placeholder={copy.input_password}
                  autoComplete="current-password"
                />
              </div>
              <small>{error?.type && passwordError && copy?.[`error_${error.type}`]}</small>
            </div>
            <button data-component="button">
              <div data-component="spinner">
                <div>
                  {new Array(12).fill(0).map((i, k) => (
                    <div key={k} />
                  ))}
                </div>
              </div>
              {copy.button_continue}
            </button>
            <div style={{ padding: "2px 0" }} data-component="form-header">
              <hr />
              <span>
                {copy.change_prompt}{" "}
                <a data-component="link" href="change">
                  {copy.change}
                </a>
              </span>
            </div>
          </form>
        </Layout>
      )
      return new Response(jsx.toString(), {
        status: error ? 401 : 200,
        headers: {
          "Content-Type": "text/html",
        },
      })
    },
    register: async (_req, state, form, error): Promise<Response> => {
      const emailError = ["invalid_email", "email_taken"].includes(
        error?.type || "",
      )
      const passwordError = ["invalid_password", "password_mismatch"].includes(
        error?.type || "",
      )

      //Just in case the server does it
      const codeError = ["invalid_code"].includes(
        error?.type || "",
      )

      const usernameError = ["invalid_username", "username_taken"].includes(
        error?.type || "",
      );

      const jsx = (
        <Layout page="password">
          <div data-component="form-header">
            <h1>Register</h1>
            <span>
              {copy.login_prompt}{" "}
              <a data-component="link" href="authorize">
                {copy.login}
              </a>
            </span>
            <hr></hr>
          </div>
          <form data-component="form" method="post">
            {/* <FormAlert message={error?.type && copy?.[`error_${error.type}`]} /> */}
            {state.type === "start" && (
              <>
                <input type="hidden" name="action" value="register" />
                <div
                  data-component="input-container"
                >
                  <span>Email</span>
                  <div data-error={emailError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="currentColor">
                        <path d="M7 9l5 3.5L17 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        </path>
                        <path d="M2 17V7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.5">
                        </path>
                      </svg>
                    </span>
                    <input
                      data-component="input"
                      autofocus={!error || emailError}
                      type="email"
                      name="email"
                      value={!emailError ? form?.get("email")?.toString() : ""}
                      required
                      placeholder={copy.input_email}
                    />
                  </div>
                  <small>{error?.type && emailError && copy?.[`error_${error.type}`]}</small>
                </div>
                <div
                  data-component="input-container"
                >
                  <span>Username</span>
                  <div data-error={usernameError} data-component="input-wrapper">
                    <span id="username-icon" data-component="input-icon">
                      <svg width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M4.271 18.346S6.5 15.5 12 15.5s7.73 2.846 7.73 2.846M12 12a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    </span>
                    <input
                      id="username"
                      data-component="input"
                      autofocus={usernameError}
                      type="text"
                      name="username"
                      placeholder={copy.input_username}
                      required
                      value={
                        !usernameError ? form?.get("username")?.toString() : ""
                      }
                    />
                  </div>
                  <small>{error?.type && usernameError && copy?.[`error_${error.type}`]}</small>
                </div>
                <div
                  data-component="input-container"
                >
                  <span>Password</span>
                  <div data-error={passwordError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="M12 16.5v-2m-7.732 4.345c.225 1.67 1.608 2.979 3.292 3.056c1.416.065 2.855.099 4.44.099s3.024-.034 4.44-.1c1.684-.076 3.067-1.385 3.292-3.055c.147-1.09.268-2.207.268-3.345s-.121-2.255-.268-3.345c-.225-1.67-1.608-2.979-3.292-3.056A95 95 0 0 0 12 9c-1.585 0-3.024.034-4.44.1c-1.684.076-3.067 1.385-3.292 3.055C4.12 13.245 4 14.362 4 15.5s.121 2.255.268 3.345" /><path d="M7.5 9V6.5a4.5 4.5 0 0 1 9 0V9" /></g></svg>
                    </span>
                    <input
                      data-component="input"
                      id="password"
                      autofocus={passwordError}
                      type="password"
                      name="password"
                      placeholder={copy.input_password}
                      required
                      value={
                        !passwordError ? form?.get("password")?.toString() : ""
                      }
                      autoComplete="new-password"
                    />
                  </div>
                  <small>{error?.type && passwordError && copy?.[`error_${error.type}`]}</small>
                </div>
                <button data-component="button">
                  <div data-component="spinner">
                    <div>
                      {new Array(12).fill(0).map((i, k) => (
                        <div key={k} />
                      ))}
                    </div>
                  </div>
                  {copy.button_continue}
                </button>
              </>
            )}

            {state.type === "code" && (
              <>
                <input type="hidden" name="action" value="verify" />
                <div
                  data-component="input-container"
                >
                  <span>Code</span>
                  <div data-error={codeError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M2.43 8.25a1 1 0 0 1 1-1h.952c1.063 0 1.952.853 1.952 1.938v6.562a1 1 0 1 1-2 0v-6.5H3.43a1 1 0 0 1-1-1m5.714 0a1 1 0 0 1 1-1h2.857c1.064 0 1.953.853 1.953 1.938v1.874A1.945 1.945 0 0 1 12 13h-1.857v1.75h2.81a1 1 0 1 1 0 2h-2.858a1.945 1.945 0 0 1-1.952-1.937v-1.876c0-1.084.889-1.937 1.952-1.937h1.858V9.25h-2.81a1 1 0 0 1-1-1m7.619 0a1 1 0 0 1 1-1h2.857c1.063 0 1.953.853 1.953 1.938v5.624a1.945 1.945 0 0 1-1.953 1.938h-2.857a1 1 0 1 1 0-2h2.81V13h-2.81a1 1 0 1 1 0-2h2.81V9.25h-2.81a1 1 0 0 1-1-1" clip-rule="evenodd" /></svg>
                    </span>
                    <input
                      data-component="input"
                      autofocus
                      name="code"
                      minLength={6}
                      maxLength={6}
                      required
                      placeholder={copy.input_code}
                      autoComplete="one-time-code"
                    />
                  </div>
                  <small>{error?.type && codeError && copy?.[`error_${error.type}`]}</small>
                </div>
                <button data-component="button">
                  <div data-component="spinner">
                    <div>
                      {new Array(12).fill(0).map((i, k) => (
                        <div key={k} />
                      ))}
                    </div>
                  </div>
                  {copy.button_continue}
                </button>
              </>
            )}
          </form>
        </Layout>
      ) as string
      return new Response(jsx.toString(), {
        headers: {
          "Content-Type": "text/html",
        },
      })
    },
    change: async (_req, state, form, error): Promise<Response> => {
      const passwordError = ["invalid_password", "password_mismatch"].includes(
        error?.type || "",
      )

      const emailError = ["invalid_email", "email_taken"].includes(
        error?.type || "",
      )

      const codeError = ["invalid_code"].includes(
        error?.type || "",
      )

      const jsx = (
        <Layout page="password">
          <div data-component="form-header">
            <h1>Forgot Password</h1>
            {state.type != "update" && (
              <span>
                Suddenly had an epiphany?{" "}
                <a data-component="link" href="authorize">
                  {copy.login}
                </a>
              </span>
            )}
            <hr />
          </div>
          <form data-component="form" method="post" replace>
            {/* <FormAlert message={error?.type && copy?.[`error_${error.type}`]} /> */}
            {state.type === "start" && (
              <>
                <input type="hidden" name="action" value="code" />
                <div
                  data-component="input-container"
                >
                  <span>Email</span>
                  <div data-error={emailError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="currentColor">
                        <path d="M7 9l5 3.5L17 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        </path>
                        <path d="M2 17V7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.5">
                        </path>
                      </svg>
                    </span>
                    <input
                      data-component="input"
                      autofocus
                      type="email"
                      name="email"
                      required
                      value={form?.get("email")?.toString()}
                      placeholder={copy.input_email}
                    />
                  </div>
                  <small>{error?.type && emailError && copy?.[`error_${error.type}`]}</small>
                </div>
              </>
            )}
            {state.type === "code" && (
              <>
                <input type="hidden" name="action" value="verify" />
                <div
                  data-component="input-container"
                >
                  <span>Code</span>
                  <div data-error={codeError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M2.43 8.25a1 1 0 0 1 1-1h.952c1.063 0 1.952.853 1.952 1.938v6.562a1 1 0 1 1-2 0v-6.5H3.43a1 1 0 0 1-1-1m5.714 0a1 1 0 0 1 1-1h2.857c1.064 0 1.953.853 1.953 1.938v1.874A1.945 1.945 0 0 1 12 13h-1.857v1.75h2.81a1 1 0 1 1 0 2h-2.858a1.945 1.945 0 0 1-1.952-1.937v-1.876c0-1.084.889-1.937 1.952-1.937h1.858V9.25h-2.81a1 1 0 0 1-1-1m7.619 0a1 1 0 0 1 1-1h2.857c1.063 0 1.953.853 1.953 1.938v5.624a1.945 1.945 0 0 1-1.953 1.938h-2.857a1 1 0 1 1 0-2h2.81V13h-2.81a1 1 0 1 1 0-2h2.81V9.25h-2.81a1 1 0 0 1-1-1" clip-rule="evenodd" /></svg>
                    </span>
                    <input
                      data-component="input"
                      autofocus
                      name="code"
                      minLength={6}
                      maxLength={6}
                      required
                      placeholder={copy.input_code}
                      autoComplete="one-time-code"
                    />
                  </div>
                  <small>{error?.type && codeError && copy?.[`error_${error.type}`]}</small>
                </div>
              </>
            )}
            {state.type === "update" && (
              <>
                <input type="hidden" name="action" value="update" />
                <div
                  data-component="input-container"
                >
                  <span>Password</span>
                  <div data-error={passwordError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="M12 16.5v-2m-7.732 4.345c.225 1.67 1.608 2.979 3.292 3.056c1.416.065 2.855.099 4.44.099s3.024-.034 4.44-.1c1.684-.076 3.067-1.385 3.292-3.055c.147-1.09.268-2.207.268-3.345s-.121-2.255-.268-3.345c-.225-1.67-1.608-2.979-3.292-3.056A95 95 0 0 0 12 9c-1.585 0-3.024.034-4.44.1c-1.684.076-3.067 1.385-3.292 3.055C4.12 13.245 4 14.362 4 15.5s.121 2.255.268 3.345" /><path d="M7.5 9V6.5a4.5 4.5 0 0 1 9 0V9" /></g></svg>
                    </span>
                    <input
                      data-component="input"
                      autofocus
                      type="password"
                      name="password"
                      placeholder={copy.input_password}
                      required
                      value={
                        !passwordError ? form?.get("password")?.toString() : ""
                      }
                      autoComplete="new-password"
                    />
                  </div>
                  <small>{error?.type && passwordError && copy?.[`error_${error.type}`]}</small>
                </div>
                <div
                  data-component="input-container"
                >
                  <span>Confirm Password</span>
                  <div data-error={passwordError} data-component="input-wrapper">
                    <span data-component="input-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="M12 16.5v-2m-7.732 4.345c.225 1.67 1.608 2.979 3.292 3.056c1.416.065 2.855.099 4.44.099s3.024-.034 4.44-.1c1.684-.076 3.067-1.385 3.292-3.055c.147-1.09.268-2.207.268-3.345s-.121-2.255-.268-3.345c-.225-1.67-1.608-2.979-3.292-3.056A95 95 0 0 0 12 9c-1.585 0-3.024.034-4.44.1c-1.684.076-3.067 1.385-3.292 3.055C4.12 13.245 4 14.362 4 15.5s.121 2.255.268 3.345" /><path d="M7.5 9V6.5a4.5 4.5 0 0 1 9 0V9" /></g></svg>
                    </span>
                    <input
                      data-component="input"
                      type="password"
                      name="repeat"
                      required
                      value={
                        !passwordError ? form?.get("password")?.toString() : ""
                      }
                      placeholder={copy.input_repeat}
                      autoComplete="new-password"
                    />
                  </div>
                  <small>{error?.type && passwordError && copy?.[`error_${error.type}`]}</small>
                </div>
              </>
            )}
            <button data-component="button">
              <div data-component="spinner">
                <div>
                  {new Array(12).fill(0).map((i, k) => (
                    <div key={k} />
                  ))}
                </div>
              </div>
              {copy.button_continue}
            </button>
          </form>
          {state.type === "code" && (
            <form method="post">
              <input type="hidden" name="action" value="code" />
              <input type="hidden" name="email" value={state.email} />
            </form>
          )}
        </Layout>
      )
      return new Response(jsx.toString(), {
        status: error ? 400 : 200,
        headers: {
          "Content-Type": "text/html",
        },
      })
    },
  } satisfies PasswordConfig
}
