import type { VendoJourney } from "@/utils/schemas";
import { createSegmentSearchUrl } from "@/utils/createUrl";
import {
	legIsFlixTrain,
	isLegCoveredByDeutschlandTicket,
} from "@/utils/deutschlandTicketUtils";
import { getJourneyLegsWithTransfers } from "@/utils/journeyUtils";
import { formatPriceDE } from "@/utils/priceUtils";
import { LegList } from "../JourneyCard/LegList";

export const Segment = ({
	segment,
	index,
	segmentsWithoutPricing,
	hasDeutschlandTicket,
	bahnCard,
	travelClass
}: {
	segment: VendoJourney;
	index: number;
	segmentsWithoutPricing: number[];
	hasDeutschlandTicket: boolean;
	bahnCard: string | null;
	travelClass: string
}) => {
	const segmentHasFlixTrain = getJourneyLegsWithTransfers(segment).some((leg) =>
		legIsFlixTrain(leg)
	);
	const hasUnknownPrice = segmentsWithoutPricing?.includes(index);

	// Check if segment is covered by Deutschland-Ticket
	const segmentCoveredByDeutschlandTicket =
		hasDeutschlandTicket &&
		getJourneyLegsWithTransfers(segment).every((leg) =>
			isLegCoveredByDeutschlandTicket(leg, hasDeutschlandTicket)
		);

	return (
		<div className="flex justify-between items-start gap-3 p-2 rounded-md bg-background border border-foreground/20">
			<div className="flex-grow">
				<LegList journey={segment} />
			</div>
			<div className="text-right ml-4 flex-shrink-0 w-28">
				<div className="font-bold text-md">
					{segmentCoveredByDeutschlandTicket ? (
						<span className="text-xs font-medium text-green-600">
							✓ D-Ticket
						</span>
					) : hasUnknownPrice ? (
						<span
							className={`text-xs font-medium ${segmentHasFlixTrain ? "text-purple-600" : "text-orange-600"
								}`}
						>
							{segmentHasFlixTrain ? "FlixTrain" : "Preis unbekannt"}
						</span>
					) : (
						<span>
							{segment.price?.amount === undefined
								? "Preis auf Anfrage"
								: formatPriceDE(segment.price.amount)}
						</span>
					)}
				</div>
				<button
					onClick={(e) => {
						e.stopPropagation();

						const dbUrl = createSegmentSearchUrl(segment, Number(travelClass), hasDeutschlandTicket, bahnCard);

						if (dbUrl && !dbUrl.startsWith("Error:")) {
							window.open(dbUrl, "_blank");
						} else {
							console.error("Failed to generate URL:", dbUrl);
							alert("Failed to generate booking URL.");
						}
					}}
					className="mt-1 px-3 py-1 bg-green-600 hover:bg-green-700 hover:cursor-pointer text-foreground text-xs rounded-md "
				>
					Zur Buchung
				</button>
			</div>
		</div>
	);
};
