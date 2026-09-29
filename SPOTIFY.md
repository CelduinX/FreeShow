# Spotify in der rechten Sidebar

Unter der vorhandenen lokalen Mediensteuerung zeigt FreeShow deine Spotify-Playlists.
Eine Playlist öffnet ihre Titel; ein Klick auf einen verfügbaren Titel startet die
Wiedergabe auf dem aktiven Spotify-Gerät im Kontext der Playlist. Es gibt keine
freie Suche. Große Playlists und Playlistlisten werden über „Mehr laden“ geladen.

## Einmalige Einrichtung

1. Öffne https://developer.spotify.com/dashboard und erstelle eine Spotify-App
   mit Web-API-Zugriff.
2. Trage exakt `http://127.0.0.1:43827/spotify/callback` als Redirect-URI ein.
3. Kopiere die Client-ID in den Spotify-Bereich von FreeShow. Ein Client-Secret
   wird nicht benötigt.
4. Klicke „Spotify verbinden“ und erlaube den Zugriff im Browser. Bei einer App
   im Development Mode muss das verwendete Konto als Nutzer freigegeben sein.
5. Öffne Spotify auf dem gewünschten Gerät und aktiviere dort die Wiedergabe.
   Danach kannst du Titel aus FreeShow starten.

Spotify Premium ist für die Web-API-Wiedergabesteuerung erforderlich. Spotify
beschränkt den Titelzugriff bei Development-Mode-Apps auf eigene und gemeinsame
Playlists. Andere gespeicherte Playlists können in der Liste erscheinen, aber
beim Öffnen einen Zugriffshinweis auslösen.

„Trennen“ entfernt den gespeicherten Wiederanmeldeschlüssel. Eine laufende
Anmeldung kann mit „Abbrechen“ beendet werden. Die Client-ID bleibt für eine
erneute Anmeldung erhalten. Um die Freigabe bei Spotify selbst zu entfernen,
verwende die App-Verwaltung deines Spotify-Kontos.

## Technik

Die Anmeldung verwendet Authorization Code mit PKCE und einen lokalen Callback
auf `127.0.0.1:43827`. Der Browser erhält einen zufälligen OAuth-State; ungültige
Callbacks werden abgewiesen. Die Anmeldung endet nach drei Minuten. Refresh-Tokens
liegen im separaten Electron-Store `spotify-account`, verschlüsselt mit Electrons
`safeStorage`; Zugriffstokens bleiben im Hauptprozess im Arbeitsspeicher. Es
werden keine Spotify-Tokens an das Frontend geschickt oder in die FreeShow-Daten
übernommen. Ein System ohne sichere Token-Verschlüsselung kann sich nicht anmelden.

Die Integration liest `/me/playlists` und `/playlists/{id}/items` und startet über
`/me/player/play` einen Titel anhand seiner ursprünglichen Playlistposition.
Nicht verfügbare Titel, lokale Dateien und Podcasts sind nicht auswählbar.
Die bestehende lokale Mediensteuerung bleibt unabhängig davon nutzbar.

Referenzen:
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback
