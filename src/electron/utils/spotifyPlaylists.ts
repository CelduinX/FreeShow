import axios from "axios"
import { randomBytes, createHash } from "crypto"
import { app, safeStorage, shell } from "electron"
import Store from "electron-store"
import { createServer } from "http"
import type { SpotifyPlaylist, SpotifyRequest, SpotifyResult, SpotifyTrack } from "../../types/Spotify"

const redirectUri = "http://127.0.0.1:43827/spotify/callback"
const scopes = "playlist-read-private playlist-read-collaborative user-modify-playback-state"
const api = "https://api.spotify.com/v1"
let store: Store<{ clientId: string; refreshToken: string }> | undefined
const credentials = () => (store ||= new Store({ name: "spotify-account", defaults: { clientId: "", refreshToken: "" } }))
let accessToken = ""
let expiresAt = 0
let refreshPromise: Promise<string> | undefined
let cancelLogin: (() => void) | undefined
let generation = 0
const playlists = new Map<string, SpotifyPlaylist>()
const tracks = new Map<string, Map<number, SpotifyTrack>>()

function saveTokens(data: any, clientId: string, session: number) {
    if (session !== generation) throw new Error("Spotify-Anmeldung wurde abgebrochen.")
    if (!data.access_token) throw new Error("Spotify hat keinen Zugriffstoken zurückgegeben.")
    if (data.refresh_token) credentials().set("refreshToken", safeStorage.encryptString(data.refresh_token).toString("base64"))
    credentials().set("clientId", clientId)
    accessToken = data.access_token
    expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000
}

async function token() {
    if (accessToken && expiresAt > Date.now() + 30000) return accessToken
    if (refreshPromise) return refreshPromise
    const session = generation
    refreshPromise = (async () => {
        if (!safeStorage.isEncryptionAvailable() || !credentials().get("refreshToken")) throw new Error("Bitte Spotify verbinden.")
        const refreshToken = safeStorage.decryptString(Buffer.from(credentials().get("refreshToken"), "base64"))
        try {
            const { data } = await axios.post("https://accounts.spotify.com/api/token", new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: credentials().get("clientId") }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 })
            saveTokens(data, credentials().get("clientId"), session)
            return accessToken
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 400 && session === generation) disconnect()
            throw error
        }
    })()
    try {
        return await refreshPromise
    } finally {
        refreshPromise = undefined
    }
}

async function request(path: string, method: "GET" | "PUT" = "GET", data?: object, retry = true): Promise<any> {
    const session = generation
    const bearer = await token()
    if (session !== generation) throw new Error("Spotify-Verbindung wurde getrennt.")
    try {
        const response = await axios.request({ url: api + path, method, data, headers: { Authorization: `Bearer ${bearer}` }, timeout: 15000 })
        if (session !== generation) throw new Error("Spotify-Verbindung wurde getrennt.")
        return response.data
    } catch (error) {
        if (retry && session === generation && axios.isAxiosError(error) && error.response?.status === 401) {
            accessToken = ""
            return request(path, method, data, false)
        }
        throw error
    }
}

function disconnect() {
    generation++
    cancelLogin?.()
    accessToken = ""
    expiresAt = 0
    playlists.clear()
    tracks.clear()
    credentials().delete("refreshToken")
}

async function connect(clientId: string) {
    if (!/^[a-f\d]{32}$/i.test(clientId)) throw new Error("Bitte eine gültige Spotify Client-ID eingeben.")
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Die sichere Speicherung der Spotify-Anmeldung ist nicht verfügbar.")
    if (cancelLogin) throw new Error("Die Spotify-Anmeldung läuft bereits.")
    const session = ++generation
    const verifier = randomBytes(64).toString("base64url")
    const state = randomBytes(32).toString("hex")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    const code = await new Promise<string>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error, value?: string) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            cancelLogin = undefined
            server.close()
            if (error) reject(error)
            else resolve(value!)
        }
        const server = createServer((req, res) => {
            const url = new URL(req.url || "/", redirectUri)
            if (url.pathname !== "/spotify/callback" || url.searchParams.get("state") !== state) {
                res.writeHead(400).end("Invalid Spotify callback")
                return
            }
            const code = url.searchParams.get("code")
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(code ? "Spotify-Anmeldung empfangen. Du kannst dieses Fenster schließen und zu FreeShow zurückkehren." : "Spotify-Anmeldung abgebrochen.")
            finish(code ? undefined : new Error("Spotify-Anmeldung wurde abgebrochen."), code || undefined)
        })
        const timer = setTimeout(() => finish(new Error("Spotify-Anmeldung hat zu lange gedauert. Bitte erneut verbinden.")), 180000)
        cancelLogin = () => finish(new Error("Spotify-Anmeldung wurde abgebrochen."))
        server.once("error", () => finish(new Error("Spotify-Anmeldung konnte nicht gestartet werden. Ist Port 43827 bereits belegt?")))
        server.listen(43827, "127.0.0.1", () => {
            const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: scopes, state, code_challenge_method: "S256", code_challenge: challenge })
            shell.openExternal(`https://accounts.spotify.com/authorize?${params}`).catch(() => finish(new Error("Der Browser für die Spotify-Anmeldung konnte nicht geöffnet werden.")))
        })
    })
    const { data } = await axios.post("https://accounts.spotify.com/api/token", new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 })
    saveTokens(data, clientId, session)
    playlists.clear()
    tracks.clear()
}

app.once("before-quit", () => cancelLogin?.())

export async function spotifyLibrary(input: SpotifyRequest): Promise<SpotifyResult> {
    try {
        switch (input.action) {
            case "status":
                return { connected: !!credentials().get("refreshToken"), clientId: credentials().get("clientId") }
            case "connect":
                await connect(input.clientId.trim())
                return { connected: true }
            case "disconnect":
                disconnect()
                return { connected: false }
            case "playlists": {
                validateOffset(input.offset)
                const page = await request(`/me/playlists?limit=50&offset=${input.offset}`)
                if (input.offset === 0) {
                    playlists.clear()
                    tracks.clear()
                }
                const rows: SpotifyPlaylist[] = (page.items || []).filter(Boolean).map((p: any) => ({ id: p.id, name: p.name, image: p.images?.[0]?.url, total: p.items?.total ?? p.tracks?.total ?? 0 }))
                rows.forEach((p) => playlists.set(p.id, p))
                return { playlists: rows, nextOffset: page.next ? input.offset + page.items.length : null }
            }
            case "tracks": {
                validateOffset(input.offset)
                if (!playlists.has(input.playlistId)) throw new Error("Bitte eine deiner geladenen Playlists auswählen.")
                const page = await request(`/playlists/${encodeURIComponent(input.playlistId)}/items?limit=50&offset=${input.offset}`)
                const rows: SpotifyTrack[] = (page.items || []).map((entry: any, index: number) => {
                    const item = entry.item ?? entry.track
                    return { name: item?.name || "Nicht verfügbar", artist: item?.artists?.map((a: any) => a.name).join(", ") || "", durationMs: item?.duration_ms || 0, position: input.offset + index, playable: !!item && item.type === "track" && !entry.is_local && !item.is_local && item.is_playable !== false && !item.restrictions }
                })
                if (input.offset === 0 || !tracks.has(input.playlistId)) tracks.set(input.playlistId, new Map())
                rows.forEach((t) => tracks.get(input.playlistId)!.set(t.position, t))
                return { tracks: rows, nextOffset: page.next ? input.offset + page.items.length : null }
            }
            case "play":
                if (!playlists.has(input.playlistId) || !tracks.get(input.playlistId)?.get(input.position)?.playable) throw new Error("Bitte einen verfügbaren Titel aus der Playlist auswählen.")
                await request("/me/player/play", "PUT", { context_uri: `spotify:playlist:${input.playlistId}`, offset: { position: input.position }, position_ms: 0 })
                return {}
        }
        throw new Error("Ungültige Spotify-Anfrage.")
    } catch (error) {
        let message = error instanceof Error ? error.message : "Spotify ist nicht erreichbar."
        if (axios.isAxiosError(error)) {
            const status = error.response?.status
            message =
                status === 404
                    ? "Bitte Spotify öffnen und dort ein Wiedergabegerät aktivieren. Danach den Titel erneut auswählen."
                    : status === 403
                      ? "Spotify verweigert den Zugriff. Premium und die Freigabe deines Kontos in der Spotify-App prüfen. Playlist-Titel sind nur für eigene oder gemeinsame Playlists verfügbar."
                      : status === 429
                        ? `Spotify-Anfragelimit erreicht. Bitte in ${error.response?.headers["retry-after"] || 30} Sekunden erneut versuchen.`
                        : status === 400 || status === 401
                          ? "Spotify-Anmeldung ist ungültig. Bitte erneut verbinden und Client-ID sowie Redirect-URI prüfen."
                          : "Spotify ist nicht erreichbar. Bitte später erneut versuchen."
        }
        return { error: message, connected: !!credentials().get("refreshToken") }
    }
}

function validateOffset(offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Ungültige Playlist-Seite.")
}
