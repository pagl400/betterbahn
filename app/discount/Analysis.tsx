import { OriginalJourneyCard } from "@/components/discount/OriginalJourneyCard";
import { SplitOptionsCardContent } from "@/components/discount/SplitOptionsCard";
import type { Progress } from "@/components/discount/StatusBox";
import { SplitOptions } from "@/components/SplitOptions/SplitOptions";
import type { VendoJourney } from "@/utils/schemas";
import { trpc } from "@/utils/TRPCProvider";
import { useState, type Dispatch } from "react";
import type {
	AlternativeRouteAnalysis,
	ExtendedRouteAnalysis,
	SplitAnalysis,
} from "../api/analyzeJourney";
import { useUrlParams } from "./useUrlParams";

interface Props {
	journey: VendoJourney;
	setProgress: Dispatch<Progress | null>;
	setAnalysisError: Dispatch<string>;
	extensionStops: number;
	maxDurationMs?: number;
}

export const ComparisonView = ({
	journey,
	setProgress,
	setAnalysisError,
	extensionStops,
	maxDurationMs,
}: Props) => {
	const params = useUrlParams();
	const [splitOptions, setSplitPoints] = useState<SplitAnalysis[] | null>(null);
	const [extensionOptions, setExtensionOptions] = useState<
		ExtendedRouteAnalysis[]
	>([]);
	const [alternativeOptions, setAlternativeOptions] = useState<
		AlternativeRouteAnalysis[]
	>([]);

	const analysisSubscription = trpc.analyzeJourney.useSubscription(
		{ ...params, journey, extensionStops },
		{
			onError: (err) => setAnalysisError(err.message),
			onData(data) {
				switch (data.type) {
					case "processing": {
						setProgress(data);
						break;
					}
					case "complete": {
						setProgress(null);
						setSplitPoints(data.splitOptions);
						setExtensionOptions(data.extensionOptions);
						setAlternativeOptions(data.alternativeOptions);
						break;
					}
				}
			},
		}
	);

	if (splitOptions === null) {
		return;
	}

	const loading = analysisSubscription.status === "pending";

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<div className="bg-background rounded-lg shadow p-6">
					<OriginalJourneyCard selectedJourney={journey} />
				</div>
				<div className="bg-background rounded-lg shadow p-6">
					<div className="space-y-6">
						<h3 className="font-semibold text-lg ">Split-Ticket Optionen</h3>
						<SplitOptionsCardContent
							loading={loading}
							splitOptions={splitOptions}
							selectedJourney={journey}
							maxDurationMs={maxDurationMs}
						/>
					</div>
				</div>
			</div>

			<div className="bg-background rounded-lg shadow p-6">
				<div className="space-y-4">
					<h3 className="font-semibold text-lg">
						Verlängerte Route (günstigeres Ticket)
					</h3>
					<p className="text-sm text-foreground/60">
						Ein Ticket für eine längere Strecke kann günstiger sein. Du fährst
						nur deinen Abschnitt, kaufst aber das längere Ticket.
					</p>
					<SplitOptions
						splitOptions={extensionOptions}
						originalJourney={journey}
						loadingSplits={loading}
						variant="extended"
						maxDurationMs={maxDurationMs}
					/>
				</div>
			</div>

			<div className="bg-background rounded-lg shadow p-6">
				<div className="space-y-4">
					<h3 className="font-semibold text-lg">
						Alternative Start-/Zielbahnhöfe
					</h3>
					<p className="text-sm text-foreground/60">
						Du fährst tatsächlich ab/zu einem anderen Bahnhof in der Nähe – der
						Gesamtpreis kann günstiger sein. Die Anreise zum Alternativbahnhof
						musst du selbst organisieren.
					</p>
					<SplitOptions
						splitOptions={alternativeOptions}
						originalJourney={journey}
						loadingSplits={loading}
						variant="alternative"
						maxDurationMs={maxDurationMs}
					/>
				</div>
			</div>

			<div className="rounded-lg border border-foreground/15 bg-foreground/5 p-4 text-sm text-foreground/70">
				<span className="font-medium text-foreground/80">Hinweis:</span> Fernbus
				(FlixBus), Taxi/Uber/Bolt und Mitfahrgelegenheiten lassen sich mangels
				kostenloser offizieller API aktuell nicht vergleichen. FlixTrain ist –
				sofern verfügbar – in den DB-Ergebnissen enthalten und entsprechend
				markiert.
			</div>
		</div>
	);
};
