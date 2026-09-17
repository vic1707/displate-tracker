import { expect, test } from "bun:test";
import {
	calendarDates,
	compareTiers,
	endsIn,
	lastYearWindow,
	maxDiscount,
	offerLabel,
	parseHistory,
	promotionAt,
	readHistory,
} from "./app.tsx";

const discount = (discountPercent: number, condition: unknown = "unconditional", upTo = false) => ({
	kind: "discount",
	discountPercent,
	condition,
	...(upTo ? { upTo } : {}),
});
const quantity = (quantity: number) => ({ kind: "minimum-quantity", quantity });
const order = (amount: number) => ({ kind: "minimum-order", amount });
const unknown = { kind: "unknown", reason: "not-published" };
const shipping = { kind: "shipping", freeShipping: true, condition: "unconditional" };

function record(startDate: unknown, endDate: unknown, offers: Array<unknown>, code = "TEST") {
	const [row] = readHistory(
		parseHistory([{ startDate, endDate, offers, code, description: "Selected products only" }]),
	);
	if (!row) throw new Error("Expected fixture row");
	return row;
}

test("promotion countdown uses useful units", () => {
	const now = Temporal.Instant.from("2026-09-17T12:00:00Z");
	expect(endsIn(Temporal.Instant.from("2026-09-17T12:30:00Z"), now)).toBe("Ends in 30 minutes");
	expect(endsIn(Temporal.Instant.from("2026-09-17T14:00:00Z"), now)).toBe("Ends in 2 hours");
	expect(endsIn(Temporal.Instant.from("2026-09-20T12:00:00Z"), now)).toBe("Ends in 3 days");
});

test("schema parsing, display and active interval use synthetic records", () => {
	const row = record("2026-09-07T08:00:00Z", "2026-09-14T08:00:00Z", [discount(35, "unknown", true), shipping]);
	expect(row.promo.description).toBe("Selected products only");
	expect(maxDiscount(row)).toBe(35);
	expect(row.promo.offers.map(offerLabel)).toEqual([
		"Up to 35% off / conditions unknown",
		"Free shipping / no minimum",
	]);
	expect(calendarDates(row)).toEqual({ start: "2026-09-07T08:00:00Z", end: "2026-09-14T08:00:00Z", allDay: false });
	expect(promotionAt([row], Temporal.Instant.from("2026-09-07T08:00:00Z"))).toBe(row);
	expect(promotionAt([row], Temporal.Instant.from("2026-09-14T08:00:00Z"))).toBeNull();
});

test("last year's month selects exact eligible discounts, not the advertised maximum", () => {
	const asOf = Temporal.Instant.from("2026-09-16T12:00:00Z");
	const valid = record("2025-10-09T08:01:00Z", "2025-10-10T00:00:00Z", [
		discount(28, quantity(1)),
		discount(36, quantity(3)),
	]);
	const rows = [
		valid,
		record("2025-10-10T00:00:00Z", unknown, [
			discount(90, "unknown"),
			discount(80, "unconditional", true),
			discount(10),
		]),
		record("2025-10-11T00:00:00Z", unknown, [shipping]),
		record("2025-10-16T12:00:00Z", unknown, [discount(100)]),
		record("2025-09-16T11:59:59Z", unknown, [discount(100)]),
		record({ kind: "supposed", date: "2025-10-01T00:00:00Z" }, unknown, [discount(100)]),
	];
	const window = lastYearWindow(rows, asOf);
	expect(window.from.toString()).toBe("2025-09-16T12:00:00Z");
	expect(window.to.toString()).toBe("2025-10-16T12:00:00Z");
	expect(window.best).toBe(valid);
	const unsupported = record("2025-10-10T00:00:00Z", unknown, [
		discount(90, "unknown"),
		discount(80, "unconditional", true),
		shipping,
	]);
	expect(lastYearWindow([unsupported], asOf).best).toBeNull();
});

test("daily maxima span all codes, carry tiers forward and keep order and quantity separate", () => {
	const rows = [
		record(
			"2024-02-28T12:00:00Z",
			"2024-03-01T00:00:00Z",
			[discount(10), discount(20, quantity(2)), shipping],
			"A",
		),
		record(
			"2024-02-29T23:00:00Z",
			"2024-03-01T00:00:00Z",
			[discount(30, quantity(3)), discount(40, order(100))],
			"B",
		),
		record(
			"2024-02-29T00:00:00Z",
			"2024-03-01T00:00:00Z",
			[discount(25, quantity(2)), discount(50, order(200))],
			"C",
		),
		record("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z", [
			discount(100, "unknown"),
			discount(99, quantity(9), true),
		]),
	];
	const during = Temporal.Instant.from("2024-02-29T23:30:00Z");
	expect(
		compareTiers(rows, rows[0] ?? null, during).map(({ label, current, historical }) => ({
			label,
			current,
			historical,
		})),
	).toEqual([
		{ label: "No minimum", current: 10, historical: 10 },
		{ label: "2+ Displates", current: 25, historical: 20 },
		{ label: "3+ Displates", current: 30, historical: 20 },
		{ label: "Orders over $100", current: 40, historical: 10 },
		{ label: "Orders over $200", current: 50, historical: 10 },
	]);
	expect(compareTiers(rows, null, during).map((tier) => tier.average)).toEqual([
		10 / 731,
		20 / 731,
		20 / 731,
		10 / 731,
		10 / 731,
	]);
	const asOf = Temporal.Instant.from("2026-02-28T12:00:00Z");
	const tiers = compareTiers(rows, null, asOf);
	expect(tiers.map((tier) => tier.average)).toEqual([20 / 731, 45 / 731, 50 / 731, 50 / 731, 60 / 731]);
	expect(tiers.every((tier) => tier.current === null && tier.historical === null)).toBe(true);
	expect(compareTiers(rows.toReversed(), null, asOf)).toEqual(tiers);
});

test("two calendar years clip intervals, exclude today and unknown endpoints, and zero-fill gaps", () => {
	const asOf = Temporal.Instant.from("2026-03-01T18:00:00Z");
	const rows = [
		record("2020-01-01T00:00:00Z", "2024-03-02T00:00:00Z", [discount(20)]),
		record("2026-02-28T23:59:00Z", "2027-01-01T00:00:00Z", [discount(30)]),
		record("2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z", [discount(80)]),
		record("2026-03-02T00:00:00Z", "2026-03-03T00:00:00Z", [discount(100)]),
		record("2024-01-01T00:00:00Z", "2024-03-01T00:00:00Z", [discount(100)]),
		record("2025-01-01T00:00:00Z", unknown, [discount(100)]),
		record(unknown, "2027-01-01T00:00:00Z", [discount(100)]),
		record("2025-01-02T00:00:00Z", "2025-01-01T00:00:00Z", [discount(100)]),
		record("2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", [discount(100)]),
		record({ kind: "supposed", date: "2025-01-01T12:00:00Z" }, "2025-01-02T00:00:00Z", [discount(10)]),
	];
	expect(compareTiers(rows, null, asOf)).toEqual([
		{ label: "No minimum", current: 80, historical: null, average: 60 / 730 },
	]);
	expect(compareTiers([], null, asOf)).toEqual([]);
	const today = record("2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z", [discount(50, quantity(2)), shipping]);
	expect(compareTiers([today], null, asOf)).toEqual([
		{ label: "2+ Displates", current: 50, historical: null, average: 0 },
	]);
});
