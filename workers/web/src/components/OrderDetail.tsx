import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { Clock, Upload, CheckCircle2, AlertCircle, ExternalLink, Copy, Check, ImagePlus, X, BellRing } from 'lucide-preact';
import { apiFetch, formatDate, formatXof } from '../lib/api';
import {
	enableWebPush,
	getActivePushSubscription,
	isIosStandaloneRequired,
	isWebPushSupported,
	onPushSubscriptionChange,
	subscribeRealtime,
} from '../lib/realtime';

interface Props {
  orderId: string;
}

interface OrderDetailResponse {
  order: {
    id: string;
    reference: string;
    total_amount_xof: number;
    status: string;
    expires_at: string;
    created_at: string;
  };
  event?: {
    id: string;
    title: string;
    slug: string;
    venue: string;
    starts_at: string;
  } | null;
  items: Array<{
    id: string;
    item_type: string;
    quantity: number;
    unit_price_xof: number;
    subtotal_xof: number;
    convoy_commune?: string | null;
    convoy_meeting_point?: string | null;
  }>;
  payment: {
    id: string;
    expected_amount_xof: number;
    payer_phone: string | null;
    proof_image_key: string | null;
    wave_transaction_ref: string | null;
    wave_payment_url: string | null;
    status: string;
    rejection_reason: string | null;
    submitted_at: string | null;
  } | null;
  tickets: Array<{
    id: string;
    code: string;
    item_type: string;
    status: string;
  }>;
}

export default function OrderDetail({ orderId }: Props) {
  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payerPhone, setPayerPhone] = useState("");
  const [waveRef, setWaveRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [remainingText, setRemainingText] = useState("");
  const [waveQrSrc, setWaveQrSrc] = useState("");
  const [copied, setCopied] = useState(false);
	const [pushReady, setPushReady] = useState(true);
	const [pushLoading, setPushLoading] = useState(false);
	const [pushMessage, setPushMessage] = useState<string | null>(null);

  function load() {
    apiFetch<OrderDetailResponse>(`/api/orders/${orderId}`)
      .then((res) => {
        setData(res);
        if (res.payment?.payer_phone) setPayerPhone(res.payment.payer_phone);
        if (res.payment?.wave_transaction_ref)
          setWaveRef(res.payment.wave_transaction_ref);
        if (res.payment?.wave_payment_url) {
          QRCode.toDataURL(res.payment.wave_payment_url, {
            width: 200,
            margin: 1,
            color: { dark: "#064e3b", light: "#ffffff" },
          })
            .then(setWaveQrSrc)
            .catch(() => {});
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

	useEffect(() => {
		load();
		if (isWebPushSupported() || isIosStandaloneRequired()) {
			getActivePushSubscription().then((sub) => setPushReady(Boolean(sub)));
		}

		const unsubPush = onPushSubscriptionChange((enabled) => {
			setPushReady(enabled);
		});

		const unsub = subscribeRealtime((ev) => {
			if (!ev.orderId || ev.orderId === orderId) {
				if (
					ev.type === 'payment_confirmed' ||
					ev.type === 'payment_rejected' ||
					ev.type === 'order_expired' ||
					ev.type === 'order_expiring_soon'
				) {
					load();
				}
			}
		});

		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				load();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			unsubPush();
			unsub();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [orderId]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!data || data.order.status !== "pending_payment") return;
    const tick = () => {
      const diff = new Date(data.order.expires_at).getTime() - Date.now();
      if (diff <= 0) {
        setRemainingText("Expirée");
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemainingText(
        `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data]);

  function copyReference(ref: string) {
    navigator.clipboard?.writeText(ref).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  async function handleUpload(e: Event) {
    e.preventDefault();
    if (!file && !waveRef.trim()) {
      setError(
        "Veuillez fournir une capture d’écran ou un ID de transaction Wave.",
      );
      return;
    }
    setUploading(true);
    setError(null);

    const form = new FormData();
    if (file) form.append("file", file);
    if (waveRef.trim()) form.append("wave_transaction_ref", waveRef.trim());
    if (payerPhone.trim()) form.append("payer_phone", payerPhone.trim());

    try {
      const res = await apiFetch<{
        ok: boolean;
        status: string;
        proof_image_key: string | null;
        wave_transaction_ref: string | null;
      }>(`/api/orders/${orderId}/proof`, {
        method: "POST",
        body: form,
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              order: { ...prev.order, status: res.status },
              payment: prev.payment
                ? {
                    ...prev.payment,
                    proof_image_key:
                      res.proof_image_key ?? prev.payment.proof_image_key,
                    wave_transaction_ref:
                      res.wave_transaction_ref ??
                      prev.payment.wave_transaction_ref,
                    submitted_at: new Date().toISOString(),
                  }
                : null,
            }
          : null,
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  if (loading)
    return (
      <div class="h-64 rounded-2xl bg-slate-50 border border-slate-200 animate-pulse" />
    );
  if (!data) {
    return (
      <div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || "Commande introuvable"}
      </div>
    );
  }

  const { order, event, items, payment, tickets } = data;
  const firstConvoy = items.find((it) => it.convoy_commune);

  return (
    <div class="space-y-6">
      <div class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-mono text-xs font-bold uppercase tracking-wide text-emerald-600">
                {order.reference}
              </p>
              <button
                type="button"
                onClick={() => copyReference(order.reference)}
                title="Copier la référence"
                class="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                {copied ? (
                  <Check class="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy class="h-3 w-3" />
                )}
                <span>{copied ? "Copié" : "Copier"}</span>
              </button>
              {order.status === "pending_payment" && (
                <span class="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                  En attente de paiement
                </span>
              )}
            </div>
            <h1 class="mt-1.5 text-2xl sm:text-3xl font-black tracking-tight text-slate-950">
              {formatXof(order.total_amount_xof)}
            </h1>
            {event && (
              <p class="mt-1.5 text-sm font-bold text-slate-800">
                {event.title}
                {firstConvoy?.convoy_commune
                  ? ` • Départ ${firstConvoy.convoy_commune}`
                  : ""}
              </p>
            )}
            <p class="mt-1 text-xs text-slate-500">
              Créée le {formatDate(order.created_at)}
            </p>
          </div>

          {order.status === "pending_payment" && (
            <div class="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800">
              <Clock class="h-4 w-4 shrink-0" />
              <span>Expire dans : {remainingText}</span>
            </div>
          )}

          {order.status === "under_review" && (
            <div class="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">
              <Clock class="h-4 w-4 shrink-0" />
              <span>
                Vérification en cours
                {payment?.wave_transaction_ref
                  ? ` (${payment.wave_transaction_ref})`
                  : ""}
              </span>
            </div>
          )}

          {order.status === "confirmed" && (
            <div class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
              <CheckCircle2 class="h-4 w-4" />
              <span>Paiement confirmé</span>
            </div>
          )}
        </div>

				{order.status === 'rejected' && payment?.rejection_reason && (
					<div class="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
						<AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
						<div>
							<p class="font-bold">Paiement rejeté</p>
							<p>{payment.rejection_reason}</p>
						</div>
					</div>
				)}

				{!pushReady && (order.status === 'pending_payment' || order.status === 'under_review') && (
					<div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs">
						<div class="flex items-center gap-2 text-slate-800">
							<BellRing class="h-4 w-4 text-emerald-600 shrink-0" />
							<span>
								Recevez une alerte instantanée dès que vos billets QR sont activés.
								{pushMessage ? ` (${pushMessage})` : ''}
							</span>
						</div>
						<button
							type="button"
							disabled={pushLoading}
							onClick={async () => {
								setPushLoading(true);
								setPushMessage(null);
								const res = await enableWebPush();
								if (res.ok) setPushReady(true);
								else if (res.error) setPushMessage(res.error);
								setPushLoading(false);
							}}
							class="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700 cursor-pointer"
						>
							{pushLoading ? 'Activation...' : 'Activer les alertes'}
						</button>
					</div>
				)}
			</div>

      {order.status === "pending_payment" && (
        <div class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs space-y-6">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div class="space-y-3">
              <span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                Étape 1 sur 2
              </span>
              <h2 class="text-lg font-extrabold text-slate-950">
                Régler {formatXof(order.total_amount_xof)} avec Wave
              </h2>
              <p class="text-sm text-slate-600">
                Ouvrez directement Wave sur mobile ou scannez ce QR code depuis
                un autre appareil.
              </p>
              {payment?.wave_payment_url && (
                <a
                  href={payment.wave_payment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                >
                  <span>
                    Payer avec Wave ({formatXof(order.total_amount_xof)})
                  </span>
                  <ExternalLink class="h-4 w-4" />
                </a>
              )}
            </div>

            {waveQrSrc && (
              <div class="flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50/70 p-3 shrink-0">
                <img
                  src={waveQrSrc}
                  alt="QR Code paiement Wave"
                  class="h-36 w-36 rounded-lg bg-white p-1.5 border border-slate-100"
                />
                <span class="mt-1.5 text-[11px] font-semibold text-slate-600">
                  Scanner avec Wave
                </span>
              </div>
            )}
          </div>

          <form
            onSubmit={handleUpload}
            class="space-y-4 pt-6 border-t border-slate-100"
          >
            <div>
              <span class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                Étape 2 sur 2
              </span>
              <h3 class="mt-2 text-base font-extrabold text-slate-950">
                Transmettre votre preuve de paiement
              </h3>
              <p class="text-xs text-slate-500">
                Indiquez l’ID de transaction Wave, une capture d’écran, ou les
                deux.
              </p>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  for="proof-wave-ref"
                  class="block text-sm font-semibold text-slate-700 mb-1"
                >
                  ID de transaction Wave
                </label>
                <input
                  id="proof-wave-ref"
                  name="wave_transaction_ref"
                  type="text"
                  value={waveRef}
                  onInput={(e) =>
                    setWaveRef((e.target as HTMLInputElement).value)
                  }
                  placeholder="Ex: T_CI_XXXXXXXX"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-mono focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  for="proof-phone"
                  class="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Numéro Wave utilisé (optionnel)
                </label>
                <input
                  id="proof-phone"
                  name="payer_phone"
                  type="tel"
                  value={payerPhone}
                  onInput={(e) =>
                    setPayerPhone((e.target as HTMLInputElement).value)
                  }
                  placeholder="+225 07 00 00 00 00"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <span class="block text-sm font-semibold text-slate-700 mb-1.5">
                Capture d’écran Wave (optionnel si ID saisi)
              </span>

              {previewUrl ? (
                <div class="relative inline-block rounded-2xl border border-slate-200 bg-slate-50 p-2">
                  <img
                    src={previewUrl}
                    alt="Aperçu capture Wave"
                    class="max-h-48 rounded-xl object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label="Retirer la capture"
                    class="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow-xs hover:bg-red-600 cursor-pointer"
                  >
                    <X class="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label class="flex max-w-md cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3.5 text-sm text-slate-600 hover:border-emerald-500 hover:bg-emerald-50/30 transition-colors">
                  <ImagePlus class="h-5 w-5 text-emerald-600 shrink-0" />
                  <span>Choisir une capture (JPEG, PNG, WebP — max 5 Mo)</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    class="hidden"
                    onChange={(e) =>
                      setFile((e.target as HTMLInputElement).files?.[0] || null)
                    }
                  />
                </label>
              )}
            </div>

            {error && (
              <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={(!file && !waveRef.trim()) || uploading}
              class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <Upload class="h-4 w-4" />
              {uploading ? "Envoi en cours..." : "Soumettre pour validation"}
            </button>
          </form>
        </div>
      )}

      {order.status === "confirmed" && (
        <div class="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="font-extrabold text-emerald-950">
              Vos billets sont prêts !
            </h3>
            <p class="text-sm text-emerald-800">
              {tickets.length} billet(s) valide(s) disponible(s) dans votre
              portefeuille.
            </p>
          </div>
          <a
            href="/tickets"
            class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <span>Ouvrir mes billets</span>
            <ExternalLink class="h-4 w-4" />
          </a>
        </div>
      )}

      <div class="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 class="font-bold text-slate-950 mb-3">Détail de la réservation</h3>
        <div class="divide-y divide-slate-100 text-sm">
          {items.map((item) => (
            <div
              key={item.id}
              class="py-2.5 flex items-baseline justify-between gap-4"
            >
              <div class="min-w-0">
                <span class="text-slate-700 font-medium">
                  {event?.title ? `${event.title} — ` : ""}Billet + convoi
                  aller-retour × {item.quantity}
                </span>
                {item.convoy_commune && (
                  <p class="text-xs text-slate-500 mt-0.5">
                    Départ {item.convoy_commune}
                    {item.convoy_meeting_point
                      ? ` (${item.convoy_meeting_point})`
                      : ""}
                  </p>
                )}
              </div>
              <span class="shrink-0 whitespace-nowrap font-bold text-slate-950">
                {formatXof(item.subtotal_xof)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
