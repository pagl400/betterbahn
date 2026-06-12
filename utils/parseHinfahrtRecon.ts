import zlib from "node:zlib";
import { z } from "zod/v4";

const locationListSchema = z.array(z.object({ lid: z.string() })).min(1);

// Das `SC`-Segment enthält die ursprüngliche Verbindungsanfrage. DB hat die
// Feldnamen für Start-/Ziel-Locations von `depLoc`/`arrLoc` auf
// `depLocL`/`arrLocL` umgestellt – wir akzeptieren beide Varianten.
const scJsonSchema = z.object({
	req: z
		.object({
			depLocL: locationListSchema.optional(),
			arrLocL: locationListSchema.optional(),
			depLoc: locationListSchema.optional(),
			arrLoc: locationListSchema.optional(),
		})
		.refine(
			(req) => (req.depLocL ?? req.depLoc) && (req.arrLocL ?? req.arrLoc),
			{ message: "hinfahrtRecon 'SC' JSON is missing depLoc(L)/arrLoc(L)" }
		),
});

/**
 * Liest Start- und Ziel-Location-ID direkt aus dem `hinfahrtRecon`-String aus,
 * ohne die DB-Recon-API aufzurufen.
 *
 * Hintergrund: Der frühere Weg über `https://www.bahn.de/web/api/angebote/recon`
 * wird inzwischen von Akamai Bot Manager geblockt (HTTP 403, `OPS_BLOCKED`) –
 * der Endpunkt verlangt ein gültiges `_abck`-Sensor-Cookie, das nur über das
 * Lösen der Akamai-JS-Challenge im Browser entsteht. Server-seitig ist das nicht
 * zuverlässig nachzubilden. Die benötigten Stations-IDs stecken aber ohnehin
 * bereits im `hinfahrtRecon`, den wir über den (weiterhin funktionierenden)
 * `verbindung/{vbid}`-Endpunkt erhalten.
 *
 * `hinfahrtRecon` ist ein eigenwilliges Format: per "¶" getrennte Sektionen,
 * wovon die auf `SC` folgende ein mit `1_`-Prefix versehener, base64-kodierter
 * und gzip-komprimierter JSON-String ist.
 */
export const parseHinfahrtRecon = (hinfahrtRecon: string) => {
	const sections = hinfahrtRecon.split("¶");
	const scIndex = sections.findIndex((s) => s === "SC");

	if (scIndex === -1) {
		throw new Error("Can't process vbid: Couldn't find 'SC' in hinfahrtRecon");
	}

	const scGzipBase64WithPrefix = sections[scIndex + 1];

	if (!scGzipBase64WithPrefix?.startsWith("1_")) {
		throw new Error(
			"Can't process vbid: hinfahrtRecon 'SC' unexpectedly doesn't start with '1_'"
		);
	}

	const scGzipBase64 = scGzipBase64WithPrefix.slice("1_".length);
	const scGzipBuffer = Buffer.from(scGzipBase64, "base64");

	let scJsonString = "";

	try {
		scJsonString = zlib.gunzipSync(scGzipBuffer).toString("utf-8");
	} catch {
		throw new Error(
			"Can't process vbid: hinfahrtRecon 'SC' failed to get gunzipped"
		);
	}

	let scUnvalidatedJson: unknown;

	try {
		scUnvalidatedJson = JSON.parse(scJsonString);
	} catch {
		throw new Error(
			"Can't process vbid: hinfahrtRecon 'SC' JSON parsing failed (invalid JSON)"
		);
	}

	const scValidatedJsonResult = scJsonSchema.safeParse(scUnvalidatedJson);

	if (!scValidatedJsonResult.success) {
		throw new Error(
			"Can't process vbid: hinfahrtRecon 'SC' JSON doesn't match schema"
		);
	}

	const { req } = scValidatedJsonResult.data;
	const departLid = (req.depLocL ?? req.depLoc)![0].lid;
	const arrLid = (req.arrLocL ?? req.arrLoc)![0].lid;

	return { arrLid, departLid };
};
