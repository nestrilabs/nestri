import fetch from "node-fetch";

export const handleGithub = async (accessKey: string) => {
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
            username: user.name ?? user.login,
        };
    } catch (error) {
        console.error('GitHub OAuth error:', error);
        throw error;
    }
}