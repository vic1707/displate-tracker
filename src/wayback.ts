import * as v from "valibot";
import { AppError } from "./error.ts";
import { Entry } from "./localCache.ts";
import { log } from "./logger.ts";

export type WaybackErrorCode = "invalid-snapshot-list" | "snapshot-list-request-failed";
export class WaybackError extends AppError<WaybackErrorCode> {}

export class WaybackService {
	constructor(public readonly targetUrl: string) {}

	public async cachedSnapshots() {
		const result = await this.availableSnapshots();
		if (result instanceof WaybackError) return result;
		const { success, output: snapshots, issues } = result;
		if (!success) {
			return new WaybackError(`Invalid Wayback snapshot list:\n${v.summarize(issues)}`, "invalid-snapshot-list");
		}

		return {
			count: snapshots.length,
			snapshots: Iterator.from(snapshots).map(({ key, date, downloadUrl }) => new Entry(key, date, downloadUrl)),
		};
	}

	private async availableSnapshots() {
		const url = new URL("https://web.archive.org/cdx/search/cdx");
		url.searchParams.set("url", this.targetUrl);
		url.searchParams.set("fl", "timestamp,original");
		url.searchParams.set("filter", "statuscode:200");
		url.searchParams.set("collapse", "timestamp:8");
		url.searchParams.set("output", "json");
		log.debug({ url: url.toString() }, "Fetching Wayback snapshot list");

		try {
			const response = await fetch(url);
			if (!response.ok) {
				return new WaybackError(
					`Wayback snapshot list request failed: HTTP ${response.status} ${response.statusText}`,
					"snapshot-list-request-failed",
				);
			}
			return v.safeParse(SnapShotListSchema, await response.json());
		} catch (cause) {
			return new WaybackError("Wayback snapshot list request failed", "snapshot-list-request-failed", "error", {
				cause,
			});
		}
	}
}

/**
 * Wayback Machine gives `20260827095518` as a time.
 */
const WaybackTimeSchema = v.pipe(
	v.string(),
	v.regex(/^\d{14}$/),
	v.transform((raw) => ({
		raw,
		date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`,
	})),
	v.strictObject({
		raw: v.string(),
		date: v.pipe(
			v.string(),
			v.isoDateTimeSecond(),
			v.transform((date) => Temporal.Instant.from(`${date}Z`)),
		),
	}),
);

const SnapShotListSchema = v.pipe(
	v.tupleWithRest(
		[v.strictTuple([v.literal("timestamp"), v.literal("original")])],
		v.pipe(
			v.strictTuple([WaybackTimeSchema, v.pipe(v.string(), v.url())]),
			v.transform(([{ raw: key, date }, sourceUrl]) => ({
				key,
				date,
				downloadUrl: `https://web.archive.org/web/${key}id_/${sourceUrl}`,
			})),
		),
	),
	v.transform(([_header, ...rest]) => rest),
);

export const waybackTimestampToInstant = (wb: string): Temporal.Instant => v.parse(WaybackTimeSchema, wb).date;
