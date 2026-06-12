import { legIsFlixTrain } from "@/utils/deutschlandTicketUtils";
import { formatTime } from "@/utils/formatUtils";
import { getStationName } from "@/utils/journeyUtils";
import type { VendoJourney } from "@/utils/schemas";

/**
 * Zeigt jeden Zug der Strecke einzeln: Linie, Von (ab) → Nach (an).
 * FlixTrain wird als Anbieter markiert. Wird nur im aufgeklappten Zustand
 * gerendert (keine zusätzlichen Netzwerk-Calls).
 */
export const LegList = ({ journey }: { journey: VendoJourney }) => {
	const legs = journey.legs.filter((leg) => !leg.walking && leg.line);

	return (
		<div className="space-y-2">
			{legs.map((leg, i) => {
				const isFlix = legIsFlixTrain(leg);
				return (
					<div key={i} className="flex items-start gap-2 text-sm">
						<span
							className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${
								isFlix
									? "bg-purple-500/15 text-purple-600"
									: "bg-primary/15 text-primary"
							}`}
						>
							{leg.line?.name ?? "Zug"}
						</span>
						<div className="text-foreground/80">
							<span className="font-medium">
								{getStationName(leg.origin)}
							</span>{" "}
							<span className="tabular-nums text-foreground/60">
								({formatTime(leg.departure)})
							</span>{" "}
							<span className="text-foreground/40">→</span>{" "}
							<span className="font-medium">
								{getStationName(leg.destination)}
							</span>{" "}
							<span className="tabular-nums text-foreground/60">
								({formatTime(leg.arrival)})
							</span>
							{isFlix && (
								<span className="ml-2 text-xs text-purple-600">FlixTrain</span>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
};
