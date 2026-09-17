import { AppError } from "../error.ts";
import { log } from "../logger.ts";
import { PromoParseError } from "../promos/error.ts";
import { readPromoHistory, updatePromoHistory, writePromoHistory } from "../promos/history.ts";
import { parsePromo } from "../promos/index.ts";
import { formatPromo } from "../promos/promo.ts";

async function updateDailyPromo(): Promise<AppError | undefined> {
	const response = await fetch("https://displate.com/", { headers: { "user-agent": "displate-tracker/1.0" } }).catch(
		(cause) =>
			new AppError("Fetching current Displate page failed", "current-page-request-failed", "error", { cause }),
	);
	if (response instanceof AppError) return response;
	const html = await response
		.text()
		.catch(
			(cause) =>
				new AppError("Reading current Displate page failed", "current-page-read-failed", "error", { cause }),
		);
	if (html instanceof AppError) return html;
	if (process.env.DAILY_HTML_DUMP) {
		await Bun.write(process.env.DAILY_HTML_DUMP, html).catch((err) =>
			log.warn({ err }, "Saving daily HTML diagnostics failed"),
		);
	}
	if (!response.ok) {
		return new AppError(
			`Fetching current Displate page failed: HTTP ${response.status} ${response.statusText}`,
			"current-page-request-failed",
		);
	}
	const date = Temporal.Now.instant();
	const promos = parsePromo(date, html);
	if (promos instanceof PromoParseError) {
		if (promos.severity === "warning") {
			log.warn({ err: promos }, "Current Displate page skipped");
			return;
		}
		return promos;
	}

	const history = await readPromoHistory();
	if (history instanceof AppError) return history;
	const updated = updatePromoHistory(history, { date, promos, source: "displate" });
	const summary = promos.map(formatPromo).join("; ") || "No promotion";
	if (JSON.stringify(updated) === JSON.stringify(history)) {
		log.info(`Promo history is already current: ${summary}`);
		return;
	}

	const error = await writePromoHistory(updated);
	if (!error) log.info({ promotions: updated.length }, `Updated promo history: ${summary}`);
	return error;
}

const error = await updateDailyPromo().catch(
	(cause) => new AppError("Unexpected daily update failure", "daily-update-failed", "error", { cause }),
);
if (error) {
	log.error({ err: error }, "Daily promo update failed");
	process.exitCode = 1;
}
