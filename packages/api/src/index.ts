import { Hono } from 'hono'
import Image from "./image"
import Relay from "./relay"

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello There! 👋🏾')
})

app.get('/favicon.ico', (c) => {
  return c.newResponse(null, 302, {
    Location: 'https://nestri.pages.dev/favicon.svg'
  })
})

app.route("/image", Image)

app.route("/relay", Relay)

export default app