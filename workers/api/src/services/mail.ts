import { tryCatch } from 'utils';

export interface SendTransactionalMailInput {
	to: string;
	subject: string;
	html: string;
	text?: string;
	template?: string;
}

export interface MailWorkerSendResponse {
	ok: boolean;
	id?: string;
	providerId?: string | null;
	code?: string;
	error?: string;
}

export function resolveFrontendOrigin(rawUrl: string, request?: Request): string {
	const parsedRaw = (() => {
		try {
			return new URL(rawUrl);
		} catch {
			return null;
		}
	})();

	const callbackParam = parsedRaw?.searchParams.get('callbackURL');
	if (callbackParam) {
		try {
			const cbUrl = new URL(callbackParam);
			if (cbUrl.origin && cbUrl.origin !== 'null') {
				return cbUrl.origin;
			}
		} catch {
			// callbackURL relatif : continuer avec les en-têtes de la requête
		}
	}

	if (request) {
		const originHeader = request.headers.get('origin');
		if (originHeader && originHeader !== 'null') {
			try {
				return new URL(originHeader).origin;
			} catch {
				// ignorer
			}
		}

		const refererHeader = request.headers.get('referer');
		if (refererHeader) {
			try {
				const refOrigin = new URL(refererHeader).origin;
				if (refOrigin && refOrigin !== 'null') {
					return refOrigin;
				}
			} catch {
				// ignorer
			}
		}

		try {
			return new URL(request.url).origin;
		} catch {
			// ignorer
		}
	}

	return parsedRaw?.origin || 'https://eventrip-abj.com';
}

export function buildPasswordResetLink(rawUrl: string, token: string, request?: Request): string {
	const origin = resolveFrontendOrigin(rawUrl, request);
	return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function buildPasswordResetEmail(params: { name: string; resetLink: string }): {
	subject: string;
	html: string;
	text: string;
} {
	const safeName = escapeHtml(params.name?.trim() || 'Client');
	const safeLink = escapeHtml(params.resetLink);

	const subject = 'Réinitialisation de votre mot de passe — EVENTRIP';
	const text = [
		`Bonjour ${params.name?.trim() || 'Client'},`,
		'',
		'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte EVENTRIP.',
		'Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe (valable 1 heure) :',
		params.resetLink,
		'',
		"Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.",
	].join('\n');

	const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
      <tr>
        <td>
          <div style="font-size:20px;font-weight:900;letter-spacing:-0.02em;color:#0f172a;margin-bottom:16px;">
            EVENTRIP<span style="color:#ea580c;">.</span>
          </div>
          <h1 style="font-size:18px;font-weight:800;margin:0 0 12px;color:#0f172a;">
            Réinitialisez votre mot de passe
          </h1>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 20px;">
            Bonjour <strong>${safeName}</strong>,<br/>
            Vous avez demandé à réinitialiser le mot de passe de votre compte EVENTRIP. Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :
          </p>
          <div style="margin:24px 0;">
            <a href="${safeLink}" style="display:inline-block;background-color:#ea580c;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:12px;">
              Choisir un nouveau mot de passe
            </a>
          </div>
          <p style="font-size:12px;line-height:1.6;color:#64748b;margin:0 0 12px;">
            Ce lien est personnel et expire dans <strong>1 heure</strong>. Si le bouton ne s'affiche pas correctement, copiez ce lien dans votre navigateur :<br/>
            <a href="${safeLink}" style="color:#ea580c;word-break:break-all;">${safeLink}</a>
          </p>
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0;" />
          <p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:0;">
            Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe actuel restera inchangé.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

	return { subject, html, text };
}

export async function sendMailViaBinding(
	env: Pick<Env, 'MAIL'>,
	input: SendTransactionalMailInput,
): Promise<MailWorkerSendResponse> {
	if (!env.MAIL) {
		throw new Error("Service d'envoi d'emails indisponible.");
	}

	const res = await tryCatch(
		env.MAIL.fetch(
			new Request('http://internal/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(input),
			}),
		),
	);

	if (!res.ok) {
		throw new Error("Impossible de joindre le service d'envoi d'emails.");
	}

	const payloadRes = await tryCatch(res.data.json() as Promise<MailWorkerSendResponse>);
	if (!payloadRes.ok) {
		throw new Error("Réponse invalide du service d'envoi d'emails.");
	}

	if (!res.data.ok || !payloadRes.data.ok) {
		throw new Error(payloadRes.data.error || "Échec de l'envoi de l'email.");
	}

	return payloadRes.data;
}
