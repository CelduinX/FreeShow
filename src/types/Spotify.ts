export type SpotifyRequest = { action: "status" | "disconnect" } | { action: "connect"; clientId: string } | { action: "playlists"; offset: number } | { action: "tracks"; playlistId: string; offset: number } | { action: "play"; playlistId: string; position: number }

export interface SpotifyPlaylist {
    id: string
    name: string
    image?: string
    total: number
}

export interface SpotifyTrack {
    name: string
    artist: string
    durationMs: number
    position: number
    playable: boolean
}

export interface SpotifyResult {
    error?: string
    connected?: boolean
    clientId?: string
    playlists?: SpotifyPlaylist[]
    tracks?: SpotifyTrack[]
    nextOffset?: number | null
}
