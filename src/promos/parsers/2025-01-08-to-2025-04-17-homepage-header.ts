import * as v from "valibot";
import { PromoParseError } from "../error.ts";
import type { PromoDetails } from "../promo.ts";
import type { HtmlDocument } from "./html.ts";
import { PromotionSchema, requiredNextData } from "./next.ts";
import { flatDiscountOffers, promoCode } from "./text.ts";

export function parsePromo2025Jan08ToApr17(document: HtmlDocument): PromoDetails | PromoParseError | undefined {
	const raw = requiredNextData(document);
	if (raw instanceof PromoParseError) return raw;
	const { header, featuredEvent } = v.parse(HomepageHeaderSchema, JSON.parse(raw)).props.pageProps.homepageData;
	if (header.promotion) {
		const promotion = header.promotion;
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

	if (featuredEvent?.badge !== "promo") return;
	const promo = { code: promoCode(featuredEvent.title), offers: flatDiscountOffers(featuredEvent.title) };
	if (promo.offers.length === 0 && (!promo.code || /%|\bfree\s+shipping\b/i.test(featuredEvent.title)))
		return new PromoParseError(`Unsupported featured promotion: ${featuredEvent.title}`, "unsupported-promotion");
	return {
		...promo,
		description: featuredEvent.title,
		endDate: { kind: "unknown", reason: "not-published" },
		startDate: { kind: "unknown", reason: "not-published" },
	};
}

const HomepageHeaderSchema = v.object({
	props: v.object({
		pageProps: v.object({
			homepageData: v.object({
				header: v.object({ promotion: v.optional(PromotionSchema) }),
				featuredEvent: v.optional(v.object({ title: v.string(), badge: v.optional(v.string()) })),
			}),
		}),
	}),
});
