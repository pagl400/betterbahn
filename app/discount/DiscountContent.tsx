"use client";

import { BestPriceTimeline } from "@/components/discount/BestPriceTimeline";
import { ErrorDisplay } from "@/components/discount/ErrorDisplay";
import { StatusBox, type Progress } from "@/components/discount/StatusBox";
import { Journey } from "@/components/Journey";
import { SearchBar } from "@/components/SearchForm/SearchBar";
import { journeyDurationMs } from "@/utils/formatUtils";
import type { VendoJourney } from "@/utils/schemas";
import { trpc } from "@/utils/TRPCProvider";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ComparisonView } from "./Analysis";
import { useUrlParams } from "./useUrlParams";

export const DiscountContent = () => {
	const params = useUrlParams();
	const router = useRouter();
	const journeysQuery = trpc.getJourney.useQuery(params);

	const [analysisProgress, setAnalysisProgress] = useState<Progress | null>(
		null
	);
	const [analysisError, setAnalysisError] = useState<string | null>(null);
	const [selectedJourney, setSelectedJourney] = useState<VendoJourney | null>(
		null
	);
	const [extensionStops, setExtensionStops] = useState(3);
	const [timeLimitHours, setTimeLimitHours] = useState(2);

	const isDirect = Boolean(params.from && params.to);
	const data = journeysQuery.data ?? [];
	const dateMs = params.date?.getTime();

	// Standardmäßig die zur Wunschzeit nächstgelegene Verbindung wählen.
	const closest = useMemo(() => {
		if (data.length === 0) return null;
		if (dateMs == null) return data[0];
		return data.reduce(
			(best, j) =>
				Math.abs(j.legs[0].departure.getTime() - dateMs) <
				Math.abs(best.legs[0].departure.getTime() - dateMs)
					? j
					: best,
			data[0]
		);
	}, [data, dateMs]);

	const effectiveJourney =
		selectedJourney && data.includes(selectedJourney)
			? selectedJourney
			: closest;

	// Schnellste Direktverbindung (Referenz fürs Zeitlimit).
	const fastestMs = useMemo(() => {
		const ds = data
			.map(journeyDurationMs)
			.filter((d): d is number => d != null);
		return ds.length ? Math.min(...ds) : null;
	}, [data]);
	const fastestJourney = useMemo(
		() =>
			fastestMs == null
				? null
				: data.find((j) => journeyDurationMs(j) === fastestMs) ?? null,
		[data, fastestMs]
	);
	const maxDurationMs =
		fastestMs != null ? fastestMs + timeLimitHours * 3_600_000 : undefined;

	const pickDate = (departure: Date) => {
		const sp = new URLSearchParams();
		if (params.from) sp.set("from", params.from);
		if (params.fromName) sp.set("fromName", params.fromName);
		if (params.to) sp.set("to", params.to);
		if (params.toName) sp.set("toName", params.toName);
		sp.set("date", departure.toISOString());
		sp.set("travelClass", String(params.travelClass));
		sp.set("hasDeutschlandTicket", String(params.hasDeutschlandTicket));
		if (params.passengerAge !== undefined)
			sp.set("passengerAge", String(params.passengerAge));
		if (params.bahnCard !== null) sp.set("bahnCard", String(params.bahnCard));
		setSelectedJourney(null);
		router.replace(`/discount?${sp.toString()}`);
	};

	if (journeysQuery.isError) {
		return <ErrorDisplay error={journeysQuery.error.message} />;
	}
	if (analysisError) {
		return <ErrorDisplay error={analysisError} />;
	}

	const bestPriceProps =
		isDirect && params.from && params.to && params.date
			? {
					from: params.from,
					to: params.to,
					date: params.date,
					travelClass: params.travelClass,
					bahnCard: params.bahnCard,
					passengerAge: params.passengerAge,
					hasDeutschlandTicket: params.hasDeutschlandTicket,
			  }
			: null;

	return (
		<div className="space-y-6">
			{/* Tagesbestpreis-Timeline ganz oben. */}
			{bestPriceProps && (
				<BestPriceTimeline
					{...bestPriceProps}
					selectedDeparture={effectiveJourney?.legs[0].departure ?? null}
					onPick={pickDate}
				/>
			)}

			{isDirect && (
				<SearchBar
					initialFrom={
						params.from
							? { id: params.from, name: params.fromName ?? params.from }
							: null
					}
					initialTo={
						params.to
							? { id: params.to, name: params.toName ?? params.to }
							: null
					}
					initialDate={params.date ?? null}
				/>
			)}

			{analysisProgress !== null && <StatusBox progress={analysisProgress} />}

			{journeysQuery.isLoading ? (
				<div className="bg-primary text-white rounded-lg flex gap-3 justify-center items-center p-3 text-xl italic">
					<div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent" />
					Lade Reise...
				</div>
			) : (
				<>
					<div className="rounded-xl border border-foreground/15 bg-background shadow-sm p-4 space-y-3">
						<div className="font-semibold text-lg">Wähle deine Verbindung</div>
						{data.length === 0 && (
							<div className="text-foreground/70 py-2">
								Keine Verbindung gefunden. Bitte passe Start, Ziel oder Zeit an.
							</div>
						)}
						{data.map((journey, index) => (
							<Journey
								key={index}
								journey={journey}
								isSelected={journey === effectiveJourney}
								isFastest={journey === fastestJourney}
								onClick={() => setSelectedJourney(journey)}
							/>
						))}

						<div className="border-t border-foreground/15 pt-3 space-y-3">
							<div>
								<label
									htmlFor="timeLimit"
									className="flex items-center justify-between gap-4 text-sm font-medium text-foreground"
								>
									<span>Zeitlimit ggü. schnellster Verbindung</span>
									<span className="font-bold text-primary">
										+{timeLimitHours} h
									</span>
								</label>
								<input
									id="timeLimit"
									type="range"
									min={0}
									max={3}
									step={1}
									value={timeLimitHours}
									onChange={(e) => setTimeLimitHours(Number(e.target.value))}
									className="w-full mt-2 accent-primary"
								/>
							</div>
							<div>
								<label
									htmlFor="extensionStops"
									className="flex items-center justify-between gap-4 text-sm font-medium text-foreground"
								>
									<span>Verlängerte Route: Kandidaten-Halte pro Richtung</span>
									<span className="font-bold text-primary">{extensionStops}</span>
								</label>
								<input
									id="extensionStops"
									type="range"
									min={1}
									max={10}
									step={1}
									value={extensionStops}
									onChange={(e) => setExtensionStops(Number(e.target.value))}
									className="w-full mt-2 accent-primary"
								/>
							</div>
						</div>
					</div>

					{effectiveJourney && (
						<ComparisonView
							journey={effectiveJourney}
							setProgress={setAnalysisProgress}
							setAnalysisError={setAnalysisError}
							extensionStops={extensionStops}
							maxDurationMs={maxDurationMs}
						/>
					)}
				</>
			)}
		</div>
	);
};
