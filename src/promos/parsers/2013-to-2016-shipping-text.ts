import { PromoParseError } from "../error.ts";
import type { PromoDetails, PromoOffer } from "../promo.ts";
import type { HtmlDocument } from "./html.ts";

export function parsePromo2013To2016(
	date: Temporal.Instant,
	document: HtmlDocument,
): PromoDetails | PromoParseError | undefined {
	const text = document.querySelector(".shipping-text")?.textContent.replace(/\s+/g, " ").trim();
	if (!text) return;

	const amount = text.match(/^FREE shipping(?: to US)? (?:from|on orders over) (\d+) \$!?$/)?.[1];
	const quantity = text.match(/^(\d+) Displates = FREE shipping (?:to|in) US!$/)?.[1];
	const condition: PromoOffer["condition"] | undefined = amount
		? { kind: "minimum-order", amount: Number(amount) }
		: quantity
			? { kind: "minimum-quantity", quantity: Number(quantity) }
			: text === "FREE shipping worldwide today!"
				? "unconditional"
				: undefined;
	if (!condition) return new PromoParseError(`Unsupported shipping text: ${text}`, "unsupported-promotion");

	return {
		code: undefined,
		offers: [{ kind: "shipping", condition, freeShipping: true }],
		endDate: text.endsWith("today!")
			? Temporal.Instant.from(`${date.toZonedDateTimeISO("UTC").toPlainDate()}T23:59:59Z`)
			: { kind: "unknown", reason: "not-published" },
		startDate: { kind: "unknown", reason: "not-published" },
	};
}
