import * as v from "valibot";
import { Entry } from "./localCache.ts";

export class WaybackService {
	constructor(public readonly targetUrl: string) {}

	public async cachedSnapshots() {
		const { success, output: snapshots, issues } = await this.availableSnapshots();
		if (!success) {
			throw new Error(`Invalid Wayback snapshot list:\n${v.summarize(issues)}`);
		}

		return {
			count: snapshots.length,
			snapshots: Iterator.from(snapshots).map(({ key, date, downloadUrl }) => new Entry(key, date, downloadUrl)),
		};
	}

	private availableSnapshots() {
		const url = new URL("https://web.archive.org/cdx/search/cdx");
		url.searchParams.set("url", this.targetUrl);
		url.searchParams.set("fl", "timestamp,original");
		url.searchParams.set("filter", "statuscode:200");
		url.searchParams.set("collapse", "timestamp:8");
		url.searchParams.set("output", "json");

		return fetch(url)
			.then((r) => {
				if (!r.ok) throw new Error(`Wayback snapshot list request failed: HTTP ${r.status} ${r.statusText}`);
				return r.json();
			})
			.then((json) => v.safeParse(SnapShotListSchema, json));
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
