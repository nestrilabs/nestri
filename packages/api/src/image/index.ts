import { Hono } from 'hono'
import { cors } from 'hono/cors';
import Cover from './cover'
import Avatar from './avatar'
import Banner from './banner'

const app = new Hono()

app.get('/', (c) => {
    return c.text('Hello There! 👋🏾')
})

app.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404))

app.use(
    '/*',
    cors({
        origin: (origin, c) => {
            const allowedOriginPatterns = [
                /^https:\/\/.*\.nestri\.pages\.dev$/,
                /^https:\/\/.*\.nestri\.io$/,
                /^http:\/\/localhost:\d+$/ // For local development
            ];

            return allowedOriginPatterns.some(pattern => pattern.test(origin))
                ? origin
                : 'https://nexus.nestri.io'
        },
    })
)

app.route('/cover', Cover)

app.route('/avatar', Avatar)

app.route("/banner", Banner)

export default app
