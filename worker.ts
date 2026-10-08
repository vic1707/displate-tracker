export default {
    async scheduled(_controller: unknown, env: { GITHUB_TOKEN: string }) {
        if (!env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN Worker secret");
        const response = await fetch(
            "https://api.github.com/repos/vic1707/displate-tracker/actions/workflows/daily.yml/dispatches",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                    Accept: "application/vnd.github+json",
                    "Content-Type": "application/json",
                    "User-Agent": "displate-tracker-cron",
                    "X-GitHub-Api-Version": "2026-03-10",
                },
                body: JSON.stringify({ ref: "main" }),
            },
        );
        if (!response.ok) throw new Error(`GitHub workflow dispatch failed: HTTP ${response.status}`);
        console.log("Dispatched daily.yml on main");
    },
};
