"use client";

import type { VendoLocationResult } from "@/utils/schemas";
import { trpc } from "@/utils/TRPCProvider";
import { useEffect, useRef, useState } from "react";

export interface SelectedStation {
	id: string;
	name: string;
	latitude?: number;
	longitude?: number;
}

interface Props {
	label: string;
	placeholder?: string;
	value: SelectedStation | null;
	onChange: (station: SelectedStation | null) => void;
}

export const StationAutocomplete = ({
	label,
	placeholder,
	value,
	onChange,
}: Props) => {
	const [text, setText] = useState(value?.name ?? "");
	const [debounced, setDebounced] = useState("");
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	// Debounce der Eingabe (~250ms)
	useEffect(() => {
		const id = setTimeout(() => setDebounced(text.trim()), 250);
		return () => clearTimeout(id);
	}, [text]);

	// Wenn von außen ein Bahnhof gesetzt wird (Vorbefüllung), Anzeige übernehmen.
	useEffect(() => {
		if (value?.name) setText(value.name);
	}, [value]);

	// Dropdown schließen bei Klick außerhalb
	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, []);

	const query = trpc.searchLocations.useQuery(
		{ query: debounced },
		{ enabled: debounced.length >= 2 && !value }
	);

	const handleSelect = (station: VendoLocationResult) => {
		onChange(station);
		setText(station.name);
		setOpen(false);
	};

	const results = query.data ?? [];

	return (
		<div className="relative w-full" ref={containerRef}>
			<label className="text-sm font-medium opacity-80">{label}</label>
			<input
				value={text}
				placeholder={placeholder}
				onChange={(e) => {
					setText(e.target.value);
					setOpen(true);
					// Auswahl zurücksetzen, sobald getippt wird (kein stale id)
					if (value) onChange(null);
				}}
				onFocus={() => setOpen(true)}
				className="w-full px-3 py-2 border-b-2 border-gray-300 focus:ring-2 focus:ring-primary"
			/>

			{open && debounced.length >= 2 && !value && (
				<div className="absolute z-20 mt-1 w-full bg-background border border-foreground/20 rounded-md shadow-lg max-h-64 overflow-auto">
					{query.isLoading && (
						<div className="px-3 py-2 text-sm text-foreground/60">
							Suche…
						</div>
					)}
					{!query.isLoading && results.length === 0 && (
						<div className="px-3 py-2 text-sm text-foreground/60">
							Keine Bahnhöfe gefunden
						</div>
					)}
					{results.map((station) => (
						<button
							key={station.id}
							type="button"
							onClick={() => handleSelect(station)}
							className="block w-full text-left px-3 py-2 text-sm hover:bg-primary/10"
						>
							{station.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
};
