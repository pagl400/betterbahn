import { getJourneyLegsWithTransfers } from "@/utils/journeyUtils";
import type { VendoJourney, VendoLeg, VendoStation } from "@/utils/schemas";
import { dbClient } from "./getJourney";

// Fernverkehrs-Produkte (ICE/IC/EC) – nur hier lohnt sich Overshoot.
const FERNVERKEHR = new Set(["nationalExpress", "national"]);
// Regional-/Nahverkehrs-Produkte für Feeder-Verbindungen (<1h).
const REGIONAL = new Set([
	"regional",
	"regionalbahn",
	"regionalexpress",
	"sbahn",
	"suburban",
]);

// Wie viele Regionalzüge je Seite maximal per trip() aufgelöst werden (Kostenbremse).
const FEEDER_TRAIN_CAP = 4;
const FEEDER_MAX_MINUTES = 60;

export interface ExtensionCandidate {
	station: VendoStation;
	/** Planmäßige Abfahrt an diesem Kandidaten (Anker für die journeys()-Abfrage). */
	time: Date;
	source: "train" | "regional";
}

export interface ExtensionPlan {
	/** A – wo der Nutzer tatsächlich einsteigt (= Reise-Start). */
	travelFrom: VendoStation;
	/** B – wo der Nutzer tatsächlich aussteigt (= Reise-Ziel). */
	travelTo: VendoStation;
	/** Zugnummern der Fernverkehrs-Legs der Originalreise (für die Validierung). */
	fahrtNrs: string[];
	/** Ursprüngliche Abfahrtszeit an A. */
	origDeparture: Date;
	/** X-Kandidaten vor A (nächste zuerst, max. N). */
	beforeA: ExtensionCandidate[];
	/** Y-Kandidaten nach B (nächste zuerst, max. N). */
	afterB: ExtensionCandidate[];
}

const stationOf = (stop?: { id?: string; name?: string }): VendoStation | null =>
	stop?.id ? { id: stop.id, name: stop.name } : null;

const toDate = (v: unknown): Date | null => {
	if (v instanceof Date) return v;
	if (typeof v === "string") {
		const d = new Date(v);
		return isNaN(d.getTime()) ? null : d;
	}
	return null;
};

/** Halte aus einem Zuglauf vor `anchorId` (nächste zuerst). */
const sameTrainBefore = (
	stopovers: { stop?: { id?: string; name?: string }; arrival?: unknown; departure?: unknown }[],
	anchorId: string
): ExtensionCandidate[] => {
	const idx = stopovers.findIndex((s) => s.stop?.id === anchorId);
	if (idx <= 0) return [];
	return stopovers
		.slice(0, idx)
		.reverse()
		.map((s): ExtensionCandidate | null => {
			const station = stationOf(s.stop);
			const time = toDate(s.departure) ?? toDate(s.arrival);
			return station && time ? { station, time, source: "train" } : null;
		})
		.filter((c): c is ExtensionCandidate => c !== null);
};

/** Halte aus einem Zuglauf nach `anchorId` (nächste zuerst). */
const sameTrainAfter = (
	stopovers: { stop?: { id?: string; name?: string }; arrival?: unknown; departure?: unknown }[],
	anchorId: string
): ExtensionCandidate[] => {
	const idx = stopovers.findIndex((s) => s.stop?.id === anchorId);
	if (idx === -1 || idx >= stopovers.length - 1) return [];
	return stopovers
		.slice(idx + 1)
		.map((s): ExtensionCandidate | null => {
			const station = stationOf(s.stop);
			const time = toDate(s.arrival) ?? toDate(s.departure);
			return station && time ? { station, time, source: "train" } : null;
		})
		.filter((c): c is ExtensionCandidate => c !== null);
};

/**
 * Best-effort Regional-Feeder: nahe Bahnhöfe, die A in <1h erreichen (bzw. von B
 * in <1h erreichbar sind). Da die Abfahrts-/Ankunftstafeln keine Herkunfts-IDs
 * liefern, lösen wir wenige Regionalzüge per trip() auf. Fehler werden geschluckt
 * – Feeder sind nur eine Anreicherung, die Same-Train-Kandidaten sind der Kern.
 */
export const regionalFeedersBefore = async (
	anchorId: string,
	anchorDeparture: Date
): Promise<ExtensionCandidate[]> => {
	try {
		const board = await dbClient.arrivals(anchorId, {
			duration: FEEDER_MAX_MINUTES,
			when: new Date(anchorDeparture.getTime() - FEEDER_MAX_MINUTES * 60_000),
		});
		const arrivals: any[] = (board as any).arrivals ?? board;
		const trains = dedupeByLine(
			arrivals.filter((a) => REGIONAL.has(a.line?.product))
		).slice(0, FEEDER_TRAIN_CAP);

		const out: ExtensionCandidate[] = [];
		for (const train of trains) {
			if (!train.tripId) continue;
			const trip: any = await dbClient.trip(train.tripId, { stopovers: true });
			const stops: any[] = (trip.trip ?? trip).stopovers ?? [];
			const anchorIdx = stops.findIndex((s) => s.stop?.id === anchorId);
			if (anchorIdx <= 0) continue;
			for (const s of stops.slice(0, anchorIdx)) {
				const station = stationOf(s.stop);
				const dep = toDate(s.departure) ?? toDate(s.arrival);
				if (!station || !dep) continue;
				const minutes = (anchorDeparture.getTime() - dep.getTime()) / 60_000;
				if (minutes > 0 && minutes <= FEEDER_MAX_MINUTES) {
					out.push({ station, time: dep, source: "regional" });
				}
			}
		}
		return out;
	} catch {
		return [];
	}
};

export const regionalFeedersAfter = async (
	anchorId: string,
	anchorArrival: Date
): Promise<ExtensionCandidate[]> => {
	try {
		const board = await dbClient.departures(anchorId, {
			duration: FEEDER_MAX_MINUTES,
			when: anchorArrival,
		});
		const departures: any[] = (board as any).departures ?? board;
		const trains = dedupeByLine(
			departures.filter((a) => REGIONAL.has(a.line?.product))
		).slice(0, FEEDER_TRAIN_CAP);

		const out: ExtensionCandidate[] = [];
		for (const train of trains) {
			if (!train.tripId) continue;
			const trip: any = await dbClient.trip(train.tripId, { stopovers: true });
			const stops: any[] = (trip.trip ?? trip).stopovers ?? [];
			const anchorIdx = stops.findIndex((s) => s.stop?.id === anchorId);
			if (anchorIdx === -1 || anchorIdx >= stops.length - 1) continue;
			for (const s of stops.slice(anchorIdx + 1)) {
				const station = stationOf(s.stop);
				const arr = toDate(s.arrival) ?? toDate(s.departure);
				if (!station || !arr) continue;
				const minutes = (arr.getTime() - anchorArrival.getTime()) / 60_000;
				if (minutes > 0 && minutes <= FEEDER_MAX_MINUTES) {
					out.push({ station, time: arr, source: "regional" });
				}
			}
		}
		return out;
	} catch {
		return [];
	}
};

const dedupeByLine = (entries: any[]): any[] => {
	const seen = new Set<string>();
	const out: any[] = [];
	for (const e of entries) {
		const key = e.line?.name ?? e.tripId;
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	return out;
};

/** Same-Train + Feeder mergen, gegen ausgeschlossene IDs dedupen, auf N kürzen. */
const mergeCandidates = (
	sameTrain: ExtensionCandidate[],
	feeders: ExtensionCandidate[],
	excludeIds: Set<string>,
	n: number
): ExtensionCandidate[] => {
	const seen = new Set(excludeIds);
	const out: ExtensionCandidate[] = [];
	// Same-Train zuerst (auf der Strecke, garantiert gültig), dann Feeder.
	for (const c of [...sameTrain, ...feeders]) {
		if (seen.has(c.station.id)) continue;
		seen.add(c.station.id);
		out.push(c);
		if (out.length >= n) break;
	}
	return out;
};

/**
 * Baut den Plan für die „Verlängerte Route"-Suche. Gibt `null` zurück, wenn die
 * Reise sich nicht eignet (kein Fernverkehr, oder Regional-Zubringer an den Enden,
 * deren Abdeckung v1 nicht garantieren kann).
 */
export const buildExtensionPlan = async (
	journey: VendoJourney,
	n: number
): Promise<ExtensionPlan | null> => {
	const legs = getJourneyLegsWithTransfers(journey);
	if (legs.length === 0) return null;

	const fvLegs = legs.filter(
		(l) => l.line?.product && FERNVERKEHR.has(l.line.product)
	);
	if (fvLegs.length === 0) return null;

	const firstFv = fvLegs[0];
	const lastFv = fvLegs[fvLegs.length - 1];

	// v1: nur Reisen, deren erstes/letztes Leg Fernverkehr ist (kein Regional-
	// Zubringer am Anfang/Ende) – sonst kann die Ticketgültigkeit für A→B nicht
	// garantiert werden.
	if (legs[0] !== firstFv || legs[legs.length - 1] !== lastFv) return null;

	const travelFrom = stationOf(firstFv.origin as any);
	const travelTo = stationOf(lastFv.destination as any);
	if (!travelFrom || !travelTo || !firstFv.tripId || !lastFv.tripId) return null;

	const fahrtNrs = fvLegs
		.map((l) => l.line?.fahrtNr)
		.filter((x): x is string => typeof x === "string");
	if (fahrtNrs.length === 0) return null;

	const origDeparture = legs[0].departure;
	const lastArrival = legs.at(-1)!.arrival;

	// Zugläufe der äußeren FV-Legs abrufen.
	const tripFirst: any = await dbClient.trip(firstFv.tripId, { stopovers: true });
	const firstStops: any[] = (tripFirst.trip ?? tripFirst).stopovers ?? [];
	let lastStops = firstStops;
	if (lastFv.tripId !== firstFv.tripId) {
		const tripLast: any = await dbClient.trip(lastFv.tripId, { stopovers: true });
		lastStops = (tripLast.trip ?? tripLast).stopovers ?? [];
	}

	const sameTrainX = sameTrainBefore(firstStops, travelFrom.id);
	const sameTrainY = sameTrainAfter(lastStops, travelTo.id);

	// Feeder nur abrufen, wenn N mehr Kandidaten zulässt, als der Zug hergibt.
	const [feederX, feederY] = await Promise.all([
		sameTrainX.length < n
			? regionalFeedersBefore(travelFrom.id, origDeparture)
			: Promise.resolve([]),
		sameTrainY.length < n
			? regionalFeedersAfter(travelTo.id, lastArrival)
			: Promise.resolve([]),
	]);

	const exclude = new Set<string>([travelFrom.id, travelTo.id]);
	for (const l of legs) {
		if (l.origin && "id" in l.origin && l.origin.id) exclude.add(l.origin.id);
		if (l.destination && "id" in l.destination && l.destination.id)
			exclude.add(l.destination.id);
	}

	const beforeA = mergeCandidates(sameTrainX, feederX, exclude, n);
	const afterB = mergeCandidates(sameTrainY, feederY, exclude, n);

	if (beforeA.length === 0 && afterB.length === 0) return null;

	return {
		travelFrom,
		travelTo,
		fahrtNrs,
		origDeparture,
		beforeA,
		afterB,
	};
};

/**
 * Prüft, ob eine bepreiste X→Y-Verbindung den echten A→B-Zug des Nutzers enthält:
 * alle FV-Zugnummern kommen vor, A und B liegen (in Reihenfolge) auf der Strecke,
 * A-Abfahrt passt zur Originalzeit, und etwaige Zubringer-Legs sind je <60min.
 */
export const extensionJourneyIsValid = (
	candidate: VendoJourney,
	plan: ExtensionPlan
): boolean => {
	const legs = getJourneyLegsWithTransfers(candidate);
	if (legs.length === 0) return false;

	// Alle Original-Zugnummern müssen vorkommen.
	const candFahrtNrs = new Set(
		legs.map((l) => l.line?.fahrtNr).filter(Boolean) as string[]
	);
	if (!plan.fahrtNrs.every((nr) => candFahrtNrs.has(nr))) return false;

	const fvLegs = legs.filter(
		(l) => l.line?.fahrtNr && plan.fahrtNrs.includes(l.line.fahrtNr)
	);
	if (fvLegs.length === 0) return false;

	// A und B müssen auf den passenden FV-Legs liegen (A vor B).
	const stopsOf = (leg: VendoLeg): { id: string; time: number }[] => {
		const list: { id: string; time: number }[] = [];
		const push = (s?: { id?: string }, t?: unknown) => {
			const time = toDate(t);
			if (s?.id && time) list.push({ id: s.id, time: time.getTime() });
		};
		push(leg.origin as any, leg.departure);
		for (const s of leg.stopovers ?? [])
			push(s.stop, s.departure ?? s.arrival);
		push(leg.destination as any, leg.arrival);
		return list;
	};
	const allStops = fvLegs.flatMap(stopsOf);
	const aStop = allStops.find((s) => s.id === plan.travelFrom.id);
	const bStop = allStops.find((s) => s.id === plan.travelTo.id);
	if (!aStop || !bStop || aStop.time >= bStop.time) return false;

	// A-Abfahrt muss zur Originalabfahrt passen (gleicher Zug).
	if (Math.abs(aStop.time - plan.origDeparture.getTime()) > 5 * 60_000)
		return false;

	// Etwaige Nicht-FV-Legs (Zubringer) dürfen je nur <60min dauern.
	for (const leg of legs) {
		const isFv = leg.line?.fahrtNr && plan.fahrtNrs.includes(leg.line.fahrtNr);
		if (isFv) continue;
		const dur = (leg.arrival.getTime() - leg.departure.getTime()) / 60_000;
		if (dur >= 60) return false;
	}

	return true;
};
