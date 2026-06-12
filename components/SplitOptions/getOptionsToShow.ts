import type {
	AlternativeRouteAnalysis,
	ExtendedRouteAnalysis,
	SplitAnalysis,
} from "@/app/api/analyzeJourney";
import type { VendoJourney } from "@/utils/schemas";
import { calculateSplitOptionPricing } from "./calculateSplitOptionPricing";

/**
 * Wählt die anzuzeigenden Optionen: Preise berechnen, nicht bepreisbare
 * Optionen rauswerfen, nach Ersparnis sortieren, auf die besten 3 begrenzen.
 * Das Backend liefert bereits nur echt günstigere Optionen.
 */
// Gesamtdauer einer Option in ms (erste Abfahrt bis letzte Ankunft über alle Segmente).
const optionDurationMs = (
	option: SplitAnalysis | ExtendedRouteAnalysis | AlternativeRouteAnalysis
): number | null => {
	const first = option.segments[0]?.legs[0]?.departure;
	const lastSeg = option.segments[option.segments.length - 1];
	const last = lastSeg?.legs[lastSeg.legs.length - 1]?.arrival;
	if (!first || !last) return null;
	return last.getTime() - first.getTime();
};

export const getOptionsToShow = ({
	splitOptions,
	hasDeutschlandTicket,
	originalJourney,
	maxDurationMs,
}: {
	splitOptions: (
		| SplitAnalysis
		| ExtendedRouteAnalysis
		| AlternativeRouteAnalysis
	)[];
	hasDeutschlandTicket: boolean;
	originalJourney: VendoJourney;
	/** Zeitlimit: Optionen, die länger dauern, werden ausgeblendet (Client-Filter). */
	maxDurationMs?: number;
}) => {
	if (splitOptions.length === 0) {
		return [];
	}

	const optionsWithPricing = splitOptions
		.filter((option) => {
			if (maxDurationMs == null) return true;
			const d = optionDurationMs(option);
			return d == null || d <= maxDurationMs;
		})
		.map((option) => ({
			...option,
			pricing: calculateSplitOptionPricing({
				splitOption: option,
				hasDeutschlandTicket,
				originalJourney,
			}),
		}))
		.filter(
			(o) => o.pricing.isFullyCovered || o.pricing.adjustedTotalPrice !== null
		);

	const sortedOptions = optionsWithPricing.toSorted(
		(a, b) => (b.pricing.adjustedSavings ?? 0) - (a.pricing.adjustedSavings ?? 0)
	);

	return sortedOptions.slice(0, 3);
};
