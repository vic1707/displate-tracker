import { expect, test } from "bun:test";
import * as v from "valibot";
import { PromoParseError } from "./error.ts";
import { parsePromo } from "./index.ts";
import { EndDateSchema, formatPromo, type PromoDetails } from "./promo.ts";

test("parses current conditional shipping", () => {
	const promotion = {
		code: "FREE",
		publishesAt: "2026-08-25T08:00:00Z",
		endsAt: "2026-08-26T07:59:59Z",
		type: "shipping",
		steps: [],
		shipping: { minValue: { formatted: "$0", amountInCurrency: 0 }, percentageValue: 100 },
	};
	const parse = (promotion: object) => {
		const result = parsePromo(
			Temporal.Instant.from("2026-08-25T17:36:38Z"),
			`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { header: { promotion } } } })}</script>`,
		);
		expect(result).not.toBeInstanceOf(PromoParseError);
		if (result instanceof PromoParseError) return;
		return result[0];
	};

	expect(
		parse({
			...promotion,
			shipping: { ...promotion.shipping, minValue: { formatted: "$50", amountInCurrency: 50 } },
		})?.offers,
	).toEqual([{ kind: "shipping", condition: { kind: "minimum-order", amount: 50 }, freeShipping: true }]);
	expect(parse({ ...promotion, steps: [{ minQuantity: 3 }] })?.offers).toEqual([
		{ kind: "shipping", condition: { kind: "minimum-quantity", quantity: 3 }, freeShipping: true },
	]);
});

test("classifies Wayback interstitials as warnings", () => {
	const result = parsePromo(
		Temporal.Instant.from("2025-04-11T06:31:30Z"),
		"<!doctype html><html><head><title>Wayback Machine</title></head></html>",
	);
	expect(result).toBeInstanceOf(PromoParseError);
	expect(result).toMatchObject({
		code: "wayback-interstitial",
		severity: "warning",
	});
});

test("returns fatal parser errors as values", () => {
	const result = parsePromo(Temporal.Instant.from("2025-04-17T06:51:08Z"), "<title>Displate</title>");
	expect(result).toBeInstanceOf(PromoParseError);
	expect(result).toMatchObject({ code: "missing-data", severity: "error" });
});

function nextData(pageProps: object): string {
	return `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps } })}</script>`;
}

function topbar(text: string): Array<PromoDetails> {
	const result = parsePromo(
		Temporal.Instant.from("2024-06-25T07:22:36Z"),
		nextData({
			homepageData: {
				topBar: {
					contentDesktop: `<p>${text}</p>`,
					startDate: "2024-06-24T07:00:00Z",
					endDate: "2024-06-25T07:00:00Z",
				},
			},
		}),
	);
	if (result instanceof PromoParseError) throw result;
	return result;
}

test("snapshot maxima remain unknown, while advertised quantity tiers remain exact", () => {
	const [maximum] = topbar(
		"Up to <strong>40% OFF</strong> on matte and gloss Displates | Use Code: <strong>BDAY</strong> | Ends: Thursday",
	);
	expect(maximum?.offers).toEqual([{ kind: "discount", condition: "unknown", discountPercent: 40, upTo: true }]);
	expect(formatPromo(maximum)).toContain("up to 40% off (conditions unknown)");
	expect(maximum?.description).toContain("matte and gloss");
	expect(maximum?.endDate).toBeInstanceOf(Temporal.Instant);
	expect(maximum?.endDate.toString()).toBe("2024-06-25T07:00:00Z");

	const [tiered] = topbar(
		"Get 20% OFF with 1-2 or 25% OFF with 3+ matte and gloss Displates | Use Code: SAVE25 | Ends: Sunday",
	);
	expect(tiered?.offers).toEqual([
		{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 1 }, discountPercent: 20 },
		{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 3 }, discountPercent: 25 },
	]);
});

test("May 1 and April 12 snapshots produce separate, correctly attributed codes", () => {
	const force = topbar(
		"Use code&nbsp;<strong>FORCE&nbsp;</strong>to get 35% OFF on Star Wars or&nbsp;<strong>GET20</strong>&nbsp;to get 20% on other matte &amp; gloss posters | Ends:&nbsp;<strong>Soon</strong>",
	);
	expect(force.map(({ code, offers }) => ({ code, offers }))).toEqual([
		{ code: "FORCE", offers: [{ kind: "discount", condition: "unknown", discountPercent: 35 }] },
		{ code: "GET20", offers: [{ kind: "discount", condition: "unknown", discountPercent: 20 }] },
	]);
	expect(force[0]?.description).toContain("Star Wars");
	expect(force[1]?.description).toContain("other matte & gloss");
	expect(force[0]?.endDate.toString()).toBe(force[1]?.endDate.toString());

	const art = topbar(
		"Get up to&nbsp;<strong>35% OFF</strong>&nbsp;chosen posters with code&nbsp;<strong>ART</strong>&nbsp;and&nbsp;<strong>20% OFF</strong>&nbsp;all matte and gloss Displates with code&nbsp;<strong>ARTDAY</strong>&nbsp;| Ends: Soon",
	);
	expect(art.map(({ code, offers }) => ({ code, offers }))).toEqual([
		{ code: "ART", offers: [{ kind: "discount", condition: "unknown", discountPercent: 35, upTo: true }] },
		{ code: "ARTDAY", offers: [{ kind: "discount", condition: "unknown", discountPercent: 20 }] },
	]);
	expect(art[0]?.description).toContain("chosen posters");
	expect(art[1]?.description).toContain("all matte and gloss");
});

test("legacy and server banners preserve restrictions and buy-first quantity tiers", () => {
	for (const [date, html, offers] of [
		[
			"2017-11-14",
			'<div id="black_friday_text">30% OFF Selected Collections. Check them here!</div>',
			[{ kind: "discount", condition: "unknown", discountPercent: 30 }],
		],
		[
			"2019-07-22",
			'<div class="topbar__text">24% OFF L and XL size | Use code: LARGE | Ends: Tuesday</div>',
			[{ kind: "discount", condition: "unknown", discountPercent: 24 }],
		],
		[
			"2018-04-08",
			'<div id="black_friday_text">All Star Promo - Use code: ALLSTAR Buy 3-4 get 15% OFF | 5+ 20% OFF</div>',
			[
				{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 3 }, discountPercent: 15 },
				{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 5 }, discountPercent: 20 },
			],
		],
		[
			"2019-08-12",
			'<div class="topbar__text">Buy 1-2 Save 25% | Buy 3+ Save 35%Use code: BTS | Ends: Soon!</div>',
			[
				{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 1 }, discountPercent: 25 },
				{ kind: "discount", condition: { kind: "minimum-quantity", quantity: 3 }, discountPercent: 35 },
			],
		],
	] as const) {
		const result = parsePromo(Temporal.Instant.from(`${date}T12:00:00Z`), html);
		if (result instanceof PromoParseError) throw result;
		expect(result[0]?.offers).toEqual([...offers]);
		expect(result[0]?.description).toBeTruthy();
	}
});

test("all structured eras retain expired endsAt timestamps", () => {
	const promotion = {
		code: "OLD",
		publishesAt: "2024-12-01T08:00:00Z",
		endsAt: "2024-12-02T08:00:00Z",
		type: "flat",
		steps: [{ minQuantity: 1, percentageValue: 20 }],
	};
	for (const [date, pageProps] of [
		["2024-12-20", { homepageData: { promotion } }],
		["2025-01-10", { homepageData: { header: { promotion } } }],
		["2026-08-25", { header: { promotion } }],
	] as const) {
		const result = parsePromo(Temporal.Instant.from(`${date}T12:00:00Z`), nextData(pageProps));
		if (result instanceof PromoParseError) throw result;
		expect(result[0]?.endDate).toBeInstanceOf(Temporal.Instant);
		expect(result[0]?.endDate.toString()).toBe(promotion.endsAt);
	}
});

test("injected countdowns keep explicit expired instants but do not guess a timezone", () => {
	for (const raw of ["May 17, 2021 09:00:00 GMT+0200", "December 11, 2020 23:59:00"]) {
		const result = parsePromo(
			Temporal.Instant.from("2021-06-01T12:00:00Z"),
			`<p class="text--bold text--white">BUY 1-2 DISPLATES - GET 20% OFF BUY 3+ TO GET 27% OFF ending soon!</p><script>countDownDate = new Date("${raw}")</script>`,
		);
		if (result instanceof PromoParseError) throw result;
		if (raw.includes("GMT")) expect(result[0]?.endDate.toString()).toBe("2021-05-17T07:00:00Z");
		else expect(result[0]?.endDate).toEqual({ kind: "unknown", reason: "relative-unresolvable", _raw: raw });
	}
});

test("legacy ended schema inputs normalize without retaining an ended output variant", () => {
	const timestamp = "2024-06-25T07:00:00Z";
	expect(v.parse(EndDateSchema, { kind: "ended", _raw: timestamp }).toString()).toBe(timestamp);
	expect(v.parse(EndDateSchema, { kind: "ended", _raw: "yesterday" })).toEqual({
		kind: "unknown",
		reason: "relative-unresolvable",
		_raw: "yesterday",
	});
});

test("absent promotions normalize to empty arrays, including before the first era", () => {
	expect(parsePromo(Temporal.Instant.from("2013-01-01T00:00:00Z"), "<title>Displate</title>")).toEqual([]);
	expect(parsePromo(Temporal.Instant.from("2026-08-25T00:00:00Z"), nextData({ header: {} }))).toEqual([]);
});

test("featured fallbacks preserve cached titles but reject unparsed offers in both eras", () => {
	for (const date of ["2024-03-10T20:19:34Z", "2025-03-04T07:48:39Z"]) {
		const parseTitle = (title: string) =>
			parsePromo(
				Temporal.Instant.from(date),
				nextData({ homepageData: { header: {}, featuredEvent: { badge: "promo", title } } }),
			);
		for (const title of [
			"Free shipping with code FREE",
			"Buy 1-2 get 20% OFF | Buy 3+ get 30% OFF with code SAVE",
		]) {
			expect(parseTitle(title)).toMatchObject({ code: "unsupported-promotion" });
		}
		expect(parseTitle("Women's Day Sale! Shop with code WDAY")).toMatchObject([{ code: "WDAY", offers: [] }]);
		for (const title of ["Your wall's next quest: 23% OFF with code QUEST23", "Shop 23% OFF with code QUEST23"]) {
			expect(parseTitle(title)).toMatchObject([
				{
					code: "QUEST23",
					offers: [{ kind: "discount", condition: "unconditional", discountPercent: 23 }],
				},
			]);
		}
	}
});
