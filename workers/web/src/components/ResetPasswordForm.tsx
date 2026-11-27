import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';

function translateResetError(message?: string): string {
	if (!message) return 'Impossible de réinitialiser le mot de passe.';
	const lower = message.toLowerCase();
	if (lower.includes('invalid token') || lower.includes('expired')) {
		return 'Ce lien de réinitialisation est invalide ou a expiré. Veuillez demander un nouveau lien.';
	}
	if (lower.includes('short') || lower.includes('8')) {
		return 'Le mot de passe doit contenir au moins 8 caractères.';
	}
	return message;
}

export default function ResetPasswordForm() {
	const [token, setToken] = useState<string | null>(null);
	const [tokenChecked, setTokenChecked] = useState(false);
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const urlError = params.get('error');
		const urlToken = params.get('token')?.trim() || null;
		if (urlError) {
			setError('Ce lien de réinitialisation est invalide ou a expiré.');
		}
		setToken(urlToken);
		setTokenChecked(true);
	}, []);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!token) return;

		if (newPassword.length < 8) {
			setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
			return;
		}
		if (newPassword !== confirmPassword) {
			setError('Les deux mots de passe ne correspondent pas.');
			return;
		}

		setLoading(true);
		setError(null);

		try {
			await apiFetch('/api/auth/reset-password', {
				method: 'POST',
				body: JSON.stringify({
					newPassword,
					token,
				}),
			});
			setDone(true);
		} catch (err: any) {
			setError(translateResetError(err?.message));
		} finally {
			setLoading(false);
		}
	}

	if (!tokenChecked) {
		return (
			<div class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
				Vérification du lien...
			</div>
		);
	}

	if (done) {
		return (
			<div class="mx-auto max-w-md rounded-2xl border border-emerald-200 bg-white p-6 sm:p-8 shadow-sm space-y-4 text-center">
				<div class="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 space-y-1">
					<p class="font-bold">Mot de passe mis à jour</p>
					<p class="text-xs">
						Votre nouveau mot de passe est actif. Vous pouvez maintenant vous connecter.
					</p>
				</div>
				<a
					href="/auth"
					class="inline-block w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white hover:bg-brand-700 transition-colors"
				>
					Se connecter
				</a>
			</div>
		);
	}

	if (!token) {
		return (
			<div class="mx-auto max-w-md rounded-2xl border border-amber-200 bg-white p-6 sm:p-8 shadow-sm space-y-4 text-center">
				<div class="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-1">
					<p class="font-bold">Lien manquant ou expiré</p>
					<p class="text-xs">
						{error || 'Aucun jeton de réinitialisation valide n’a été détecté dans cette adresse.'}
					</p>
				</div>
				<a
					href="/forgot-password"
					class="inline-block w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white hover:bg-brand-700 transition-colors"
				>
					Demander un nouveau lien
				</a>
			</div>
		);
	}

	return (
		<div class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
			<form onSubmit={handleSubmit} class="space-y-4">
				<div>
					<label for="reset-new-password" class="block text-sm font-semibold text-slate-700 mb-1">
						Nouveau mot de passe
					</label>
					<input
						id="reset-new-password"
						name="newPassword"
						type="password"
						autoComplete="new-password"
						required
						minLength={8}
						value={newPassword}
						onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
						placeholder="Minimum 8 caractères"
						class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
					/>
				</div>

				<div>
					<label
						for="reset-confirm-password"
						class="block text-sm font-semibold text-slate-700 mb-1"
					>
						Confirmer le mot de passe
					</label>
					<input
						id="reset-confirm-password"
						name="confirmPassword"
						type="password"
						autoComplete="new-password"
						required
						minLength={8}
						value={confirmPassword}
						onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
						placeholder="••••••••"
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
					{loading ? 'Enregistrement...' : 'Enregistrer le nouveau mot de passe'}
				</button>
			</form>
		</div>
	);
}
