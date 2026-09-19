# Displate Discount Tracker

A small tracker for answering one question:

> **Displate seems to be on sale 24/7 — so what does an actually good discount look like?**

**Live:** https://displate-tracker.bofzilla.dev/

## What it does

Displate Discount Tracker keeps a history of promotions advertised on Displate and makes them easier to compare over time.

The site shows:

* the currently recorded promotion and promo code
* discount tiers and conditions
* how the current offer compares with the equivalent period last year
* a 2-year daily discount average
* a calendar of historical promotions
* free-shipping offers
* exact/estimated promotion start and end dates

Historical data is also reconstructed from archived Displate pages available through the Wayback Machine.

The current Displate homepage is checked automatically several times per day, with new promotion data committed back into the repository.

## Why?

I was looking at Displate and noticed there seemed to be some kind of sale running basically all the time.

That made the usual **“X% OFF”** banner a lot less useful. Is 25% good? Is 35% normal? Should you actually wait for the next promotion?

Rather than guessing, I wanted to see the history.

This project is the result.

## Run locally

Requires [Bun](https://bun.sh/).

```bash
git clone https://github.com/vic1707/displate-tracker.git
cd displate-tracker

bun install
```

Start the site locally:

```bash
bun run preview
```

Capture the current Displate promotion:

```bash
bun run daily
```

Backfill promotion history from Wayback Machine snapshots:

```bash
bun run scrapper
```

Other useful commands:

```bash
bun run check
bun run check:fix
bun run tsc
```

## Caveats

This is an independent archive and is **not affiliated with Displate**.

Historical coverage is imperfect. Missing archive data does not necessarily mean no promotion was running (ie: missing free shipping on 14-15/09/2026).

Discount eligibility can also depend on quantity, order value, region, product exclusions, or other terms. Always check the actual offer and checkout price before buying.

## Contributing

Found a promotion the parser missed, bad historical data, or another edge case?

Issues and PRs are welcome.
