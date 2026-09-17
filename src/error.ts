export class AppError<Code extends string = string> extends Error {
	constructor(
		message: string,
		public readonly code: Code,
		public readonly severity: "warning" | "error" = "error",
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = this.constructor.name;
	}
}
