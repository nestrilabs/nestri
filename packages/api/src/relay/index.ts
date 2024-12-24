import { Hono } from 'hono'
import { kvCaches } from "@nestri/cache"

const cacheOptions = {
    key: "nexus",
    namespace: "channel-cache"
};

interface Body {
    ip?: string //private address of the relay. IF this does not exist, use the public address instead
}

const middleware = kvCaches(cacheOptions);

const app = new Hono()

// app.get('/', (c) => {
//     return c.text('Hello There! 👋🏾')
// })

app.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404))

// register the channel id here
app.post('/:id', middleware, async (c) => {
    const body = await c.req.json() as Body
    const id = c.req.param("id")
    let ipAddr

    if (body.ip) {
        ipAddr = body.ip
    } else {
        ipAddr = c.req.header('cf-connecting-ip')
    }

    return c.newResponse(JSON.stringify({ ip: ipAddr, channel: id }), 200)
})

export default app