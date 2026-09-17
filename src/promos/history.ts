import * as v from "valibot";
import { AppError } from "../error.ts";
import { type PromoDetails, PromoDetailsSchema, type PromoSource } from "./promo.ts";

export const PROMO_HISTORY_FILE = "web/promo_history.json";

export type HistoryErrorCode = "history-invalid" | "history-read-failed" | "history-write-failed";
export class HistoryError extends AppError<HistoryErrorCode> {}

export interface PromoSnapshot {
	date: Temporal.Instant;
	promos: Array<PromoDetails>;
	source: PromoSource;
}

export function mergePromoHistory(snapshots: Array<PromoSnapshot>): Array<PromoDetails> {
	const history: Array<PromoDetails> = [];
	let current: Array<PromoDetails> = [];

	for (const snapshot of snapshots.toSorted((a, b) => Temporal.Instant.compare(a.date, b.date))) {
		current = snapshot.promos.map((value) => {
			const promo = withSupposedStart(snapshot.date, { ...value, _source: snapshot.source });
			const previous = current.find((previous) => isSameCampaign(previous, promo));
			if (previous) {
				const merged = mergeCampaign(previous, promo);
				history[history.indexOf(previous)] = merged;
				return merged;
			}
			history.push(promo);
			return promo;
		});
	}

	return history;
}

export function reconcilePromoHistory(
	snapshots: Array<PromoSnapshot>,
	existing: Array<PromoDetails>,
): Array<PromoDetails> {
	if (!snapshots.length) return existing;
	const rebuilt = mergePromoHistory(snapshots);
	for (const promo of existing) {
		const index = rebuilt.findIndex((archived) => isSameCampaign(promo, archived));
		const archived = rebuilt[index];
		if (archived) rebuilt[index] = mergeCampaign(promo, archived);
		else if (promo._source === "displate") rebuilt.push(promo);
	}
	return rebuilt.toSorted((a, b) => {
		const aStart = startInstant(a);
		const bStart = startInstant(b);
		return aStart && bStart ? Temporal.Instant.compare(aStart, bStart) : aStart ? -1 : bStart ? 1 : 0;
	});
}

export function updatePromoHistory(history: Array<PromoDetails>, snapshot: PromoSnapshot): Array<PromoDetails> {
	if (!snapshot.promos.length) return history;
	const updated = [...history];
	for (const value of snapshot.promos) {
		const promo = withSupposedStart(snapshot.date, { ...value, _source: snapshot.source });
		const index = updated.findLastIndex((current) => isSameCampaign(current, promo));
		const current = updated[index];
		if (current) updated[index] = mergeCampaign(current, promo);
		else updated.push(promo);
	}
	return updated;
}

export async function readPromoHistory(): Promise<Array<PromoDetails> | HistoryError> {
	const file = Bun.file(PROMO_HISTORY_FILE);
	if (!(await file.exists())) return [];
	const json = await file
		.json()
		.catch(
			(cause) =>
				new HistoryError(`Reading ${PROMO_HISTORY_FILE} failed`, "history-read-failed", "error", { cause }),
		);
	if (json instanceof HistoryError) return json;
	const result = v.safeParse(v.array(PromoDetailsSchema), json);
	return result.success
		? result.output
		: new HistoryError(`Invalid ${PROMO_HISTORY_FILE}:\n${v.summarize(result.issues)}`, "history-invalid");
}

export function writePromoHistory(history: Array<PromoDetails>): Promise<HistoryError | undefined> {
	return Bun.write(PROMO_HISTORY_FILE, `${JSON.stringify(history, null, "\t")}\n`)
		.then(() => undefined)
		.catch(
			(cause) =>
				new HistoryError(`Writing ${PROMO_HISTORY_FILE} failed`, "history-write-failed", "error", { cause }),
		);
}

function withSupposedStart(date: Temporal.Instant, promo: PromoDetails): PromoDetails {
	const startDate = promo.startDate;
	return {
		...promo,
		offers: [...promo.offers],
		startDate:
			startDate instanceof Temporal.Instant ||
			startDate.kind === "supposed" ||
			startDate.reason !== "not-published"
				? startDate
				: { kind: "supposed", date },
	};
}

function mergeCampaign(current: PromoDetails, next: PromoDetails): PromoDetails {
	const currentStart = startInstant(current);
	const nextStart = startInstant(next);
	const startDate =
		next.startDate instanceof Temporal.Instant ||
		(!(current.startDate instanceof Temporal.Instant) &&
			nextStart &&
			(!currentStart || Temporal.Instant.compare(nextStart, currentStart) < 0))
			? next.startDate
			: current.startDate;
	const endDate =
		next.endDate instanceof Temporal.Instant &&
		(!(current.endDate instanceof Temporal.Instant) || Temporal.Instant.compare(next.endDate, current.endDate) > 0)
			? next.endDate
			: current.endDate;
	return {
		...current,
		description: next.description ?? current.description,
		_source: next._source ?? current._source,
		startDate,
		endDate,
	};
}

function isSameCampaign(a: PromoDetails, b: PromoDetails): boolean {
	if (a.code !== b.code || JSON.stringify(a.offers) !== JSON.stringify(b.offers)) return false;
	if (a.startDate instanceof Temporal.Instant && b.startDate instanceof Temporal.Instant) {
		return Temporal.Instant.compare(a.startDate, b.startDate) === 0;
	}
	const aStart = startInstant(a);
	const bStart = startInstant(b);
	if (aStart && bStart && Temporal.Instant.compare(aStart, bStart) === 0) return true;
	if (a.endDate instanceof Temporal.Instant && b.endDate instanceof Temporal.Instant) {
		if (Temporal.Instant.compare(a.endDate, b.endDate) === 0) return true;
		return (
			!!aStart &&
			!!bStart &&
			Temporal.Instant.compare(aStart, b.endDate) < 0 &&
			Temporal.Instant.compare(bStart, a.endDate) < 0
		);
	}
	return false;
}

function startInstant(promo: PromoDetails): Temporal.Instant | undefined {
	return promo.startDate instanceof Temporal.Instant
		? promo.startDate
		: promo.startDate.kind === "supposed"
			? promo.startDate.date
			: undefined;
}
