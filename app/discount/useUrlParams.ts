import { useSearchParams } from "next/navigation";

export const useUrlParams = () => {
	const searchParams = useSearchParams();
	const date = searchParams.get("date");

	return {
		bahnCard: searchParams.has("bahnCard")
			? Number.parseInt(searchParams.get("bahnCard")!, 10)
			: null,
		// Modus 1: geteilter Link
		vbid: searchParams.get("vbid") ?? undefined,
		// Modus 2: direkte Von/Nach-Suche
		from: searchParams.get("from") ?? undefined,
		fromName: searchParams.get("fromName") ?? undefined,
		to: searchParams.get("to") ?? undefined,
		toName: searchParams.get("toName") ?? undefined,
		date: date ? new Date(date) : undefined,
		travelClass: Number.parseInt(searchParams.get("travelClass")!, 10),
		hasDeutschlandTicket: searchParams.get("hasDeutschlandTicket") === "true",
		passengerAge: searchParams.get("passengerAge")
			? Number.parseInt(searchParams.get("passengerAge")!, 10)
			: undefined,
	};
};
