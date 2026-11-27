import { useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';

function translateChangeError(message?: string): string {
	if (!message) return 'Impossible de modifier le mot de passe.';
	const lower = message.toLowerCase();
	if (lower.includes('invalid password') || lower.includes('incorrect')) {
		return 'Votre mot de passe actuel est incorrect.';
	}
	if (lower.includes('short') || lower.includes('8')) {
		return 'Le nouveau mot de passe doit contenir au moins 8 caractères.';
	}
	return message;
}

export default function ChangePasswordForm() {
	const [currentPassword, setCurrentPassword] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		setSuccess(false);

		if (newPassword.length < 8) {
			setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
			return;
		}
		if (newPassword !== confirmPassword) {
			setError('La confirmation ne correspond pas au nouveau mot de passe.');
			return;
		}
		if (newPassword === currentPassword) {
			setError("Le nouveau mot de passe doit être différent de l'actuel.");
			return;
		}

		setLoading(true);
		setError(null);

		try {
			await apiFetch('/api/auth/change-password', {
				method: 'POST',
				body: JSON.stringify({
					currentPassword,
					newPassword,
					revokeOtherSessions,
				}),
			});
			setCurrentPassword('');
			setNewPassword('');
			setConfirmPassword('');
			setSuccess(true);
		} catch (err: any) {
			setError(translateChangeError(err?.message));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
			<form onSubmit={handleSubmit} class="space-y-4">
				<div>
					<div class="flex items-center justify-between mb-1">
						<label
							for="change-current-password"
							class="block text-sm font-semibold text-slate-700"
						>
							Mot de passe actuel
						</label>
						<a
							href="/forgot-password"
							class="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
						>
							Oublié ?
						</a>
					</div>
					<input
						id="change-current-password"
						name="currentPassword"
						type="password"
						autoComplete="current-password"
						required
						value={currentPassword}
						onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
						placeholder="••••••••"
						class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
					/>
				</div>

				<div>
					<label for="change-new-password" class="block text-sm font-semibold text-slate-700 mb-1">
						Nouveau mot de passe
					</label>
					<input
						id="change-new-password"
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
						for="change-confirm-password"
						class="block text-sm font-semibold text-slate-700 mb-1"
					>
						Confirmer le nouveau mot de passe
					</label>
					<input
						id="change-confirm-password"
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

				<label class="flex items-center gap-2.5 text-xs text-slate-600 cursor-pointer select-none pt-1">
					<input
						type="checkbox"
						checked={revokeOtherSessions}
						onChange={(e) => setRevokeOtherSessions((e.target as HTMLInputElement).checked)}
						class="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
					/>
					<span>Déconnecter mes autres sessions ouvertes</span>
				</label>

				{error && (
					<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
						{error}
					</div>
				)}

				{success && (
					<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
						Votre mot de passe a été modifié avec succès.
					</div>
				)}

				<button
					type="submit"
					disabled={loading}
					class="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
				>
					{loading ? 'Mise à jour...' : 'Mettre à jour mon mot de passe'}
				</button>
			</form>
		</div>
	);
}
