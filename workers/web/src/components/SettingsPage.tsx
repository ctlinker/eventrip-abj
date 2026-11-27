import { useState } from 'preact/hooks';
import { KeyRound, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-preact';
import ChangePasswordForm from './ChangePasswordForm';

export default function SettingsPage() {
	const [openSection, setOpenSection] = useState<'password' | null>('password');

	return (
		<div class="mx-auto max-w-2xl space-y-4">
			<div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				<button
					type="button"
					onClick={() => setOpenSection((prev) => (prev === 'password' ? null : 'password'))}
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

			<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-4 flex items-center gap-3 text-xs text-slate-500">
				<ShieldCheck class="h-4 w-4 text-slate-400 shrink-0" />
				<span>
					D’autres préférences de compte (commune favorite, notifications) seront bientôt
					disponibles ici.
				</span>
			</div>
		</div>
	);
}
