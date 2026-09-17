import { PromoParseError } from "../error.ts";
import type { PromoDetails } from "../promo.ts";
import type { HtmlDocument } from "./html.ts";
import { buyQuantityOffers, flatDiscountOffers, promoCode } from "./text.ts";

export function parsePromo2019To2021(
	date: Temporal.Instant,
	document: HtmlDocument,
): PromoDetails | PromoParseError | undefined {
	let banner = document.querySelector(".topbar__text");
	if (!banner) return;

	const variant = document.body.classList.contains("black-friday-color-change") ? "temporary" : "regular";
	if (banner.querySelector(".black-friday-text-regular, .black-friday-text-temporary")) {
		const active = banner.querySelector(`.black-friday-text-${variant}`);
		if (!active) return;
		banner = active;
	}
	for (const node of banner.querySelectorAll("script, style")) node.remove();
	const text = banner.textContent.replace(/\s+/g, " ").trim();
	if (!text) return;

	let offers = buyQuantityOffers(text);
	if (offers.length === 0) offers = flatDiscountOffers(text);
	if (/^(?:Get )?Free Shipping(?: on all orders| sitewide)?\s*\|/i.test(text)) {
		offers.push({ kind: "shipping", condition: "unconditional", freeShipping: true });
	}
	if (offers.length === 0)
		return new PromoParseError(`Unsupported promotion banner: ${text}`, "unsupported-promotion");
	const rawEndDate = text.match(/\b(?:ends?|expires?|valid till|until|ending)\s*:?\s*-?\s*([^|!]+)!?/i)?.[1]?.trim();
	return {
		code: promoCode(text),
		offers,
		description: text,
		endDate: /\btoday\b/i.test(text)
			? Temporal.Instant.from(`${date.toZonedDateTimeISO("UTC").toPlainDate()}T23:59:59Z`)
			: rawEndDate
				? { kind: "unknown", reason: "relative-unresolvable", _raw: rawEndDate }
				: { kind: "unknown", reason: "not-published" },
		startDate: { kind: "unknown", reason: "not-published" },
	};
}
