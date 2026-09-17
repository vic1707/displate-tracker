import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("failed daily captures retain the received HTML without masking the failure", async () => {
	const directory = await mkdtemp(join(tmpdir(), "displate-daily-"));
	try {
		for (const status of [200, 503]) {
			const html = "<title>Unexpected Displate page</title>";
			const dump = join(directory, `${status}.html`);
			const child = Bun.spawn(
				[
					process.execPath,
					"--eval",
					`globalThis.fetch = async () => new Response(${JSON.stringify(html)}, { status: ${status} }); await import(${JSON.stringify(join(import.meta.dir, "daily.ts"))});`,
				],
				{
					env: { ...process.env, DAILY_HTML_DUMP: dump, LOG_LEVEL: "error" },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(exitCode).toBe(1);
			expect(stdout + stderr).toContain(status === 503 ? "HTTP 503" : "No __NEXT_DATA__ script found");
			expect(await Bun.file(dump).text()).toBe(html);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
