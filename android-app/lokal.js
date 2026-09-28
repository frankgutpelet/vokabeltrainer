"use strict";
/*
 * Lokale Speicherschicht für die Android-App.
 * Bildet die Endpunkte des FastAPI-Backends nach, speichert aber alles
 * im lokalen Speicher des Geräts (localStorage der App-WebView).
 */
const LOKAL_LEKTION_PREFIX = "vt_lektion:";
const LOKAL_LOG_KEY = "vt_log";
const LOKAL_LOG_MAX = 2000;

function lokalFehler(detail) { return new Error(detail); }

function lokalName(name) {
  name = (name || "").trim();
  if (!name) throw lokalFehler("Lektionsname darf nicht leer sein.");
  if (!/^[A-Za-z0-9_\- äöüÄÖÜß]+$/.test(name)) throw lokalFehler("Ungültige Zeichen im Lektionsnamen.");
  return name;
}

function lokalLog(level, msg) {
  try {
    let log = JSON.parse(localStorage.getItem(LOKAL_LOG_KEY) || "[]");
    log.push(`${new Date().toLocaleString("de-DE")} | ${level} | ${msg}`);
    if (log.length > LOKAL_LOG_MAX) log = log.slice(-LOKAL_LOG_MAX);
    localStorage.setItem(LOKAL_LOG_KEY, JSON.stringify(log));
  } catch (e) { /* Speicher voll o.ä. - Logging darf die App nie stören */ }
}
function lokalLogLesen() {
  try { return JSON.parse(localStorage.getItem(LOKAL_LOG_KEY) || "[]").join("\n"); } catch (e) { return ""; }
}
function lokalLogLoeschen() { localStorage.removeItem(LOKAL_LOG_KEY); }

function lokalLektionLesen(name) {
  const raw = localStorage.getItem(LOKAL_LEKTION_PREFIX + name);
  return raw ? JSON.parse(raw) : null;
}

function lokalErgebnisLoggen(prefix, lektion, ergebnisse) {
  for (const e of ergebnisse) {
    lokalLog(e.richtig ? "INFO" : "WARNING",
      `${prefix} | ${e.richtig ? "RICHTIG" : "FALSCH"} | Lektion='${lektion}' de='${e.de}' en='${e.en}' Richtung=${e.richtung} gegeben='${e.gegeben}'`);
  }
}

async function lokalApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : null;

  try {
    if (path === "/lektionen" && method === "GET") {
      const namen = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(LOKAL_LEKTION_PREFIX)) namen.push(k.slice(LOKAL_LEKTION_PREFIX.length));
      }
      namen.sort((a, b) => a.localeCompare(b, "de"));
      return { lektionen: namen };
    }

    if (path === "/lektionen" && method === "POST") {
      const name = lokalName(body.name);
      if (lokalLektionLesen(name)) throw lokalFehler("Lektion existiert bereits.");
      const data = { name, vokabeln: body.vokabeln || [] };
      localStorage.setItem(LOKAL_LEKTION_PREFIX + name, JSON.stringify(data));
      lokalLog("INFO", `Lektion angelegt: '${name}' mit ${data.vokabeln.length} Vokabeln`);
      return data;
    }

    const m = path.match(/^\/lektionen\/(.+)$/);
    if (m) {
      const name = lokalName(decodeURIComponent(m[1]));
      const vorhanden = lokalLektionLesen(name);
      if (!vorhanden) { lokalLog("WARNING", `Lektion nicht gefunden: ${name}`); throw lokalFehler("Lektion nicht gefunden."); }
      if (method === "GET") return vorhanden;
      if (method === "PUT") {
        const data = { name, vokabeln: body.vokabeln || [] };
        localStorage.setItem(LOKAL_LEKTION_PREFIX + name, JSON.stringify(data));
        lokalLog("INFO", `Lektion aktualisiert: '${name}', jetzt ${data.vokabeln.length} Vokabeln`);
        return data;
      }
      if (method === "DELETE") {
        localStorage.removeItem(LOKAL_LEKTION_PREFIX + name);
        lokalLog("INFO", `Lektion gelöscht: '${name}'`);
        return { status: "ok" };
      }
    }

    if (path === "/log/abfrage" && method === "POST") {
      lokalLog("INFO", `=== ABFRAGE gestartet | Lektion='${body.lektion}' Richtung=${body.richtung} ===`);
      lokalErgebnisLoggen("Abfrage", body.lektion, body.ergebnisse);
      const ok = body.ergebnisse.filter(e => e.richtig).length;
      lokalLog("INFO", `=== ABFRAGE beendet | Lektion='${body.lektion}' Richtig=${ok}/${body.ergebnisse.length} ===`);
      return { status: "ok" };
    }

    if (path === "/log/test" && method === "POST") {
      lokalLog("INFO", `=== TEST gestartet | Lektion='${body.lektion}' Anzahl Fragen=${body.ergebnisse.length} ===`);
      lokalErgebnisLoggen("Test", body.lektion, body.ergebnisse);
      lokalLog("INFO", `=== TEST beendet | Lektion='${body.lektion}' Punkte=${body.punkte}/${body.max_punkte} (${body.prozent.toFixed(1)}%) Note=${body.note} ===`);
      return { status: "ok" };
    }
  } catch (err) {
    if (err.message) lokalLog("ERROR", `${method} ${path}: ${err.message}`);
    throw err;
  }
  throw lokalFehler(`Unbekannter Aufruf: ${method} ${path}`);
}
