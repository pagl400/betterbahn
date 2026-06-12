"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
	StationAutocomplete,
	type SelectedStation,
} from "./StationAutocomplete";
import { useLocalStorage } from "./useLocalStorage";

// Date -> "datetime-local"-Stringwert (lokale Zeit).
const toLocalInput = (d: Date) => {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
		d.getHours()
	)}:${pad(d.getMinutes())}`;
};

interface Props {
	initialFrom: SelectedStation | null;
	initialTo: SelectedStation | null;
	initialDate: Date | null;
}

/** Kompakte, jederzeit editierbare Such-Leiste für die Ergebnisseite. */
export const SearchBar = ({ initialFrom, initialTo, initialDate }: Props) => {
	const router = useRouter();

	const [from, setFrom] = useState<SelectedStation | null>(initialFrom);
	const [to, setTo] = useState<SelectedStation | null>(initialTo);
	const [dateTime, setDateTime] = useState<string>(
		toLocalInput(initialDate ?? new Date())
	);

	const [bahnCard, setBahnCard] = useLocalStorage("bahnCard", "none");
	const [hasDeutschlandTicket, setHasDeutschlandTicket] = useLocalStorage(
		"hasDeutschlandTicket",
		false
	);
	const [passengerAge, setPassengerAge] = useLocalStorage<string>(
		"passengerAge",
		""
	);
	const [travelClass, setTravelClass] = useLocalStorage("travelClass", "2");

	const submit = () => {
		if (!from || !to) return;
		const sp = new URLSearchParams({
			from: from.id,
			fromName: from.name,
			to: to.id,
			toName: to.name,
			date: new Date(dateTime).toISOString(),
			hasDeutschlandTicket: String(hasDeutschlandTicket),
			passengerAge: String(passengerAge),
			travelClass,
		});
		if (bahnCard !== "none") sp.set("bahnCard", bahnCard);
		// localStorage: letzte Suche merken
		try {
			window.localStorage.setItem(
				"lastSearch",
				JSON.stringify({ mode: "direct", from, to, date: dateTime })
			);
		} catch {}
		router.replace(`/discount?${sp.toString()}`);
	};

	const selectClass =
		"px-3 py-2 border-b-2 border-gray-300 focus:ring-2 focus:ring-primary bg-background text-sm";

	return (
		<div className="rounded-xl border border-foreground/15 bg-background shadow-sm p-4">
			<div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
				<StationAutocomplete
					label="Von"
					placeholder="Startbahnhof"
					value={from}
					onChange={setFrom}
				/>
				<StationAutocomplete
					label="Nach"
					placeholder="Zielbahnhof"
					value={to}
					onChange={setTo}
				/>
				<div>
					<label className="text-sm font-medium opacity-80">Abfahrt</label>
					<input
						type="datetime-local"
						value={dateTime}
						onChange={(e) => setDateTime(e.target.value)}
						className="w-full px-3 py-2 border-b-2 border-gray-300 focus:ring-2 focus:ring-primary bg-background"
					/>
				</div>
				<button
					onClick={submit}
					disabled={!from || !to}
					className="h-[42px] px-5 rounded-full bg-primary text-white font-semibold hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					Suchen
				</button>
			</div>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
				<select
					value={bahnCard}
					onChange={(e) => setBahnCard(e.target.value)}
					className={selectClass}
				>
					<option className="text-black" value="none">
						Keine BahnCard
					</option>
					<option className="text-black" value="25">
						BahnCard 25
					</option>
					<option className="text-black" value="50">
						BahnCard 50
					</option>
				</select>
				<input
					type="number"
					value={passengerAge}
					onChange={(e) => setPassengerAge(e.target.value)}
					placeholder="Alter"
					min="0"
					max="120"
					className={selectClass}
				/>
				<select
					value={String(hasDeutschlandTicket)}
					onChange={(e) => setHasDeutschlandTicket(e.target.value === "true")}
					className={selectClass}
				>
					<option className="text-black" value="true">
						Deutschlandticket
					</option>
					<option className="text-black" value="false">
						Kein Deutschlandticket
					</option>
				</select>
				<select
					value={String(travelClass)}
					onChange={(e) => setTravelClass(e.target.value)}
					className={selectClass}
				>
					<option className="text-black" value="1">
						Erste Klasse
					</option>
					<option className="text-black" value="2">
						Zweite Klasse
					</option>
				</select>
			</div>
		</div>
	);
};
