import { expect, test } from "bun:test";
import { mergePromoHistory, type PromoSnapshot, reconcilePromoHistory, updatePromoHistory } from "./history.ts";
import type { PromoDetails } from "./promo.ts";

test("merges extensions but splits changed offers", () => {
	const firstEnd = Temporal.Instant.from("2026-08-26T08:00:00Z");
	const extendedEnd = Temporal.Instant.from("2026-08-27T08:00:00Z");
	const offer20 = { kind: "discount" as const, condition: "unconditional" as const, discountPercent: 20 };
	const offer25 = { kind: "discount" as const, condition: "unconditional" as const, discountPercent: 25 };
	const promo = (discountPercent: number, endDate: PromoDetails["endDate"]): PromoDetails => ({
		code: "SAVE",
		offers: [{ kind: "discount", condition: "unconditional", discountPercent }],
		startDate: { kind: "unknown", reason: "not-published" },
		endDate,
	});
	const history = mergePromoHistory([
		{ date: Temporal.Instant.from("2026-08-24T12:00:00Z"), promos: [promo(20, firstEnd)], source: "wayback" },
		{ date: Temporal.Instant.from("2026-08-25T12:00:00Z"), promos: [promo(20, extendedEnd)], source: "wayback" },
		{ date: Temporal.Instant.from("2026-08-26T06:00:00Z"), promos: [promo(25, extendedEnd)], source: "wayback" },
		{ date: Temporal.Instant.from("2026-08-26T12:00:00Z"), promos: [], source: "wayback" },
		{ date: Temporal.Instant.from("2026-08-27T12:00:00Z"), promos: [promo(20, extendedEnd)], source: "wayback" },
	]);

	expect(history).toEqual([
		{
			...promo(20, extendedEnd),
			_source: "wayback",
			offers: [offer20],
			startDate: { kind: "supposed", date: Temporal.Instant.from("2026-08-24T12:00:00Z") },
		},
		{
			...promo(25, extendedEnd),
			_source: "wayback",
			offers: [offer25],
			startDate: { kind: "supposed", date: Temporal.Instant.from("2026-08-26T06:00:00Z") },
		},
		{
			...promo(20, extendedEnd),
			_source: "wayback",
			offers: [offer20],
			startDate: { kind: "supposed", date: Temporal.Instant.from("2026-08-27T12:00:00Z") },
		},
	]);
});

test("a Wayback rebuild keeps daily campaigns in archive gaps and after its newest snapshot", () => {
	const campaign = (
		code: string,
		start: string,
		end: string,
		discountPercent: number,
		_source?: PromoDetails["_source"],
	): PromoDetails => ({
		_source,
		code,
		offers: [{ kind: "discount", condition: "unconditional", discountPercent }],
		startDate: Temporal.Instant.from(start),
		endDate: Temporal.Instant.from(end),
	});
	const collect = campaign("COLLECT", "2026-09-07T08:00:00Z", "2026-09-14T07:59:00Z", 35);
	const free = campaign("FREE", "2026-09-14T08:00:00Z", "2026-09-15T07:59:59Z", 15, "displate");
	const two20 = campaign("TWO20", "2026-09-15T08:00:00Z", "2026-09-16T07:59:59Z", 20, "displate");
	const two25 = campaign("TWO25", "2026-09-16T08:00:00Z", "2026-09-17T07:59:59Z", 25, "displate");

	const history = reconcilePromoHistory(
		[
			{ date: Temporal.Instant.from("2026-09-13T12:00:00Z"), promos: [collect], source: "wayback" },
			{ date: Temporal.Instant.from("2026-09-14T12:00:00Z"), promos: [], source: "wayback" },
			{ date: Temporal.Instant.from("2026-09-15T12:00:00Z"), promos: [two20], source: "wayback" },
		],
		[collect, free, two20, two25],
	);

	expect(history.map((promo) => [promo.code, promo._source])).toEqual([
		["COLLECT", "wayback"],
		["FREE", "displate"],
		["TWO20", "wayback"],
		["TWO25", "displate"],
	]);

	const archivedTwo25 = campaign("TWO25", "2026-09-16T08:00:00Z", "2026-09-17T07:59:59Z", 25);
	const caughtUp = reconcilePromoHistory(
		[
			{ date: Temporal.Instant.from("2026-09-13T12:00:00Z"), promos: [collect], source: "wayback" },
			{ date: Temporal.Instant.from("2026-09-14T12:00:00Z"), promos: [free], source: "wayback" },
			{ date: Temporal.Instant.from("2026-09-15T12:00:00Z"), promos: [two20], source: "wayback" },
			{ date: Temporal.Instant.from("2026-09-16T12:00:00Z"), promos: [archivedTwo25], source: "wayback" },
		],
		[collect, free, two20, two25],
	);
	expect(caughtUp.map((promo) => [promo.code, promo._source])).toEqual([
		["COLLECT", "wayback"],
		["FREE", "wayback"],
		["TWO20", "wayback"],
		["TWO25", "wayback"],
	]);
	expect(caughtUp.at(-1)?.offers).toEqual(archivedTwo25.offers);
});

test("campaign identity respects published starts and merges inferred starts with shared ends", () => {
	const first: PromoDetails = {
		code: "SAVE",
		offers: [{ kind: "discount", condition: "unconditional", discountPercent: 25 }],
		startDate: Temporal.Instant.from("2026-09-01T00:00:00Z"),
		endDate: Temporal.Instant.from("2026-09-03T00:00:00Z"),
	};
	const date = Temporal.Instant.from("2026-09-16T12:00:00Z");
	for (const [a, b, count] of [
		[first, { ...first, startDate: Temporal.Instant.from("2026-09-02T00:00:00Z") }, 2],
		[first, { ...first, startDate: date, endDate: date.add({ hours: 24 }) }, 2],
		[
			{ ...first, startDate: { kind: "supposed", date } },
			{ ...first, startDate: { kind: "supposed", date: date.add({ hours: 1 }) } },
			1,
		],
		[{ ...first, startDate: { kind: "unknown", reason: "not-published" } }, first, 1],
	] satisfies Array<[PromoDetails, PromoDetails, number]>) {
		expect(updatePromoHistory([a], { date, promos: [b], source: "displate" })).toHaveLength(count);
		expect(
			mergePromoHistory([
				{ date: date.subtract({ hours: 1 }), promos: [a], source: "wayback" },
				{ date, promos: [b], source: "wayback" },
			]),
		).toHaveLength(count);
	}
});

test("multiple codes survive updates and rebuilds retain daily date evidence", () => {
	const date = Temporal.Instant.from("2026-09-16T12:00:00Z");
	const daily: Array<PromoDetails> = ["FIRST", "SECOND"].map((code) => ({
		code,
		_source: "displate",
		offers: [{ kind: "discount", condition: "unconditional", discountPercent: 25 }],
		startDate: Temporal.Instant.from("2026-09-16T00:00:00Z"),
		endDate: Temporal.Instant.from("2026-09-18T00:00:00Z"),
	}));
	const snapshots = [
		{
			date,
			promos: daily.map((promo) => ({ ...promo, endDate: Temporal.Instant.from("2026-09-17T00:00:00Z") })),
			source: "wayback" as const,
		},
	];
	const expected = daily.map((promo) => ({ ...promo, _source: "wayback" as const }));
	const rebuilt = reconcilePromoHistory(snapshots, daily);
	expect(rebuilt).toEqual(expected);
	expect(reconcilePromoHistory(snapshots, rebuilt)).toEqual(expected);
	expect(updatePromoHistory(daily, { date, promos: daily.toReversed(), source: "displate" })).toEqual(daily);
	expect(mergePromoHistory([...snapshots, ...snapshots])).toHaveLength(2);
	const first = daily[0];
	if (!first) throw new Error("Expected first campaign");
	const changed = {
		...first,
		offers: [{ kind: "discount" as const, condition: "unconditional" as const, discountPercent: 30 }],
	};
	expect(reconcilePromoHistory([{ date, promos: [changed], source: "wayback" }], daily)).toHaveLength(3);
});

test("reprocessing the same undated observation is idempotent", () => {
	const snapshot = {
		date: Temporal.Instant.from("2024-03-10T12:00:00Z"),
		promos: [
			{
				code: "WDAY",
				offers: [],
				startDate: { kind: "unknown", reason: "not-published" },
				endDate: { kind: "unknown", reason: "not-published" },
			},
		],
		source: "displate",
	} satisfies PromoSnapshot;
	const history = updatePromoHistory([], snapshot);
	expect(updatePromoHistory(history, snapshot)).toEqual(history);
	expect(mergePromoHistory([snapshot, snapshot])).toEqual(history);
});
