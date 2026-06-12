import type {
	AlternativeRouteAnalysis,
	ExtendedRouteAnalysis,
	SplitAnalysis,
} from "@/app/api/analyzeJourney";
import {
	isLegCoveredByDeutschlandTicket,
	legIsFlixTrain,
	segmentEffectivePrice,
} from "@/utils/deutschlandTicketUtils";
import { getJourneyLegsWithTransfers } from "@/utils/journeyUtils";
import type { VendoJourney } from "@/utils/schemas";

const REGIONAL_PRODUCTS = [
	"regional",
	"regionalbahn",
	"regionalexpress",
	"sbahn",
	"suburban",
];

/**
 * Preis-/Ersparnis-Berechnung einer Option mit Deutschland-Ticket-Logik.
 * Basis ist der Effektivpreis je Segment (D-Ticket-abgedeckter Nahverkehr = 0).
 * Das Backend liefert nur noch echt günstigere Optionen – hier wird daher nur
 * noch dargestellt, nicht mehr „Teilpreis" toleriert.
 */
export const calculateSplitOptionPricing = ({
	splitOption,
	hasDeutschlandTicket,
	originalJourney,
}: {
	splitOption: SplitAnalysis | ExtendedRouteAnalysis | AlternativeRouteAnalysis;
	hasDeutschlandTicket: boolean;
	originalJourney: VendoJourney;
}) => {
	const segments = splitOption.segments ?? [];
	const effectivePrices = segments.map((s) =>
		segmentEffectivePrice(s, hasDeutschlandTicket)
	);
	const allKnown =
		effectivePrices.length > 0 && effectivePrices.every((p) => p !== null);

	const totalPrice = allKnown
		? effectivePrices.reduce((sum, p) => sum + (p ?? 0), 0)
		: null;

	const originalApiPrice = originalJourney.price?.amount ?? 0;
	const savings =
		totalPrice !== null ? Math.max(0, originalApiPrice - totalPrice) : null;

	const hasRegionalTrains = segments.some((segment) =>
		getJourneyLegsWithTransfers(segment).some((leg) =>
			REGIONAL_PRODUCTS.includes(leg.line?.product?.toLowerCase() || "")
		)
	);
	const hasFlixTrains = segments.some((segment) =>
		getJourneyLegsWithTransfers(segment).some((leg) => legIsFlixTrain(leg))
	);

	const allSegmentsCovered =
		segments.length > 0 &&
		segments.every((segment) =>
			getJourneyLegsWithTransfers(segment).every((leg) =>
				isLegCoveredByDeutschlandTicket(leg, hasDeutschlandTicket)
			)
		);
	const isFullyCovered = allSegmentsCovered && hasDeutschlandTicket;

	// Segmente ohne Effektivpreis (sollten dank Backend-Filter praktisch nicht
	// mehr vorkommen) – nur für die Detail-Anzeige.
	const segmentsWithoutPricing = effectivePrices
		.map((p, i) => (p === null ? i : -1))
		.filter((i) => i >= 0);

	return {
		...splitOption,
		isFullyCovered,
		hasRegionalTrains,
		hasFlixTrains,
		cannotShowPrice: totalPrice === null && !isFullyCovered,
		hasPartialPricing: false,
		segmentsWithoutPricing,
		adjustedTotalPrice: totalPrice,
		adjustedSavings: savings,
	};
};
