"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StationAutocomplete, type SelectedStation } from "./StationAutocomplete";
import { URLInput } from "./URLInput";
import { useLocalStorage } from "./useLocalStorage";

// "datetime-local"-Defaultwert: nächste Viertelstunde in lokaler Zeit.
const defaultDateTimeLocal = () => {
	const d = new Date();
	d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
		d.getHours()
	)}:${pad(d.getMinutes())}`;
};

export const SearchForm = () => {
	const router = useRouter();

	const [mode, setMode] = useState<"direct" | "link">("direct");

	// Link-Modus
	const [url, setUrl] = useState("");
	const [urlParseError, setUrlParseError] = useState<string | null>(null);

	// Direkt-Modus
	const [from, setFrom] = useState<SelectedStation | null>(null);
	const [to, setTo] = useState<SelectedStation | null>(null);
	const [dateTime, setDateTime] = useState<string>(defaultDateTimeLocal());

	// Geteilte Optionen
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

	// Letzte Suche vorbefüllen (clientseitig, SSR-sicher).
	useEffect(() => {
		try {
			const raw = window.localStorage.getItem("lastSearch");
			if (!raw) return;
			const last = JSON.parse(raw) as {
				from?: SelectedStation;
				to?: SelectedStation;
				date?: string;
			};
			if (last.from?.id) setFrom(last.from);
			if (last.to?.id) setTo(last.to);
			if (last.date) setDateTime(last.date);
		} catch {}
	}, []);

	const persistLastSearch = () => {
		try {
			window.localStorage.setItem(
				"lastSearch",
				JSON.stringify({ mode: "direct", from, to, date: dateTime })
			);
		} catch {}
	};

	const sharedParams = () => {
		const sp = new URLSearchParams({
			hasDeutschlandTicket: String(hasDeutschlandTicket),
			passengerAge: String(passengerAge),
			travelClass,
		});
		if (bahnCard !== "none") sp.set("bahnCard", bahnCard);
		return sp;
	};

	const handleLinkSearch = () => {
		if (!url.trim()) {
			setUrlParseError(
				"Bitte geben Sie Text mit einer DB-Buchungs-URL ein oder fügen Sie einen direkten DB-Buchungslink ein"
			);
			return;
		}

		const vbid = url.match(/vbid=([\w-]+)/)?.[1];
		if (!vbid) {
			setUrlParseError(
				"Keine gültige DB-Buchungs-URL gefunden. Bitte fügen Sie Text mit einem Deutsche Bahn Buchungslink ein (von bahn.de mit /buchung/start Pfad) oder überprüfen Sie, ob Ihre URL korrekt ist."
			);
			return;
		}

		const sp = sharedParams();
		sp.set("vbid", vbid);
		router.push(`/discount?${sp.toString()}`);
	};

	const handleDirectSearch = () => {
		if (!from || !to) return;
		const sp = sharedParams();
		sp.set("from", from.id);
		sp.set("fromName", from.name);
		sp.set("to", to.id);
		sp.set("toName", to.name);
		sp.set("date", new Date(dateTime).toISOString());
		persistLastSearch();
		router.push(`/discount?${sp.toString()}`);
	};

	const tabClasses = (active: boolean) =>
		`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
			active
				? "bg-primary text-white"
				: "bg-transparent text-foreground/70 hover:text-foreground"
		}`;

	return (
		<section>
			<div className="space-y-6">
				{/* Tab-Umschalter */}
				<div className="flex gap-2 justify-center">
					<button
						type="button"
						onClick={() => setMode("direct")}
						className={tabClasses(mode === "direct")}
					>
						Von/Nach suchen
					</button>
					<button
						type="button"
						onClick={() => setMode("link")}
						className={tabClasses(mode === "link")}
					>
						Link einfügen
					</button>
				</div>

				{mode === "direct" ? (
					<div className="flex flex-col md:flex-row gap-4">
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
						<div className="w-full">
							<label className="text-sm font-medium opacity-80">Abfahrt</label>
							<input
								type="datetime-local"
								value={dateTime}
								onChange={(e) => setDateTime(e.target.value)}
								className="w-full px-3 py-2 border-b-2 border-gray-300 focus:ring-2 focus:ring-primary"
							/>
						</div>
					</div>
				) : (
					<URLInput url={url} setUrl={setUrl} />
				)}

				{/* Geteilte Optionen */}
				<div className="flex flex-col md:flex-row gap-8">
					<select
						value={bahnCard}
						onChange={(e) => setBahnCard(e.target.value)}
						className="w-full px-3 py-2 resize-vertical border-b-2 border-gray-300 focus:ring-2 focus:ring-primary"
					>
						<option className="text-black" value="none">
							Keine BahnCard
						</option>
						<option className="text-black" value="25">
							BahnCard 25{" "}
						</option>
						<option className="text-black" value="50">
							BahnCard 50{" "}
						</option>
					</select>
					<input
						type="number"
						value={passengerAge}
						onChange={(e) => setPassengerAge(e.target.value)}
						placeholder="Alter des Reisenden"
						min="0"
						max="120"
						className="w-full px-3 py-2 resize-vertical border-b-2 border-gray-300 focus:ring-2 focus:ring-primary"
					/>
					<select
						value={String(hasDeutschlandTicket)}
						onChange={(e) => setHasDeutschlandTicket(e.target.value === "true")}
						className="w-full px-3 py-2 resize-vertical border-b-2 border-gray-300 focus:ring-2 focus:ring-primary"
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
						className="w-full px-3 py-2 resize-vertical border-b-2 border-gray-300 focus:ring-2 focus:ring-primary"
					>
						<option className="text-black" value="1">
							Erste Klasse
						</option>
						<option className="text-black" value="2">
							Zweite Klasse
						</option>
					</select>
				</div>

				<button
					onClick={mode === "direct" ? handleDirectSearch : handleLinkSearch}
					disabled={mode === "direct" ? !from || !to : !url.trim()}
					className="w-full bg-primary text-white py-3 px-4 rounded-full hover:cursor-pointer hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-lg font-semibold"
				>
					Bessere Verbindung suchen
				</button>
			</div>

			{urlParseError && mode === "link" && (
				<div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
					<strong>Fehler:</strong> {urlParseError}
				</div>
			)}
		</section>
	);
};
