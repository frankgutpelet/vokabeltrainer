"""
Vokabeltrainer Backend
-----------------------
FastAPI-Server, der:
- Lektionen (Vokabellisten) als JSON-Dateien auf dem Server speichert
- Abfrage- und Test-Ergebnisse entgegennimmt
- alle Aktionen, Ergebnisse und Fehler in eine Logdatei schreibt
"""

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pfade
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
LEKTIONEN_DIR = BASE_DIR / "lektionen"
LOG_DIR = BASE_DIR / "logs"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

LEKTIONEN_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger("vokabeltrainer")
logger.setLevel(logging.INFO)
handler = logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8")
handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
logger.addHandler(handler)

# ---------------------------------------------------------------------------
# Datenmodelle
# ---------------------------------------------------------------------------
class Vokabel(BaseModel):
    de: str
    en: str


class LektionCreate(BaseModel):
    name: str
    vokabeln: List[Vokabel] = Field(default_factory=list)


class Lektion(BaseModel):
    name: str
    vokabeln: List[Vokabel]


class EinzelErgebnis(BaseModel):
    de: str
    en: str
    richtung: str          # "de-en" oder "en-de"
    gegeben: str
    richtig: bool


class AbfrageLog(BaseModel):
    lektion: str
    richtung: str
    ergebnisse: List[EinzelErgebnis]


class TestLog(BaseModel):
    lektion: str
    ergebnisse: List[EinzelErgebnis]
    punkte: int
    max_punkte: int
    prozent: float
    note: int


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------
def sichere_dateiname(name: str) -> str:
    """Verhindert Path-Traversal und ungültige Dateinamen."""
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Lektionsname darf nicht leer sein.")
    if not re.match(r"^[A-Za-z0-9_\- äöüÄÖÜß]+$", name):
        raise HTTPException(status_code=400, detail="Ungültige Zeichen im Lektionsnamen.")
    return name


def lektion_pfad(name: str) -> Path:
    return LEKTIONEN_DIR / f"{sichere_dateiname(name)}.json"


def note_berechnen(prozent: float) -> int:
    """
    Standard-Notenschlüssel Gymnasium (6-stufig, KMK-Schema), 5. Klasse.
    """
    if prozent >= 92:
        return 1
    elif prozent >= 81:
        return 2
    elif prozent >= 67:
        return 3
    elif prozent >= 50:
        return 4
    elif prozent >= 30:
        return 5
    else:
        return 6


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Vokabeltrainer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as exc:
        logger.error("Unbehandelter Fehler bei %s %s: %s", request.method, request.url.path, exc)
        raise


# ---------------------------------------------------------------------------
# Lektionen-Endpunkte
# ---------------------------------------------------------------------------
@app.get("/api/lektionen")
def lektionen_liste():
    namen = sorted(p.stem for p in LEKTIONEN_DIR.glob("*.json"))
    return {"lektionen": namen}


@app.get("/api/lektionen/{name}", response_model=Lektion)
def lektion_laden(name: str):
    pfad = lektion_pfad(name)
    if not pfad.exists():
        logger.warning("Lektion nicht gefunden: %s", name)
        raise HTTPException(status_code=404, detail="Lektion nicht gefunden.")
    with pfad.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data


@app.post("/api/lektionen", response_model=Lektion)
def lektion_anlegen(lektion: LektionCreate):
    pfad = lektion_pfad(lektion.name)
    if pfad.exists():
        raise HTTPException(status_code=409, detail="Lektion existiert bereits.")
    data = {"name": lektion.name, "vokabeln": [v.dict() for v in lektion.vokabeln]}
    with pfad.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info("Lektion angelegt: '%s' mit %d Vokabeln", lektion.name, len(lektion.vokabeln))
    return data


@app.put("/api/lektionen/{name}", response_model=Lektion)
def lektion_aktualisieren(name: str, lektion: LektionCreate):
    pfad = lektion_pfad(name)
    if not pfad.exists():
        raise HTTPException(status_code=404, detail="Lektion nicht gefunden.")
    data = {"name": name, "vokabeln": [v.dict() for v in lektion.vokabeln]}
    with pfad.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info("Lektion aktualisiert: '%s', jetzt %d Vokabeln", name, len(lektion.vokabeln))
    return data


@app.delete("/api/lektionen/{name}")
def lektion_loeschen(name: str):
    pfad = lektion_pfad(name)
    if not pfad.exists():
        raise HTTPException(status_code=404, detail="Lektion nicht gefunden.")
    pfad.unlink()
    logger.info("Lektion gelöscht: '%s'", name)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Logging-Endpunkte für Abfrage & Test
# ---------------------------------------------------------------------------
@app.post("/api/log/abfrage")
def abfrage_loggen(log: AbfrageLog):
    logger.info("=== ABFRAGE gestartet | Lektion='%s' Richtung=%s ===", log.lektion, log.richtung)
    richtige = 0
    for e in log.ergebnisse:
        status = "RICHTIG" if e.richtig else "FALSCH"
        if e.richtig:
            richtige += 1
        else:
            logger.warning(
                "Abfrage-Fehler | Lektion='%s' Frage='%s' Erwartet='%s' Gegeben='%s' Richtung=%s",
                log.lektion, e.de if e.richtung == "de-en" else e.en,
                e.en if e.richtung == "de-en" else e.de, e.gegeben, e.richtung,
            )
        logger.info(
            "Abfrage | %s | de='%s' en='%s' gegeben='%s'",
            status, e.de, e.en, e.gegeben,
        )
    logger.info(
        "=== ABFRAGE beendet | Lektion='%s' Richtig=%d/%d ===",
        log.lektion, richtige, len(log.ergebnisse),
    )
    return {"status": "ok"}


@app.post("/api/log/test")
def test_loggen(log: TestLog):
    logger.info(
        "=== TEST gestartet | Lektion='%s' Anzahl Fragen=%d ===",
        log.lektion, len(log.ergebnisse),
    )
    for e in log.ergebnisse:
        status = "RICHTIG" if e.richtig else "FALSCH"
        if not e.richtig:
            logger.warning(
                "Test-Fehler | Lektion='%s' de='%s' en='%s' Richtung=%s Gegeben='%s'",
                log.lektion, e.de, e.en, e.richtung, e.gegeben,
            )
        logger.info(
            "Test | %s | de='%s' en='%s' Richtung=%s gegeben='%s'",
            status, e.de, e.en, e.richtung, e.gegeben,
        )
    logger.info(
        "=== TEST beendet | Lektion='%s' Punkte=%d/%d (%.1f%%) Note=%d ===",
        log.lektion, log.punkte, log.max_punkte, log.prozent, log.note,
    )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Frontend ausliefern (gleiche Origin, kein CORS-Ärger)
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
