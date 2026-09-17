import * as v from "valibot";

const InstantSchema = v.union([
	v.instance(Temporal.Instant),
	v.pipe(
		v.string(),
		v.isoTimestamp(),
		v.transform((raw) => Temporal.Instant.from(raw)),
	),
]);

export const PromoOfferSchema = v.intersect([
	v.object({
		condition: v.union([
			v.literal("unconditional"),
			v.literal("unknown"),
			v.variant("kind", [
				v.object({ kind: v.literal("minimum-order"), amount: v.number() }),
				v.object({ kind: v.literal("minimum-quantity"), quantity: v.number() }),
			]),
		]),
	}),
	v.variant("kind", [
		v.object({ kind: v.literal("discount"), discountPercent: v.number(), upTo: v.optional(v.boolean()) }),
		v.object({ kind: v.literal("shipping"), freeShipping: v.literal(true) }),
	]),
]);

export const StartDateSchema = v.union([
	InstantSchema,
	v.strictObject({ kind: v.literal("supposed"), date: InstantSchema }),
	v.strictObject({ kind: v.literal("unknown"), reason: v.literal("not-published") }),
	v.strictObject({ kind: v.literal("unknown"), reason: v.literal("invalid"), _raw: v.string() }),
]);

export const EndDateSchema = v.union([
	InstantSchema,
	v.strictObject({ kind: v.literal("unknown"), reason: v.literal("not-published") }),
	v.strictObject({ kind: v.literal("unknown"), reason: v.literal("invalid"), _raw: v.string() }),
	// Persisted history used to discard expired timestamps into this wrapper.
	v.pipe(
		v.strictObject({ kind: v.literal("ended"), _raw: v.string() }),
		v.transform(({ _raw }) => {
			try {
				return Temporal.Instant.from(_raw);
			} catch {
				return { kind: "unknown", reason: "relative-unresolvable", _raw } as const;
			}
		}),
	),
	v.strictObject({ kind: v.literal("unknown"), reason: v.literal("relative-unresolvable"), _raw: v.string() }),
]);

// TODO: strictObject?
export const PromoDetailsSchema = v.object({
	code: v.optional(v.string()), // TODO: if no code => automatic. may be better repr
	description: v.optional(v.string()),
	offers: v.array(PromoOfferSchema),
	endDate: EndDateSchema,
	startDate: StartDateSchema,
	_source: v.optional(v.picklist(["wayback", "displate"])),
});

export type PromoOffer = v.InferOutput<typeof PromoOfferSchema>;
export type EndDate = v.InferOutput<typeof EndDateSchema>;
export type StartDate = v.InferOutput<typeof StartDateSchema>;
export type PromoDetails = v.InferOutput<typeof PromoDetailsSchema>;
export type PromoSource = NonNullable<PromoDetails["_source"]>;

export function formatPromo(promo: PromoDetails | undefined): string {
	if (!promo) return "No promotion";

	const offers = promo.offers.map((offer) => {
		const condition = offer.condition;
		if (offer.kind === "shipping") {
			if (condition === "unconditional") return "free shipping";
			if (condition === "unknown") return "free shipping (conditions unknown)";
			return condition.kind === "minimum-quantity"
				? `free shipping on ${condition.quantity}+`
				: `free shipping over $${condition.amount}`;
		}
		const discount = `${offer.upTo ? "up to " : ""}${offer.discountPercent}% off`;
		if (condition === "unconditional") return discount;
		if (condition === "unknown") return `${discount} (conditions unknown)`;
		return condition.kind === "minimum-quantity"
			? `${discount} ${condition.quantity}+`
			: `${discount} orders over $${condition.amount}`;
	});

	const details: Array<string> = [];
	if (promo.code) details.push(`code ${promo.code}`);
	const start = promo.startDate instanceof Temporal.Instant ? formatDate(promo.startDate) : undefined;
	const end = promo.endDate instanceof Temporal.Instant ? formatDate(promo.endDate) : undefined;
	if (start && end) details.push(`${start} to ${end}`);
	else {
		if (start) details.push(`from ${start}`);
		if (end) details.push(`until ${end}`);
	}
	if (!(promo.startDate instanceof Temporal.Instant) && promo.startDate.kind === "supposed") {
		details.push(`seen ${formatDate(promo.startDate.date)}`);
	}
	if (!(promo.endDate instanceof Temporal.Instant)) {
		if (promo.endDate.kind === "unknown" && promo.endDate.reason === "relative-unresolvable") {
			details.push(`until ${promo.endDate._raw}`);
		}
	}
	if (promo.description) details.push(promo.description);

	return `${offers.join(", ") || "Promotion"}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

function formatDate(date: Temporal.Instant): string {
	return date.toZonedDateTimeISO("UTC").toPlainDate().toString();
}
