import * as v from "valibot";
import { log } from "../logger.ts";
import { waybackTimestampToInstant } from "../wayback.ts";
import { PromoParseError } from "./error.ts";
import { parsePromo2013To2016 } from "./parsers/2013-to-2016-shipping-text.ts";
import { parsePromo2016To2019 } from "./parsers/2016-to-2019-legacy.ts";
import { parsePromo2019To2021 } from "./parsers/2019-to-2021-server-topbar.ts";
import { parsePromo2021To2022 } from "./parsers/2021-to-2022-injected-banner.ts";
import { parsePromo2022To2024 } from "./parsers/2022-to-2024-react-shell.ts";
import { parsePromo2024To2025 } from "./parsers/2024-to-2025-next-data.ts";
import { parsePromo2025Jan08ToApr17 } from "./parsers/2025-01-08-to-2025-04-17-homepage-header.ts";
import { parseHtml } from "./parsers/html.ts";
import { PromotionSchema, requiredNextData } from "./parsers/next.ts";
import { type PromoDetails, PromoDetailsSchema, type PromoOffer } from "./promo.ts";

export function parsePromo(date: Temporal.Instant, html: string): Array<PromoDetails> | PromoParseError {
	try {
		return parsePromoUnsafe(date, html);
	} catch (cause) {
		return new PromoParseError(`Promo parsing failed for ${date}`, "parse-failed", "error", { cause });
	}
}

function parsePromoUnsafe(date: Temporal.Instant, html: string): Array<PromoDetails> | PromoParseError {
	const document = parseHtml(html);
	if (document.querySelector("title")?.textContent.trim() === "Wayback Machine") {
		return new PromoParseError(`Wayback interstitial returned for ${date}`, "wayback-interstitial", "warning");
	}

	const isBefore = (timestamp: string) => Temporal.Instant.compare(date, waybackTimestampToInstant(timestamp)) < 0;

	switch (true) {
		case isBefore("20130905212316"):
			log.debug(`No promotion parser needed for ${date}`);
			return [];
		case isBefore("20160326184115"):
			log.debug(`Using 2013-to-2016 promotion parser for ${date}`);
			return validatePromo(parsePromo2013To2016(date, document));
		case isBefore("20190118171115"):
			log.debug(`Using 2016-to-2019 promotion parser for ${date}`);
			return validatePromo(parsePromo2016To2019(date, document));
		case isBefore("20201205141225"):
			log.debug(`Using 2019-to-2021 promotion parser for ${date}`);
			return validatePromo(parsePromo2019To2021(date, document));
		case isBefore("20221126150626"):
			log.debug(`Using 2021-to-2022 promotion parser for ${date}`);
			return validatePromo(parsePromo2021To2022(document, html));
		case isBefore("20241219165010"):
			log.debug(`Using 2022-to-2024 promotion parser for ${date}`);
			return validatePromo(parsePromo2022To2024(document));
		case isBefore("20250108174354"):
			log.debug(`Using 2024-to-2025 promotion parser for ${date}`);
			return validatePromo(parsePromo2024To2025(document));
		case isBefore("20250417065108"):
			log.debug(`Using 2025-01-08-to-2025-04-17 promotion parser for ${date}`);
			return validatePromo(parsePromo2025Jan08ToApr17(document));
		default:
			log.debug(`Using current promotion parser for ${date}`);
			return validatePromo(parsePromo2025Apr17Onward(document));
	}
}

function parsePromo2025Apr17Onward(document: ReturnType<typeof parseHtml>): PromoDetails | PromoParseError | undefined {
	const raw = requiredNextData(document);
	if (raw instanceof PromoParseError) return raw;
	const promotion = v.parse(HeaderSchema, JSON.parse(raw)).props.pageProps.header.promotion;
	if (!promotion) return;

	let offers: Array<PromoOffer>;
	if (promotion.type === "shipping") {
		const quantity = promotion.steps[0]?.minQuantity;
		const amount = promotion.shipping.minValue.amountInCurrency;
		if (quantity && amount)
			return new PromoParseError("Combined shipping conditions are not supported", "unsupported-promotion");
		offers = [
			{
				kind: "shipping",
				condition: quantity
					? { kind: "minimum-quantity", quantity }
					: amount
						? { kind: "minimum-order", amount }
						: "unconditional",
				freeShipping: true,
			},
		];
	} else {
		offers = promotion.steps.map(({ minQuantity, percentageValue }) => ({
			kind: "discount",
			condition: { kind: "minimum-quantity", quantity: minQuantity },
			discountPercent: percentageValue,
		}));
	}

	return {
		code: promotion.code.toUpperCase(),
		offers,
		endDate: promotion.endsAt,
		startDate: promotion.publishesAt,
	};
}

function validatePromo(
	promo: PromoDetails | Array<PromoDetails> | PromoParseError | undefined,
): Array<PromoDetails> | PromoParseError {
	if (promo instanceof PromoParseError) return promo;
	const result = v.safeParse(v.array(PromoDetailsSchema), promo ? (Array.isArray(promo) ? promo : [promo]) : []);
	if (!result.success)
		return new PromoParseError(`Invalid promo details:\n${v.summarize(result.issues)}`, "invalid-promotion");
	return result.output;
}

const HeaderSchema = v.object({
	props: v.object({ pageProps: v.object({ header: v.object({ promotion: v.optional(PromotionSchema) }) }) }),
});
