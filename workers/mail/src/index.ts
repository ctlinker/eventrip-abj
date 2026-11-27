import { Resend } from 'resend';
import { getErrorMessage, tryCatch } from 'utils';

export interface SendMailRequest {
	to: string;
	subject: string;
	html: string;
	text?: string;
	template?: string;
	replyTo?: string;
}

interface MailSettingsRow {
	is_enabled: number;
	daily_limit: number;
	monthly_limit: number;
	cooldown_minutes: number;
}

interface QuotaCountsRow {
	daily_sent: number | null;
	monthly_sent: number | null;
}

type MailEnv = Env & {
	RESEND_API_KEY?: string;
	MAIL_FROM?: string;
	MAIL_REPLY_TO?: string;
};

const DEFAULT_SETTINGS: MailSettingsRow = {
	is_enabled: 1,
	daily_limit: 100,
	monthly_limit: 3000,
	cooldown_minutes: 5,
};

async function recordMailLog(
	db: D1Database,
	entry: {
		id: string;
		recipient: string;
		subject: string;
		template: string;
		status: 'sent' | 'failed' | 'quota_blocked' | 'cooldown_blocked' | 'disabled_blocked';
		providerId?: string | null;
		errorMessage?: string | null;
		createdAt: string;
	},
): Promise<void> {
	await tryCatch(
		db
			.prepare(
				`INSERT INTO mail_logs (id, recipient, subject, template, status, provider_id, error_message, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				entry.id,
				entry.recipient,
				entry.subject,
				entry.template,
				entry.status,
				entry.providerId ?? null,
				entry.errorMessage ?? null,
				entry.createdAt,
			)
			.run(),
	);
}

export default {
	async fetch(request: Request, env: MailEnv): Promise<Response> {
		const url = new URL(request.url);
		const fromAddress = env.MAIL_FROM?.trim() || 'Eventrip <noreply@eventrip-abj.com>';

		if (url.pathname === '/health' && request.method === 'GET') {
			return Response.json({
				ok: true,
				service: 'eventrip-mail',
				configured: Boolean(env.RESEND_API_KEY?.trim()),
				from: fromAddress,
			});
		}

		if (url.pathname === '/send' && request.method === 'POST') {
			const bodyRes = await tryCatch(request.json() as Promise<Partial<SendMailRequest>>);
			if (!bodyRes.ok) {
				return Response.json({ ok: false, code: 'INVALID_JSON', error: 'JSON invalide' }, { status: 400 });
			}

			const recipient = bodyRes.data.to?.trim().toLowerCase() || '';
			const subject = bodyRes.data.subject?.trim() || '';
			const html = bodyRes.data.html?.trim() || '';
			const text = bodyRes.data.text?.trim() || undefined;
			const template = bodyRes.data.template?.trim() || 'transactional';
			const replyTo = bodyRes.data.replyTo?.trim() || env.MAIL_REPLY_TO?.trim() || undefined;

			if (!recipient || !recipient.includes('@') || !subject || !html) {
				return Response.json(
					{ ok: false, code: 'VALIDATION_ERROR', error: 'Champs to, subject et html requis.' },
					{ status: 400 },
				);
			}

			const now = new Date();
			const nowIso = now.toISOString();
			const logId = crypto.randomUUID();

			const settingsRes = await tryCatch(
				env.DB.prepare(
					'SELECT is_enabled, daily_limit, monthly_limit, cooldown_minutes FROM mail_settings WHERE id = ? LIMIT 1',
				)
					.bind('default')
					.first<MailSettingsRow>(),
			);
			const settings: MailSettingsRow =
				settingsRes.ok && settingsRes.data ? settingsRes.data : DEFAULT_SETTINGS;

			if (!settings.is_enabled) {
				await recordMailLog(env.DB, {
					id: logId,
					recipient,
					subject,
					template,
					status: 'disabled_blocked',
					errorMessage: "Envoi d'emails désactivé par l'administrateur",
					createdAt: nowIso,
				});
				return Response.json(
					{
						ok: false,
						code: 'MAIL_DISABLED',
						error: "Le service d'envoi d'emails est temporairement désactivé.",
					},
					{ status: 503 },
				);
			}

			if (settings.cooldown_minutes > 0) {
				const cutoffIso = new Date(now.getTime() - settings.cooldown_minutes * 60_000).toISOString();
				const recentRes = await tryCatch(
					env.DB.prepare(
						`SELECT id FROM mail_logs
						 WHERE recipient = ? AND template = ? AND status = 'sent' AND created_at >= ?
						 LIMIT 1`,
					)
						.bind(recipient, template, cutoffIso)
						.first<{ id: string }>(),
				);
				if (recentRes.ok && recentRes.data) {
					await recordMailLog(env.DB, {
						id: logId,
						recipient,
						subject,
						template,
						status: 'cooldown_blocked',
						errorMessage: `Cooldown par destinataire actif (${settings.cooldown_minutes} min)`,
						createdAt: nowIso,
					});
					return Response.json(
						{
							ok: false,
							code: 'MAIL_COOLDOWN',
							error: `Un email vient déjà d'être envoyé à cette adresse. Veuillez patienter ${settings.cooldown_minutes} min avant de réessayer.`,
						},
						{ status: 429 },
					);
				}
			}

			const dayStartIso = `${nowIso.slice(0, 10)}T00:00:00.000Z`;
			const monthStartIso = `${nowIso.slice(0, 7)}-01T00:00:00.000Z`;
			const countsRes = await tryCatch(
				env.DB.prepare(
					`SELECT
						SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS daily_sent,
						COUNT(*) AS monthly_sent
					 FROM mail_logs
					 WHERE status = 'sent' AND created_at >= ?`,
				)
					.bind(dayStartIso, monthStartIso)
					.first<QuotaCountsRow>(),
			);

			const dailySent = countsRes.ok ? Number(countsRes.data?.daily_sent ?? 0) : 0;
			const monthlySent = countsRes.ok ? Number(countsRes.data?.monthly_sent ?? 0) : 0;

			if (dailySent >= settings.daily_limit || monthlySent >= settings.monthly_limit) {
				const reason =
					dailySent >= settings.daily_limit
						? `Quota journalier atteint (${dailySent}/${settings.daily_limit})`
						: `Quota mensuel atteint (${monthlySent}/${settings.monthly_limit})`;
				await recordMailLog(env.DB, {
					id: logId,
					recipient,
					subject,
					template,
					status: 'quota_blocked',
					errorMessage: reason,
					createdAt: nowIso,
				});
				return Response.json(
					{
						ok: false,
						code: 'MAIL_QUOTA_EXCEEDED',
						error: "Le quota d'envoi d'emails est temporairement atteint. Veuillez réessayer plus tard.",
					},
					{ status: 429 },
				);
			}

			const apiKey = env.RESEND_API_KEY?.trim();
			if (!apiKey) {
				await recordMailLog(env.DB, {
					id: logId,
					recipient,
					subject,
					template,
					status: 'failed',
					errorMessage: 'RESEND_API_KEY manquante',
					createdAt: nowIso,
				});
				return Response.json(
					{
						ok: false,
						code: 'MAIL_UNCONFIGURED',
						error: "Le service d'envoi d'emails n'est pas configuré.",
					},
					{ status: 503 },
				);
			}

			const resend = new Resend(apiKey);
			const sendRes = await tryCatch(
				resend.emails.send({
					from: fromAddress,
					to: recipient,
					subject,
					html,
					...(text ? { text } : {}),
					...(replyTo ? { replyTo } : {}),
				}),
			);

			if (!sendRes.ok || sendRes.data.error) {
				const errMsg = !sendRes.ok
					? getErrorMessage(sendRes.error, 'Erreur Resend')
					: sendRes.data.error?.message || 'Erreur Resend';
				await recordMailLog(env.DB, {
					id: logId,
					recipient,
					subject,
					template,
					status: 'failed',
					errorMessage: errMsg,
					createdAt: nowIso,
				});
				return Response.json(
					{
						ok: false,
						code: 'PROVIDER_ERROR',
						error: "Échec de l'envoi de l'email via le fournisseur.",
						details: errMsg,
					},
					{ status: 502 },
				);
			}

			const providerId = sendRes.data.data?.id ?? null;
			await recordMailLog(env.DB, {
				id: logId,
				recipient,
				subject,
				template,
				status: 'sent',
				providerId,
				createdAt: nowIso,
			});

			return Response.json({
				ok: true,
				id: logId,
				providerId,
			});
		}

		return Response.json({ error: 'Not found' }, { status: 404 });
	},
} satisfies ExportedHandler<MailEnv>;
