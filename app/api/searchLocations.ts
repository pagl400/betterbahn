import {
	vendoLocationResultSchema,
	type VendoLocationResult,
} from "@/utils/schemas";
import { t } from "@/utils/trpc-init";
import { z } from "zod/v4";
import { dbClient } from "./getJourney/getJourney";

// Rohform eines locations()-Treffers (nur die Felder, die wir brauchen).
const rawLocationSchema = z.object({
	type: z.string().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	location: z
		.object({
			latitude: z.number().optional(),
			longitude: z.number().optional(),
		})
		.optional(),
});

/**
 * Bahnhofs-Suche für das Autocomplete der direkten Von/Nach-Suche.
 * Liefert nur echte Stationen/Haltestellen (keine POIs/Adressen).
 */
export const searchLocations = t.procedure
	.input(
		z.object({
			query: z.string().min(2),
			results: z.int().min(1).max(10).default(8),
		})
	)
	.query(async ({ input }): Promise<VendoLocationResult[]> => {
		const raw = await dbClient.locations(input.query, {
			results: input.results,
		});

		const parsed = z.array(rawLocationSchema).safeParse(raw);
		if (!parsed.success) return [];

		return parsed.data
			.filter(
				(l) =>
					(l.type === "stop" || l.type === "station") && l.id && l.name
			)
			.map((l) =>
				vendoLocationResultSchema.parse({
					id: l.id,
					name: l.name,
					latitude: l.location?.latitude,
					longitude: l.location?.longitude,
				})
			);
	});
