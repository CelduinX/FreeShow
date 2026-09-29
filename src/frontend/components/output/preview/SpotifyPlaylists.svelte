<script lang="ts">
    import { onMount, onDestroy } from "svelte"
    import { Main } from "../../../../types/IPC/Main"
    import type { SpotifyPlaylist, SpotifyRequest, SpotifyResult, SpotifyTrack } from "../../../../types/Spotify"
    import { requestMain, sendMain } from "../../../IPC/main"
    import { language } from "../../../stores"
    import Icon from "../../helpers/Icon.svelte"
    import { spotifyIsFading } from "./SpotifyManager"

    const labels = {
        de: {
            playlists: "Meine Playlists",
            connect: "Spotify verbinden",
            disconnect: "Trennen",
            refresh: "Aktualisieren",
            back: "Playlists",
            more: "Mehr laden",
            loading: "Wird geladen …",
            empty: "Keine Playlists vorhanden.",
            noTracks: "Diese Playlist enthält keine Titel.",
            cancel: "Abbrechen",
            unavailable: "Nicht verfügbar",
            setup: "Einmalige Einrichtung: Erstelle eine App im Spotify Developer Dashboard und trage diese Redirect-URI ein:",
            premium: "Zur Wiedergabe brauchst du Spotify Premium und ein aktives Spotify-Gerät.",
            dashboard: "Developer Dashboard öffnen",
            failed: "Spotify antwortet nicht. Bitte erneut versuchen.",
            playing: "Wiedergabe gestartet"
        },
        en: {
            playlists: "My playlists",
            connect: "Connect Spotify",
            disconnect: "Disconnect",
            refresh: "Refresh",
            back: "Playlists",
            more: "Load more",
            loading: "Loading …",
            empty: "No playlists found.",
            noTracks: "This playlist has no tracks.",
            cancel: "Cancel",
            unavailable: "Unavailable",
            setup: "One-time setup: Create an app in the Spotify Developer Dashboard and register this redirect URI:",
            premium: "Playback requires Spotify Premium and an active Spotify device.",
            dashboard: "Open Developer Dashboard",
            failed: "Spotify did not respond. Please try again.",
            playing: "Playback started"
        }
    }
    $: text = $language === "de" ? labels.de : labels.en
    let connected = false
    let initialized = false
    let clientId = ""
    let busy = false
    let error = ""
    let notice = ""
    let selected: SpotifyPlaylist | null = null
    let playlists: SpotifyPlaylist[] = []
    let tracks: SpotifyTrack[] = []
    let nextOffset: number | null = null
    let currentPosition: number | null = null
    let revision = 0
    let destroyed = false

    async function call(input: SpotifyRequest): Promise<SpotifyResult> {
        const result = await requestMain(Main.SPOTIFY_LIBRARY, input, undefined, input.action === "connect" ? 220000 : 45000)
        return result || { error: text.failed }
    }

    async function run(input: SpotifyRequest, apply: (result: SpotifyResult) => void) {
        const version = ++revision
        busy = true
        error = notice = ""
        try {
            const result = await call(input)
            if (destroyed || version !== revision) return
            if (result.connected !== undefined) connected = result.connected
            if (result.error) error = result.error
            else apply(result)
        } catch {
            if (!destroyed && version === revision) error = text.failed
        } finally {
            if (!destroyed && version === revision) busy = false
        }
    }

    async function loadPlaylists(offset = 0) {
        selected = null
        tracks = []
        currentPosition = null
        if (!offset) nextOffset = null
        await run({ action: "playlists", offset }, (result) => {
            playlists = offset ? [...playlists, ...(result.playlists || [])] : result.playlists || []
            nextOffset = result.nextOffset ?? null
        })
    }

    async function loadTracks(playlist: SpotifyPlaylist, offset = 0) {
        selected = playlist
        if (!offset) {
            tracks = []
            nextOffset = null
            currentPosition = null
        }
        await run({ action: "tracks", playlistId: playlist.id, offset }, (result) => {
            tracks = offset ? [...tracks, ...(result.tracks || [])] : result.tracks || []
            nextOffset = result.nextOffset ?? null
        })
    }

    async function connect() {
        await run({ action: "connect", clientId }, () => {})
        if (connected && !error && !destroyed) await loadPlaylists()
    }

    async function disconnect() {
        await run({ action: "disconnect" }, () => {
            selected = null
            playlists = []
            tracks = []
            nextOffset = null
            currentPosition = null
        })
    }

    async function play(track: SpotifyTrack) {
        if (!selected || $spotifyIsFading) return
        await run({ action: "play", playlistId: selected.id, position: track.position }, () => {
            currentPosition = track.position
            notice = `${text.playing}: ${track.name}`
        })
    }

    function duration(ms: number) {
        const seconds = Math.floor(ms / 1000)
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    }

    onMount(async () => {
        await run({ action: "status" }, (result) => (clientId = result.clientId || ""))
        initialized = true
        if (connected && !destroyed) await loadPlaylists()
    })
    onDestroy(() => {
        destroyed = true
        revision++
    })
</script>

<section class="spotify-library" aria-label="Spotify">
    <header>
        <Icon id="spotify" color="#1db954" size={1} />
        <strong>Spotify</strong>
        {#if connected}
            <button disabled={busy} on:click={() => (selected ? loadTracks(selected) : loadPlaylists())} title={text.refresh}>{text.refresh}</button>
            <button on:click={disconnect}>{text.disconnect}</button>
        {/if}
    </header>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#if !initialized}
        <p role="status">{text.loading}</p>
    {:else if !connected}
        <p>{text.setup}</p>
        <code>http://127.0.0.1:43827/spotify/callback</code>
        <button class="link" on:click={() => sendMain(Main.URL, "https://developer.spotify.com/dashboard")}>{text.dashboard}</button>
        <label>Client ID<input bind:value={clientId} disabled={busy} autocomplete="off" spellcheck={false} placeholder="Spotify Client ID" /></label>
        <p>{text.premium}</p>
        <button class="connect" disabled={busy || !clientId.trim()} on:click={connect}>{busy ? text.loading : text.connect}</button>
        {#if busy}<button on:click={disconnect}>{text.cancel}</button>{/if}
    {:else}
        <div class="heading">
            {#if selected}<button disabled={busy} on:click={() => loadPlaylists()}>← {text.back}</button>{/if}
            <strong>{selected?.name || text.playlists}</strong>
        </div>
        <div class="list" aria-busy={busy}>
            {#if selected}
                {#each tracks as track (track.position)}
                    <button class="row" class:chosen={currentPosition === track.position} disabled={busy || !track.playable || $spotifyIsFading} on:click={() => play(track)} title={track.playable ? `${track.name} · ${track.artist}` : text.unavailable}>
                        <span class="number">{track.position + 1}</span>
                        <span class="info"><span>{track.name}</span><small>{track.artist || text.unavailable}</small></span>
                        <small>{duration(track.durationMs)}</small>
                    </button>
                {/each}
                {#if !busy && !tracks.length && !error}<p>{text.noTracks}</p>{/if}
            {:else}
                {#each playlists as playlist (playlist.id)}
                    <button class="row" disabled={busy} on:click={() => loadTracks(playlist)}>
                        {#if playlist.image}<img src={playlist.image} alt="" loading="lazy" />{:else}<Icon id="spotify" color="#1db954" size={1} />{/if}
                        <span class="info"><span>{playlist.name}</span><small>{playlist.total}</small></span>
                        <span aria-hidden="true">›</span>
                    </button>
                {/each}
                {#if !busy && !playlists.length && !error}<p>{text.empty}</p>{/if}
            {/if}
        </div>
        {#if busy}<p role="status">{text.loading}</p>{/if}
        {#if nextOffset !== null}<button disabled={busy} on:click={() => (selected ? loadTracks(selected, nextOffset ?? 0) : loadPlaylists(nextOffset ?? 0))}>{text.more}</button>{/if}
    {/if}
</section>

<style>
    .spotify-library {
        margin: 5px;
        padding: 10px;
        border: 1px solid var(--primary-lighter);
        border-radius: 8px;
        background: var(--primary-darker);
        min-width: 0;
    }
    header,
    .heading,
    .row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    header strong {
        flex: 1;
    }
    header button {
        font-size: 11px;
    }
    button {
        border-radius: 4px;
        padding: 5px 8px;
        color: inherit;
        background: var(--primary);
    }
    button:hover:enabled {
        background: var(--primary-lighter);
    }
    button:focus-visible,
    input:focus-visible {
        outline: 2px solid #1db954;
        outline-offset: 2px;
    }
    button:disabled {
        opacity: 0.5;
    }
    p {
        font-size: 12px;
        line-height: 1.5;
        margin: 8px 0;
    }
    code {
        display: block;
        font-size: 11px;
        overflow-wrap: anywhere;
        user-select: text;
    }
    label {
        display: block;
        margin-top: 8px;
        font-size: 12px;
    }
    input {
        box-sizing: border-box;
        width: 100%;
        margin-top: 4px;
        padding: 6px;
        background: var(--primary);
        color: inherit;
        border: 1px solid var(--primary-lighter);
        border-radius: 4px;
    }
    .link {
        font-size: 12px;
        margin-top: 6px;
    }
    .connect {
        background: #1db954;
        color: #111;
    }
    .heading {
        margin: 10px 0 6px;
        font-size: 13px;
    }
    .heading strong {
        overflow-wrap: anywhere;
    }
    .list {
        max-height: 280px;
        overflow-y: auto;
    }
    .row {
        width: 100%;
        text-align: left;
        padding: 7px 5px;
        margin-bottom: 2px;
        background: transparent;
    }
    .row img {
        width: 36px;
        height: 36px;
        object-fit: cover;
        border-radius: 3px;
    }
    .info {
        display: flex;
        flex: 1;
        min-width: 0;
        flex-direction: column;
    }
    .info span,
    .info small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .info span {
        font-size: 13px;
    }
    small,
    .number {
        font-size: 11px;
        opacity: 0.7;
    }
    .chosen {
        box-shadow: inset 3px 0 #1db954;
    }
    .error {
        color: var(--red, #ff8888);
    }
    .notice {
        color: #1db954;
    }
</style>
