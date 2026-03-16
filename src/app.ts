import { hookOpen, getAudioBuffer } from "./hook";
import { createLastFMProxyClient } from "./fm";
import type { LastFMSession } from "./fm";

interface SoundtrackRecord {
    id: [
        number,
        string,
    ],
    name: string,
    author: string,
    speed: string,
    location: string,
}

interface PlayingTrack {
    AudioBuffer: AudioBuffer,
    data: SoundtrackRecord,
}

declare const soundtrackData: SoundtrackRecord[]; // required from userscript header

const soundtrackMap = new Map<string, SoundtrackRecord>(
    soundtrackData.map(record => [record.name, record])
);

const html = `
<button id="fmButton" class="iconButton transparentToggleButton toggled">
    <span
        style="position: absolute;color: white;background: red;min-width: 12px;min-height: 12px;border-radius: 50%;left: 22px;top: -6px;">!</span>
    <svg viewBox="0 0 804 447" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path
            d="M354.475 397.74L325.008 317.643C325.008 317.643 277.126 371.046 205.321 371.046C141.781 371.046 96.6749 315.802 96.6749 227.413C96.6749 114.167 153.753 73.6561 209.921 73.6561C290.938 73.6561 316.715 126.135 338.817 193.35L368.284 285.425C397.74 374.725 452.984 446.543 612.264 446.543C726.441 446.543 803.776 411.56 803.776 319.488C803.776 244.911 761.417 206.242 682.234 187.823L623.311 174.938C582.804 165.732 570.836 149.153 570.836 121.535C570.836 90.2306 595.689 71.8148 636.207 71.8148C680.396 71.8148 704.332 88.3894 708.018 127.979L800.09 116.928C792.725 34.0662 735.644 0 641.731 0C558.872 0 477.847 31.3044 477.847 131.662C477.847 194.27 508.231 233.864 584.642 252.276L647.258 267.002C694.213 278.053 709.859 297.386 709.859 324.095C709.859 358.154 676.717 371.966 614.109 371.966C521.12 371.966 482.454 323.17 460.352 255.952L429.969 163.887C391.306 44.193 329.615 0 207.156 0C71.8148 0 0 85.624 0 231.095C0 371.046 71.8148 446.54 200.722 446.54C304.748 446.536 354.475 397.74 354.475 397.74Z"
            fill="white"></path>
    </svg>
</button>`;

(async () => {
    const fm = createLastFMProxyClient("https://fm.arf.puppygirls.life/");
    let session = fm.getSession();
    let scrobblingEnabled = GM_getValue("lastfm_scrobbling_enabled", true);

    let scrobbleTimer = 0;
    let loopInterval: ReturnType<typeof setInterval> | null = null;
    let currentlyPlaying: PlayingTrack | null = null;

    setInterval(() => {
        scrobbleTimer++
    }, 1000);

    hookOpen((...args) => { // runs every time a new track is played
        const path = args[0];
        if (typeof path === "string" && (path as string).match("/easyrpg/.*/Music/") && (path as string).endsWith(".opus")) {
            const trackName = (path as string).match(/([^/]+)\.opus$/)?.[1];
            if (!trackName) return;
            const trackData = soundtrackMap.get(trackName);

            console.log(trackData);
            if (trackData) {

                // get track duration
                getAudioBuffer(path).then(buffer => {
                    const duration = Math.floor(buffer.duration) >= 30 ? Math.floor(buffer.duration) : 30;
                    console.log(`Track duration: ${duration} seconds`);

                    if (session && scrobblingEnabled) {
                        if (currentlyPlaying && scrobbleTimer > 30) {
                            const prevData = (currentlyPlaying as PlayingTrack).data;
                            fm.scrobble({
                                artist: prevData.author,
                                track: (prevData.name?.toLowerCase() ?? prevData.id ?? "Unknown Track") as string,
                                album: prevData.location,
                                duration,
                                timestamp: Math.floor(Date.now() / 1000) - scrobbleTimer,
                            }).catch(e => console.error("Failed to scrobble track:", e));
                        }

                        fm.updateNowPlaying({
                            artist: trackData.author,
                            track: (trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track") as string,
                            album: trackData.location,
                        }).catch(e => console.error("Failed to update Now Playing:", e));

                        if (loopInterval) clearInterval(loopInterval);
                        loopInterval = setInterval(() => {
                            fm.scrobble({
                                artist: trackData.author,
                                track: (trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track") as string,
                                album: trackData.location,
                                duration,
                                timestamp: Math.floor(Date.now() / 1000) - duration,
                            }).catch(e => console.error("Failed to scrobble track:", e));

                            scrobbleTimer = 0;
                        }, duration * 1000);
                    }

                    currentlyPlaying = {
                        AudioBuffer: buffer,
                        data: trackData,
                    };
                    scrobbleTimer = 0;
                });

            }
        }
    });

    window.addEventListener("DOMContentLoaded", () => {
        document.querySelector("#leftControls")?.insertAdjacentHTML("afterbegin", html);
        const button = document.querySelector("#fmButton") as HTMLButtonElement;

        const afterFMAuth = async () => {
            button.querySelector("span")!.style.display = "none";
            button.querySelector("svg")?.querySelector("path")?.setAttribute("fill", !scrobblingEnabled ? "#c00" : "white");
        };

        if (session) afterFMAuth();

        button.addEventListener("click", () => {
            if (!session) {
                console.log("No session found, starting authentication process...");
                fm.initiateAuth().then(() => {
                    fm.completeAuth().then((authData: LastFMSession) => {
                        console.log("Authentication successful! Session:", authData);
                        session = authData;
                        afterFMAuth();
                    }).catch((err) => {
                        console.error("Error completing authentication:", err);
                    });
                }).catch((err) => {
                    console.error("Error initiating authentication:", err);
                });
            }

            else {
                scrobblingEnabled = !scrobblingEnabled;
                GM_setValue("lastfm_scrobbling_enabled", scrobblingEnabled);
                button.querySelector("svg")?.querySelector("path")?.setAttribute("fill", !scrobblingEnabled ? "#c00" : "white");

                if (scrobblingEnabled && session && currentlyPlaying) {
                    const trackData = currentlyPlaying.data;
                    fm.updateNowPlaying({
                        artist: trackData.author,
                        track: (trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track") as string,
                        album: trackData.location,
                    }).catch(e => console.error("Failed to update Now Playing:", e));
                }

                if (!scrobblingEnabled && session && currentlyPlaying) {
                    const trackData = currentlyPlaying.data;
                    fm.scrobble({
                        artist: trackData.author,
                        track: (trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track") as string,
                        album: trackData.location,
                        duration: Math.floor(currentlyPlaying.AudioBuffer.duration),
                        timestamp: Math.floor(Date.now() / 1000) - scrobbleTimer,
                    }).catch(e => console.error("Failed to scrobble track:", e));

                    // clear now playing
                    fm.updateNowPlaying({
                        artist: "shh",
                        track: "shh",
                        album: "shh",
                        duration: 0,
                    }).catch(e => console.error("Failed to clear Now Playing:", e));
                }
            }
        });
    })
})();