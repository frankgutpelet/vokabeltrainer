"use strict";

const API = "/api";
const content = document.getElementById("content");
const nav = document.getElementById("nav");

// ---------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Fehler ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function normalisieren(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalisierenCS(s) {
  return (s || "").trim().replace(/\s+/g, " ");
}

// antwortSprache: "en" -> case-sensitive prüfen, "de" -> case-insensitive
function istRichtig(gegeben, korrekt, antwortSprache) {
  return antwortSprache === "en"
    ? normalisierenCS(gegeben) === normalisierenCS(korrekt)
    : normalisieren(gegeben) === normalisieren(korrekt);
}

function noteBerechnen(prozent) {
  if (prozent >= 92) return 1;
  if (prozent >= 81) return 2;
  if (prozent >= 67) return 3;
  if (prozent >= 50) return 4;
  if (prozent >= 30) return 5;
  return 6;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------
// Foto-Scan: Text erkennen (Tesseract.js) und Deutsch/Englisch zuordnen
// ---------------------------------------------------------------------
let tesseractLadenPromise = null;
function ladeTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLadenPromise) return tesseractLadenPromise;
  tesseractLadenPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Texterkennung konnte nicht geladen werden (keine Internetverbindung?)."));
    document.head.appendChild(script);
  });
  return tesseractLadenPromise;
}

const DEUTSCH_WOERTER = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
  "und", "ist", "nicht", "ich", "du", "er", "sie", "es", "wir", "ihr", "mit", "für",
  "auf", "im", "in", "zu", "kein", "keine", "sein", "haben", "werden", "sehr", "auch",
  "sich", "von", "aus", "bei", "nach", "über", "unter", "durch", "als", "wie", "wenn",
  "man", "was", "wo", "wer", "zum", "zur",
]);
const ENGLISCH_WOERTER = new Set([
  "the", "and", "is", "you", "this", "that", "with", "for", "have", "has", "are",
  "was", "were", "a", "an", "to", "of", "in", "on", "at", "it", "he", "she", "we",
  "they", "not", "be", "will", "would", "can", "could", "do", "does", "his", "her",
  "their", "or", "but", "so", "if", "what", "who", "where",
]);

function deutschWahrscheinlichkeit(text) {
  const t = text.toLowerCase();
  let score = 0;
  const umlaute = (t.match(/[äöüß]/g) || []).length;
  score += umlaute * 3;
  const woerter = t.split(/\s+/).filter(Boolean);
  for (const w of woerter) {
    const bereinigt = w.replace(/[^a-zäöüß]/g, "");
    if (DEUTSCH_WOERTER.has(bereinigt)) score += 3;
    if (ENGLISCH_WOERTER.has(bereinigt)) score -= 3;
  }
  return score;
}

// Ordnet zwei erkannte Textteile automatisch Deutsch/Englisch zu.
// Bei Gleichstand wird die übliche Konvention (Deutsch zuerst) als Fallback genutzt.
function ordneDeEnZu(teilA, teilB) {
  const scoreA = deutschWahrscheinlichkeit(teilA);
  const scoreB = deutschWahrscheinlichkeit(teilB);
  if (scoreA === scoreB) return { de: teilA, en: teilB };
  return scoreA > scoreB ? { de: teilA, en: teilB } : { de: teilB, en: teilA };
}

// Versucht eine erkannte Textzeile in zwei Vokabelteile zu splitten
// (Tab, mehrere Leerzeichen, Gedankenstrich, Gleichheitszeichen, Doppelpunkt).
function splitVokabelZeile(zeile) {
  const bereinigt = zeile.trim();
  if (!bereinigt) return null;
  const trenner = /\t|\s{2,}|\s[-–—=]\s|\s:\s/;
  const teile = bereinigt.split(trenner).map(t => t.trim()).filter(Boolean);
  if (teile.length !== 2) return null;
  return ordneDeEnZu(teile[0], teile[1]);
}

async function erkenneVokabelnAusBild(file, statusCallback) {
  await ladeTesseract();
  const { data } = await window.Tesseract.recognize(file, "eng+deu", {
    logger: (m) => {
      if (m.status && typeof m.progress === "number") {
        statusCallback(`${m.status} … ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  const zeilen = data.text.split("\n");
  const erkannt = [];
  let uebersprungen = 0;
  for (const zeile of zeilen) {
    if (!zeile.trim()) continue;
    const paar = splitVokabelZeile(zeile);
    if (paar) erkannt.push(paar);
    else uebersprungen++;
  }
  return { erkannt, uebersprungen };
}

function setNav(buttons) {
  nav.innerHTML = "";
  for (const b of buttons) nav.appendChild(b);
}

// ---------------------------------------------------------------------
// Startseite: Lektionsliste
// ---------------------------------------------------------------------
async function zeigeStartseite() {
  setNav([]);
  content.innerHTML = "";

  const neueBtn = el("button", { onclick: () => zeigeLektionErstellen() }, "+ Neue Lektion");
  content.appendChild(el("div", { class: "card" }, [
    el("div", { class: "row" }, [neueBtn]),
  ]));

  const liste = el("div");
  content.appendChild(liste);

  let daten;
  try {
    daten = await api("/lektionen");
  } catch (err) {
    liste.appendChild(el("p", {}, "Fehler beim Laden: " + err.message));
    return;
  }

  if (daten.lektionen.length === 0) {
    liste.appendChild(el("p", { class: "hinweis" }, "Noch keine Lektionen angelegt."));
    return;
  }

  for (const name of daten.lektionen) {
    liste.appendChild(
      el("div", { class: "lektion-item" }, [
        el("span", { class: "name" }, name),
        el("span", { class: "aktionen" }, [
          el("button", { class: "secondary", onclick: () => zeigeLektionDetail(name) }, "Öffnen"),
          el("button", { class: "secondary", onclick: () => lektionLoeschen(name) }, "Löschen"),
        ]),
      ])
    );
  }
}

async function lektionLoeschen(name) {
  if (!confirm(`Lektion "${name}" wirklich löschen?`)) return;
  await api(`/lektionen/${encodeURIComponent(name)}`, { method: "DELETE" });
  zeigeStartseite();
}

// ---------------------------------------------------------------------
// Lektion erstellen / bearbeiten
// ---------------------------------------------------------------------
function zeigeLektionErstellen(bestehendeLektion = null) {
  setNav([el("button", { class: "secondary", onclick: () => zeigeStartseite() }, "← Zurück")]);
  content.innerHTML = "";

  const istBearbeiten = bestehendeLektion !== null;
  let vokabeln = istBearbeiten ? bestehendeLektion.vokabeln.map(v => ({ ...v })) : [];

  const nameInput = el("input", {
    type: "text",
    placeholder: "Name der Lektion",
    value: istBearbeiten ? bestehendeLektion.name : "",
  });
  if (istBearbeiten) nameInput.disabled = true;

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, istBearbeiten ? `Lektion bearbeiten: ${bestehendeLektion.name}` : "Neue Lektion"));
  card.appendChild(el("div", { class: "row" }, [nameInput]));

  const vokabelListe = el("div", { class: "vokabel-liste" });

  let deZuerst = true; // Reihenfolge der Eingabefelder: Deutsch zuerst oder Englisch zuerst

  const reihenfolgeBtn = el("button", {
    class: "secondary",
    onclick: () => { deZuerst = !deZuerst; renderVokabelListe(); reihenfolgeBtn.textContent = reihenfolgeText(); },
  }, "");
  function reihenfolgeText() {
    return deZuerst ? "⇄ Reihenfolge: Deutsch → Englisch" : "⇄ Reihenfolge: Englisch → Deutsch";
  }
  reihenfolgeBtn.textContent = reihenfolgeText();
  card.appendChild(el("div", { class: "row" }, [reihenfolgeBtn]));
  card.appendChild(vokabelListe);

  let fokusIndex = null; // Index der Zeile, deren erstes Feld nach dem Rendern fokussiert werden soll

  function neueZeileAnhaengen() {
    vokabeln.push({ de: "", en: "" });
    fokusIndex = vokabeln.length - 1;
    renderVokabelListe();
  }

  function renderVokabelListe() {
    vokabelListe.innerHTML = "";
    vokabeln.forEach((v, i) => {
      const istLetzte = i === vokabeln.length - 1;

      // erstesFeld/zweitesFeld bestimmen sich aus der gewählten Reihenfolge,
      // die Daten (v.de / v.en) bleiben davon unberührt.
      const erstesKey = deZuerst ? "de" : "en";
      const zweitesKey = deZuerst ? "en" : "de";
      const erstesPlatzhalter = deZuerst ? "Deutsch" : "Englisch";
      const zweitesPlatzhalter = deZuerst ? "Englisch" : "Deutsch";

      const erstesInput = el("input", { type: "text", placeholder: erstesPlatzhalter, value: v[erstesKey] });
      const zweitesInput = el("input", { type: "text", placeholder: zweitesPlatzhalter, value: v[zweitesKey] });
      erstesInput.addEventListener("input", () => (v[erstesKey] = erstesInput.value));
      zweitesInput.addEventListener("input", () => (v[zweitesKey] = zweitesInput.value));

      // Enter im ersten Feld -> weiter zum zweiten Feld derselben Zeile
      erstesInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); zweitesInput.focus(); }
      });

      // In der letzten Zeile: Tab oder Enter im zweiten Feld legt automatisch
      // eine neue, leere Vokabelzeile an und springt dorthin (kein Mausklick nötig).
      // Nur wenn die Zeile bereits ausgefüllt ist - sonst normal weiter tabben
      // (z.B. zum Speichern-Button).
      function ggfNeueZeile(e) {
        if (istLetzte && zweitesInput.value.trim() !== "") {
          e.preventDefault();
          neueZeileAnhaengen();
        }
      }
      zweitesInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); ggfNeueZeile(e); }
        else if (e.key === "Tab" && !e.shiftKey) { ggfNeueZeile(e); }
      });

      const entfernenBtn = el("button", {
        class: "secondary", tabindex: "-1",
        onclick: () => { vokabeln.splice(i, 1); renderVokabelListe(); },
      }, "✕");
      vokabelListe.appendChild(el("div", { class: "row" }, [erstesInput, zweitesInput, entfernenBtn]));

      if (fokusIndex === i) {
        fokusIndex = null;
        requestAnimationFrame(() => erstesInput.focus());
      }
    });
  }
  renderVokabelListe();

  const hinzufuegenBtn = el("button", {
    class: "secondary",
    onclick: () => neueZeileAnhaengen(),
  }, "+ Vokabel hinzufügen");

  const scanBtn = el("button", {
    class: "secondary",
    onclick: () => fileInput.click(),
  }, "📷 Vokabeln scannen");
  const fileInput = el("input", { type: "file", accept: "image/*", capture: "environment" });
  fileInput.style.display = "none";

  const scanStatus = el("div", { class: "hinweis" }, "");
  const scanErgebnisBereich = el("div");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = ""; // damit dasselbe Bild erneut ausgewählt werden kann
    if (!file) return;
    scanErgebnisBereich.innerHTML = "";
    scanStatus.textContent = "Bild wird verarbeitet …";
    try {
      const { erkannt, uebersprungen } = await erkenneVokabelnAusBild(file, (msg) => { scanStatus.textContent = msg; });
      scanStatus.textContent = "";
      zeigeScanErgebnis(erkannt, uebersprungen);
    } catch (err) {
      scanStatus.textContent = "";
      alert("Texterkennung fehlgeschlagen: " + err.message);
    }
  });

  function zeigeScanErgebnis(erkannt, uebersprungen) {
    scanErgebnisBereich.innerHTML = "";
    if (erkannt.length === 0) {
      scanErgebnisBereich.appendChild(el("p", { class: "hinweis" },
        "Keine Vokabelpaare erkannt. Am besten ein scharfes Foto mit klar getrennten Spalten (Tabulator, mehrere Leerzeichen oder Gedankenstrich zwischen den Wörtern) machen."));
      return;
    }

    const zeilenState = erkannt.map(p => ({ ...p, uebernehmen: true }));
    const ergebnisCard = el("div", { class: "card" });
    ergebnisCard.appendChild(el("h3", {},
      `Erkannte Vokabeln (${erkannt.length})` +
      (uebersprungen > 0 ? ` — ${uebersprungen} Zeile(n) nicht eindeutig erkannt, übersprungen` : "")));
    ergebnisCard.appendChild(el("p", { class: "hinweis" },
      "Sprache wurde automatisch zugeordnet, bitte vor dem Übernehmen kurz prüfen und ggf. korrigieren."));

    zeilenState.forEach((p) => {
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = true;
      checkbox.addEventListener("change", () => (p.uebernehmen = checkbox.checked));
      const deInput = el("input", { type: "text", placeholder: "Deutsch", value: p.de });
      const enInput = el("input", { type: "text", placeholder: "Englisch", value: p.en });
      deInput.addEventListener("input", () => (p.de = deInput.value));
      enInput.addEventListener("input", () => (p.en = enInput.value));
      ergebnisCard.appendChild(el("div", { class: "row" }, [checkbox, deInput, enInput]));
    });

    const uebernehmenBtn = el("button", {
      onclick: () => {
        const ausgewaehlt = zeilenState.filter(p => p.uebernehmen && p.de.trim() && p.en.trim());
        if (ausgewaehlt.length === 0) return alert("Keine Vokabeln zum Übernehmen ausgewählt.");
        // leere Platzhalterzeile entfernen, bevor die gescannten Vokabeln angehängt werden
        if (vokabeln.length === 1 && !vokabeln[0].de.trim() && !vokabeln[0].en.trim()) vokabeln.length = 0;
        for (const p of ausgewaehlt) vokabeln.push({ de: p.de.trim(), en: p.en.trim() });
        scanErgebnisBereich.innerHTML = "";
        renderVokabelListe();
      },
    }, "Ausgewählte übernehmen");
    const verwerfenBtn = el("button", { class: "secondary", onclick: () => { scanErgebnisBereich.innerHTML = ""; } }, "Verwerfen");
    ergebnisCard.appendChild(el("div", { class: "row" }, [uebernehmenBtn, verwerfenBtn]));
    scanErgebnisBereich.appendChild(ergebnisCard);
  }

  card.appendChild(el("div", { class: "row" }, [hinzufuegenBtn, scanBtn, fileInput]));
  card.appendChild(scanStatus);
  card.appendChild(scanErgebnisBereich);

  const speichernBtn = el("button", {
    onclick: async () => {
      const name = nameInput.value.trim();
      const bereinigt = vokabeln
        .map(v => ({ de: v.de.trim(), en: v.en.trim() }))
        .filter(v => v.de && v.en);

      if (!name) return alert("Bitte einen Namen für die Lektion angeben.");
      if (bereinigt.length === 0) return alert("Bitte mindestens eine vollständige Vokabel eingeben.");

      try {
        if (istBearbeiten) {
          await api(`/lektionen/${encodeURIComponent(name)}`, {
            method: "PUT",
            body: JSON.stringify({ name, vokabeln: bereinigt }),
          });
        } else {
          await api("/lektionen", {
            method: "POST",
            body: JSON.stringify({ name, vokabeln: bereinigt }),
          });
        }
        zeigeStartseite();
      } catch (err) {
        alert("Fehler: " + err.message);
      }
    },
  }, "Speichern");

  card.appendChild(el("div", { class: "row" }, [speichernBtn]));
  content.appendChild(card);
  if (vokabeln.length === 0) { vokabeln.push({ de: "", en: "" }); renderVokabelListe(); }
}

// ---------------------------------------------------------------------
// Lektion-Detailseite: Aktionen wählen
// ---------------------------------------------------------------------
async function zeigeLektionDetail(name) {
  setNav([el("button", { class: "secondary", onclick: () => zeigeStartseite() }, "← Zurück")]);
  content.innerHTML = "";

  let lektion;
  try {
    lektion = await api(`/lektionen/${encodeURIComponent(name)}`);
  } catch (err) {
    content.appendChild(el("p", {}, "Fehler: " + err.message));
    return;
  }

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, lektion.name));
  card.appendChild(el("p", { class: "hinweis" }, `${lektion.vokabeln.length} Vokabeln`));

  card.appendChild(el("div", { class: "row" }, [
    el("button", { onclick: () => starteAbfrage(lektion, "de-en") }, "Abfragen: Deutsch → Englisch"),
  ]));
  card.appendChild(el("div", { class: "row" }, [
    el("button", { onclick: () => starteAbfrage(lektion, "en-de") }, "Abfragen: Englisch → Deutsch"),
  ]));
  card.appendChild(el("div", { class: "row" }, [
    el("button", { onclick: () => starteTest(lektion) }, "Test starten"),
  ]));
  card.appendChild(el("div", { class: "row" }, [
    el("button", { class: "secondary", onclick: () => zeigeLektionErstellen(lektion) }, "Vokabeln bearbeiten"),
  ]));

  content.appendChild(card);
}

// ---------------------------------------------------------------------
// Abfrage-Modus (eine Richtung, falsche werden am Ende wiederholt)
// ---------------------------------------------------------------------
function starteAbfrage(lektion, richtung) {
  setNav([el("button", { class: "secondary", onclick: () => zeigeLektionDetail(lektion.name) }, "← Abbrechen")]);

  let runde = shuffle(lektion.vokabeln);
  let rundenNr = 1;
  const alleErgebnisse = [];

  function frageText(v) { return richtung === "de-en" ? v.de : v.en; }
  function antwortText(v) { return richtung === "de-en" ? v.en : v.de; }

  function naechsteRunde(vokabelListe, runde) {
    let index = 0;
    let falscheDieserRunde = [];

    function zeigeFrage() {
      content.innerHTML = "";
      if (index >= vokabelListe.length) {
        if (falscheDieserRunde.length > 0) {
          rundenNr++;
          naechsteRunde(shuffle(falscheDieserRunde), rundenNr);
        } else {
          abfrageAbschluss();
        }
        return;
      }

      const v = vokabelListe[index];
      const box = el("div", { class: "frage-box card" });
      box.appendChild(el("div", { class: "fortschritt" },
        `Runde ${runde} · Frage ${index + 1} / ${vokabelListe.length}` +
        (runde > 1 ? " (Wiederholung der Fehler)" : "")
      ));
      box.appendChild(el("div", { class: "wort" }, frageText(v)));

      const input = el("input", { type: "text", class: "antwort-input" });
      const feedback = el("div", { class: "feedback" });
      box.appendChild(input);
      box.appendChild(feedback);

      const weiterBtn = el("button", { onclick: () => weiter() }, "Prüfen");
      box.appendChild(el("div", { class: "row" }, [weiterBtn]));
      content.appendChild(box);
      input.focus();

      let ausgewertet = false;
      function auswerten() {
        if (ausgewertet) return;
        ausgewertet = true;
        const antwortSprache = richtung === "de-en" ? "en" : "de";
        const richtig = istRichtig(input.value, antwortText(v), antwortSprache);
        input.disabled = true;
        weiterBtn.textContent = "Weiter";
        if (richtig) {
          feedback.textContent = "Richtig!";
          feedback.className = "feedback richtig";
        } else {
          feedback.textContent = `Falsch. Richtig wäre: ${antwortText(v)}`;
          feedback.className = "feedback falsch";
          falscheDieserRunde.push(v);
        }
        alleErgebnisse.push({ de: v.de, en: v.en, richtung, gegeben: input.value, richtig });
        // Fokuswechsel erst nach dem aktuellen Tastendruck, sonst löst derselbe
        // Enter-Druck sofort auch den fokussierten Button aus.
        setTimeout(() => weiterBtn.focus(), 0);
      }

      function weiter() {
        if (!ausgewertet) { auswerten(); return; }
        index++;
        zeigeFrage();
      }

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); weiter(); }
      });
    }

    zeigeFrage();
  }

  async function abfrageAbschluss() {
    content.innerHTML = "";
    const richtigeAnzahl = alleErgebnisse.filter(e => e.richtig).length;
    const card = el("div", { class: "card" });
    card.appendChild(el("h2", {}, "Abfrage beendet"));
    card.appendChild(el("p", {}, `Es wurden ${lektion.vokabeln.length} Vokabeln abgefragt, ` +
      `${alleErgebnisse.filter(e=>e.richtig).length} von ${alleErgebnisse.length} Antworten waren beim ersten oder wiederholten Versuch richtig.`));
    card.appendChild(el("button", { onclick: () => zeigeLektionDetail(lektion.name) }, "Zurück zur Lektion"));
    content.appendChild(card);

    try {
      await api("/log/abfrage", {
        method: "POST",
        body: JSON.stringify({ lektion: lektion.name, richtung, ergebnisse: alleErgebnisse }),
      });
    } catch (err) {
      console.error("Logging fehlgeschlagen:", err);
    }
  }

  naechsteRunde(runde, rundenNr);
}

// ---------------------------------------------------------------------
// Test-Modus (beide Richtungen, falsche werden nicht wiederholt, Note am Ende)
// ---------------------------------------------------------------------
function starteTest(lektion) {
  setNav([el("button", { class: "secondary", onclick: () => zeigeLektionDetail(lektion.name) }, "← Abbrechen")]);

  const fragen = shuffle([
    ...lektion.vokabeln.map(v => ({ ...v, richtung: "de-en" })),
    ...lektion.vokabeln.map(v => ({ ...v, richtung: "en-de" })),
  ]);
  const ergebnisse = [];
  let index = 0;

  function frageText(f) { return f.richtung === "de-en" ? f.de : f.en; }
  function antwortText(f) { return f.richtung === "de-en" ? f.en : f.de; }

  function zeigeFrage() {
    content.innerHTML = "";
    if (index >= fragen.length) { testAbschluss(); return; }

    const f = fragen[index];
    const box = el("div", { class: "frage-box card" });
    box.appendChild(el("div", { class: "fortschritt" }, `Test · Frage ${index + 1} / ${fragen.length}`));
    box.appendChild(el("div", { class: "wort" }, frageText(f)));

    const input = el("input", { type: "text", class: "antwort-input" });
    const feedback = el("div", { class: "feedback" });
    box.appendChild(input);
    box.appendChild(feedback);

    const weiterBtn = el("button", { onclick: () => weiter() }, "Prüfen");
    box.appendChild(el("div", { class: "row" }, [weiterBtn]));
    content.appendChild(box);
    input.focus();

    let ausgewertet = false;
    function auswerten() {
      if (ausgewertet) return;
      ausgewertet = true;
      const antwortSprache = f.richtung === "de-en" ? "en" : "de";
      const richtig = istRichtig(input.value, antwortText(f), antwortSprache);
      input.disabled = true;
      weiterBtn.textContent = "Weiter";
      if (richtig) {
        feedback.textContent = "Richtig!";
        feedback.className = "feedback richtig";
      } else {
        feedback.textContent = `Falsch. Richtig wäre: ${antwortText(f)}`;
        feedback.className = "feedback falsch";
      }
      ergebnisse.push({ de: f.de, en: f.en, richtung: f.richtung, gegeben: input.value, richtig });
      // Fokuswechsel erst nach dem aktuellen Tastendruck, sonst löst derselbe
      // Enter-Druck sofort auch den fokussierten Button aus.
      setTimeout(() => weiterBtn.focus(), 0);
    }

    function weiter() {
      if (!ausgewertet) { auswerten(); return; }
      index++;
      zeigeFrage();
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); weiter(); }
    });
  }

  async function testAbschluss() {
    const punkte = ergebnisse.filter(e => e.richtig).length;
    const maxPunkte = ergebnisse.length;
    const prozent = maxPunkte > 0 ? (punkte / maxPunkte) * 100 : 0;
    const note = noteBerechnen(prozent);

    content.innerHTML = "";
    const card = el("div", { class: "card" });
    card.appendChild(el("h2", {}, "Test beendet"));
    card.appendChild(el("div", { class: "ergebnis-note" }, `Note ${note}`));
    card.appendChild(el("p", {}, `${punkte} von ${maxPunkte} Punkten (${prozent.toFixed(1)} %)`));

    const tabelle = el("table", { class: "ergebnis-tabelle" });
    tabelle.appendChild(el("tr", {}, [
      el("th", {}, "Deutsch"), el("th", {}, "Englisch"), el("th", {}, "Richtung"),
      el("th", {}, "Deine Antwort"), el("th", {}, "Ergebnis"),
    ]));
    for (const e of ergebnisse) {
      tabelle.appendChild(el("tr", {}, [
        el("td", {}, e.de), el("td", {}, e.en),
        el("td", {}, e.richtung === "de-en" ? "DE→EN" : "EN→DE"),
        el("td", {}, e.gegeben || "–"),
        el("td", { class: e.richtig ? "tag-richtig" : "tag-falsch" }, e.richtig ? "richtig" : "falsch"),
      ]));
    }
    card.appendChild(tabelle);
    card.appendChild(el("div", { class: "row" }, [
      el("button", { onclick: () => zeigeLektionDetail(lektion.name) }, "Zurück zur Lektion"),
    ]));
    content.appendChild(card);

    try {
      await api("/log/test", {
        method: "POST",
        body: JSON.stringify({
          lektion: lektion.name, ergebnisse, punkte, max_punkte: maxPunkte, prozent, note,
        }),
      });
    } catch (err) {
      console.error("Logging fehlgeschlagen:", err);
    }
  }

  zeigeFrage();
}

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------
zeigeStartseite();
