/**
 * Last.fm authentication and scrobbling module for Violentmonkey userscripts.
 */

// ---------------------------------------------------------------------------
// Violentmonkey GM API declarations
// ---------------------------------------------------------------------------

import '@violentmonkey/types'
import { Log } from "./util";

declare function GM_getValue(key: string, defaultValue: string): string;
declare function GM_getValue(key: string): string | undefined;
declare function GM_setValue(key: string, value: string): void;
declare function GM_deleteValue(key: string): void;
declare function GM_openInTab(
    url: string,
    options?: { active?: boolean; insert?: boolean; setParent?: boolean },
): { closed?: boolean; close(): void; onclose?: () => void };
declare function GM_xmlhttpRequest(details: {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    data?: string;
    onload?: (response: { status: number; statusText: string; responseText: string }) => void;
    onerror?: (response: { status: number; statusText: string; responseText: string }) => void;
    ontimeout?: () => void;
}): void;

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const KEY_SESSION  = "lastfm_session_key";
const KEY_USERNAME = "lastfm_username";
const KEY_TOKEN    = "lastfm_pending_token";
const KEY_STATE    = "lastfm_pending_state";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function gmGet(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url,
            onload: (res) => {
                if (res.status >= 400) { reject(new Error(`HTTP ${res.status}`)); return; }
                try { resolve(JSON.parse(res.responseText)); } catch { resolve(res.responseText); }
            },
            onerror: (res) => reject(new Error(`Network error (${res.status})`)),
        });
    });
}

function gmPostJson(url: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "POST",
            url,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(body),
            onload: (res) => {
                if (res.status >= 400) { reject(new Error(`HTTP ${res.status}`)); return; }
                try { resolve(JSON.parse(res.responseText)); } catch { resolve(res.responseText); }
            },
            onerror: (res) => reject(new Error(`Network error (${res.status})`)),
        });
    });
}

function gmPost(url: string, body: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "POST",
            url,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: body,
            onload: (res) => {
                if (res.status >= 400) { reject(new Error(`HTTP ${res.status}`)); return; }
                try { resolve(JSON.parse(res.responseText)); } catch { resolve(res.responseText); }
            },
            onerror: (res) => reject(new Error(`Network error (${res.status})`)),
        });
    });
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LastFMConfig {
    /** Your Last.fm API key — register at https://www.last.fm/api/account/create */
    apiKey: string;
    /** Your Last.fm API shared secret */
    apiSecret: string;
}

export interface LastFMSession {
    key: string;
    username: string;
}

export interface ScrobbleParams {
    artist: string;
    track: string;
    /** Unix timestamp (seconds). Defaults to now. */
    timestamp?: number;
    album?: string;
    trackNumber?: number;
    /** Track duration in seconds */
    duration?: number;
}

export interface LastFMClient {
    /**
     * Returns the stored session if the user is already authenticated,
     * or `undefined` if not yet signed in.
     */
    getSession(): LastFMSession | undefined;

    /**
     * Step 1 of the auth flow.
     *
     * Requests a one-time token from Last.fm, opens the authorisation page in a
     * new tab, and stores the token for later. Call `completeAuth()` after the
     * user has clicked "Allow" on Last.fm.
     *
     * @returns The pending token (useful for display/debugging).
     */
    initiateAuth(): Promise<string>;

    /**
     * Step 2 of the auth flow.
     *
     * Exchanges the pending request token for a session key and persists it via
     * `GM_setValue`. Throws if no pending token is found.
     */
    completeAuth(): Promise<LastFMSession>;

    /** Signs the user out by removing all stored session data. */
    clearSession(): void;

    /**
     * Scrobbles a track. The session must be established first.
     *
     * Last.fm requires scrobbling after the track has played for at least 30
     * seconds, and only once ≥50 % of the track has elapsed (or 4 minutes,
     * whichever comes first).
     */
    scrobble(params: ScrobbleParams): Promise<void>;

    /**
     * Updates the "Now Playing" status on Last.fm.
     * Should be called when playback of a new track begins.
     */
    updateNowPlaying(params: Omit<ScrobbleParams, "timestamp">): Promise<void>;
}

export type LastFMData = {
    client: LastFMClient | undefined;
    session: LastFMSession | undefined;
    key: string | undefined;
    secret: string | undefined;
    inAuth: boolean;
}

// ---------------------------------------------------------------------------
// Proxy client — works with a hosted lastfm-server.ts instance
// ---------------------------------------------------------------------------

/**
 * Creates a Last.fm client that authenticates and scrobbles through a
 * self-hosted proxy server (lastfm-server.ts) rather than directly against
 * the Last.fm API. The API key and secret live only on the server; the
 * userscript only ever stores the session key.
 *
 * @param serverUrl  Root URL of your running lastfm-server.ts instance,
 *                   e.g. `"https://yourserver.example.com"`.
 */
export function createLastFMProxyClient(serverUrl: string): LastFMClient {
    const base = serverUrl.replace(/\/$/, "");

    function getSession(): LastFMSession | undefined {
        const key      = GM_getValue(KEY_SESSION);
        const username = GM_getValue(KEY_USERNAME);
        if (!key || !username) return undefined;
        return { key, username };
    }

    async function initiateAuth(): Promise<string> {
        const res     = await gmGet(`${base}/auth/start`) as Record<string, unknown>;
        const stateId = res["stateId"] as string;
        const authUrl = res["authUrl"] as string;
        GM_setValue(KEY_STATE, stateId);
        GM_openInTab(authUrl, { active: true, setParent: true });
        return stateId;
    }

    async function completeAuth(): Promise<LastFMSession> {
        const stateId = GM_getValue(KEY_STATE);
        if (!stateId) throw new Error("No pending auth state — call initiateAuth() first.");

        // Poll the server every 2 s for up to 2 minutes
        for (let i = 0; i < 60; i++) {
            await new Promise<void>(r => setTimeout(r, 2000));
            Log(`Auth: polling ${base}/auth/poll/${encodeURIComponent(stateId)}`);
            const poll = await gmGet(`${base}/auth/poll/${encodeURIComponent(stateId)}`) as Record<string, unknown>;
            if (poll["error"]) throw new Error(`Auth failed: ${poll["error"]}`);
            if (poll["done"]) {
                const sessionKey = poll["sessionKey"] as string;
                const username   = poll["username"] as string;
                GM_setValue(KEY_SESSION,  sessionKey);
                GM_setValue(KEY_USERNAME, username);
                GM_deleteValue(KEY_STATE);
                return { key: sessionKey, username };
            }
        }
        throw new Error("Auth timed out — the user did not approve within 2 minutes.");
    }

    function clearSession(): void {
        GM_deleteValue(KEY_SESSION);
        GM_deleteValue(KEY_USERNAME);
        GM_deleteValue(KEY_STATE);
    }

    async function scrobble(params: ScrobbleParams): Promise<void> {
        Log(`Requested scrobble with parameters :`, params);

        const session = getSession();
        if (!session) throw new Error("Not authenticated — call initiateAuth() then completeAuth() first.");
        const res = await gmPostJson(`${base}/scrobble`, {
            sessionKey:  session.key,
            artist:      params.artist,
            track:       params.track,
            timestamp:   params.timestamp,
            album:       params.album,
            trackNumber: params.trackNumber,
            duration:    params.duration,
        }) as Record<string, unknown>;
        if (res["error"]) throw new Error(res["error"] as string);
    }

    async function updateNowPlaying(params: Omit<ScrobbleParams, "timestamp">): Promise<void> {
        Log(`Requested now playing with parameters :`, params);

        const session = getSession();
        if (!session) throw new Error("Not authenticated — call initiateAuth() then completeAuth() first.");
        const res = await gmPostJson(`${base}/now-playing`, {
            sessionKey:  session.key,
            artist:      params.artist,
            track:       params.track,
            album:       params.album,
            trackNumber: params.trackNumber,
            duration:    params.duration,
        }) as Record<string, unknown>;
        if (res["error"]) throw new Error(res["error"] as string);
    }

    return { getSession, initiateAuth, completeAuth, clearSession, scrobble, updateNowPlaying };
}
