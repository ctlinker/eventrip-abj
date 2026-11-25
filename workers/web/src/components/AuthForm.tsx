import { useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';

export default function AuthForm() {
	const [mode, setMode] = useState<'login' | 'register'>('login');
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [phone, setPhone] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			if (mode === 'login') {
				await apiFetch('/api/auth/sign-in/email', {
					method: 'POST',
					body: JSON.stringify({ email, password }),
				});
			} else {
				await apiFetch('/api/auth/sign-up/email', {
					method: 'POST',
					body: JSON.stringify({
						name,
						email,
						password,
						phone: phone.trim() || undefined,
					}),
				});
			}
			const params = new URLSearchParams(window.location.search);
			const next = params.get('next');
			window.location.href = next && next.startsWith('/') ? next : '/';
		} catch (err: any) {
			setError(err.message || 'Erreur d’authentification');
			setLoading(false);
		}
	}

	return (
		<div class="mx-auto max-w-md rounded-2xl border border-green-100 bg-white p-6 sm:p-8 shadow-sm">
			<div class="grid grid-cols-2 gap-2 rounded-xl bg-green-50 p-1 mb-6">
				<button
					type="button"
					onClick={() => {
						setMode('login');
						setError(null);
					}}
					class={`rounded-lg py-2 text-sm font-semibold transition-colors cursor-pointer ${
						mode === 'login' ? 'bg-white text-green-700 shadow-xs' : 'text-slate-600'
					}`}
				>
					Connexion
				</button>
				<button
					type="button"
					onClick={() => {
						setMode('register');
						setError(null);
					}}
					class={`rounded-lg py-2 text-sm font-semibold transition-colors cursor-pointer ${
						mode === 'register' ? 'bg-white text-green-700 shadow-xs' : 'text-slate-600'
					}`}
				>
					Créer un compte
				</button>
			</div>

			<form onSubmit={handleSubmit} class="space-y-4">
				{mode === 'register' && (
					<>
						<div>
							<label class="block text-sm font-medium text-slate-700 mb-1">Nom complet</label>
							<input
								type="text"
								required
								value={name}
								onInput={(e) => setName((e.target as HTMLInputElement).value)}
								placeholder="Ex: Kouamé Aya"
								class="w-full rounded-xl border border-green-200 px-3.5 py-2.5 text-sm focus:border-green-600 focus:outline-none"
							/>
						</div>
						<div>
							<label class="block text-sm font-medium text-slate-700 mb-1">
								Téléphone (Wave / Contact)
							</label>
							<input
								type="tel"
								required
								value={phone}
								onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
								placeholder="+225 07 00 00 00 00"
								class="w-full rounded-xl border border-green-200 px-3.5 py-2.5 text-sm focus:border-green-600 focus:outline-none"
							/>
						</div>
					</>
				)}

				<div>
					<label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
					<input
						type="email"
						required
						value={email}
						onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
						placeholder="vous@exemple.ci"
						class="w-full rounded-xl border border-green-200 px-3.5 py-2.5 text-sm focus:border-green-600 focus:outline-none"
					/>
				</div>

				<div>
					<label class="block text-sm font-medium text-slate-700 mb-1">Mot de passe</label>
					<input
						type="password"
						required
						minLength={8}
						value={password}
						onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						placeholder="••••••••"
						class="w-full rounded-xl border border-green-200 px-3.5 py-2.5 text-sm focus:border-green-600 focus:outline-none"
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
					class="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors cursor-pointer"
				>
					{loading
						? 'Veuillez patienter...'
						: mode === 'login'
							? 'Se connecter'
							: 'Créer mon compte'}
				</button>
			</form>
		</div>
	);
}
