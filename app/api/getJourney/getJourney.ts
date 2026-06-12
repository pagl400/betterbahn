import { fetchAndValidateJson } from "@/utils/fetchAndValidateJson";
import { parseHinfahrtRecon } from "@/utils/parseHinfahrtRecon";
import { vbidSchema, vendoJourneySchema } from "@/utils/schemas";
import { t } from "@/utils/trpc-init";
import { TRPCError } from "@trpc/server";
import https from "node:https";
import { createClient, type SearchJourneysOptions } from "db-vendo-client";
import { data as loyaltyCards } from "db-vendo-client/format/loyalty-cards";
import { profile as dbProfile } from "db-vendo-client/p/db/index";
import { prettifyError, z } from "zod/v4";

// Die DB hat ihren Vendo-Host von `app.vendo.noncd.db.de` (DNS existiert nicht
// mehr, ENOTFOUND) auf `app.services-bahn.de` umgestellt. Die installierte
// db-vendo-client-Version verweist noch auf den alten Host, daher mappen wir
// alle Endpunkte des Profils hier auf den neuen Host um. (Upstream ab 6.10.11
// bereits korrigiert: public-transport/db-vendo-client.)
const OLD_DB_HOST = "https://app.vendo.noncd.db.de";
const NEW_DB_HOST = "https://app.services-bahn.de";
for (const key of Object.keys(dbProfile) as (keyof typeof dbProfile)[]) {
	const value = dbProfile[key];
	if (typeof value === "string" && value.startsWith(OLD_DB_HOST)) {
		(dbProfile as Record<string, unknown>)[key] = value.replace(
			OLD_DB_HOST,
			NEW_DB_HOST
		);
	}
}

// Der neue Host `app.services-bahn.de` steht hinter Akamai Bot Manager, der
// Anfragen per TLS-Fingerprint (JA3) filtert. Node.js' Standard-TLS-Handshake
// wird als Bot erkannt und mit "403 Access Denied" geblockt – identische
// Header/Body via curl funktionieren dagegen. Wir geben dem zugrunde liegenden
// node-fetch daher einen https.Agent mit Browser-naher Cipher-Reihenfolge mit,
// wodurch der Handshake wie ein Chrome-Client aussieht und durchkommt.
const BROWSER_TLS_CIPHERS = [
	"TLS_AES_128_GCM_SHA256",
	"TLS_AES_256_GCM_SHA384",
	"TLS_CHACHA20_POLY1305_SHA256",
	"ECDHE-ECDSA-AES128-GCM-SHA256",
	"ECDHE-RSA-AES128-GCM-SHA256",
	"ECDHE-ECDSA-AES256-GCM-SHA384",
	"ECDHE-RSA-AES256-GCM-SHA384",
	"ECDHE-ECDSA-CHACHA20-POLY1305",
	"ECDHE-RSA-CHACHA20-POLY1305",
	"ECDHE-RSA-AES128-SHA",
	"ECDHE-RSA-AES256-SHA",
	"AES128-GCM-SHA256",
	"AES256-GCM-SHA384",
	"AES128-SHA",
	"AES256-SHA",
].join(":");

const dbTlsAgent = new https.Agent({
	keepAlive: true,
	ciphers: BROWSER_TLS_CIPHERS,
	ecdhCurve: "X25519:prime256v1:secp384r1",
});

// `transformReq` ist der vorgesehene Hook, um die fetch-Optionen vor dem Request
// anzupassen – hier hängen wir den TLS-Agent an (ohne einen evtl. gesetzten
// Proxy-Agent zu überschreiben).
const previousTransformReq = dbProfile.transformReq;
dbProfile.transformReq = (ctx: unknown, rawReqOptions: unknown) => {
	const reqOptions = (
		previousTransformReq
			? previousTransformReq(ctx, rawReqOptions)
			: rawReqOptions
	) as { agent?: unknown };
	if (!reqOptions.agent) {
		reqOptions.agent = dbTlsAgent;
	}
	return reqOptions;
};

export const dbClient = createClient(dbProfile, "mail@lukasweihrauch.de");

export const getJourney = t.procedure
	.input(
		z
			.object({
				// Modus 1: geteilter bahn.de-Link
				vbid: z.string().optional(),
				// Modus 2: direkte Von/Nach-Suche
				from: z.string().optional(),
				to: z.string().optional(),
				date: z.date().optional(),
				travelClass: z.int(),
				bahnCard: z.int().nullable(),
				passengerAge: z.int().optional(),
				hasDeutschlandTicket: z.boolean(),
			})
			.refine((i) => Boolean(i.vbid) || Boolean(i.from && i.to && i.date), {
				message: "Entweder vbid oder from/to/date muss angegeben werden",
			})
	)
	.query(async ({ input }) => {
		// Such-Optionen einmal bauen – für beide Modi identisch.
		const options: SearchJourneysOptions = {
			results: 10,
			stopovers: true,
			// Bei genauer Abfahrtszeit wollen wir exakte Treffer, nicht verschiedene Alternativen
			notOnlyFastRoutes: true,
			remarks: true, // Verbindungshinweise einschließen
			transfers: -1, // System entscheidet über optimale Anzahl Umstiege
			// Reiseklasse-Präferenz setzen - verwende firstClass boolean Parameter
			firstClass: input.travelClass === 1,
			age: input.passengerAge,
		};

		if (input.bahnCard !== null && [25, 50, 100].includes(input.bahnCard)) {
			options.loyaltyCard = {
				type: loyaltyCards.BAHNCARD,
				discount: input.bahnCard,
				class: input.travelClass,
			};
		}

		if (input.hasDeutschlandTicket) {
			options.deutschlandTicketDiscount = true;
			// Diese Option kann helfen, genauere Preise zurückzugeben wenn Deutschland-Ticket verfügbar ist
			options.deutschlandTicketConnectionsOnly = false; // Wir wollen alle Verbindungen, aber mit genauen Preisen
		}

		// Verbindungen suchen, deduplizieren und auf die zur Wunschzeit passenden
		// Treffer reduzieren.
		const buildAndFilter = async (
			fromStationId: string,
			toStationId: string,
			departure: Date,
			restrictToClosest: boolean
		) => {
			const raw = await dbClient.journeys(fromStationId, toStationId, {
				...options,
				departure,
			});

			const envelope = z
				.object({ journeys: z.array(z.unknown()) })
				.safeParse(raw);

			if (!envelope.success) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Unexpected DB journeys response: ${prettifyError(
						envelope.error
					)}`,
					cause: envelope.error,
				});
			}

			// Einzelne ungültige Verbindungen (z.B. ein Leg ohne Zeitangabe)
			// überspringen, statt die gesamte Suche scheitern zu lassen.
			const parsedJourneys = envelope.data.journeys.flatMap((j) => {
				const parsed = vendoJourneySchema.safeParse(j);
				return parsed.success ? [parsed.data] : [];
			});

			const uniqueJourneys = parsedJourneys.filter(
				(journey, index, arr) => {
					if (journey.legs.length === 0) {
						return false;
					}

					const journeySignature = journey.legs
						.map(
							(leg) =>
								`${leg.line?.name || "walk"}-${leg.origin?.id}-${
									leg.destination?.id
								}-${leg.departure}`
						)
						.join("|");

					const key = `${journeySignature}-${
						journey.price?.amount || "no-price"
					}`;
					return (
						arr.findIndex((j) => {
							if (!j.legs || j.legs.length === 0) {
								return false;
							}

							const jSignature = j.legs
								.map(
									(leg) =>
										`${leg.line?.name || "walk"}-${leg.origin?.id}-${
											leg.destination?.id
										}-${leg.departure}`
								)
								.join("|");

							const jKey = `${jSignature}-${j.price?.amount || "no-price"}`;
							return jKey === key;
						}) === index
					);
				}
			);

			// Sort by departure time
			const sortedJourneys = uniqueJourneys.toSorted(
				(a, b) => a.legs[0].departure.getTime() - b.legs[0].departure.getTime()
			);

			// Find the journey that best matches the requested departure time
			const closestJourney = sortedJourneys.reduce((closest, current) => {
				if (!closest) return current;
				const closestDiff = Math.abs(
					closest.legs[0].departure.getTime() - departure.getTime()
				);
				const currentDiff = Math.abs(
					current.legs[0].departure.getTime() - departure.getTime()
				);
				return currentDiff < closestDiff ? current : closest;
			}, sortedJourneys[0]);

			if (!closestJourney) {
				return [];
			}

			// vbid-Modus: nur die zur exakt geteilten Abfahrt passende(n) Verbindung(en).
			if (restrictToClosest) {
				const targetDepartureTime = closestJourney.legs[0].departure.getTime();
				return sortedJourneys.filter(
					(journey) =>
						journey.legs[0].departure.getTime() === targetDepartureTime
				);
			}

			// Direkt-Modus: mehrere Optionen rund um die Wunschzeit zur Auswahl.
			return sortedJourneys.slice(0, 6);
		};

		// --- Modus 2: direkte Von/Nach-Suche ---
		if (input.from && input.to && input.date) {
			return await buildAndFilter(input.from, input.to, input.date, false);
		}

		// --- Modus 1: geteilter Link (vbid) ---
		const vbidRequest = await fetchAndValidateJson({
			url: `https://www.bahn.de/web/api/angebote/verbindung/${input.vbid}`,
			schema: vbidSchema,
		});

		// Start-/Ziel-Station direkt aus dem `hinfahrtRecon` auslesen, statt die
		// DB-Recon-API aufzurufen – diese ist inzwischen hinter Akamai Bot Manager
		// und liefert für Server-Requests `403 OPS_BLOCKED`. Details siehe
		// parseHinfahrtRecon().
		const { departLid, arrLid } = parseHinfahrtRecon(
			vbidRequest.data.hinfahrtRecon
		);
		const fromStationId = departLid.match(/@L=(\d+)/)?.[1];
		const toStationId = arrLid.match(/@L=(\d+)/)?.[1];

		if (!fromStationId || !toStationId) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "missing soid or zoid",
			});
		}

		return await buildAndFilter(
			fromStationId,
			toStationId,
			new Date(vbidRequest.data.hinfahrtDatum),
			true
		);
	});
