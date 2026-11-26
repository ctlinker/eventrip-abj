import { useEffect, useRef, useState } from 'preact/hooks';
import { QrCode, Camera, CheckCircle2, AlertTriangle, XCircle } from 'lucide-preact';
import { apiFetch } from '../../lib/api';

interface ScanResponse {
	result: 'valid' | 'pending' | 'already_used' | 'invalid';
	direction?: 'outbound' | 'return';
	message: string;
	ticket?: { code?: string; status?: string; used_at?: string };
}

interface ScanHistoryEntry extends ScanResponse {
	at: string;
}

export default function AdminScanner() {
	const [token, setToken] = useState('');
	const [direction, setDirection] = useState<'outbound' | 'return'>('outbound');
	const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
	const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
	const [cameraActive, setCameraActive] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);

	async function verifyToken(qrToken: string, dir = direction) {
		const trimmed = qrToken.trim();
		if (!trimmed) return;
		try {
			const res = await apiFetch<ScanResponse>('/api/admin/tickets/scan', {
				method: 'POST',
				body: JSON.stringify({ qr_token: trimmed, direction: dir }),
			});
			setScanResult(res);
			setHistory((prev) => [{ ...res, at: new Date().toLocaleTimeString('fr-FR') }, ...prev].slice(0, 10));
			setToken('');
			try {
				navigator.vibrate?.(80);
			} catch {}
		} catch (err: any) {
			const fail: ScanResponse = {
				result: 'invalid',
				message: err.message || 'Ticket invalide ou déjà utilisé',
			};
			setScanResult(fail);
			setHistory((prev) => [{ ...fail, at: new Date().toLocaleTimeString('fr-FR') }, ...prev].slice(0, 10));
			try {
				navigator.vibrate?.([120, 60, 120]);
			} catch {}
		}
	}

	useEffect(() => {
		if (!cameraActive) return;
		let stream: MediaStream | null = null;
		let stopped = false;

		async function start() {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'environment' },
				});
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					await videoRef.current.play();
				}

				const Detector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
				if (!Detector) return;
				const detector = new Detector({ formats: ['qr_code'] });

				const loop = async () => {
					if (stopped || !videoRef.current) return;
					try {
						const codes = await detector.detect(videoRef.current);
						if (codes.length > 0 && codes[0].rawValue) {
							await verifyToken(codes[0].rawValue);
							setCameraActive(false);
							return;
						}
					} catch {}
					requestAnimationFrame(loop);
				};
				requestAnimationFrame(loop);
			} catch {
				setCameraActive(false);
			}
		}

		start();
		return () => {
			stopped = true;
			stream?.getTracks().forEach((t) => t.stop());
		};
	}, [cameraActive, direction]);

	const validCount = history.filter((h) => h.result === 'valid').length;

	return (
		<div class="mx-auto max-w-xl space-y-6">
			<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="flex items-center gap-2 text-lg font-extrabold text-slate-950">
						<QrCode class="h-5 w-5 text-emerald-600" />
						Contrôle d’accès QR
					</h2>
					<button
						type="button"
						onClick={() => setCameraActive(!cameraActive)}
						class="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 cursor-pointer"
					>
						<Camera class="h-4 w-4 text-emerald-600" />
						{cameraActive ? 'Arrêter caméra' : 'Activer caméra'}
					</button>
				</div>

				<div class="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
					<button
						type="button"
						onClick={() => setDirection('outbound')}
						class={`rounded-lg py-2 text-xs font-bold transition-colors cursor-pointer ${
							direction === 'outbound'
								? 'bg-emerald-600 text-white shadow-xs'
								: 'text-slate-600 hover:text-slate-900'
						}`}
					>
						Contrôle Aller / Entrée
					</button>
					<button
						type="button"
						onClick={() => setDirection('return')}
						class={`rounded-lg py-2 text-xs font-bold transition-colors cursor-pointer ${
							direction === 'return'
								? 'bg-emerald-600 text-white shadow-xs'
								: 'text-slate-600 hover:text-slate-900'
						}`}
					>
						Contrôle Retour (Convoi)
					</button>
				</div>

				{cameraActive && (
					<video
						ref={videoRef}
						class="w-full rounded-xl border border-slate-200 bg-black aspect-video object-cover"
						muted
						playsInline
					/>
				)}

				<form
					onSubmit={(e) => {
						e.preventDefault();
						verifyToken(token);
					}}
					class="flex gap-2"
				>
					<input
						type="text"
						name="qr_token"
						aria-label="Token QR à vérifier"
						placeholder="Coller ou scanner le token QR..."
						value={token}
						onInput={(e) => setToken((e.target as HTMLInputElement).value)}
						class="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono focus:border-emerald-600 focus:outline-none"
					/>
					<button
						type="submit"
						class="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 cursor-pointer shadow-xs"
					>
						Vérifier
					</button>
				</form>
			</div>

			{scanResult && (
				<div
					class={`rounded-2xl border p-6 flex items-start gap-3 ${
						scanResult.result === 'valid'
							? 'border-emerald-300 bg-emerald-50 text-emerald-950'
							: scanResult.result === 'pending'
								? 'border-amber-300 bg-amber-50 text-amber-950'
								: 'border-red-300 bg-red-50 text-red-950'
					}`}
				>
					{scanResult.result === 'valid' ? (
						<CheckCircle2 class="h-6 w-6 text-emerald-600 shrink-0" />
					) : scanResult.result === 'pending' ? (
						<AlertTriangle class="h-6 w-6 text-amber-600 shrink-0" />
					) : (
						<XCircle class="h-6 w-6 text-red-600 shrink-0" />
					)}
					<div>
						<p class="font-extrabold">{scanResult.message}</p>
						{scanResult.ticket?.code && (
							<p class="text-xs mt-1 font-mono">Billet : {scanResult.ticket.code}</p>
						)}
					</div>
				</div>
			)}

			{history.length > 0 && (
				<div class="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-extrabold text-slate-950">Historique de session</h3>
						<span class="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
							{validCount} validé(s)
						</span>
					</div>
					<div class="divide-y divide-slate-100 text-xs">
						{history.map((item, idx) => (
							<div key={idx} class="py-2 flex items-center justify-between gap-2">
								<span
									class={`font-semibold ${
										item.result === 'valid' ? 'text-emerald-700' : 'text-red-600'
									}`}
								>
									{item.message} {item.ticket?.code ? `(${item.ticket.code})` : ''}
								</span>
								<span class="font-mono text-slate-400">{item.at}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
