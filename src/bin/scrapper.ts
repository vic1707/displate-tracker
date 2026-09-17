import * as v from "valibot";
import { AppError } from "../error.ts";
import { log } from "../logger.ts";
import { PromoParseError } from "../promos/error.ts";
import { type PromoSnapshot, readPromoHistory, reconcilePromoHistory, writePromoHistory } from "../promos/history.ts";
import { parsePromo } from "../promos/index.ts";
import { formatPromo } from "../promos/promo.ts";
import { WaybackService } from "../wayback.ts";

const ENV = v.parse(
	v.object({
		CONCURRENT: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)), "10"),
	}),
	process.env,
);

const wayback = new WaybackService("https://displate.com/");

log.info("Fetching Wayback snapshots.");
const available = await wayback.cachedSnapshots();
if (available instanceof AppError) {
	log.error({ err: available }, "Fetching Wayback snapshots failed");
	process.exit(1);
}

const { count, snapshots } = available;
log.info(`Found ${count} snapshots.`);

let completed = 0;
let stopped = false;

const jobs = snapshots.map(async (snap): Promise<PromoSnapshot | AppError | undefined> => {
	const context = {
		key: snap.key,
		date: snap.date.toString(),
		source: snap.source,
		downloadUrl: snap.downloadUrl,
	};
	log.info(context, "Start");

	const data = await snap.get();
	if (data instanceof AppError) {
		log.error({ ...context, err: data }, "Snapshot failed");
		return data;
	}

	const promos = parsePromo(snap.date, data);
	if (promos instanceof PromoParseError) {
		if (promos.code === "wayback-interstitial") {
			const error = await snap.invalidate();
			if (error) {
				log.error({ ...context, err: error }, "Evicting Wayback error page failed");
				return error;
			}
		}
		if (promos.severity === "error") {
			log.error({ ...context, err: promos }, "Snapshot failed");
			return promos;
		}
		log.warn({ ...context, err: promos }, `[${++completed}/${count}] Snapshot skipped`);
		return;
	}

	log.info(context, `[${++completed}/${count}] ${promos.map(formatPromo).join("; ") || "No promotion"}`);
	return { date: snap.date, promos, source: "wayback" };
});

const workerResults = await Promise.all(
	Array.from({ length: Math.min(ENV.CONCURRENT, count) }, async () => {
		const parsed: Array<PromoSnapshot> = [];
		for (const job of jobs) {
			if (stopped) return parsed;
			const result = await job;
			if (result instanceof AppError) {
				stopped = true;
				return result;
			}
			if (result) parsed.push(result);
		}
		return parsed;
	}),
).catch(
	(cause) =>
		new AppError("Unexpected snapshot processing failure", "snapshot-processing-failed", "error", {
			cause,
		}),
);

if (workerResults instanceof AppError) {
	log.error({ err: workerResults }, "Snapshot processing failed");
	process.exit(1);
}
if (workerResults.some((result) => result instanceof AppError)) process.exit(1);

const parsedSnapshots = workerResults.flatMap((result) => (result instanceof AppError ? [] : result));
const existing = await readPromoHistory();
if (existing instanceof AppError) {
	log.error({ err: existing }, "Reading promo history failed");
	process.exit(1);
}
const history = reconcilePromoHistory(parsedSnapshots, existing);
const writeError = await writePromoHistory(history);
if (writeError) {
	log.error({ err: writeError }, "Writing promo history failed");
	process.exitCode = 1;
} else {
	log.info({ promotions: history.length }, "Wrote promo_history.json");
}
