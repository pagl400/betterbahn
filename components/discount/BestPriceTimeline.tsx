"use client";

import { formatTime } from "@/utils/formatUtils";
import { formatPriceDE } from "@/utils/priceUtils";
import { trpc } from "@/utils/TRPCProvider";

interface Props {
	from: string;
	to: string;
	date: Date;
	travelClass: number;
	bahnCard: number | null;
	passengerAge?: number;
	hasDeutschlandTicket: boolean;
	/** Abfahrtszeit der aktuell gewählten Verbindung (zum Hervorheben). */
	selectedDeparture?: Date | null;
	/** Klick auf einen Balken → diese Abfahrtszeit übernehmen. */
	onPick: (departure: Date) => void;
}

const durationLabel = (dep: Date, arr: Date) => {
	const m = Math.max(0, Math.round((arr.getTime() - dep.getTime()) / 60000));
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const BestPriceTimeline = ({
	from,
	to,
	date,
	travelClass,
	bahnCard,
	passengerAge,
	hasDeutschlandTicket,
	selectedDeparture,
	onPick,
}: Props) => {
	const query = trpc.getBestPrices.useQuery(
		{ from, to, date, travelClass, bahnCard, passengerAge, hasDeutschlandTicket },
		{ staleTime: 5 * 60 * 1000 }
	);

	const entries = query.data ?? [];
	const prices = entries.map((e) => e.price);
	const min = prices.length ? Math.min(...prices) : 0;
	const max = prices.length ? Math.max(...prices) : 0;
	const span = Math.max(1, max - min);

	return (
		<div className="rounded-xl border border-foreground/15 bg-background shadow-sm p-4">
			<div className="flex items-baseline justify-between mb-3">
				<h3 className="font-semibold text-lg">
					Tagesbestpreis für diese Strecke
				</h3>
				{min > 0 && (
					<span className="text-sm text-foreground/60">
						ab{" "}
						<span className="font-bold text-green-600">
							{formatPriceDE(min)}
						</span>
					</span>
				)}
			</div>

			{query.isLoading ? (
				<div className="flex items-center gap-3 py-8 justify-center text-foreground/60">
					<div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-b-transparent" />
					Suche günstigste Verbindungen über den Tag…
				</div>
			) : entries.length === 0 ? (
				<p className="text-sm text-foreground/60 py-4 text-center">
					Keine Tagesbestpreise verfügbar – für den heutigen Tag bietet die Bahn
					keine an. Wähle einen späteren Reisetag.
				</p>
			) : (
				<div className="flex items-end gap-1 overflow-x-auto pb-2">
					{entries.map((e, i) => {
						const isCheapest = e.price === min;
						const isSelected =
							selectedDeparture != null &&
							Math.abs(
								e.departure.getTime() - selectedDeparture.getTime()
							) < 60_000;
						// Höhe: teurer = höher (40–100%).
						const h = 40 + Math.round(((e.price - min) / span) * 60);
						return (
							<button
								key={i}
								type="button"
								onClick={() => onPick(e.departure)}
								title={`${formatTime(e.departure)}–${formatTime(
									e.arrival
								)} · ${durationLabel(e.departure, e.arrival)} · ${
									e.transfers
								}× · ${e.lineNames.join(", ")}`}
								className="group flex flex-col items-center gap-1 min-w-12 flex-1"
							>
								<span
									className={`text-[11px] font-semibold ${
										isCheapest ? "text-green-600" : "text-foreground/70"
									}`}
								>
									{formatPriceDE(e.price)}
								</span>
								<div className="w-full h-24 flex items-end">
									<div
										className={`w-full rounded-t-md transition-all ${
											isSelected
												? "ring-2 ring-primary "
												: ""
										}${
											isCheapest
												? "bg-green-500 group-hover:bg-green-600"
												: "bg-foreground/25 group-hover:bg-foreground/40"
										}`}
										style={{ height: `${h}%` }}
									/>
								</div>
								<span className="text-[11px] text-foreground/60">
									{formatTime(e.departure)}
								</span>
							</button>
						);
					})}
				</div>
			)}
			<p className="text-xs text-foreground/50 mt-2">
				Klicke einen Balken, um diese Verbindung zu analysieren.
			</p>
		</div>
	);
};
