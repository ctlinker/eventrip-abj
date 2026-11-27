import { useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Ticket } from 'lucide-preact';

interface Props {
	urls: string[];
	alt: string;
	aspectClass?: string;
	href?: string;
	priority?: boolean;
}

export default function EventImageCarousel({
	urls,
	alt,
	aspectClass = 'aspect-[16/10]',
	href,
	priority = false,
}: Props) {
	const [index, setIndex] = useState(0);

	if (urls.length === 0) {
		const placeholder = (
			<div class={`relative ${aspectClass} w-full bg-slate-50 bg-hatched-gold flex items-center justify-center overflow-hidden`}>
				<Ticket class="h-12 w-12 text-brand-600/50" />
			</div>
		);
		return href ? (
			<a href={href} class="block w-full min-w-0">
				{placeholder}
			</a>
		) : (
			placeholder
		);
	}

	const safeIndex = index % urls.length;

	function prev(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		setIndex((i) => (i - 1 + urls.length) % urls.length);
	}

	function next(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		setIndex((i) => (i + 1) % urls.length);
	}

	const track = (
		<div
			class="flex h-full w-full transition-transform duration-300 ease-out"
			style={{ transform: `translateX(-${safeIndex * 100}%)` }}
		>
			{urls.map((url, idx) => {
				const isLcpHero = priority && idx === 0;
				return (
					<img
						key={url}
						src={url}
						alt={`${alt} (${idx + 1}/${urls.length})`}
						loading={isLcpHero ? 'eager' : 'lazy'}
						decoding={isLcpHero ? 'sync' : 'async'}
						fetchpriority={isLcpHero ? 'high' : undefined}
						class="h-full w-full shrink-0 object-cover"
					/>
				);
			})}
		</div>
	);

	return (
		<div class={`relative ${aspectClass} w-full min-w-0 bg-slate-100 overflow-hidden group/carousel`}>
			{href ? (
				<a href={href} class="block h-full w-full" aria-label={alt}>
					{track}
				</a>
			) : (
				track
			)}

			{urls.length > 1 && (
				<>
					<button
						type="button"
						onClick={prev}
						aria-label="Photo précédente"
						class="absolute left-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm opacity-90 hover:bg-white cursor-pointer"
					>
						<ChevronLeft class="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={next}
						aria-label="Photo suivante"
						class="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm opacity-90 hover:bg-white cursor-pointer"
					>
						<ChevronRight class="h-4 w-4" />
					</button>

					<div class="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-1 backdrop-blur-xs">
						{urls.map((_, i) => (
							<button
								key={i}
								type="button"
								aria-label={`Image ${i + 1}`}
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									setIndex(i);
								}}
								class={`h-1.5 rounded-full transition-all cursor-pointer ${
									i === safeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60'
								}`}
							/>
						))}
					</div>
				</>
			)}
		</div>
	);
}
