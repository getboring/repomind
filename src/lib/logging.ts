export interface LogContext {
	requestId?: string;
	path?: string;
	method?: string;
	[key: string]: unknown;
}

export function logInfo(message: string, context: LogContext = {}) {
	console.log(JSON.stringify({ level: "info", message, timestamp: Date.now(), ...context }));
}

export function logError(message: string, error: unknown, context: LogContext = {}) {
	console.error(
		JSON.stringify({
			level: "error",
			message,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			timestamp: Date.now(),
			...context,
		})
	);
}

export function logWarn(message: string, context: LogContext = {}) {
	console.warn(JSON.stringify({ level: "warn", message, timestamp: Date.now(), ...context }));
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries?: number;
		baseDelayMs?: number;
		context?: LogContext;
	} = {}
): Promise<T> {
	const { maxRetries = 3, baseDelayMs = 1000, context = {} } = options;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt === maxRetries) {
				logError("Max retries exceeded", error, { ...context, attempt, maxRetries });
				throw error;
			}

			const delay = baseDelayMs * 2 ** (attempt - 1);
			logWarn(`Retrying after error`, { ...context, attempt, maxRetries, delay });
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw new Error("Unreachable");
}

export function generateRequestId(): string {
	return crypto.randomUUID();
}
