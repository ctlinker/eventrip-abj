import { useRef, useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';

export default function ForgotPasswordForm() {
	const [email, setEmail] = useState('');
	const [loading, setLoading] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const emailRef = useRef<HTMLInputElement>(null);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		const finalEmail = (emailRef.current?.value ?? email).trim().toLowerCase();
		if (!finalEmail) return;

		setLoading(true);
		setError(null);

		try {
			await apiFetch('/api/auth/request-password-reset', {
				method: 'POST',
				body: JSON.stringify({
					email: finalEmail,
					redirectTo: `${window.location.origin}/reset-password`,
				}),
			});
			setSent(true);
		} catch (err: any) {
			setError(err?.message || "Impossible d'envoyer le lien de réinitialisation.");
		} finally {
			setLoading(false);
		}
	}

	if (sent) {
		return (
			<div class="mx-auto max-w-md rounded-2xl border border-emerald-200 bg-white p-6 sm:p-8 shadow-sm space-y-4">
				<div class="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 space-y-1">
					<p class="font-bold">Vérifiez votre boîte mail</p>
					<p class="text-xs leading-relaxed">
						Si un compte EVENTRIP est associé à <strong>{email}</strong>, un lien de réinitialisation
						valable 1 heure vient de vous être envoyé. Pensez à vérifier vos courriers indésirables
						(spams).
					</p>
				</div>
				<div class="flex items-center justify-between text-xs font-semibold pt-1">
					<button
						type="button"
						onClick={() => setSent(false)}
						class="text-slate-500 hover:text-slate-800 cursor-pointer"
					>
						Essayer une autre adresse
					</button>
					<a href="/auth" class="text-brand-600 hover:text-brand-700 hover:underline">
						Retour à la connexion →
					</a>
				</div>
			</div>
		);
	}

	return (
		<div class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
			<form onSubmit={handleSubmit} class="space-y-4">
				<div>
					<label for="forgot-email" class="block text-sm font-semibold text-slate-700 mb-1">
						Adresse email du compte
					</label>
					<input
						ref={emailRef}
						id="forgot-email"
						name="email"
						type="email"
						autoComplete="email"
						required
						value={email}
						onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
						placeholder="vous@exemple.ci"
						class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
					/>
				</div>

				{error && (
					<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={loading}
					class="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
				>
					{loading ? 'Envoi en cours...' : 'Envoyer le lien de réinitialisation'}
				</button>

				<div class="text-center pt-1">
					<a href="/auth" class="text-xs font-semibold text-slate-500 hover:text-slate-800">
						← Retour à la connexion
					</a>
				</div>
			</form>
		</div>
	);
}
