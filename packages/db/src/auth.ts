import { betterAuth, type Auth } from 'better-auth';
import { D1Dialect } from 'kysely-d1';

export interface ResetPasswordEmailPayload {
	user: { id: string; email: string; name: string };
	url: string;
	token: string;
	request?: Request;
}

export interface PasswordResetAuditPayload {
	user: { id: string; email: string; name: string };
	request?: Request;
}

export interface AuthHooks {
	sendResetPasswordEmail?: (payload: ResetPasswordEmailPayload) => Promise<void>;
	onPasswordResetAudit?: (payload: PasswordResetAuditPayload) => Promise<void>;
}

let currentAuthHooks: AuthHooks = {};

export const rawBetterAuthConfig = {
	emailAndPassword: {
		enabled: true,
		revokeSessionsOnPasswordReset: true,
		async sendResetPassword(
			data: { user: { id: string; email: string; name: string }; url: string; token: string },
			request?: Request,
		) {
			if (!currentAuthHooks.sendResetPasswordEmail) {
				throw new Error("Service d'envoi d'email non configuré.");
			}
			await currentAuthHooks.sendResetPasswordEmail({
				user: {
					id: data.user.id,
					email: data.user.email,
					name: data.user.name,
				},
				url: data.url,
				token: data.token,
				request,
			});
		},
		async onPasswordReset(
			data: { user: { id: string; email: string; name: string } },
			request?: Request,
		) {
			if (currentAuthHooks.onPasswordResetAudit) {
				await currentAuthHooks.onPasswordResetAudit({
					user: {
						id: data.user.id,
						email: data.user.email,
						name: data.user.name,
					},
					request,
				});
			}
		},
	},
	user: {
		additionalFields: {
			phone: {
				type: 'string' as const,
				required: false,
			},
			commune: {
				type: 'string' as const,
				required: false,
			},
			role: {
				type: 'string' as const,
				required: false,
				defaultValue: 'client',
				input: false,
			},
			permissions: {
				type: 'string' as const,
				required: false,
				defaultValue: '[]',
				input: false,
			},
			is_active: {
				type: 'number' as const,
				required: false,
				defaultValue: 1,
				input: false,
			},
		},
	},
	trustedOrigins: async (request?: Request) => {
		const list = [
			'nostress://',
			'nostress://*',
			'exp://',
			'exp://*',
			'http://localhost:*',
			'http://127.0.0.1:*',
			'http://10.0.2.2:*',
			'https://eventrip-abj.com',
			'https://*.eventrip-abj.com',
			'https://*.app.github.dev',
			'https://*.workers.dev',
			'https://*.pages.dev',
		];
		if (request) {
			const origin = request.headers.get('origin');
			if (origin && origin !== 'null') {
				list.push(origin);
			}
			const referer = request.headers.get('referer');
			if (referer) {
				try {
					const parsed = new URL(referer).origin;
					if (parsed && parsed !== 'null') list.push(parsed);
				} catch (_) {}
			}
		}
		return list;
	},
	advanced: {
		disableCSRFCheck: true,
	},
};

let cachedAuth: Auth<any> | undefined;
let lastAuthDBBinding: D1Database | undefined;

export function initAuth(DB: D1Database, hooks?: AuthHooks): void {
	if (hooks) {
		currentAuthHooks = { ...currentAuthHooks, ...hooks };
	}
	if (!cachedAuth || lastAuthDBBinding !== DB) {
		lastAuthDBBinding = DB;
		cachedAuth = betterAuth({
			...rawBetterAuthConfig,
			database: new D1Dialect({ database: DB }),
		});
	}
}

export function getAuth(DB?: D1Database, hooks?: AuthHooks): Auth<any> {
	if (DB) {
		initAuth(DB, hooks);
	} else if (hooks) {
		currentAuthHooks = { ...currentAuthHooks, ...hooks };
	}

	if (!cachedAuth) {
		throw new Error('Auth not initialized. Call initAuth(DB) first.');
	}

	return cachedAuth;
}
