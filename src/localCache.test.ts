import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import { Entry } from "./localCache.ts";
import { PromoParseError } from "./promos/error.ts";
import { parsePromo } from "./promos/index.ts";

test("recognized Wayback error pages can be evicted so the next run uses the network", async () => {
	const key = `test-${crypto.randomUUID()}`;
	const date = Temporal.Instant.from("2025-04-11T06:31:30Z");
	const url = `https://web.archive.org/web/${key}id_/https://displate.com/`;
	const file = new Entry(key, date, url).cacheFile;
	await fs.mkdir("snapshots_cache", { recursive: true });
	try {
		await fs.writeFile(
			file,
			"<title>Wayback Machine</title><p>This snapshot cannot be displayed due to an internal error.</p>",
		);
		const entry = new Entry(key, date, url);
		expect(entry.source).toBe("cache");
		const html = await entry.get();
		if (html instanceof Error) throw html;
		const parsed = parsePromo(date, html);
		expect(parsed).toBeInstanceOf(PromoParseError);
		if (!(parsed instanceof PromoParseError)) throw new Error("Expected interstitial");
		expect(parsed.code).toBe("wayback-interstitial");
		expect(await entry.invalidate()).toBeUndefined();
		expect(await Bun.file(file).exists()).toBe(false);
		expect(new Entry(key, date, url).source).toBe("network");
		expect(await entry.invalidate()).toBeUndefined();
	} finally {
		await fs.rm(file, { force: true });
	}
});
