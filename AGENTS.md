# Hinweise für Änderungen an diesem FreeShow-Fork

- `personal` ist der Standardbranch für die nutzbare Version: das neueste erfolgreich übernommene **stabile** Release von `ChurchApps/FreeShow` plus eigene Änderungen.
- `main` enthält den offiziellen Entwicklungsstand und kann Beta-Versionen enthalten. Verwende für Release-Updates die offiziellen stabilen Release-Tags, nicht den Stand von `main`.
- Beginne eigene Änderungen auf einem Branch von `personal` und führe sie anschließend per Pull Request in `personal` zusammen. Erhalte die Git-Historie; setze `personal` nicht per Force-Push auf einen anderen Stand zurück.
- Der Workflow `.github/workflows/sync-official-release.yml` prüft täglich das neueste offizielle stabile Release, führt dessen Tag mit `personal` zusammen, baut die Anwendung und pusht erst bei erfolgreichem Build. Er lässt sich auch manuell starten.
- Wenn ein Release-Merge Konflikte oder Build-Fehler verursacht, untersuche den fehlgeschlagenen Workflow-Lauf, löse die Ursache und prüfe mindestens `npm ci` und `npm run build`, bevor du `personal` aktualisierst. Überschreibe dabei keine eigenen Anpassungen.
- Die ausführliche Anleitung steht in `FORK_UPDATES.md`. Halte sie und diesen Hinweis aktuell, wenn du die Branch- oder Release-Strategie änderst.
