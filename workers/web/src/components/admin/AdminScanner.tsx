import { useEffect, useRef, useState } from 'preact/hooks';
import { QrCode, Camera, CheckCircle2, AlertTriangle, XCircle } from 'lucide-preact';
import { apiFetch } from '../../lib/api';

interface ScanResponse {
	result: 'valid' | 'pending' | 'already_used' | 'invalid';
	message: string;
	ticket?: { code?: string; status?: string; used_at?: string };
}

export default function AdminScanner() {
	const [token, setToken] = useState('');
	const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
	const [cameraActive, setCameraActive] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);

	async function verifyToken(qrToken: string) {
		const trimmed = qrToken.trim();
		if (!trimmed) return;
		try {
			const res = await apiFetch<ScanResponse>('/api/admin/tickets/scan', {
				method: 'POST',
				body: JSON.stringify({ qr_token: trimmed }),
			});
			setScanResult(res);
		} catch (err: any) {
			setScanResult({
				result: 'invalid',
				message: err.message || 'Ticket invalide ou déjà utilisé',
			});
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
							setToken(codes[0].rawValue);
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
	}, [cameraActive]);

	return (
		<div class="mx-auto max-w-xl space-y-6">
			<div class="rounded-2xl border border-green-100 bg-white p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="flex items-center gap-2 text-lg font-bold text-slate-900">
						<QrCode class="h-5 w-5 text-green-600" />
						Contrôle d’accès QR
					</h2>
					<button
						type="button"
						onClick={() => setCameraActive(!cameraActive)}
						class="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 cursor-pointer"
					>
						<Camera class="h-4 w-4" />
						{cameraActive ? 'Arrêter caméra' : 'Activer caméra'}
					</button>
				</div>

				{cameraActive && (
					<video
						ref={videoRef}
						class="w-full rounded-xl border border-green-200 bg-black aspect-video object-cover"
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
						placeholder="Coller ou scanner le token QR..."
						value={token}
						onInput={(e) => setToken((e.target as HTMLInputElement).value)}
						class="flex-1 rounded-xl border border-green-200 px-3.5 py-2.5 text-sm font-mono focus:border-green-600 focus:outline-none"
					/>
					<button
						type="submit"
						class="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer"
					>
						Vérifier
					</button>
				</form>
			</div>

			{scanResult && (
				<div
					class={`rounded-2xl border p-6 flex items-start gap-3 ${
						scanResult.result === 'valid'
							? 'border-green-300 bg-green-50 text-green-900'
							: scanResult.result === 'pending'
								? 'border-amber-300 bg-amber-50 text-amber-900'
								: 'border-red-300 bg-red-50 text-red-900'
					}`}
				>
					{scanResult.result === 'valid' ? (
						<CheckCircle2 class="h-6 w-6 text-green-600 shrink-0" />
					) : scanResult.result === 'pending' ? (
						<AlertTriangle class="h-6 w-6 text-amber-600 shrink-0" />
					) : (
						<XCircle class="h-6 w-6 text-red-600 shrink-0" />
					)}
					<div>
						<p class="font-bold">{scanResult.message}</p>
						{scanResult.ticket?.code && (
							<p class="text-xs mt-1 font-mono">Ticket : {scanResult.ticket.code}</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
