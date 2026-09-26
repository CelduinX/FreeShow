# Eigene Anpassungen und offizielle FreeShow-Releases

Der Branch `personal` ist die Version dieses Forks für eigene Änderungen. Er
startet bei der letzten stabilen Veröffentlichung von FreeShow. Der Branch
`main` bleibt als unveränderte Referenz zum offiziellen Entwicklungsstand
erhalten. Dort können bereits Beta-Versionen liegen.

## Eigene Änderungen

Arbeite auf einem neuen Branch, der von `personal` abzweigt, und übernimm die
Änderungen anschließend per Pull Request nach `personal`. So bleiben deine
Commits erhalten, wenn ein neues offizielles Release hinzukommt.

```bash
git clone https://github.com/CelduinX/FreeShow.git
cd FreeShow
git switch personal
git switch -c meine-aenderung
# Dateien ändern, committen und den Branch zu GitHub pushen.
```

## Offizielle Releases

Der Workflow [Sync official stable release](.github/workflows/sync-official-release.yml)
fragt täglich das neueste **stabile** Release von `ChurchApps/FreeShow` ab.
Er führt dessen Tag mit `personal` zusammen, baut die Anwendung und pusht
erst nach erfolgreichem Build. Er kann auch im GitHub-Tab **Actions** manuell
gestartet werden. Releases erscheinen damit nach dem nächsten erfolgreichen
Workflow-Lauf im Fork; GitHub Actions startet geplante Läufe nicht exakt zur
angegebenen Minute.

Falls Änderungen kollidieren oder der Build fehlschlägt, endet der Workflow
mit einem Fehler. Der Branch bleibt auf dem letzten funktionierenden Stand.
Prüfe dann das Workflow-Protokoll, löse den Konflikt lokal und pushe das
Ergebnis nach `personal`:

```bash
git switch personal
git pull --ff-only origin personal
git remote add upstream https://github.com/ChurchApps/FreeShow.git
git fetch upstream --tags
git merge --no-ff vX.Y.Z
# Konflikte lösen, danach: git add <dateien> && git commit
npm ci
npm run build
git push origin personal
```

Ersetze `vX.Y.Z` durch den Tag des aktuellen offiziellen stabilen Releases.
Falls `upstream` schon vorhanden ist, überspringe `git remote add upstream`.
