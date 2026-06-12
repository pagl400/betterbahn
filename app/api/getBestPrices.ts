import {
	bestPriceEntrySchema,
	type BestPriceEntry,
} from "@/utils/schemas";
import { t } from "@/utils/trpc-init";
import type { SearchJourneysOptions } from "db-vendo-client";
import { data as loyaltyCards } from "db-vendo-client/format/loyalty-cards";
import { z } from "zod/v4";
import { dbClient } from "./getJourney/getJourney";

// Rohform einer bestprice-Verbindung (nur was wir für die Timeline brauchen).
const rawBestPriceJourney = z.object({
	legs: z.array(
		z.object({
			departure: z.union([z.string(), z.date()]).nullable().optional(),
			arrival: z.union([z.string(), z.date()]).nullable().optional(),
			walking: z.unknown().optional(),
			line: z.object({ name: z.string().optional() }).nullable().optional(),
		})
	),
	price: z.object({ amount: z.number().nullable().optional() }).nullable().optional(),
});

/**
 * Tagesbestpreis-Suche (wie die DB-Bestpreissuche): günstigste Verbindungen über
 * den ganzen Tag. Liefert leichtgewichtige Einträge (Zeit + Preis + Zuglinien)
 * für die Timeline – nicht die volle Journey.
 */
export const getBestPrices = t.procedure
	.input(
		z.object({
			from: z.string(),
			to: z.string(),
			date: z.date(),
			travelClass: z.int(),
			bahnCard: z.int().nullable(),
			passengerAge: z.int().optional(),
			hasDeutschlandTicket: z.boolean(),
		})
	)
	.query(async ({ input }): Promise<BestPriceEntry[]> => {
		// Tagesbeginn als Anker – bestprice durchsucht den ganzen Tag. Bei
		// heutigem Datum nicht in der Vergangenheit starten (sonst liefert DB
		// kaum/keine Treffer), sondern ab jetzt.
		const dayStart = new Date(input.date);
		dayStart.setHours(0, 0, 0, 0);
		const now = new Date();
		const anchor = dayStart.getTime() < now.getTime() ? now : dayStart;

		const options: SearchJourneysOptions = {
			// Bei bestprice begrenzt `results` die Tagesliste – hoch wählen, damit
			// alle Tagespreise zurückkommen (sonst nur 1 Treffer).
			results: 60,
			stopovers: false,
			notOnlyFastRoutes: true,
			remarks: false,
			transfers: -1,
			firstClass: input.travelClass === 1,
			age: input.passengerAge,
			departure: anchor,
			// @ts-expect-error bestprice ist im db-vendo-Typstub nicht deklariert
			bestprice: true,
		};
		if (input.bahnCard !== null && [25, 50, 100].includes(input.bahnCard)) {
			options.loyaltyCard = {
				type: loyaltyCards.BAHNCARD,
				discount: input.bahnCard,
				class: input.travelClass,
			};
		}
		// Bewusst KEIN deutschlandTicketDiscount: die Tagesübersicht zeigt die
		// regulären (BahnCard-)Preise; D-Ticket-Abdeckung steckt in der Detail-
		// analyse. Mit dem Flag liefert die bestprice-Suche teils 0 Ergebnisse.

		const raw = await dbClient.journeys(input.from, input.to, options);
		const parsed = z
			.object({ journeys: z.array(rawBestPriceJourney) })
			.safeParse(raw);
		if (!parsed.success) return [];

		const toDate = (v: unknown): Date | null =>
			v instanceof Date
				? v
				: typeof v === "string"
				? new Date(v)
				: null;

		const entries: BestPriceEntry[] = [];
		for (const j of parsed.data.journeys) {
			const amount = j.price?.amount;
			if (amount === null || amount === undefined) continue;
			const trainLegs = j.legs.filter((l) => !l.walking && l.line?.name);
			const departure = toDate(trainLegs[0]?.departure ?? j.legs[0]?.departure);
			const arrival = toDate(
				trainLegs.at(-1)?.arrival ?? j.legs.at(-1)?.arrival
			);
			if (!departure || !arrival) continue;
			entries.push({
				departure,
				arrival,
				price: amount,
				lineNames: trainLegs
					.map((l) => l.line?.name)
					.filter((n): n is string => Boolean(n)),
				transfers: Math.max(0, trainLegs.length - 1),
			});
		}

		// Nach Abfahrtszeit sortiert (für die Timeline).
		entries.sort((a, b) => a.departure.getTime() - b.departure.getTime());
		return bestPriceEntrySchema.array().parse(entries);
	});
