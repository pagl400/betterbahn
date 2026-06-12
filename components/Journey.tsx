import type { VendoJourney } from "@/utils/schemas";
import { JourneyCard } from "./JourneyCard/JourneyCard";

interface Props {
	isSelected?: boolean;
	isFastest?: boolean;
	onClick: () => void;
	journey: VendoJourney;
}

export const Journey = ({ journey, onClick, isSelected, isFastest }: Props) => (
	<JourneyCard
		journey={journey}
		isSelected={isSelected}
		isFastest={isFastest}
		onClick={onClick}
	/>
);
