import { Hono } from "hono";

const app = new Hono()
app.get("/", (c)=>c.text("Hello there !"))



export default app