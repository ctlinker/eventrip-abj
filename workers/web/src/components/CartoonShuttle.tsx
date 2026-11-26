export default function CartoonShuttle() {
	return (
		<div class="relative mx-auto w-full max-w-[440px] select-none" aria-hidden="true">
			<svg
				viewBox="0 0 460 270"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				class="w-full h-auto overflow-visible"
			>
				{/* Grille subtile sous la colline */}
				<defs>
					<pattern id="hero-grid" width="22" height="22" patternUnits="userSpaceOnUse">
						<path d="M 22 0 L 0 0 0 22" fill="none" stroke="#b8893c" stroke-opacity="0.18" stroke-width="1" />
					</pattern>
					<clipPath id="hill-clip">
						<path d="M 10 255 Q 235 168 455 238 L 455 268 L 10 268 Z" />
					</clipPath>
					<clipPath id="bus-body-clip">
						<path d="M 104 166 L 104 128 Q 104 114 118 109 L 132 68 Q 136 56 150 56 L 352 56 Q 374 56 374 78 L 374 166 Z" />
					</clipPath>
				</defs>

				{/* Remplissage grille sous la courbe */}
				<rect x="0" y="160" width="460" height="110" fill="url(#hero-grid)" clipPath="url(#hill-clip)" />

				{/* Courbe de route dorée principale */}
				<path
					d="M 12 254 Q 235 168 452 236"
					stroke="#b8893c"
					stroke-width="5.5"
					stroke-linecap="round"
				/>
				{/* Tirets de mouvement doux sur la route */}
				<path
					d="M 30 247 Q 235 173 440 232"
					stroke="#e3c183"
					stroke-width="2"
					stroke-dasharray="10 14"
					stroke-linecap="round"
					class="animate-road-flow"
				/>

				{/* Ombre portée de la navette */}
				<ellipse cx="244" cy="192" rx="134" ry="9" fill="#0f172a" fill-opacity="0.08" />

				{/* Corps de la navette avec léger rebond */}
				<g class="animate-shuttle-bob">
					{/* Rétroviseur avant gauche */}
					<path
						d="M 130 78 L 114 78 Q 109 78 109 84 L 109 95"
						stroke="#1e293b"
						stroke-width="4"
						stroke-linecap="round"
					/>
					<rect x="103" y="88" width="11" height="18" rx="4" fill="#334155" stroke="#1e293b" stroke-width="3" />

					{/* Carrosserie blanche */}
					<path
						d="M 104 166 L 104 128 Q 104 114 118 109 L 132 68 Q 136 56 150 56 L 352 56 Q 374 56 374 78 L 374 166 Z"
						fill="#ffffff"
					/>

					{/* Graffiti & Stickers événementiels statiques (clippés à la carrosserie) */}
					<g clipPath="url(#bus-body-clip)">
						{/* Bande toit dorée */}
						<rect x="125" y="56" width="255" height="11" fill="#b8893c" />

						{/* Taches artistiques graffiti maîtrisées */}
						<circle cx="178" cy="146" r="26" fill="#2b3a4d" fill-opacity="0.85" />
						<circle cx="236" cy="138" r="34" fill="#e3c183" fill-opacity="0.4" />
						<circle cx="292" cy="148" r="28" fill="#cfa35b" fill-opacity="0.9" />
						<circle cx="344" cy="136" r="26" fill="#0e1827" fill-opacity="0.85" />
						<circle cx="358" cy="158" r="22" fill="#9a6f28" fill-opacity="0.85" />
						<path
							d="M 118 148 Q 140 126 160 152 T 195 156"
							stroke="#e3c183"
							stroke-width="10"
							stroke-linecap="round"
						/>

						{/* Points street-art */}
						<circle cx="164" cy="126" r="3" fill="#0e1827" />
						<circle cx="322" cy="124" r="3.5" fill="#b8893c" />
						<circle cx="332" cy="152" r="2.5" fill="#ffffff" />

						{/* Tag "GO!" à l'avant */}
						<text
							x="120"
							y="142"
							transform="rotate(-10 120 142)"
							fill="#9a6f28"
							font-size="18"
							font-weight="900"
							font-family="Satoshi-Variable, sans-serif"
						>
							GO!
						</text>

						{/* Sticker central "FEST" */}
						<g transform="rotate(-5 248 146)">
							<rect
								x="196"
								y="120"
								width="104"
								height="40"
								rx="9"
								fill="#0e1827"
								stroke="#e3c183"
								stroke-width="3"
							/>
							<text
								x="248"
								y="148"
								text-anchor="middle"
								fill="#e3c183"
								stroke="#0e1827"
								stroke-width="0.5"
								font-size="29"
								font-weight="900"
								letter-spacing="1"
								font-family="Satoshi-Variable, sans-serif"
							>
								FEST
							</text>
						</g>

						{/* Sticker "ABJ" arrière */}
						<rect
							x="318"
							y="116"
							width="40"
							height="18"
							rx="5"
							fill="#b8893c"
							stroke="#0e1827"
							stroke-width="2.5"
						/>
						<text
							x="338"
							y="129"
							text-anchor="middle"
							fill="#ffffff"
							font-size="10.5"
							font-weight="800"
							font-family="Satoshi-Variable, sans-serif"
						>
							ABJ
						</text>
					</g>

					{/* Contour carrosserie */}
					<path
						d="M 104 166 L 104 128 Q 104 114 118 109 L 132 68 Q 136 56 150 56 L 352 56 Q 374 56 374 78 L 374 166 Z"
						stroke="#1e293b"
						stroke-width="4"
						stroke-linejoin="round"
					/>

					{/* Pare-brise conducteur + 4 fenêtres passagers */}
					<path
						d="M 126 108 L 138 72 Q 140 67 146 67 L 166 67 L 166 108 Z"
						fill="#334155"
						stroke="#1e293b"
						stroke-width="3.2"
						stroke-linejoin="round"
					/>
					{[176, 224, 272, 320].map((x) => (
						<g key={x}>
							<rect
								x={x}
								y={67}
								width={40}
								height={41}
								rx={5}
								fill="#334155"
								stroke="#1e293b"
								stroke-width="3.2"
							/>
							<path
								d={`M ${x + 8} 73 L ${x + 18} 73 L ${x + 8} 92 Z`}
								fill="#94a3b8"
								fill-opacity="0.35"
							/>
						</g>
					))}

					{/* Phare avant & feu arrière */}
					<rect x="101" y="136" width="9" height="14" rx="3" fill="#facc15" stroke="#1e293b" stroke-width="2.8" />
					<rect x="369" y="136" width="8" height="15" rx="3" fill="#ef4444" stroke="#1e293b" stroke-width="2.8" />

					{/* Pare-chocs bas */}
					<rect
						x="96"
						y="160"
						width="286"
						height="13"
						rx="6.5"
						fill="#475569"
						stroke="#1e293b"
						stroke-width="3.5"
					/>

					{/* Passages de roues */}
					<path d="M 132 173 A 28 28 0 0 1 188 173" fill="#0f172a" />
					<path d="M 294 173 A 28 28 0 0 1 350 173" fill="#0f172a" />
				</g>

				{/* Roue avant */}
				<g>
					<circle cx="160" cy="174" r="23" fill="#1e293b" stroke="#0f172a" stroke-width="3.5" />
					<circle cx="160" cy="174" r="13" fill="#cbd5e1" stroke="#1e293b" stroke-width="2.5" />
					<g class="animate-wheel-spin">
						<circle cx="160" cy="174" r="4" fill="#1e293b" />
						<line x1="160" y1="162" x2="160" y2="186" stroke="#1e293b" stroke-width="2.2" />
						<line x1="148" y1="174" x2="172" y2="174" stroke="#1e293b" stroke-width="2.2" />
					</g>
				</g>

				{/* Roue arrière */}
				<g>
					<circle cx="322" cy="174" r="23" fill="#1e293b" stroke="#0f172a" stroke-width="3.5" />
					<circle cx="322" cy="174" r="13" fill="#cbd5e1" stroke="#1e293b" stroke-width="2.5" />
					<g class="animate-wheel-spin">
						<circle cx="322" cy="174" r="4" fill="#1e293b" />
						<line x1="322" y1="162" x2="322" y2="186" stroke="#1e293b" stroke-width="2.2" />
						<line x1="310" y1="174" x2="334" y2="174" stroke="#1e293b" stroke-width="2.2" />
					</g>
				</g>
			</svg>
		</div>
	);
}
