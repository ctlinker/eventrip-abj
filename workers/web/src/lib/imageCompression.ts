export interface CompressImageOptions {
	maxWidth?: number;
	maxHeight?: number;
	quality?: number;
	fileName?: string;
}

function replaceExtWithWebp(name: string): string {
	const base = name.replace(/\.[^.]+$/, '') || 'image';
	return `${base}.webp`;
}

async function loadImageSource(blob: Blob): Promise<{
	width: number;
	height: number;
	draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
	cleanup: () => void;
}> {
	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(blob);
		return {
			width: bitmap.width,
			height: bitmap.height,
			draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
			cleanup: () => bitmap.close(),
		};
	}

	const url = URL.createObjectURL(blob);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('Impossible de décoder l’image'));
			el.src = url;
		});
		return {
			width: img.naturalWidth,
			height: img.naturalHeight,
			draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
			cleanup: () => URL.revokeObjectURL(url),
		};
	} catch (err) {
		URL.revokeObjectURL(url);
		throw err;
	}
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), type, quality);
	});
}

/**
 * Compresse et redimensionne une image côté navigateur au format WebP.
 * Conserve le ratio d'aspect sans jamais agrandir une image plus petite que maxWidth/maxHeight.
 */
export async function compressImageToWebP(
	input: File | Blob,
	options: CompressImageOptions = {},
): Promise<File> {
	const maxWidth = options.maxWidth ?? 1200;
	const maxHeight = options.maxHeight ?? 1200;
	const quality = options.quality ?? 0.82;
	const rawName = options.fileName ?? (input instanceof File ? input.name : 'poster.webp');

	const source = await loadImageSource(input);
	try {
		const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
		const targetW = Math.max(1, Math.round(source.width * scale));
		const targetH = Math.max(1, Math.round(source.height * scale));

		const canvas = document.createElement('canvas');
		canvas.width = targetW;
		canvas.height = targetH;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Contexte Canvas 2D indisponible');
		}

		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		source.draw(ctx, targetW, targetH);

		let outBlob = await canvasToBlob(canvas, 'image/webp', quality);
		let outType = 'image/webp';
		let outName = replaceExtWithWebp(rawName);

		if (!outBlob || outBlob.type !== 'image/webp') {
			outBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
			outType = 'image/jpeg';
			outName = `${rawName.replace(/\.[^.]+$/, '') || 'image'}.jpg`;
		}

		if (!outBlob) {
			throw new Error('Échec de la compression de l’image');
		}

		if (
			input instanceof File &&
			input.type === outType &&
			scale === 1 &&
			outBlob.size >= input.size
		) {
			return input;
		}

		return new File([outBlob], outName, { type: outType, lastModified: Date.now() });
	} finally {
		source.cleanup();
	}
}

export async function compressImagesToWebP(
	files: File[],
	options: CompressImageOptions = {},
): Promise<File[]> {
	return Promise.all(files.map((file) => compressImageToWebP(file, options)));
}

export function isWebpPosterKey(key: string): boolean {
	return key.toLowerCase().endsWith('.webp');
}
