import * as v from "valibot";
import { PromoParseError } from "../error.ts";
import type { PromoDetails, PromoOffer } from "../promo.ts";
import type { HtmlDocument } from "./html.ts";
import { InstantSchema } from "./next.ts";
import { flatDiscountOffers, promoCode } from "./text.ts";

export function parsePromo2022To2024(
	document: HtmlDocument,
): PromoDetails | Array<PromoDetails> | PromoParseError | undefined {
	const raw = document.querySelector("#__NEXT_DATA__")?.textContent.trim();
	if (!raw) {
		if (document.querySelector("title")?.textContent.trim() === "Displate - metal posters | Collect Your Passions")
			return;
		return new PromoParseError("No __NEXT_DATA__ script found", "missing-data");
	}

	const { topBar, featuredEvent } = v.parse(ReactShellSchema, JSON.parse(raw)).props.pageProps.homepageData;
	if (topBar?.contentDesktop) {
		const fragment = document.createElement("div", {});
		fragment.innerHTML = topBar.contentDesktop;
		for (const node of fragment.querySelectorAll("script, style")) node.remove();
		const text = fragment.textContent.replace(/\s+/g, " ").trim();
		const promos = parseTopbarText(text);
		if (promos instanceof PromoParseError) return promos;
		return promos.map((promo) => ({ ...promo, endDate: topBar.endDate, startDate: topBar.startDate }));
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

function parseTopbarText(text: string): Array<Pick<PromoDetails, "code" | "offers" | "description">> | PromoParseError {
	// These two campaigns use opposite code/discount order, and omit "code" or
	// "OFF" in the second clause. Keep their observed grammars explicit.
	const force = text.match(
		/^Use code (\w+) to get (\d+)% OFF on Star Wars or (\w+) to get (\d+)% on other matte & gloss posters \| Ends: .+$/i,
	);
	if (force) {
		return [
			{
				code: force[1]?.toUpperCase(),
				description: `${force[2]}% OFF on Star Wars`,
				offers: [{ kind: "discount", condition: "unknown", discountPercent: Number(force[2]) }],
			},
			{
				code: force[3]?.toUpperCase(),
				description: `${force[4]}% on other matte & gloss posters`,
				offers: [{ kind: "discount", condition: "unknown", discountPercent: Number(force[4]) }],
			},
		];
	}
	const art = text.match(
		/^Get up to (\d+)% OFF chosen posters with code (\w+) and (\d+)% OFF all matte and gloss Displates with code (\w+) \| Ends: .+$/i,
	);
	if (art) {
		return [
			{
				code: art[2]?.toUpperCase(),
				description: `Up to ${art[1]}% OFF chosen posters`,
				offers: [{ kind: "discount", condition: "unknown", discountPercent: Number(art[1]), upTo: true }],
			},
			{
				code: art[4]?.toUpperCase(),
				description: `${art[3]}% OFF all matte and gloss Displates`,
				offers: [{ kind: "discount", condition: "unknown", discountPercent: Number(art[3]) }],
			},
		];
	}

	const unsupported = () => new PromoParseError(`Unsupported topbar: ${text}`, "unsupported-promotion");
	if (Array.from(text.matchAll(/\bcode\b/gi)).length > 1) return unsupported();
	let offers: Array<PromoOffer> = Array.from(
		text.matchAll(/(\d+)%\s*OFF\s*(?:on|with)?\s*(\d+)(?:\s*-\s*\d+|\s*\+)?/gi),
		([, discount, quantity]) => ({
			kind: "discount",
			condition: { kind: "minimum-quantity", quantity: Number(quantity) },
			discountPercent: Number(discount),
		}),
	);
	if (offers.length === 0) offers = flatDiscountOffers(text);
	if (offers.length !== Array.from(text.matchAll(/\d+%/g)).length) return unsupported();
	if (
		/^(?:Get )?Free Shipping on (?:All Displate Orders|all Displates|all metal posters|everything)!?\s*(?:\||with code\b)/i.test(
			text,
		)
	) {
		offers.push({ kind: "shipping", condition: "unconditional", freeShipping: true });
	}
	const code = promoCode(text);
	if (!code && offers.length === 0) return unsupported();
	return [{ code, offers, description: text }];
}

const ReactShellSchema = v.object({
	props: v.object({
		pageProps: v.object({
			homepageData: v.object({
				topBar: v.optional(
					v.object({ contentDesktop: v.string(), startDate: InstantSchema, endDate: InstantSchema }),
				),
				featuredEvent: v.optional(v.object({ title: v.string(), badge: v.optional(v.string()) })),
			}),
		}),
	}),
});
