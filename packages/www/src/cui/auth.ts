import { createClient } from '@openauthjs/openauth/client'

const authUrl = document
  .querySelector('meta[property="auth-url"]')!
  .getAttribute('content')!

export const client = createClient({
  clientID: 'www',
  issuer: authUrl,
})

let accessToken: string | undefined = undefined

export let initialized = false

export async function init() {
  initialized = true
  return getToken()
}

export async function getToken() {
  if (!initialized) return

  const refresh = localStorage.getItem('refresh')
  if (!refresh) return

  const next = await client.refresh(refresh, {
    access: accessToken,
  })
  if (next.err) return
  if (!next.tokens) return accessToken

  localStorage.setItem('refresh', next.tokens.refresh)
  accessToken = next.tokens.access
  return next.tokens.access
}

export async function login() {
  const token = await getToken()
  if (!token) {
    const { challenge, url } = await client.authorize(location.origin, 'code', {
      pkce: true,
    })
    sessionStorage.setItem('challenge', JSON.stringify(challenge))
    window.location.href = url
  }
}

export function logout() {
  localStorage.removeItem('refresh')
  accessToken = undefined
  // window.location.replace('/')
}

export async function callback(code: string, state: string) {
  const challengeStr = sessionStorage.getItem('challenge')
  if (!challengeStr) return

  const challenge = JSON.parse(challengeStr)
  if (code) {
    if (state === challenge.state && challenge.verifier) {
      const exchanged = await client.exchange(
        code,
        location.origin,
        challenge.verifier,
      )
      if (!exchanged.err && exchanged.tokens) {
        accessToken = exchanged.tokens.access
        localStorage.setItem('refresh', exchanged.tokens.refresh)
      }
    }
    window.location.replace('/')
  }
}