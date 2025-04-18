export const handleGithub = async (accessKey: string) => {
    console.log("acceskey", accessKey)

    const headers = {
        Authorization: `token ${accessKey}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Nestri"
    };

    try {
        const [emails, user] = await Promise.all([
            fetch("https://api.github.com/user/emails", { headers }).then(r => {
                if (!r.ok) throw new Error(`Failed to fetch emails: ${r.status}`);
                return r.json();
            }),
            fetch("https://api.github.com/user", { headers }).then(r => {
                if (!r.ok) throw new Error(`Failed to fetch user: ${r.status}`);
                return r.json();
            })
        ]);

        const primaryEmail = emails.find((email: { primary: boolean }) => email.primary);

        if (!primaryEmail.verified) {
            throw new Error("Email not verified");
        }
        // console.log("raw user", user)

        const { email, primary, verified } = primaryEmail;

        return {
            primary: { email, primary, verified },
            avatar: user.avatar_url,
            username: user.name ?? user.login
        };
    } catch (error) {
        console.error('GitHub OAuth error:', error);
        throw error;
    }
}

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
        // console.log("raw user", user)
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
            username: user.global_name ?? user.username
        };
    } catch (error) {
        console.error('Discord OAuth error:', error);
        throw error;
    }

}