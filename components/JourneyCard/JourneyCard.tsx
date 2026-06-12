"use client";

import { legIsFlixTrain } from "@/utils/deutschlandTicketUtils";
import { formatDuration, formatTime } from "@/utils/formatUtils";
import { formatPriceDE } from "@/utils/priceUtils";
import type { VendoJourney } from "@/utils/schemas";
import { useState } from "react";
import { LegList } from "./LegList";

export const JourneyCard = ({
	journey,
	isSelected = false,
	isFastest = false,
	onClick,
}: {
	journey: VendoJourney;
	isSelected?: boolean;
	isFastest?: boolean;
	onClick: () => void;
}) => {
	const [expanded, setExpanded] = useState(false);

	const firstLeg = journey.legs.at(0);
	const lastLeg = journey.legs.at(-1);
	const trainLegs = journey.legs.filter((leg) => !leg.walking && leg.line);
	const transfers = Math.max(0, trainLegs.length - 1);
	const price = journey.price?.amount;

	return (
		<div
			onClick={onClick}
			className={`rounded-lg border p-4 cursor-pointer transition-all ${
				isSelected
					? "border-primary ring-2 ring-primary/40 bg-primary/5"
					: "border-foreground/20 hover:border-foreground/40 hover:bg-foreground/5"
			}`}
		>
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<div className="flex items-baseline gap-2">
						<span className="text-2xl font-bold tabular-nums">
							{formatTime(firstLeg?.departure)}
						</span>
						<span className="text-foreground/40">→</span>
						<span className="text-2xl font-bold tabular-nums">
							{formatTime(lastLeg?.arrival)}
						</span>
					</div>
					{isFastest && (
						<span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 text-xs font-bold whitespace-nowrap">
							⚡ Schnellste
						</span>
					)}
				</div>
				<div className="text-2xl font-bold text-foreground tabular-nums">
					{price === undefined ? "–" : formatPriceDE(price)}
				</div>
			</div>

			<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/70">
				<span className="font-medium">{formatDuration(journey)}</span>
				<span className="text-foreground/30">·</span>
				<span>
					{transfers === 0
						? "direkt"
						: `${transfers} Umstieg${transfers > 1 ? "e" : ""}`}
				</span>
				<span className="flex flex-wrap gap-1">
					{trainLegs.map((leg, i) => (
						<span
							key={i}
							className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
								legIsFlixTrain(leg)
									? "bg-purple-500/15 text-purple-600"
									: "bg-primary/15 text-primary"
							}`}
						>
							{leg.line?.name}
						</span>
					))}
				</span>
			</div>

			<div className="mt-1 text-xs text-foreground/50">
				{firstLeg?.origin?.name ?? "?"} → {lastLeg?.destination?.name ?? "?"}
			</div>

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setExpanded((v) => !v);
				}}
				className="mt-2 text-xs text-primary hover:underline"
			>
				{expanded ? "Details ausblenden ▴" : "Details anzeigen ▾"}
			</button>

			{expanded && (
				<div className="mt-2 pt-2 border-t border-foreground/15">
					<LegList journey={journey} />
				</div>
			)}
		</div>
	);
};
