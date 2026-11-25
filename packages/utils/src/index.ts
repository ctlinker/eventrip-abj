export type Result<T, E = Error> =
	| { ok: true; data: T }
	| { ok: false; error: E };

export async function tryCatch<T, E = Error>(
	input: Promise<T> | (() => Promise<T>),
): Promise<Result<T, E>> {
	try {
		const data = await (typeof input === 'function' ? input() : input);
		return { ok: true, data };
	} catch (error) {
		return { ok: false, error: error as E };
	}
}

export function tryCatchSync<T, E = Error>(fn: () => T): Result<T, E> {
	try {
		return { ok: true, data: fn() };
	} catch (error) {
		return { ok: false, error: error as E };
	}
}

export function isUniqueConstraintError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err ?? '');
	return msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT');
}

export function getErrorMessage(err: unknown, fallback = 'Erreur interne'): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === 'string' && err) return err;
	return fallback;
}
