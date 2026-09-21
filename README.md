# Vokabeltrainer

## Struktur
- `backend/` – FastAPI-Server (main.py), speichert Lektionen als JSON in `backend/lektionen/`
  und schreibt alle Aktionen/Ergebnisse/Fehler in `backend/logs/app.log`
- `frontend/` – Vanilla-JS-Frontend, wird vom Backend automatisch mit ausgeliefert

## Starten

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Dann im Browser öffnen: http://localhost:8000/

## Funktionen
- Lektion anlegen (Name + beliebig viele Deutsch/Englisch-Vokabelpaare), gespeichert als
  `backend/lektionen/<Name>.json`
- Lektion öffnen, Vokabeln nachträglich bearbeiten oder löschen
- **Abfragen**: Richtung wählbar (Deutsch→Englisch oder Englisch→Deutsch). Falsch beantwortete
  Vokabeln werden sofort mit der richtigen Lösung angezeigt und am Ende der Runde erneut
  abgefragt (Wiederholungsrunden, bis alles sitzt).
- **Test starten**: jede Vokabel wird in beiden Richtungen abgefragt. Falsch beantwortete
  Vokabeln werden nicht wiederholt, es werden nur Punkte gezählt. Am Ende wird die Note nach
  dem Standard-Notenschlüssel für Gymnasium (6-stufig) berechnet:
  - 92–100 % → Note 1
  - 81–91 %  → Note 2
  - 67–80 %  → Note 3
  - 50–66 %  → Note 4
  - 30–49 %  → Note 5
  - 0–29 %   → Note 6
- Jede Abfrage- und Test-Sitzung wird inkl. aller Einzelergebnisse und Fehler in
  `backend/logs/app.log` protokolliert.
