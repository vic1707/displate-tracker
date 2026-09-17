import * as v from "valibot";
import { PromoParseError } from "../error.ts";
import type { PromoDetails } from "../promo.ts";
import type { HtmlDocument } from "./html.ts";
import { PromotionSchema, requiredNextData } from "./next.ts";

export function parsePromo2024To2025(document: HtmlDocument): PromoDetails | PromoParseError {
	const raw = requiredNextData(document);
	if (raw instanceof PromoParseError) return raw;
	const promotion = v.parse(NextDataSchema, JSON.parse(raw)).props.pageProps.homepageData.promotion;
	return {
		code: promotion.code.toUpperCase(),
		offers:
			promotion.type === "shipping"
				? [{ kind: "shipping", condition: "unconditional", freeShipping: true }]
				: promotion.steps.map(({ minQuantity, percentageValue }) => ({
						kind: "discount",
						condition: { kind: "minimum-quantity", quantity: minQuantity },
						discountPercent: percentageValue,
					})),
		endDate: promotion.endsAt,
		startDate: promotion.publishesAt,
	};
}

const NextDataSchema = v.object({
	props: v.object({ pageProps: v.object({ homepageData: v.object({ promotion: PromotionSchema }) }) }),
});
