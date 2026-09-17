import * as v from "valibot";
import { PromoParseError } from "../error.ts";
import type { HtmlDocument } from "./html.ts";

export const InstantSchema = v.pipe(
	v.string(),
	v.isoTimestamp(),
	v.transform((raw) => Temporal.Instant.from(raw)),
);

const CommonPromotionEntries = {
	code: v.pipe(v.string(), v.minLength(1)),
	publishesAt: InstantSchema,
	endsAt: InstantSchema,
};

export const PromotionSchema = v.variant("type", [
	v.object({
		...CommonPromotionEntries,
		type: v.picklist(["flat", "step", "category"]),
		steps: v.pipe(
			v.array(
				v.object({
					minQuantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
					percentageValue: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
				}),
			),
			v.minLength(1),
		),
	}),
	v.object({
		...CommonPromotionEntries,
		type: v.literal("shipping"),
		steps: v.array(v.object({ minQuantity: v.pipe(v.number(), v.integer(), v.minValue(1)) })),
		shipping: v.strictObject({
			minValue: v.strictObject({
				formatted: v.string(),
				amountInCurrency: v.pipe(v.number(), v.minValue(0)),
			}),
			percentageValue: v.literal(100),
		}),
	}),
]);

export type Promotion = v.InferOutput<typeof PromotionSchema>;

export function requiredNextData(document: HtmlDocument): string | PromoParseError {
	const raw = document.querySelector("#__NEXT_DATA__")?.textContent.trim();
	if (!raw) return new PromoParseError("No __NEXT_DATA__ script found", "missing-data");
	return raw;
}
