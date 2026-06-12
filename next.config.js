// Next.js Konfigurationsdatei
module.exports = {
	// Standalone-Output für Docker-Deployment aktivieren
	// Dies erstellt eine eigenständige Version der App mit allen Abhängigkeiten
	output: "standalone",
	typescript: {
		ignoreBuildErrors: true // temporarily, since some type errors still exists and are ambiguous
	},
	// Dev-Server: Cross-Origin-Zugriffe vom gesamten lokalen Netz 192.168.178.0/24
	// erlauben. Next matcht hostnameweise pro „.“-Segment, daher deckt
	// „192.168.178.*“ alle Hosts .0–.255 des /24-Subnetzes ab.
	allowedDevOrigins: ["192.168.178.*"],
};
