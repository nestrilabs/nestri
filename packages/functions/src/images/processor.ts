export async function handler(event: any) {
    console.log('Task completion event received:', JSON.stringify(event, null, 2));

    return JSON.stringify({ hello: "world" })
}