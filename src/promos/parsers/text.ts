import type { PromoOffer } from "../promo.ts";

export const promoCode = (text: string) => text.match(/\bcode\s*:?\s*([a-z\d]+)/i)?.[1]?.toUpperCase();

// A flat claim cannot supply quantity thresholds. Only explicit sitewide wording
// (or a bare discount) is unrestricted; callers retain the wording in description.
export function flatDiscountOffers(text: string): Array<PromoOffer> {
	const matches = Array.from(text.matchAll(/\b(up\s+to\s+)?(\d+)%\s*(?:OFF\b)?/gi));
	if (matches.length !== 1) return [];
	const match = matches[0];
	if (!match) return [];
	const suffix = text
		.slice(match.index + match[0].length)
		.split(/\||\b(?:use|with)?\s*code\b|\bEXPANDED\b/i)[0]
		?.trim();
	const unrestricted =
		/^(?:(?:on\s+)?(?:sitewide|everything|all orders(?: made)?|all products|all displates)[!.]?)?$/i.test(
			suffix ?? "",
		);
	return [
		{
			kind: "discount",
			condition: match[1] || !unrestricted ? "unknown" : "unconditional",
			discountPercent: Number(match[2]),
			...(match[1] ? { upTo: true } : {}),
		},
	];
}

// The buy-first quantity notation is shared by the legacy and server topbars.
export function buyQuantityOffers(text: string): Array<PromoOffer> {
	return Array.from(
		text.matchAll(
			/(?:buy|order)?\s*(\d+)(?:\s*-\s*\d+|\s*\+|\s+and\s+more)(?:\s+(?:displates|posters))?\s*(?:-\s*)?(?:(?:and\s+|to\s+)?get\s+|save\s+)?(\d+)%(?:\s*off)?/gi,
		),
		([, quantity, discount]) => ({
			kind: "discount",
			condition: { kind: "minimum-quantity", quantity: Number(quantity) },
			discountPercent: Number(discount),
		}),
	);
}
