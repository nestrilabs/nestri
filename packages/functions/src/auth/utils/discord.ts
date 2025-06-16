import fetch from "node-fetch"

export const handleDiscord = async (accessKey: string) => {
    try {
        const response = await fetch("https://discord.com/api/v10/users/@me", {
            headers: {
                Authorization: `Bearer ${accessKey}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }

        const user = await response.json();

        if (!user.verified) {
            throw new Error("Email not verified");
        }

        return {
            primary: {
                email: user.email,
                verified: user.verified,
                primary: true
            },
            avatar: user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                : null,
            username: user.global_name ?? user.username,
        };
    } catch (error) {
        console.error('Discord OAuth error:', error);
        throw error;
    }

}