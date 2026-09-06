import pino from "pino";
import * as v from "valibot";
import { WaybackService } from "../wayback.ts";

const ENV = v.parse(
	v.object({
		LOG_LEVEL: v.optional(
			v.union([v.literal("debug"), v.literal("fatal"), v.literal("error"), v.literal("warn"), v.literal("info")]),
		),
		CONCURRENT: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)), "10"),
	}),
	process.env,
);

const log = pino({
	level: ENV.LOG_LEVEL ?? "info",
	transport: {
		target: "pino-pretty",
		options: {
			colorize: true,
			levelFirst: true,
			translateTime: "SYS:HH:MM:ss.l",
			ignore: "pid,hostname",
			singleLine: true,
		},
	},
});

const wayback = new WaybackService("https://displate.com/");

log.info("Fetching Wayback snapshots.");
const { count, snapshots } = await wayback.cachedSnapshots();
log.info(`Found ${count} snapshots.`);

let completed = 0;

Array.from({ length: Math.min(ENV.CONCURRENT, count) }, async () => {
	for (let snapshot = snapshots.next(); !snapshot.done; snapshot = snapshots.next()) {
		const { value: snap } = snapshot;
		log.info({ key: snap.key }, `[${++completed}/${count}] Start`); // TODO: better msg
		const { source } = await snap.get();
		log.info({ key: snap.key, source }, `[${++completed}/${count}]`);
	}
});
