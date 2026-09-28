# Vokabeltrainer – Android-App

Gleiche Oberfläche wie die Web-Version, aber **ohne Server**: Lektionen und Protokoll liegen
lokal im Speicher der App (Button „Protokoll“ auf der Startseite ersetzt die Server-Logdatei).
Technik: Capacitor (WebView), Code wird mit `../frontend` geteilt.

## Variante A: APK per GitHub bauen (ohne Android Studio)
1. Das ganze Projekt (`vokabeltrainer/` mit `frontend/`, `android-app/` und `.github/`) in ein GitHub-Repo pushen.
2. Im Repo: Actions → „APK bauen“ → Run workflow.
3. Fertige `app-debug.apk` als Artifact herunterladen und auf dem Handy installieren
   (Installation aus unbekannten Quellen erlauben).

## Variante B: lokal mit Android Studio
```bash
cd android-app
npm install
npm run android:add     # legt das Android-Projekt an
npm run android:sync    # kopiert die Web-App hinein
npm run android:open    # öffnet Android Studio -> Run / Build > Build APK
```
Nach Änderungen an `frontend/` oder `lokal.js` genügt `npm run android:sync`.

## Hinweise
- Sprachausgabe nutzt die Android-Sprachausgabe der System-WebView (Sprachpakete Deutsch/Englisch
  in den Android-Einstellungen installiert haben).
- Daten liegen nur auf dem Gerät; bei App-Deinstallation sind sie weg.
