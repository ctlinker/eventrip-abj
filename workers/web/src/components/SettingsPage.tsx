import { useEffect, useState } from 'preact/hooks';
import {
	User,
	KeyRound,
	BellRing,
	BellOff,
	ChevronDown,
	ChevronRight,
	CheckCircle2,
} from 'lucide-preact';
import { ABIDJAN_COMMUNES, apiFetch, type ApiUser, type CommuneItem } from '../lib/api';
import {
	disableWebPush,
	enableWebPush,
	getActivePushSubscription,
	isIosStandaloneRequired,
	isWebPushSupported,
	onPushSubscriptionChange,
} from '../lib/realtime';
import ChangePasswordForm from './ChangePasswordForm';

type SectionId = 'profile' | 'password' | 'notifications' | null;

export default function SettingsPage() {
	const [openSection, setOpenSection] = useState<SectionId>('profile');

	// Profil & Commune
	const [profileLoading, setProfileLoading] = useState(true);
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [phone, setPhone] = useState('');
	const [commune, setCommune] = useState('');
	const [communeOptions, setCommuneOptions] = useState<string[]>([...ABIDJAN_COMMUNES]);
	const [savingProfile, setSavingProfile] = useState(false);
	const [profileError, setProfileError] = useState<string | null>(null);
	const [profileSuccess, setProfileSuccess] = useState(false);

	// Notifications Push
	const [canOfferPush, setCanOfferPush] = useState(false);
	const [pushEnabled, setPushEnabled] = useState(false);
	const [pushBusy, setPushBusy] = useState(false);
	const [pushHint, setPushHint] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([
			apiFetch<{ user: ApiUser }>('/api/me'),
			apiFetch<{ communes?: CommuneItem[] }>('/api/communes').catch(() => ({ communes: [] })),
		])
			.then(([meRes, comRes]) => {
				if (meRes.user) {
					setName(meRes.user.name || '');
					setEmail(meRes.user.email || '');
					setPhone(meRes.user.phone || '');
					setCommune(meRes.user.commune || '');
				}
				if (comRes.communes && comRes.communes.length > 0) {
					setCommuneOptions(comRes.communes.map((c) => c.name));
				}
			})
			.catch((err: any) => {
				if (err?.status === 401) {
					window.location.href = '/auth?next=/settings';
					return;
				}
				setProfileError(err?.message || 'Impossible de charger votre profil.');
			})
			.finally(() => setProfileLoading(false));

		setCanOfferPush(isWebPushSupported() || isIosStandaloneRequired());
		getActivePushSubscription().then((sub) => setPushEnabled(Boolean(sub)));

		return onPushSubscriptionChange((enabled) => {
			setPushEnabled(enabled);
		});
	}, []);

	async function handleSaveProfile(e: Event) {
		e.preventDefault();
		const trimmedName = name.trim();
		if (!trimmedName) {
			setProfileError('Votre nom ne peut pas être vide.');
			return;
		}

		setSavingProfile(true);
		setProfileError(null);
		setProfileSuccess(false);

		try {
			const res = await apiFetch<{ user?: ApiUser }>('/api/me', {
				method: 'PATCH',
				body: JSON.stringify({
					name: trimmedName,
					phone: phone.trim() || null,
					commune: commune.trim() || null,
				}),
			});
			if (res.user) {
				setName(res.user.name || '');
				setPhone(res.user.phone || '');
				setCommune(res.user.commune || '');
			}
			if (commune.trim()) {
				localStorage.setItem('eventrip_commune', commune.trim());
			} else {
				localStorage.removeItem('eventrip_commune');
			}
			setProfileSuccess(true);
		} catch (err: any) {
			setProfileError(err?.message || 'Impossible de mettre à jour votre profil.');
		} finally {
			setSavingProfile(false);
		}
	}

	async function handleTogglePush() {
		if (pushBusy) return;
		setPushBusy(true);
		setPushHint(null);

		if (pushEnabled) {
			await disableWebPush(true);
			setPushEnabled(false);
			setPushBusy(false);
			return;
		}

		const res = await enableWebPush();
		if (res.ok) {
			setPushEnabled(true);
		} else if (res.error) {
			setPushHint(res.error);
		}
		setPushBusy(false);
	}

	function toggle(section: Exclude<SectionId, null>) {
		setOpenSection((prev) => (prev === section ? null : section));
	}

	return (
		<div class="mx-auto max-w-2xl space-y-4">
			{/* 1. Profil & Commune préférée */}
			<div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				<button
					type="button"
					onClick={() => toggle('profile')}
					aria-expanded={openSection === 'profile'}
					class="w-full flex items-center justify-between gap-4 px-6 py-4 text-left hover:bg-slate-50/80 transition-colors cursor-pointer"
				>
					<div class="flex items-center gap-3.5">
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 border border-brand-200/70">
							<User class="h-5 w-5" />
						</div>
						<div>
							<h2 class="text-sm sm:text-base font-bold text-slate-950">
								Profil &amp; Commune préférée
							</h2>
							<p class="text-xs text-slate-500">
								Modifiez votre nom, numéro Wave/contact et commune de départ par défaut.
							</p>
						</div>
					</div>
					{openSection === 'profile' ? (
						<ChevronDown class="h-5 w-5 text-slate-400 shrink-0" />
					) : (
						<ChevronRight class="h-5 w-5 text-slate-400 shrink-0" />
					)}
				</button>

				{openSection === 'profile' && (
					<div class="border-t border-slate-100 px-6 py-6 bg-slate-50/40">
						{profileLoading ? (
							<p class="text-xs text-slate-500">Chargement du profil...</p>
						) : (
							<form onSubmit={handleSaveProfile} class="max-w-md space-y-4">
								<div>
									<label for="settings-email" class="block text-sm font-semibold text-slate-700 mb-1">
										Email
									</label>
									<input
										id="settings-email"
										type="email"
										value={email}
										disabled
										class="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-500 cursor-not-allowed"
									/>
								</div>

								<div>
									<label for="settings-name" class="block text-sm font-semibold text-slate-700 mb-1">
										Nom complet
									</label>
									<input
										id="settings-name"
										name="name"
										type="text"
										required
										value={name}
										onInput={(e) => setName((e.target as HTMLInputElement).value)}
										placeholder="Ex: Kouamé Aya"
										class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
									/>
								</div>

								<div>
									<label for="settings-phone" class="block text-sm font-semibold text-slate-700 mb-1">
										Téléphone (Wave / Contact)
									</label>
									<input
										id="settings-phone"
										name="phone"
										type="tel"
										value={phone}
										onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
										placeholder="+225 07 00 00 00 00"
										class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
									/>
								</div>

								<div>
									<label for="settings-commune" class="block text-sm font-semibold text-slate-700 mb-1">
										Commune de départ préférée
									</label>
									<select
										id="settings-commune"
										name="commune"
										value={commune}
										onChange={(e) => setCommune((e.target as HTMLSelectElement).value)}
										class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
									>
										<option value="">Aucune préférence</option>
										{communeOptions.map((c) => (
											<option key={c} value={c}>
												{c}
											</option>
										))}
									</select>
									<p class="mt-1 text-[11px] text-slate-500">
										Utilisée pour trier automatiquement les départs de convois près de chez vous.
									</p>
								</div>

								{profileError && (
									<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
										{profileError}
									</div>
								)}

								{profileSuccess && (
									<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
										Profil mis à jour avec succès.
									</div>
								)}

								<button
									type="submit"
									disabled={savingProfile}
									class="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
								>
									{savingProfile ? 'Enregistrement...' : 'Enregistrer le profil'}
								</button>
							</form>
						)}
					</div>
				)}
			</div>

			{/* 2. Mot de passe & Sécurité */}
			<div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				<button
					type="button"
					onClick={() => toggle('password')}
					aria-expanded={openSection === 'password'}
					class="w-full flex items-center justify-between gap-4 px-6 py-4 text-left hover:bg-slate-50/80 transition-colors cursor-pointer"
				>
					<div class="flex items-center gap-3.5">
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 border border-brand-200/70">
							<KeyRound class="h-5 w-5" />
						</div>
						<div>
							<h2 class="text-sm sm:text-base font-bold text-slate-950">
								Mot de passe &amp; Sécurité
							</h2>
							<p class="text-xs text-slate-500">
								Modifiez votre mot de passe actuel et gérez vos sessions actives.
							</p>
						</div>
					</div>
					{openSection === 'password' ? (
						<ChevronDown class="h-5 w-5 text-slate-400 shrink-0" />
					) : (
						<ChevronRight class="h-5 w-5 text-slate-400 shrink-0" />
					)}
				</button>

				{openSection === 'password' && (
					<div class="border-t border-slate-100 px-6 py-6 bg-slate-50/40">
						<ChangePasswordForm embedded />
					</div>
				)}
			</div>

			{/* 3. Notifications Push */}
			<div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				<button
					type="button"
					onClick={() => toggle('notifications')}
					aria-expanded={openSection === 'notifications'}
					class="w-full flex items-center justify-between gap-4 px-6 py-4 text-left hover:bg-slate-50/80 transition-colors cursor-pointer"
				>
					<div class="flex items-center gap-3.5">
						<div
							class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
								pushEnabled
									? 'bg-emerald-50 text-emerald-600 border-emerald-200/70'
									: 'bg-amber-50 text-amber-600 border-amber-200/70'
							}`}
						>
							{pushEnabled ? <BellRing class="h-5 w-5" /> : <BellOff class="h-5 w-5" />}
						</div>
						<div>
							<h2 class="text-sm sm:text-base font-bold text-slate-950 flex items-center gap-2">
								<span>Notifications Push (cet appareil)</span>
								{canOfferPush && (
									<span
										class={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
											pushEnabled
												? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
												: 'bg-amber-50 text-amber-800 border border-amber-200'
										}`}
									>
										{pushEnabled ? 'Activées' : 'Désactivées'}
									</span>
								)}
							</h2>
							<p class="text-xs text-slate-500">
								Recevez une alerte instantanée lors de la validation de vos paiements et rappels.
							</p>
						</div>
					</div>
					{openSection === 'notifications' ? (
						<ChevronDown class="h-5 w-5 text-slate-400 shrink-0" />
					) : (
						<ChevronRight class="h-5 w-5 text-slate-400 shrink-0" />
					)}
				</button>

				{openSection === 'notifications' && (
					<div class="border-t border-slate-100 px-6 py-5 bg-slate-50/40 space-y-3">
						{!canOfferPush ? (
							<p class="text-xs text-slate-500">
								Les notifications Web Push ne sont pas supportées par ce navigateur.
							</p>
						) : (
							<div
								class={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
									pushEnabled
										? 'border-emerald-200 bg-emerald-50/50'
										: 'border-amber-200 bg-amber-50/70'
								}`}
							>
								<div class="flex items-start gap-2.5 text-xs">
									{pushEnabled ? (
										<CheckCircle2 class="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
									) : (
										<BellOff class="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
									)}
									<div>
										<p class={`font-bold ${pushEnabled ? 'text-emerald-950' : 'text-amber-950'}`}>
											{pushEnabled
												? 'Notifications push activées sur cet appareil'
												: 'Notifications push désactivées sur cet appareil'}
										</p>
										<p class={pushEnabled ? 'text-emerald-800/80' : 'text-amber-800/90'}>
											{pushEnabled
												? 'Vous recevrez vos confirmations Wave et rappels de départ même onglet fermé.'
												: 'Activez-les pour ne manquer aucune validation Wave ni modification de convoi.'}
										</p>
									</div>
								</div>

								<button
									type="button"
									disabled={pushBusy}
									onClick={handleTogglePush}
									class={`rounded-xl px-4 py-2 text-xs font-bold border transition-colors cursor-pointer shrink-0 ${
										pushEnabled
											? 'border-slate-200 bg-white text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
											: 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
									}`}
								>
									{pushBusy ? 'Patientez...' : pushEnabled ? 'Désactiver' : 'Activer les alertes'}
								</button>
							</div>
						)}

						{pushHint && (
							<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
								{pushHint}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
