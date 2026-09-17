# Displate Discount Archive

The frontend is one declarative Preact entry point using FullCalendar v7, the tracker's existing Valibot promotion schema, and a small stylesheet. Bun performs the only build step; there is no application server.

## Preview

After the first scraper CI run generates `web/promo_history.json`, run `bun run preview` and open http://127.0.0.1:3000. This builds the site into ignored `dist/`, copies the current archive, and serves it locally. The generated archive is not a test fixture and need not be committed to build the frontend bundle.

`web/promo_history.json` remains the tracker's source of truth. Local previews load the local copy; the deployed GitHub Pages site loads the latest copy from `main` through `raw.githubusercontent.com`. The frontend validates and converts it using `src/promos/promo.ts`, so tracker updates do not require a site deployment.

## Checks

- `bun run build:web`: production frontend build and archive copy (requires the generated archive).
- `bun build web/app.tsx --outdir dist --minify`: frontend bundle check without an archive.
- `bun test web/app.test.ts`: frontend checks with small synthetic records; no generated archive required.
- `bun test`: tracker and frontend tests.
- `bun run check`: Biome checks.
- `bun run tsc`: TypeScript checks, including Temporal's external declarations.

## Percentage Comparison

- **Today** takes the best applicable exact percentage across all records active at the current instant. The featured card still shows one current (or latest) record; shipping remains visible there and in the calendar.
- **Last year** uses the record with the highest eligible exact percentage starting in the equivalent one-month window last year. Unknown starts and first-seen-only starts are not candidates. An advertised up-to maximum or unknown eligibility cannot displace a known exact offer.
- **Avg 2y** is a rolling two-calendar-year daily average: from UTC midnight on today's date minus two years, inclusive, to today's UTC midnight, exclusive. Calendar subtraction constrains February 29 to February 28 where necessary. The denominator includes every completed UTC day in that interval, including leap days; it is not a fixed 730 days or just days with recorded sales.

Each tier uses its highest applicable exact percentage on any part of each day, not a time-weighted rate. Overlapping records and separate codes take the maximum, never the sum. Start is inclusive and end exclusive, so an offer ending at midnight does not cover the following day. A first-seen date counts only from observation; missing endpoints and empty/reversed intervals do not establish coverage. Missing offers for a tier and archive gaps count as zero, **not evidence that the retailer had no sale**.

Tier thresholds come from Today, Last year and the average's dated records. Lower thresholds carry forward, unconditional offers apply to all tiers, and quantity and order-value conditions remain separate. Shipping has no assigned percentage. Up-to discounts and unknown eligibility are excluded from all percentage comparisons but remain visible in record details and the calendar's advertised maximum. Raw descriptions are shown when provided. A dash in Today or Last year means no applicable recorded exact percentage; Avg 2y still includes those zero days. History is not a forecast or a guarantee of checkout eligibility.
