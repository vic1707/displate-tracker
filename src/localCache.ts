import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { AppError } from "./error.ts";
import { log } from "./logger.ts";

export type SnapshotErrorCode = "snapshot-empty" | "snapshot-io-failed" | "snapshot-request-failed";
export class SnapshotError extends AppError<SnapshotErrorCode> {}

export class Entry {
	private readonly CACHE_DIR: string = "snapshots_cache";
	public readonly source: "cache" | "network";

	get cacheFile() {
		return `${this.CACHE_DIR}/${this.key}.html`;
	}

	constructor(
		public readonly key: string,
		public readonly date: Temporal.Instant,
		public readonly downloadUrl: string,
	) {
		this.source = existsSync(this.cacheFile) ? "cache" : "network";
	}

	async invalidate(): Promise<SnapshotError | undefined> {
		try {
			await fs.rm(this.cacheFile, { force: true });
		} catch (cause) {
			return new SnapshotError(`Invalidating cached snapshot ${this.key} failed`, "snapshot-io-failed", "error", {
				cause,
			});
		}
	}

	async get(): Promise<string | SnapshotError> {
		try {
			if (this.source === "cache") {
				log.debug({ key: this.key }, "Reading cached snapshot");
				return await fs.readFile(this.cacheFile, "utf8");
			}

			await fs.mkdir(this.CACHE_DIR, { recursive: true });
			log.debug({ key: this.key, url: this.downloadUrl }, "Downloading snapshot");
			const response = await fetch(this.downloadUrl);
			if (!response.ok) {
				return new SnapshotError(
					`Snapshot request failed: HTTP ${response.status} ${response.statusText}`,
					"snapshot-request-failed",
				);
			}
			const data = await response.text();
			if (data.length === 0)
				return new SnapshotError("Snapshot request returned an empty response", "snapshot-empty");

			await fs.writeFile(this.cacheFile, data); // TODO(maybe): tmp file in case of corruption?
			return data;
		} catch (cause) {
			return new SnapshotError(`Snapshot I/O failed for ${this.key}`, "snapshot-io-failed", "error", { cause });
		}
	}
}
