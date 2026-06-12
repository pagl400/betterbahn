import type { ExtensionCandidate } from "./extractExtensionCandidates";

export interface AlternativeStation {
	id: string;
	name?: string;
	/** Entfernung vom Originalbahnhof in Metern (falls bekannt). */
	distance?: number | null;
}

const normName = (name?: string) =>
	(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Sammelt alternative Bahnhöfe nahe eines Ankerbahnhofs.
 *
 * Quelle sind die bereits ermittelten Same-Train-/Regional-Kandidaten
 * (`buildExtensionPlan`) – also echte Bahnhöfe auf der Strecke bzw. per
 * Regionalverbindung in <1h erreichbar. Der `nearby`-Endpunkt der DB wurde
 * bewusst NICHT genutzt: er liefert im Stadtgebiet überwiegend Tram-/Bushalte
 * (auch als `type:"station"`), die keine sinnvollen Alternativ-Bahnhöfe sind.
 *
 * Dedupliziert (ID + Name, inkl. Anker und ausgeschlossener IDs) und auf `n`
 * gekürzt.
 */
export const gatherAlternatives = (
	anchor: { id: string; name?: string },
	candidates: ExtensionCandidate[],
	n: number,
	excludeIds: Set<string>
): AlternativeStation[] => {
	const out: AlternativeStation[] = [];
	const seen = new Set<string>(excludeIds);
	seen.add(anchor.id);
	const seenNames = new Set<string>([normName(anchor.name)]);

	for (const c of candidates) {
		const nn = normName(c.station.name);
		if (seen.has(c.station.id) || seenNames.has(nn)) continue;
		seen.add(c.station.id);
		seenNames.add(nn);
		out.push({ id: c.station.id, name: c.station.name, distance: null });
		if (out.length >= n) break;
	}

	return out;
};
