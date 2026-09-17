import pino from "pino";
import * as v from "valibot";

const ENV = v.parse(
	v.object({
		LOG_LEVEL: v.optional(v.picklist(["trace", "debug", "info", "warn", "error", "fatal", "silent"])),
	}),
	process.env,
);

export const log = pino({
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
