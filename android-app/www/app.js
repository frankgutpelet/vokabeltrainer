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
  // Android-App: Daten liegen lokal auf dem Gerät (lokal.js), kein Server nötig
  if (window.LOKAL_MODUS) return lokalApi(path, options);
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

// Beim Vergleich werden Leerzeichen und Satzzeichen komplett ignoriert,
// nur Buchstaben und Ziffern zählen.
function normalisieren(s) {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalisierenCS(s) {
  return (s || "").replace(/[^\p{L}\p{N}]/gu, "");
}

// ---------------------------------------------------------------------
// Sprachausgabe (Web Speech API im Browser)
// ---------------------------------------------------------------------
function sprich(text, sprache) {
  if (!("speechSynthesis" in window) || !text) return;
  const lang = sprache === "en" ? "en-GB" : "de-DE";
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const stimmen = window.speechSynthesis.getVoices();
  const passend = stimmen.find(v => v.lang === lang) ||
                  stimmen.find(v => v.lang.startsWith(lang.slice(0, 2)));
  if (passend) u.voice = passend;
  window.speechSynthesis.speak(u);
}

// Legt neben "Weiter" einen Button zum erneuten Anhören an (Taste R, wenn "Weiter" fokussiert ist).
function erzeugeSprechenBtn() {
  const btn = el("button", { class: "secondary" }, "🔊 Nochmal anhören (R)");
  btn.disabled = true;
  return btn;
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
  const startButtons = [neueBtn];
  if (window.LOKAL_MODUS) {
    startButtons.push(el("button", { class: "secondary", onclick: () => zeigeProtokoll() }, "Protokoll"));
  }
  content.appendChild(el("div", { class: "card" }, [
    el("div", { class: "row" }, startButtons),
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

// Nur in der Android-App: Protokoll (Ersatz für die Server-Logdatei) anzeigen
function zeigeProtokoll() {
  setNav([el("button", { class: "secondary", onclick: () => zeigeStartseite() }, "← Zurück")]);
  content.innerHTML = "";
  const pre = el("pre", { style: "white-space:pre-wrap;font-size:0.8rem;max-height:60vh;overflow:auto;" }, lokalLogLesen() || "(leer)");
  const kopieren = el("button", { class: "secondary", onclick: async () => {
    try { await navigator.clipboard.writeText(lokalLogLesen()); alert("In die Zwischenablage kopiert."); }
    catch (e) { alert("Kopieren nicht möglich."); }
  } }, "Kopieren");
  const leeren = el("button", { class: "secondary", onclick: () => {
    if (confirm("Protokoll wirklich löschen?")) { lokalLogLoeschen(); zeigeProtokoll(); }
  } }, "Löschen");
  content.appendChild(el("div", { class: "card" }, [
    el("h2", {}, "Protokoll"), pre, el("div", { class: "row" }, [kopieren, leeren]),
  ]));
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

  card.appendChild(el("div", { class: "row" }, [hinzufuegenBtn]));

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
      const sprechenBtn = erzeugeSprechenBtn();
      box.appendChild(el("div", { class: "row" }, [weiterBtn, sprechenBtn]));
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
        const sprechText = antwortText(v);
        const sprechen = () => sprich(sprechText, antwortSprache);
        sprechenBtn.disabled = false;
        sprechenBtn.onclick = sprechen;
        weiterBtn.addEventListener("keydown", (e) => {
          if (e.key.toLowerCase() === "r") { e.preventDefault(); sprechen(); }
        });
        if (richtig) {
          feedback.textContent = "Richtig!";
          feedback.className = "feedback richtig";
        } else {
          feedback.textContent = `Falsch. Richtig wäre: ${antwortText(v)}`;
          feedback.className = "feedback falsch";
          falscheDieserRunde.push(v);
        }
        sprechen(); // Wort nach der Anzeige von richtig/falsch vorlesen
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
    const sprechenBtn = erzeugeSprechenBtn();
    box.appendChild(el("div", { class: "row" }, [weiterBtn, sprechenBtn]));
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
      const sprechText = antwortText(f);
      const sprechen = () => sprich(sprechText, antwortSprache);
      sprechenBtn.disabled = false;
      sprechenBtn.onclick = sprechen;
      weiterBtn.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "r") { e.preventDefault(); sprechen(); }
      });
      if (richtig) {
        feedback.textContent = "Richtig!";
        feedback.className = "feedback richtig";
      } else {
        feedback.textContent = `Falsch. Richtig wäre: ${antwortText(f)}`;
        feedback.className = "feedback falsch";
      }
      sprechen(); // Wort nach der Anzeige von richtig/falsch vorlesen
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
