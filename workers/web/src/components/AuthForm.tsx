import { useEffect, useRef, useState } from 'preact/hooks';
import { ABIDJAN_COMMUNES, apiFetch } from '../lib/api';

function translateAuthError(message?: string): string {
	if (!message) return 'Erreur d’authentification';
	const lower = message.toLowerCase();
	if (lower.includes('invalid email or password')) {
		return 'Email ou mot de passe incorrect.';
	}
	if (lower.includes('user already exists') || lower.includes('already exists')) {
		return 'Un compte existe déjà avec cette adresse email.';
	}
	if (lower.includes('invalid email')) {
		return 'Adresse email invalide.';
	}
	if (lower.includes('password') && lower.includes('short')) {
		return 'Le mot de passe doit contenir au moins 8 caractères.';
	}
	if (lower.includes('failed to create user')) {
		return 'Impossible de créer le compte. Vérifiez que cet email et ce téléphone ne sont pas déjà utilisés.';
	}
	return message;
}

export default function AuthForm() {
	const [mode, setMode] = useState<'login' | 'register'>('login');
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [phone, setPhone] = useState('');
	const [commune, setCommune] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const nameRef = useRef<HTMLInputElement>(null);
	const phoneRef = useRef<HTMLInputElement>(null);
	const communeRef = useRef<HTMLSelectElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);
	const passwordRef = useRef<HTMLInputElement>(null);

	// Synchroniser d'éventuelles saisies/autofill effectuées avant l'hydratation
	useEffect(() => {
		if (emailRef.current?.value && !email) setEmail(emailRef.current.value);
		if (passwordRef.current?.value && !password) setPassword(passwordRef.current.value);
		if (nameRef.current?.value && !name) setName(nameRef.current.value);
		if (phoneRef.current?.value && !phone) setPhone(phoneRef.current.value);
		if (communeRef.current?.value && !commune) setCommune(communeRef.current.value);
	}, [mode]);

	function switchMode(nextMode: 'login' | 'register') {
		if (nextMode === mode) return;
		setMode(nextMode);
		setPassword('');
		setError(null);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		const finalEmail = (emailRef.current?.value ?? email).trim();
		const finalPassword = passwordRef.current?.value ?? password;
		const finalName = (nameRef.current?.value ?? name).trim();
		const finalPhone = (phoneRef.current?.value ?? phone).trim();
		const finalCommune = (communeRef.current?.value ?? commune).trim();

		setLoading(true);
		setError(null);

		try {
			if (mode === 'login') {
				await apiFetch('/api/auth/sign-in/email', {
					method: 'POST',
					body: JSON.stringify({ email: finalEmail, password: finalPassword }),
				});
			} else {
				await apiFetch('/api/auth/sign-up/email', {
					method: 'POST',
					body: JSON.stringify({
						name: finalName,
						email: finalEmail,
						password: finalPassword,
						phone: finalPhone || undefined,
						commune: finalCommune || undefined,
					}),
				});
				if (finalCommune) {
					localStorage.setItem('eventrip_commune', finalCommune);
				}
			}
			const params = new URLSearchParams(window.location.search);
			const next = params.get('next');
			window.location.href = next && next.startsWith('/') ? next : '/';
		} catch (err: any) {
			setError(translateAuthError(err?.message));
			setLoading(false);
		}
	}

	return (
		<div class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
			<div
				role="tablist"
				aria-label="Mode d’authentification"
				class="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 mb-6"
			>
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'login'}
					onClick={() => switchMode('login')}
					class={`rounded-lg py-2 text-sm font-bold transition-colors cursor-pointer ${
						mode === 'login' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-900'
					}`}
				>
					Connexion
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'register'}
					onClick={() => switchMode('register')}
					class={`rounded-lg py-2 text-sm font-bold transition-colors cursor-pointer ${
						mode === 'register' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-900'
					}`}
				>
					Créer un compte
				</button>
			</div>

			<form onSubmit={handleSubmit} class="space-y-4">
				{mode === 'register' && (
					<>
						<div>
							<label for="auth-name" class="block text-sm font-semibold text-slate-700 mb-1">
								Nom complet
							</label>
							<input
								ref={nameRef}
								id="auth-name"
								name="name"
								type="text"
								autoComplete="name"
								required
								value={name}
								onInput={(e) => setName((e.target as HTMLInputElement).value)}
								placeholder="Ex: Kouamé Aya"
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>
						<div>
							<label for="auth-phone" class="block text-sm font-semibold text-slate-700 mb-1">
								Téléphone (Wave / Contact)
							</label>
							<input
								ref={phoneRef}
								id="auth-phone"
								name="phone"
								type="tel"
								autoComplete="tel"
								required
								value={phone}
								onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
								placeholder="+225 07 00 00 00 00"
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>
						<div>
							<label for="auth-commune" class="block text-sm font-semibold text-slate-700 mb-1">
								Commune de départ préférée (optionnel)
							</label>
							<select
								ref={communeRef}
								id="auth-commune"
								name="commune"
								value={commune}
								onChange={(e) => setCommune((e.target as HTMLSelectElement).value)}
								class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
							>
								<option value="">Sélectionner une commune...</option>
								{ABIDJAN_COMMUNES.map((c) => (
									<option key={c} value={c}>
										{c}
									</option>
								))}
							</select>
						</div>
					</>
				)}

				<div>
					<label for="auth-email" class="block text-sm font-semibold text-slate-700 mb-1">
						Email
					</label>
					<input
						ref={emailRef}
						id="auth-email"
						name="email"
						type="email"
						autoComplete="email"
						required
						value={email}
						onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
						placeholder="vous@exemple.ci"
						class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
					/>
				</div>

				<div>
					<label for="auth-password" class="block text-sm font-semibold text-slate-700 mb-1">
						Mot de passe
					</label>
					<input
						ref={passwordRef}
						id="auth-password"
						name="password"
						type="password"
						autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
						required
						minLength={8}
						value={password}
						onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						placeholder="••••••••"
						class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
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
					class="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
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
