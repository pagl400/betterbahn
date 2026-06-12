declare module "db-vendo-client" {
	interface BoardOptions {
		duration?: number;
		when?: Date;
	}

	interface NearbyLocation {
		type: "location";
		latitude: number;
		longitude: number;
	}

	interface VendoClient {
		journeys(
			from: string,
			to: string,
			options: SearchJourneysOptions
		): Promise<unknown>;
		trip(id: string, options?: { stopovers?: boolean }): Promise<unknown>;
		arrivals(station: string, options?: BoardOptions): Promise<unknown>;
		departures(station: string, options?: BoardOptions): Promise<unknown>;
		locations(
			query: string,
			options?: { results?: number }
		): Promise<unknown>;
		nearby(
			location: NearbyLocation,
			options?: { distance?: number; results?: number }
		): Promise<unknown>;
	}

	export function createClient(
		dbProfile: unknown,
		userAgent: string
	): VendoClient;

	export interface SearchJourneysOptions {
		results: number;
		stopovers: boolean;
		notOnlyFastRoutes: boolean;
		remarks: boolean;
		transfers: number;
		firstClass: boolean;
		departure?: Date;
		/** Einzelner Zwischenhalt, durch den die Verbindung führen muss. */
		via?: string;
		loyaltyCard?: {
			type: string;
			discount: number;
			class: number;
		};
		age?: number;
		deutschlandTicketDiscount?: boolean;
		deutschlandTicketConnectionsOnly?: boolean;
	}
}

declare module "db-vendo-client/format/loyalty-cards" {
	export const data: Record<string, string>;
}

declare module "db-vendo-client/p/db/index" {
	/**
	 * Das DB-Profil ist ein Record aus Endpunkt-Strings und Hook-Funktionen
	 * (z.B. transformReq). Wir greifen darauf dynamisch zu (Host-Remap, TLS-Agent).
	 */
	export const profile: Record<string, unknown> & {
		transformReq?: (ctx: unknown, reqOptions: unknown) => unknown;
	};
}
