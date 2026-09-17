import { AppError } from "../error.ts";

export type PromoParseErrorCode =
	| "invalid-promotion"
	| "missing-data"
	| "parse-failed"
	| "unsupported-promotion"
	| "wayback-interstitial";

export class PromoParseError extends AppError<PromoParseErrorCode> {}
