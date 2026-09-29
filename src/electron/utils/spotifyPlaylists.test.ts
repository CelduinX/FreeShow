import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ values: {} as Record<string, string>, request: vi.fn(), post: vi.fn(), openExternal: vi.fn(), encryption: true }))
vi.mock("electron-store", () => ({
    default: class {
        get(key: string) {
            return mocks.values[key] || ""
        }
        set(key: string, value: string) {
            mocks.values[key] = value
        }
        delete(key: string) {
            delete mocks.values[key]
        }
    }
}))
vi.mock("electron", () => ({
    app: { once: vi.fn() },
    safeStorage: { isEncryptionAvailable: () => mocks.encryption, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
    shell: { openExternal: mocks.openExternal }
}))
vi.mock("axios", () => ({ default: { request: mocks.request, post: mocks.post, isAxiosError: (error: any) => !!error.isAxiosError } }))

import { spotifyLibrary } from "./spotifyPlaylists"

beforeEach(async () => {
    await spotifyLibrary({ action: "disconnect" })
    mocks.values = { clientId: "a".repeat(32), refreshToken: Buffer.from("refresh-secret").toString("base64") }
    mocks.encryption = true
    mocks.request.mockReset()
    mocks.post.mockReset().mockResolvedValue({ data: { access_token: "access-secret", expires_in: 3600 } })
    mocks.openExternal.mockReset()
})

async function loadPlaylist() {
    mocks.request.mockResolvedValueOnce({ data: { items: [null, { id: "playlist1", name: "Music", items: { total: 3 } }], next: null } })
    return spotifyLibrary({ action: "playlists", offset: 0 })
}

describe("Spotify playlist integration", () => {
    it("returns connection status without exposing tokens", async () => {
        expect(await spotifyLibrary({ action: "status" })).toEqual({ connected: true, clientId: "a".repeat(32) })
        expect(mocks.post).not.toHaveBeenCalled()
    })

    it("refreshes once for concurrent requests and reads the current user's playlists", async () => {
        mocks.request.mockResolvedValue({ data: { items: [], next: null } })
        await Promise.all([spotifyLibrary({ action: "playlists", offset: 0 }), spotifyLibrary({ action: "playlists", offset: 50 })])
        expect(mocks.post).toHaveBeenCalledTimes(1)
        expect(mocks.request.mock.calls[0][0].url).toBe("https://api.spotify.com/v1/me/playlists?limit=50&offset=0")
    })

    it("handles the new item shape and preserves offsets for unavailable, local and non-track items", async () => {
        expect((await loadPlaylist()).playlists?.[0].total).toBe(3)
        mocks.request.mockResolvedValueOnce({ data: { items: [{ item: null }, { item: { type: "track", name: "Local", is_local: true } }, { item: { type: "episode", name: "Podcast" } }, { item: { type: "track", name: "Song", artists: [{ name: "Artist" }], duration_ms: 123000 } }], next: "next-page" } })
        const result = await spotifyLibrary({ action: "tracks", playlistId: "playlist1", offset: 50 })
        expect(result.tracks?.map((t) => t.playable)).toEqual([false, false, false, true])
        expect(result.nextOffset).toBe(54)
        mocks.request.mockResolvedValueOnce({ data: "" })
        expect(await spotifyLibrary({ action: "play", playlistId: "playlist1", position: 53 })).toEqual({})
        expect(mocks.request.mock.calls.at(-1)?.[0].data).toEqual({ context_uri: "spotify:playlist:playlist1", offset: { position: 53 }, position_ms: 0 })
    })

    it("accepts legacy track fields for older extended-quota responses", async () => {
        await loadPlaylist()
        mocks.request.mockResolvedValueOnce({ data: { items: [{ track: { type: "track", name: "Legacy" } }], next: null } })
        expect((await spotifyLibrary({ action: "tracks", playlistId: "playlist1", offset: 0 })).tracks?.[0].playable).toBe(true)
    })

    it("rejects arbitrary playlists and tracks that have not been loaded", async () => {
        expect((await spotifyLibrary({ action: "tracks", playlistId: "unknown", offset: 0 })).error).toBeTruthy()
        await loadPlaylist()
        expect((await spotifyLibrary({ action: "play", playlistId: "playlist1", position: 0 })).error).toBeTruthy()
        expect(mocks.request).toHaveBeenCalledTimes(1)
    })

    it("rejects invalid pagination without an API call", async () => {
        expect((await spotifyLibrary({ action: "playlists", offset: -1 })).error).toBeTruthy()
        expect((await spotifyLibrary({ action: "playlists", offset: 0.5 })).error).toBeTruthy()
        expect(mocks.request).not.toHaveBeenCalled()
    })

    it("retries an expired token only once", async () => {
        const failure = { isAxiosError: true, response: { status: 401 } }
        mocks.request.mockRejectedValue(failure)
        expect((await spotifyLibrary({ action: "playlists", offset: 0 })).error).toContain("erneut verbinden")
        expect(mocks.request).toHaveBeenCalledTimes(2)
        expect(mocks.post).toHaveBeenCalledTimes(2)
    })

    it("explains missing devices, inaccessible playlists and rate limits", async () => {
        for (const [status, message] of [
            [404, "Wiedergabegerät"],
            [403, "Premium"],
            [429, "17 Sekunden"]
        ] as const) {
            mocks.request.mockRejectedValueOnce({ isAxiosError: true, response: { status, headers: { "retry-after": "17" } } })
            expect((await spotifyLibrary({ action: "playlists", offset: 0 })).error).toContain(message)
        }
    })

    it("removes an invalid refresh token", async () => {
        mocks.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400 } })
        expect((await spotifyLibrary({ action: "playlists", offset: 0 })).connected).toBe(false)
        expect(mocks.values.refreshToken).toBeUndefined()
    })

    it("disconnects and clears the library while retaining the client ID", async () => {
        await loadPlaylist()
        expect(await spotifyLibrary({ action: "disconnect" })).toEqual({ connected: false })
        expect(mocks.values.refreshToken).toBeUndefined()
        expect(mocks.values.clientId).toBe("a".repeat(32))
        expect((await spotifyLibrary({ action: "tracks", playlistId: "playlist1", offset: 0 })).error).toBeTruthy()
    })

    it("does not restore tokens when disconnecting during refresh", async () => {
        let complete!: (value: any) => void
        mocks.post.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)))
        const pending = spotifyLibrary({ action: "playlists", offset: 0 })
        await spotifyLibrary({ action: "disconnect" })
        complete({ data: { access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 3600 } })
        expect((await pending).connected).toBe(false)
        expect(mocks.values.refreshToken).toBeUndefined()
        expect(mocks.request).not.toHaveBeenCalled()
    })

    it("uses PKCE and rejects an incorrect callback state before accepting a valid one", async () => {
        mocks.post.mockResolvedValueOnce({ data: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 } })
        mocks.openExternal.mockImplementationOnce(async (address: string) => {
            const authorization = new URL(address)
            expect(authorization.searchParams.get("code_challenge_method")).toBe("S256")
            expect(authorization.searchParams.get("code_challenge")).toHaveLength(43)
            const redirect = authorization.searchParams.get("redirect_uri")!
            expect((await fetch(`${redirect}?code=wrong&state=invalid`)).status).toBe(400)
            expect((await fetch(`${redirect}?code=valid&state=${authorization.searchParams.get("state")}`)).status).toBe(200)
        })
        expect(await spotifyLibrary({ action: "connect", clientId: "b".repeat(32) })).toEqual({ connected: true })
        expect(mocks.values.clientId).toBe("b".repeat(32))
        expect(Buffer.from(mocks.values.refreshToken, "base64").toString()).toBe("new-refresh")
        expect(mocks.post.mock.calls[0][1]).toContain("code_verifier=")
    })

    it("supports cancelling the browser login", async () => {
        mocks.openExternal.mockImplementationOnce(async () => {
            await spotifyLibrary({ action: "disconnect" })
        })
        expect((await spotifyLibrary({ action: "connect", clientId: "a".repeat(32) })).error).toContain("abgebrochen")
    })

    it("requires a valid client ID and secure encryption before opening a browser", async () => {
        expect((await spotifyLibrary({ action: "connect", clientId: "invalid" })).error).toContain("Client-ID")
        mocks.encryption = false
        expect((await spotifyLibrary({ action: "connect", clientId: "a".repeat(32) })).error).toContain("sichere Speicherung")
        expect(mocks.openExternal).not.toHaveBeenCalled()
    })
})
