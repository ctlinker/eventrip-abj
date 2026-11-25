import type { APIRoute } from 'astro';
import { tryCatch } from 'utils';
import { env } from "cloudflare:workers"

export const ALL: APIRoute = async ({ request, locals }) => {
	const runtime = (locals as { runtime?: { env?: Env } }).runtime;
	const api = env.API;

	if (!api) {
		return new Response(JSON.stringify({ error: 'Service binding API indisponible' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const res = await tryCatch(api.fetch(request));
	if (!res.ok) {
		return new Response(JSON.stringify({ error: 'Erreur de communication avec le service API' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	return res.data;
};
