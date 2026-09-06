import fs from "node:fs/promises";

export class Entry {
	private readonly CACHE_DIR: string = "snapshots_cache";

	get cacheFile() {
		return `${this.CACHE_DIR}/${this.key}.html`;
	}

	constructor(
		public readonly key: string,
		public readonly date: Temporal.Instant,
		public readonly downloadUrl: string,
	) {}

	get(): Promise<{ source: "cache" | "network"; data: string }> {
		return fs
			.readFile(this.cacheFile, { encoding: "utf8" })
			.then((data) => ({ source: "cache" as const, data }))
			.catch(async (error) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

				await fs.mkdir(this.CACHE_DIR, { recursive: true });
				const data = await fetch(this.downloadUrl)
					.then((r) => {
						if (!r.ok) throw new Error(`Snapshot request failed: HTTP ${r.status} ${r.statusText}`);
						return r.text();
					})
					.then((data) => {
						if (data.length === 0) throw new Error("Snapshot request returned an empty response");
						return data;
					});

				await fs.writeFile(this.cacheFile, data); // TODO(maybe): tmp file in case of corruption?
				return { source: "network" as const, data };
			});
	}
}
