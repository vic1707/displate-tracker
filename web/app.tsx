import type { EventClickInfo, EventInput } from "@fullcalendar/preact";
import FullCalendar from "@fullcalendar/preact/all";
import allLocales from "@fullcalendar/preact/locales-all";
import monarchPlugin from "@fullcalendar/preact/themes/monarch";
import "@fullcalendar/preact/skeleton.css";
import "@fullcalendar/preact/themes/monarch/theme.css";
import "@fullcalendar/preact/themes/monarch/palettes/green.css";
import { createRoot } from "preact/compat/client";
import { useEffect, useRef, useState } from "preact/hooks";
import "temporal-polyfill/global";
import * as v from "valibot";
import { type PromoDetails, PromoDetailsSchema, type PromoOffer } from "../src/promos/promo.ts";
import "./styles.css";

const DAY = 86_400_000;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat();
const HISTORY_URL =
	typeof location !== "undefined" && location.hostname === "vic1707.github.io"
		? "https://raw.githubusercontent.com/vic1707/displate-tracker/main/web/promo_history.json"
		: "./promo_history.json";

export interface PromoRow {
	id: string;
	promo: PromoDetails;
	start: Temporal.Instant | null;
	end: Temporal.Instant | null;
}

export interface TierComparison {
	label: string;
	current: number | null;
	historical: number | null;
	average: number;
}

type Theme = "system" | "light" | "dark";

function instant(value: PromoDetails["startDate"] | PromoDetails["endDate"]): Temporal.Instant | null {
	if (value instanceof Temporal.Instant) return value;
	return value.kind === "supposed" ? value.date : null;
}

export function parseHistory(data: unknown): Array<PromoDetails> {
	return v.parse(v.array(PromoDetailsSchema), data);
}

export function readHistory(data: Array<PromoDetails>): Array<PromoRow> {
	return data.map((promo, id) => ({
		id: String(id),
		promo,
		start: instant(promo.startDate),
		end: instant(promo.endDate),
	}));
}

export function maxDiscount(row: PromoRow): number | null {
	const discounts = row.promo.offers.filter((offer) => offer.kind === "discount");
	return discounts.length ? Math.max(...discounts.map((offer) => offer.discountPercent)) : null;
}

function exactDiscounts(row: PromoRow) {
	return row.promo.offers.filter(
		(offer): offer is Extract<PromoOffer, { kind: "discount" }> =>
			offer.kind === "discount" && !offer.upTo && offer.condition !== "unknown",
	);
}

function best(values: Array<number>): number | null {
	return values.length ? Math.max(...values) : null;
}

export function calendarDates(row: PromoRow): Pick<EventInput, "start" | "end" | "allDay"> | null {
	if (!row.start) return null;
	const knownEnd = row.end && Temporal.Instant.compare(row.end, row.start) > 0 ? row.end : null;
	return { start: row.start.toString(), end: knownEnd?.toString(), allDay: !knownEnd };
}

export function promotionAt(rows: Array<PromoRow>, at: Temporal.Instant): PromoRow | null {
	return (
		rows.findLast(
			(row) =>
				row.start !== null &&
				row.end !== null &&
				Temporal.Instant.compare(row.start, at) <= 0 &&
				Temporal.Instant.compare(at, row.end) < 0,
		) ?? null
	);
}

export function lastYearWindow(rows: Array<PromoRow>, asOf: Temporal.Instant) {
	const from = asOf.toZonedDateTimeISO("UTC").subtract({ years: 1 });
	const to = from.add({ months: 1 });
	const selected = rows
		.filter(
			(row) =>
				row.promo.startDate instanceof Temporal.Instant &&
				row.start !== null &&
				Temporal.Instant.compare(row.start, from.toInstant()) >= 0 &&
				Temporal.Instant.compare(row.start, to.toInstant()) < 0,
		)
		.reduce<PromoRow | null>((selected, row) => {
			const discount = best(exactDiscounts(row).map((offer) => offer.discountPercent));
			const previous = selected ? best(exactDiscounts(selected).map((offer) => offer.discountPercent)) : null;
			return discount !== null && discount > (previous ?? -Infinity) ? row : selected;
		}, null);
	return { from: from.toInstant(), to: to.toInstant(), best: selected };
}

export function compareTiers(
	archive: Array<PromoRow>,
	historical: PromoRow | null,
	asOf: Temporal.Instant,
): Array<TierComparison> {
	const to = asOf.toZonedDateTimeISO("UTC").startOfDay();
	const from = to.subtract({ years: 2 });
	const dayCount = (to.epochMilliseconds - from.epochMilliseconds) / DAY;
	const bounded = archive.filter(
		(row): row is PromoRow & { start: Temporal.Instant; end: Temporal.Instant } =>
			row.start !== null && row.end !== null && Temporal.Instant.compare(row.start, row.end) < 0,
	);
	const currentOffers = bounded
		.filter(
			(row) =>
				row.start.epochMilliseconds <= asOf.epochMilliseconds &&
				asOf.epochMilliseconds < row.end.epochMilliseconds,
		)
		.flatMap(exactDiscounts);
	const historicalOffers = historical ? exactDiscounts(historical) : [];
	const periods = bounded
		.map((row) => ({
			offers: exactDiscounts(row),
			start: Math.max(0, Math.floor((row.start.epochMilliseconds - from.epochMilliseconds) / DAY)),
			end: Math.min(dayCount, Math.ceil((row.end.epochMilliseconds - from.epochMilliseconds) / DAY)),
		}))
		.filter((period) => period.start < period.end);
	const offers = [...currentOffers, ...historicalOffers, ...periods.flatMap((period) => period.offers)];
	const applicable = (values: typeof offers, tier: PromoOffer["condition"]) =>
		best(
			values
				.filter((offer) => {
					const condition = offer.condition;
					if (condition === "unconditional") return true;
					if (typeof condition === "string" || typeof tier === "string") return false;
					return tier.kind === "minimum-quantity"
						? condition.kind === tier.kind && condition.quantity <= tier.quantity
						: condition.kind === tier.kind && condition.amount <= tier.amount;
				})
				.map((offer) => offer.discountPercent),
		);
	const tiers: Array<{ label: string; condition: PromoOffer["condition"] }> = [];
	if (offers.some((offer) => offer.condition === "unconditional")) {
		tiers.push({ label: "No minimum", condition: "unconditional" });
	}
	for (const quantity of [
		...new Set(
			offers.flatMap((offer) =>
				typeof offer.condition !== "string" && offer.condition.kind === "minimum-quantity"
					? [offer.condition.quantity]
					: [],
			),
		),
	].toSorted((a, b) => a - b)) {
		tiers.push({
			label: `${quantity}+ Displates`,
			condition: { kind: "minimum-quantity", quantity },
		});
	}
	for (const amount of [
		...new Set(
			offers.flatMap((offer) =>
				typeof offer.condition !== "string" && offer.condition.kind === "minimum-order"
					? [offer.condition.amount]
					: [],
			),
		),
	].toSorted((a, b) => a - b)) {
		tiers.push({
			label: `Orders over $${number.format(amount)}`,
			condition: { kind: "minimum-order", amount },
		});
	}
	return tiers.map(({ label, condition }) => {
		const daily = Array<number>(dayCount).fill(0);
		for (const period of periods) {
			const value = applicable(period.offers, condition) ?? 0;
			for (let day = period.start; day < period.end; day++) daily[day] = Math.max(daily[day] ?? 0, value);
		}
		return {
			label,
			current: applicable(currentOffers, condition),
			historical: applicable(historicalOffers, condition),
			average: daily.reduce((sum, value) => sum + value, 0) / dayCount,
		};
	});
}

function pct(value: number | null): string {
	return value === null ? "Not available" : percent.format(value / 100);
}

export function offerLabel(offer: PromoOffer): string {
	const condition = offer.condition;
	const label =
		offer.kind === "shipping" ? "Free shipping" : `${offer.upTo ? "Up to " : ""}${pct(offer.discountPercent)} off`;
	if (condition === "unconditional") return `${label} / no minimum`;
	if (condition === "unknown") return `${label} / conditions unknown`;
	return condition.kind === "minimum-quantity"
		? `${label} / ${number.format(condition.quantity)}+ Displates`
		: `${label} / orders over $${number.format(condition.amount)}`;
}

function datesLabel(row: PromoRow): string {
	const start = row.start
		? `${row.promo.startDate instanceof Temporal.Instant ? "Starts" : "First seen"} ${time.format(row.start.epochMilliseconds)}`
		: "Start unknown";
	let end = "End unknown";
	if (row.end) end = `Ends ${time.format(row.end.epochMilliseconds)}`;
	else if (!(row.promo.endDate instanceof Temporal.Instant) && "_raw" in row.promo.endDate) {
		end += ` (${row.promo.endDate._raw})`;
	}
	return `${start}. ${end}. Local time (${date.resolvedOptions().timeZone}).`;
}

function color(value: number | null, shipping: boolean): string {
	if (value === null) return shipping ? "#ad2860" : "#616671";
	if (value >= 40) return "#762ba2";
	if (value >= 30) return "#08734b";
	if (value >= 20) return "#175eac";
	return "#a34509";
}

function Archive({ rows }: { rows: Array<PromoRow> }) {
	const [kind, setKind] = useState("all");
	const [selected, setSelected] = useState<PromoRow | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (selected && !dialog.current?.open) dialog.current?.showModal();
	}, [selected]);

	const dated = rows.filter((row): row is PromoRow & { start: Temporal.Instant } => row.start !== null);
	const fallback = rows.at(-1);
	if (!fallback) throw new Error("Expected promotion history");
	const latest = dated.findLast((row) => row.start.epochMilliseconds <= Date.now()) ?? dated.at(-1) ?? fallback;
	const now = Temporal.Now.instant();
	const currentPromo = promotionAt(rows, now);
	const featured = currentPromo ?? latest;
	const discount = maxDiscount(featured);
	const shipping = featured.promo.offers.some((offer) => offer.kind === "shipping");
	const historical = lastYearWindow(rows, now);
	const tiers = compareTiers(rows, historical.best, now);
	const comparableTiers = tiers.filter((tier) => tier.current !== null && tier.historical !== null);
	const betterTiers = tiers.filter(
		(tier) => tier.current !== null && tier.historical !== null && tier.historical > tier.current,
	).length;
	const historicalDelay = historical.best?.start
		? Math.round((historical.best.start.epochMilliseconds - historical.from.epochMilliseconds) / DAY)
		: null;
	const events = rows
		.filter((row) => kind === "all" || row.promo.offers.some((offer) => offer.kind === kind))
		.flatMap((row): Array<EventInput> => {
			const dates = calendarDates(row);
			if (!dates) return [];
			const value = maxDiscount(row);
			const hasShipping = row.promo.offers.some((offer) => offer.kind === "shipping");
			const uncertain = !(row.promo.startDate instanceof Temporal.Instant) || !row.end;
			return [
				{
					...dates,
					id: row.id,
					title: `${value !== null ? `Up to ${pct(value)}${hasShipping ? " + free shipping" : ""}` : hasShipping ? "Free shipping" : "No offer details"} / ${row.promo.code || "Automatic"}${uncertain ? " (?)" : ""}`,
					color: color(value, hasShipping),
					contrastColor: "#fff",
					className: [uncertain && "uncertain", hasShipping && value !== null && "mixed"]
						.filter(Boolean)
						.join(" "),
					extendedProps: { row },
				},
			];
		});
	const first = dated.at(0);
	const last = dated.at(-1);

	const comparison =
		betterTiers > 0
			? `${betterTiers === comparableTiers.length ? "Last year was better at every comparable tier." : `Last year was better at ${number.format(betterTiers)} of ${number.format(comparableTiers.length)} comparable tiers.`} Waiting may be worthwhile.`
			: comparableTiers.length
				? "No comparable tier was better in this window last year."
				: "No comparable percentage tiers were recorded in this window last year.";

	return (
		<>
			<section id="history" class="history">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Promotion history</p>
						<h2>Promotion calendar</h2>
					</div>
					<label>
						Offer{" "}
						<select value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
							<option value="all">All promotions</option>
							<option value="discount">Discounts</option>
							<option value="shipping">Free shipping</option>
						</select>
					</label>
				</div>
				<p class="small">
					{number.format(rows.length)} campaigns
					{first && last
						? ` / ${date.format(first.start.epochMilliseconds)} - ${date.format(last.start.epochMilliseconds)}`
						: ""}
				</p>
				<div class="calendar">
					<FullCalendar
						plugins={[monarchPlugin]}
						locales={allLocales}
						locale={navigator.language}
						initialDate={new Date(latest.start?.epochMilliseconds ?? Date.now())}
						initialView="dayGridMonth"
						headerToolbar={{
							start: "prev,next today",
							center: "title",
							end: "",
						}}
						footerToolbar={{
							start: "",
							center: "dayGridMonth,multiMonthYear timeGridWeek,listYear",
							end: "",
						}}
						height="auto"
						fixedWeekCount={false}
						dayMaxEvents={3}
						eventDisplay="block"
						nextDayThreshold="00:00:00"
						allDayText="Unknown end"
						slotEventOverlap={false}
						views={{ dayGridMonth: { displayEventTime: false }, timeGridWeek: { displayEventEnd: true } }}
						events={events}
						eventClick={(info: EventClickInfo) => setSelected(info.event.extendedProps.row as PromoRow)}
					/>
				</div>
				<p class="legend small">
					<span class="top">40%+</span>
					<span class="strong">30-39%</span>
					<span class="medium">20-29%</span>
					<span class="low">Under 20%</span>
					<span class="shipping">Free shipping</span>
					<span class="mixed-key">Discount + shipping</span>
					<span class="other">Unknown offer</span>
				</p>
				<p class="small">
					Colors show the highest advertised discount. Conditions apply. Dashed borders mark uncertain dates.
					Month includes every day touched by an offer; Week and details show precise times.
				</p>
			</section>

			<section class="overview" aria-label="Latest promotion comparison">
				<article
					class={`featured${shipping && discount !== null ? " mixed" : ""}`}
					style={{ backgroundColor: color(discount, shipping) }}
				>
					<p class="eyebrow">{currentPromo ? "Current recorded promotion" : "Latest recorded promotion"}</p>
					<h2>{featured.promo.code || "Automatic promotion"}</h2>
					<p class="big-number">
						{discount !== null ? `Up to ${pct(discount)}` : shipping ? "Free shipping" : "No offer details"}
					</p>
					<ul>
						{featured.promo.offers.length ? (
							featured.promo.offers.map((offer) => <li key={offerLabel(offer)}>{offerLabel(offer)}</li>)
						) : (
							<li>No offer details recorded.</li>
						)}
					</ul>
					{featured.promo.description && <p class="small">{featured.promo.description}</p>}
					<p class="small">{datesLabel(featured)}</p>
					<button class="text-button" type="button" onClick={() => setSelected(featured)}>
						View full record
					</button>
				</article>
				<div class="comparison">
					<p class="eyebrow">Equivalent window last year</p>
					<h2>{comparison}</h2>
					{historical.best && (
						<p class="small">
							<strong>{historical.best.promo.code || "Automatic promotion"}</strong> started{" "}
							{date.format(historical.best.start?.epochMilliseconds)}
							{historicalDelay === null ? "" : `, ${number.format(historicalDelay)} days into the window`}
							.
						</p>
					)}
					{tiers.length > 0 && (
						<table class="tier-comparison">
							<thead>
								<tr>
									<th scope="col">Tier</th>
									<th scope="col">Today</th>
									<th scope="col">Last year</th>
									<th scope="col">Avg 2y</th>
								</tr>
							</thead>
							<tbody>
								{tiers.map((tier) => (
									<tr key={tier.label}>
										<th scope="row">{tier.label}</th>
										<td>{tier.current === null ? "—" : pct(tier.current)}</td>
										<td
											class={
												tier.current !== null &&
												tier.historical !== null &&
												tier.historical > tier.current
													? "better"
													: ""
											}
										>
											{tier.historical === null ? "—" : pct(tier.historical)}
										</td>
										<td>{pct(tier.average)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<p class="small">
						Exact percentages only; shipping, up-to offers and unknown eligibility are excluded. Lower
						thresholds carry forward; quantity and order tiers stay separate. Last-year window:{" "}
						{date.format(historical.from.epochMilliseconds)} -{" "}
						{date.format(historical.to.epochMilliseconds)}. History is not a forecast.
					</p>
					<p class="small">
						Avg 2y: from UTC midnight two calendar years ago through yesterday, including leap days. Each
						day uses the best applicable recorded percentage (any overlap, not a sum). No offer for a tier
						counts as 0%. Unknown endpoints are excluded; first-seen dates count only from observation.
						Archive gaps count as 0%, not proof the retailer had no sale.
					</p>
				</div>
			</section>

			<dialog ref={dialog} onClose={() => setSelected(null)} aria-labelledby="record-title">
				<form method="dialog">
					<button type="submit">Close</button>
				</form>
				{selected && (
					<>
						<p class="eyebrow">Promotion record</p>
						<h2 id="record-title">{selected.promo.code || "Automatic promotion"}</h2>
						<p class="big-number">
							{maxDiscount(selected) !== null
								? `Up to ${pct(maxDiscount(selected))}`
								: selected.promo.offers.some((offer) => offer.kind === "shipping")
									? "Free shipping"
									: "No offer details"}
						</p>
						<ul>
							{selected.promo.offers.length ? (
								selected.promo.offers.map((offer) => (
									<li key={offerLabel(offer)}>{offerLabel(offer)}</li>
								))
							) : (
								<li>No offer details recorded.</li>
							)}
						</ul>
						{selected.promo.description && <p>{selected.promo.description}</p>}
						<p>{datesLabel(selected)}</p>
						<details>
							<summary>Raw record</summary>
							<pre>{JSON.stringify(selected.promo, null, 2)}</pre>
						</details>
					</>
				)}
			</dialog>
		</>
	);
}

function App() {
	const [theme, setTheme] = useState<Theme>(() => {
		try {
			const saved = localStorage.getItem("theme");
			if (saved === "light" || saved === "dark") return saved;
		} catch {}
		return "system";
	});
	const [history, setHistory] = useState<Array<PromoDetails> | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		const media = matchMedia("(prefers-color-scheme: dark)");
		const apply = () =>
			document.documentElement.setAttribute(
				"data-color-scheme",
				theme === "system" ? (media.matches ? "dark" : "light") : theme,
			);
		apply();
		media.addEventListener("change", apply);
		try {
			localStorage.setItem("theme", theme);
		} catch {}
		return () => media.removeEventListener("change", apply);
	}, [theme]);

	useEffect(() => {
		fetch(HISTORY_URL, { cache: "no-store" })
			.then((response) => {
				if (!response.ok) throw new Error(`Could not load promo_history.json (HTTP ${response.status}).`);
				return response.json();
			})
			.then((data) => setHistory(parseHistory(data)))
			.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
	}, []);

	const rows = history ? readHistory(history) : [];
	return (
		<>
			<a class="skip-link" href="#history">
				Skip to promotion history
			</a>
			<header class="masthead">
				<h1>
					<a href="./" class="wordmark">
						DISPLATE <span>/ DISCOUNT ARCHIVE</span>
					</a>
				</h1>
				<nav>
					<label>
						Theme{" "}
						<select value={theme} onChange={(event) => setTheme(event.currentTarget.value as Theme)}>
							<option value="system">System</option>
							<option value="light">Light</option>
							<option value="dark">Dark</option>
						</select>
					</label>
					<a href={HISTORY_URL}>Source JSON</a>
					<a
						class="github-link"
						href="https://github.com/vic1707/displate-tracker"
						aria-label="View project on GitHub"
						title="View project on GitHub"
					>
						<img src="https://cdn.simpleicons.org/github" alt="" />
					</a>
				</nav>
			</header>
			<main>
				{error ? (
					<p role="alert" class="error">
						{error} Reload to try again.
					</p>
				) : history === null ? (
					<p>Loading archive...</p>
				) : rows.length ? (
					<Archive rows={rows} />
				) : (
					<p role="alert" class="error">
						The promotion archive is empty.
					</p>
				)}
				<details class="notes">
					<summary>About this archive</summary>
					<p>
						This is an independent, read-only view of <a href={HISTORY_URL}>promo_history.json</a>.
						Historical coverage is uneven: a gap is not evidence that no promotion ran, and a recorded end
						date does not confirm an offer is live.
					</p>
					<p>
						Dates use your device's local time zone and browser locale. “First seen” is an observation, not
						a confirmed start. Product exclusions, regional differences and final checkout eligibility are
						not captured. Check the retailer's terms before buying.
					</p>
				</details>
			</main>
			<footer>
				<span>Independent archive. Not affiliated with Displate.</span>
				<span>Read the history. Make your own call.</span>
			</footer>
		</>
	);
}

if (typeof document !== "undefined") {
	const root = document.getElementById("app");
	if (root) createRoot(root).render(<App />);
}
