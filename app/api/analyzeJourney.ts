import {
	vendoJourneySchema,
	type VendoJourney,
	type VendoStation,
} from "@/utils/schemas";
import { segmentEffectivePrice } from "@/utils/deutschlandTicketUtils";
import { t } from "@/utils/trpc-init";
import type { SearchJourneysOptions } from "db-vendo-client";
import { data as loyaltyCards } from "db-vendo-client/format/loyalty-cards";
import { z } from "zod/v4";
import {
	gatherAlternatives,
	type AlternativeStation,
} from "./getJourney/extractAlternativeStations";
import {
	buildExtensionPlan,
	extensionJourneyIsValid,
	regionalFeedersAfter,
	regionalFeedersBefore,
	type ExtensionCandidate,
	type ExtensionPlan,
} from "./getJourney/extractExtensionCandidates";
import { extractSplitPoints } from "./getJourney/extractSplitPoints";
import { dbClient } from "./getJourney/getJourney";

export interface SplitAnalysis {
	splitStations: VendoStation[];
	segments: VendoJourney[];
}

export interface ExtendedRouteAnalysis {
	kind: "extended";
	/** X – Start des (günstigeren) Tickets, liegt vor A. */
	ticketFrom: VendoStation;
	/** Y – Ziel des Tickets, liegt hinter B. */
	ticketTo: VendoStation;
	/** A – wo der Nutzer tatsächlich einsteigt. */
	travelFrom: VendoStation;
	/** B – wo der Nutzer tatsächlich aussteigt. */
	travelTo: VendoStation;
	direction: "both" | "start" | "end";
	/** [X, Y] – damit die bestehende „Über:"-Zeile der UI nutzbar bleibt. */
	splitStations: VendoStation[];
	/** Genau ein Element: die bepreiste X→Y-Verbindung. */
	segments: VendoJourney[];
}

export interface AlternativeRouteAnalysis {
	kind: "alternative";
	/** A bzw. A' – wo der Nutzer tatsächlich einsteigt. */
	travelFrom: VendoStation;
	/** B bzw. B' – wo der Nutzer tatsächlich aussteigt. */
	travelTo: VendoStation;
	direction: "start" | "end" | "both";
	/** Entfernung des Alternativ-Startbahnhofs vom Original (Meter). */
	startDistanceM?: number | null;
	/** Entfernung des Alternativ-Zielbahnhofs vom Original (Meter). */
	endDistanceM?: number | null;
	/** [A', B'] – für die „Über:"-Zeile der UI. */
	splitStations: VendoStation[];
	/** Genau ein Element: die echte, bepreiste Verbindung A'→B'. */
	segments: VendoJourney[];
}

const journeysResponseSchema = z.object({
	journeys: z.array(vendoJourneySchema),
});

export const analyzeJourney = t.procedure
	.input(
		z.object({
			journey: vendoJourneySchema,
			travelClass: z.int(),
			passengerAge: z.int().optional(),
			bahnCard: z.int().nullable(),
			hasDeutschlandTicket: z.boolean(),
			extensionStops: z.int().min(1).max(10).default(3),
		})
	)
	.subscription(async function* ({ input }) {
		// Split-Kandidaten aus vorhandenen Legs ableiten (keine zusätzlichen API Calls)
		const splitPoints = extractSplitPoints(input.journey);

		const queryOptions: SearchJourneysOptions = {
			results: 1,
			stopovers: true,
			firstClass: input.travelClass === 1,
			notOnlyFastRoutes: true,
			remarks: true,
			transfers: 3,
			age: input.passengerAge,
			deutschlandTicketDiscount: input.hasDeutschlandTicket,
			loyaltyCard:
				input.bahnCard && [25, 50, 100].includes(input.bahnCard)
					? {
							type: loyaltyCards.BAHNCARD,
							discount: input.bahnCard,
							class: input.travelClass || 2,
					  }
					: undefined,
		};

		// Findet in den Ergebnissen die Verbindung, die zur Soll-Abfahrt passt.
		const fetchJourney = async (params: {
			from: string;
			to: string;
			targetDeparture: Date;
		}) => {
			const untyped = await dbClient.journeys(params.from, params.to, {
				...queryOptions,
				departure: params.targetDeparture,
			});

			const validated = journeysResponseSchema.parse(untyped);
			const expected = params.targetDeparture.getTime();

			return (
				validated.journeys.find(
					(journey) =>
						Math.abs(journey.legs[0].departure.getTime() - expected) <= 60_000 // 1 Minute Toleranz
				) || null
			);
		};

		// Liefert für eine (alternative) Relation die erste bepreiste Verbindung
		// nahe der Wunschabfahrt – für echte Alternativreisen (lockere Zeit-Toleranz).
		const fetchCheapest = async (from: string, to: string, departure: Date) => {
			const untyped = await dbClient.journeys(from, to, {
				...queryOptions,
				results: 3,
				departure,
			});
			const { journeys } = journeysResponseSchema.parse(untyped);
			return journeys.find((j) => j.price?.amount !== undefined) ?? null;
		};

		const originalPrice = input.journey.price?.amount ?? 0;

		// „Verlängerte Route" vorbereiten (Zugläufe + Feeder). Best-effort: Fehler
		// hier dürfen die Split-Analyse nicht abbrechen.
		let extensionPlan: ExtensionPlan | null = null;
		try {
			extensionPlan = await buildExtensionPlan(
				input.journey,
				input.extensionStops
			);
		} catch {
			extensionPlan = null;
		}

		// Richtungspaare bilden (Cap ≈ 3N): X→B, A→Y und diagonal X→Y.
		type ExtensionPair = {
			from: ExtensionCandidate | "A";
			to: ExtensionCandidate | "B";
			direction: "both" | "start" | "end";
		};
		const extensionPairs: ExtensionPair[] = [];
		if (extensionPlan) {
			for (const x of extensionPlan.beforeA)
				extensionPairs.push({ from: x, to: "B", direction: "start" });
			for (const y of extensionPlan.afterB)
				extensionPairs.push({ from: "A", to: y, direction: "end" });
			const diag = Math.min(
				extensionPlan.beforeA.length,
				extensionPlan.afterB.length
			);
			for (let i = 0; i < diag; i++)
				extensionPairs.push({
					from: extensionPlan.beforeA[i],
					to: extensionPlan.afterB[i],
					direction: "both",
				});
		}

		// Alternative Start-/Zielbahnhöfe sammeln (echte Alternativreisen A'→B').
		const originRaw = input.journey.legs.at(0)!.origin!;
		const destRaw = input.journey.legs.at(-1)!.destination!;
		const A: VendoStation = { id: originRaw.id, name: originRaw.name };
		const B: VendoStation = { id: destRaw.id, name: destRaw.name };
		const origDeparture = input.journey.legs.at(0)!.departure;

		const excludeIds = new Set<string>();
		for (const leg of input.journey.legs) {
			if (leg.origin && "id" in leg.origin && leg.origin.id)
				excludeIds.add(leg.origin.id);
			if (leg.destination && "id" in leg.destination && leg.destination.id)
				excludeIds.add(leg.destination.id);
		}

		// Kandidatenquelle für Alternativen: bei Fernverkehrsreisen die bereits
		// ermittelten beforeA/afterB; sonst (mehrteilige Reisen mit Regional-
		// Zubringer, bei denen kein extensionPlan entsteht) Regional-Feeder direkt
		// zum Gesamt-Start/-Ziel – so funktionieren Alternativen auch dann.
		let startCands: ExtensionCandidate[] = extensionPlan?.beforeA ?? [];
		let endCands: ExtensionCandidate[] = extensionPlan?.afterB ?? [];
		if (!extensionPlan) {
			const lastArrival = input.journey.legs.at(-1)!.arrival;
			try {
				[startCands, endCands] = await Promise.all([
					regionalFeedersBefore(A.id, origDeparture),
					regionalFeedersAfter(B.id, lastArrival),
				]);
			} catch {
				startCands = [];
				endCands = [];
			}
		}

		const startAlts: AlternativeStation[] = gatherAlternatives(
			A,
			startCands,
			input.extensionStops,
			excludeIds
		);
		const endAlts: AlternativeStation[] = gatherAlternatives(
			B,
			endCands,
			input.extensionStops,
			excludeIds
		);

		type AltPair = {
			from: VendoStation;
			to: VendoStation;
			direction: "start" | "end" | "both";
			startDistanceM?: number | null;
			endDistanceM?: number | null;
		};
		const altPairs: AltPair[] = [];
		for (const a of startAlts)
			altPairs.push({
				from: { id: a.id, name: a.name },
				to: B,
				direction: "start",
				startDistanceM: a.distance,
			});
		for (const b of endAlts)
			altPairs.push({
				from: A,
				to: { id: b.id, name: b.name },
				direction: "end",
				endDistanceM: b.distance,
			});
		const altDiag = Math.min(startAlts.length, endAlts.length);
		for (let i = 0; i < altDiag; i++)
			altPairs.push({
				from: { id: startAlts[i].id, name: startAlts[i].name },
				to: { id: endAlts[i].id, name: endAlts[i].name },
				direction: "both",
				startDistanceM: startAlts[i].distance,
				endDistanceM: endAlts[i].distance,
			});

		const splitOptions: SplitAnalysis[] = [];
		const extensionOptions: ExtendedRouteAnalysis[] = [];
		const alternativeOptions: AlternativeRouteAnalysis[] = [];
		const total =
			splitPoints.length + extensionPairs.length + altPairs.length;
		let checked = 0;

		// Analyse-Abfragen laufen in kleinen parallelen Blöcken, um die Wartezeit
		// deutlich zu senken, ohne den Akamai-Schutz mit Bursts zu reizen.
		const CONCURRENCY = 4;

		// --- Phase 1: klassische Splits ---
		const evalSplit = async (
			splitPoint: (typeof splitPoints)[number]
		): Promise<SplitAnalysis | null> => {
			try {
				const [firstJourney, secondJourney] = await Promise.all([
					fetchJourney({
						from: A.id,
						to: splitPoint.station.id,
						targetDeparture: origDeparture,
					}),
					fetchJourney({
						from: splitPoint.station.id,
						to: B.id,
						targetDeparture: splitPoint.departure,
					}),
				]);

				if (!firstJourney || !secondJourney) return null;

				// Nur echte Ersparnis zeigen: jedes Segment braucht einen bekannten
				// Effektivpreis (unbekannt ⇒ raus, außer Nahverkehr + D-Ticket = 0).
				const p1 = segmentEffectivePrice(
					firstJourney,
					input.hasDeutschlandTicket
				);
				const p2 = segmentEffectivePrice(
					secondJourney,
					input.hasDeutschlandTicket
				);
				if (p1 === null || p2 === null) return null;
				if (p1 + p2 >= originalPrice) return null;

				return {
					splitStations: [splitPoint.station],
					segments: [firstJourney, secondJourney],
				};
			} catch {
				// Einzelnen fehlgeschlagenen Split überspringen.
				return null;
			}
		};

		for (let i = 0; i < splitPoints.length; i += CONCURRENCY) {
			const chunk = splitPoints.slice(i, i + CONCURRENCY);
			yield {
				type: "processing",
				checked,
				currentStation: chunk[0].station?.name ?? null,
				total,
			} as const;
			const results = await Promise.all(chunk.map(evalSplit));
			checked += chunk.length;
			for (const r of results) if (r) splitOptions.push(r);
		}

		// --- Phase 2: Verlängerte Route (Overshoot) ---
		const evalExtension = async (
			pair: ExtensionPair
		): Promise<ExtendedRouteAnalysis | null> => {
			if (!extensionPlan) return null;
			const ticketFrom =
				pair.from === "A" ? extensionPlan.travelFrom : pair.from.station;
			const ticketTo =
				pair.to === "B" ? extensionPlan.travelTo : pair.to.station;
			const departure =
				pair.from === "A" ? extensionPlan.origDeparture : pair.from.time;
			const via =
				pair.from === "A"
					? extensionPlan.travelTo.id
					: extensionPlan.travelFrom.id;
			try {
				const untyped = await dbClient.journeys(ticketFrom.id, ticketTo.id, {
					...queryOptions,
					results: 3,
					via,
					departure,
				});
				const { journeys } = journeysResponseSchema.parse(untyped);
				const match = journeys.find(
					(j) =>
						j.price?.amount !== undefined &&
						extensionJourneyIsValid(j, extensionPlan!)
				);
				if (!match) return null;
				const ep = segmentEffectivePrice(match, input.hasDeutschlandTicket);
				if (ep === null || ep >= originalPrice) return null;
				return {
					kind: "extended",
					ticketFrom,
					ticketTo,
					travelFrom: extensionPlan.travelFrom,
					travelTo: extensionPlan.travelTo,
					direction: pair.direction,
					splitStations: [ticketFrom, ticketTo],
					segments: [match],
				};
			} catch {
				return null;
			}
		};

		for (let i = 0; i < extensionPairs.length; i += CONCURRENCY) {
			const chunk = extensionPairs.slice(i, i + CONCURRENCY);
			yield {
				type: "processing",
				checked,
				currentStation: "Verlängerte Route",
				total,
			} as const;
			const results = await Promise.all(chunk.map(evalExtension));
			checked += chunk.length;
			for (const r of results) if (r) extensionOptions.push(r);
		}

		// --- Phase 3: Alternative Start-/Zielbahnhöfe (echte Reisen A'→B') ---
		const evalAlternative = async (
			pair: AltPair
		): Promise<AlternativeRouteAnalysis | null> => {
			try {
				const journey = await fetchCheapest(
					pair.from.id,
					pair.to.id,
					origDeparture
				);
				if (!journey) return null;
				const ep = segmentEffectivePrice(journey, input.hasDeutschlandTicket);
				if (ep === null || ep >= originalPrice) return null;
				return {
					kind: "alternative",
					travelFrom: pair.from,
					travelTo: pair.to,
					direction: pair.direction,
					startDistanceM: pair.startDistanceM ?? null,
					endDistanceM: pair.endDistanceM ?? null,
					splitStations: [pair.from, pair.to],
					segments: [journey],
				};
			} catch {
				return null;
			}
		};

		for (let i = 0; i < altPairs.length; i += CONCURRENCY) {
			const chunk = altPairs.slice(i, i + CONCURRENCY);
			yield {
				type: "processing",
				checked,
				currentStation: "Alternative Bahnhöfe",
				total,
			} as const;
			const results = await Promise.all(chunk.map(evalAlternative));
			checked += chunk.length;
			for (const r of results) if (r) alternativeOptions.push(r);
		}

		yield {
			type: "complete",
			splitOptions,
			extensionOptions,
			alternativeOptions,
		} as const;
	});
