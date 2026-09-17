import { PromoParseError } from "../error.ts";
import type { EndDate, PromoDetails } from "../promo.ts";
import type { HtmlDocument } from "./html.ts";

export function parsePromo2021To2022(document: HtmlDocument, html: string): PromoDetails | PromoParseError | undefined {
	const match = html.match(
		/<p\b[^>]*class=["'][^"']*\btext--bold\b[^"']*\btext--white\b[^"']*["'][^>]*>\s*(BUY[\s\S]*?)<\/p>[\s\S]{0,5000}?countDownDate\s*=\s*new Date\(["']([^"']+)["']\)/i,
	);
	if (!match) return;

	const fragment = document.createElement("div", {});
	fragment.innerHTML = match[1] ?? "";
	const text = fragment.textContent.replace(/\s+/g, " ").trim();
	if (text !== "BUY 1-2 DISPLATES - GET 20% OFF BUY 3+ TO GET 27% OFF ending soon!") {
		return new PromoParseError(`Unsupported injected banner: ${text}`, "unsupported-promotion");
	}

	const rawEndDate = match[2];
	if (!rawEndDate) return new PromoParseError("Missing injected banner end date", "missing-data");
	let endDate: EndDate = { kind: "unknown", reason: "relative-unresolvable", _raw: rawEndDate };
	if (/\b(?:GMT|UTC)[+-]?\d*/i.test(rawEndDate)) {
		const milliseconds = Date.parse(rawEndDate);
		endDate = Number.isFinite(milliseconds)
			? Temporal.Instant.fromEpochMilliseconds(milliseconds)
			: { kind: "unknown", reason: "invalid", _raw: rawEndDate };
	}

	return {
		code: undefined,
		offers: [
			{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 1 }, discountPercent: 20 },
			{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 3 }, discountPercent: 27 },
		],
		endDate,
		startDate: { kind: "unknown", reason: "not-published" },
	};
}
