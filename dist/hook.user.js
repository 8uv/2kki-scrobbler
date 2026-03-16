// ==UserScript==
// @name        ynohook
// @namespace   bajookieland
// @match       https://ynoproject.net/2kki
// @icon        https://www.google.com/s2/favicons?sz=64&domain=ynoproject.net
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @grant       GM_xmlhttpRequest
// @grant       GM_openInTab
// @run-at      document-start
// @require     https://maple.puppygirls.life/files/soundtrack-data.js
// @downloadURL https://github.com/8uv/2kki-scrobbler/raw/refs/heads/main/dist/hook.user.js
// @version     1.0
// @author      kalcifur
// @description 10/03/2026, 11:22:17
// ==/UserScript==
"use strict";
(() => {
  // src/util.ts
  var yieldForGlobal = (name, timeout = 125) => {
    return new Promise(async (resolve, reject) => {
      try {
        const g = eval(`typeof ${name} !== 'undefined' ? ${name} : undefined`);
        if (g) resolve(eval(name));
        else await new Promise((r) => setTimeout(r, timeout)).then(() => resolve(yieldForGlobal(name, timeout)));
      } catch (e) {
        reject(e);
      }
    });
  };
  var yieldForProp = async (obj, prop, timeout2 = 125) => {
    return new Promise((resolve2) => {
      const interval = setInterval(() => {
        if (obj[prop] !== void 0) {
          clearInterval(interval);
          resolve2(obj[prop]);
        }
      }, timeout2);
    });
  };
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // src/hook.ts
  var hookOpen = async (cb) => {
    await yieldForGlobal("easyrpgPlayer");
    await yieldForProp(easyrpgPlayer, "FS");
    await yieldForProp(easyrpgPlayer.FS, "open");
    const FS = easyrpgPlayer.FS;
    const open = FS.open;
    easyrpgPlayer.FS.open = function(...args) {
      cb(...args);
      return open.apply(this, args);
    };
    easyrpgPlayer.FS.readFile = function(path, opts = {}) {
      var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : void 0;
      var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = NaN) => {
        var endIdx = idx + maxBytesToRead;
        var endPtr = idx;
        while (heapOrArray[endPtr] && !(endPtr >= endIdx))
          ++endPtr;
        if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
          return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
        }
        var str = "";
        while (idx < endPtr) {
          var u0 = heapOrArray[idx++];
          if (!(u0 & 128)) {
            str += String.fromCharCode(u0);
            continue;
          }
          var u1 = heapOrArray[idx++] & 63;
          if ((u0 & 224) == 192) {
            str += String.fromCharCode((u0 & 31) << 6 | u1);
            continue;
          }
          var u2 = heapOrArray[idx++] & 63;
          if ((u0 & 240) == 224) {
            u0 = (u0 & 15) << 12 | u1 << 6 | u2;
          } else {
            u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
          }
          if (u0 < 65536) {
            str += String.fromCharCode(u0);
          } else {
            var ch = u0 - 65536;
            str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
          }
        }
        return str;
      };
      opts.flags = opts.flags || 0;
      opts.encoding = opts.encoding || "binary";
      if (opts.encoding !== "utf8" && opts.encoding !== "binary") throw new Error(`Invalid encoding type "${opts.encoding}"`);
      var ret;
      var stream = open(path, opts.flags);
      var stat = FS.stat(path);
      var length = stat.size;
      var buf = new Uint8Array(length);
      FS.read(stream, buf, 0, length, 0);
      if (opts.encoding === "utf8") {
        ret = UTF8ArrayToString(buf);
      } else if (opts.encoding === "binary") {
        ret = buf;
      }
      FS.close(stream);
      return ret;
    };
  };
  var getAudioBuffer = async (path) => {
    await yieldForGlobal("easyrpgPlayer");
    await yieldForProp(easyrpgPlayer, "SDL2");
    await yieldForProp(easyrpgPlayer.SDL2, "audioContext");
    const buffer = easyrpgPlayer.FS.readFile(path).buffer;
    return easyrpgPlayer.SDL2.audioContext.decodeAudioData(buffer);
  };

  // src/fm.ts
  var KEY_SESSION = "lastfm_session_key";
  var KEY_USERNAME = "lastfm_username";
  var KEY_STATE = "lastfm_pending_state";
  function gmGet(url) {
    return new Promise((resolve2, reject2) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload: (res) => {
          if (res.status >= 400) {
            reject2(new Error(`HTTP ${res.status}`));
            return;
          }
          try {
            resolve2(JSON.parse(res.responseText));
          } catch {
            resolve2(res.responseText);
          }
        },
        onerror: (res) => reject2(new Error(`Network error (${res.status})`))
      });
    });
  }
  function gmPostJson(url, body) {
    return new Promise((resolve2, reject2) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(body),
        onload: (res) => {
          if (res.status >= 400) {
            reject2(new Error(`HTTP ${res.status}`));
            return;
          }
          try {
            resolve2(JSON.parse(res.responseText));
          } catch {
            resolve2(res.responseText);
          }
        },
        onerror: (res) => reject2(new Error(`Network error (${res.status})`))
      });
    });
  }
  function createLastFMProxyClient(serverUrl) {
    const base = serverUrl.replace(/\/$/, "");
    function getSession() {
      const key = GM_getValue(KEY_SESSION);
      const username = GM_getValue(KEY_USERNAME);
      if (!key || !username) return void 0;
      return { key, username };
    }
    async function initiateAuth() {
      const res = await gmGet(`${base}/auth/start`);
      const stateId = res["stateId"];
      const authUrl = res["authUrl"];
      GM_setValue(KEY_STATE, stateId);
      GM_openInTab(authUrl, { active: true, setParent: true });
      return stateId;
    }
    async function completeAuth() {
      const stateId = GM_getValue(KEY_STATE);
      if (!stateId) throw new Error("No pending auth state \u2014 call initiateAuth() first.");
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2e3));
        console.log(`polling ${base}/auth/poll/${encodeURIComponent(stateId)}`);
        const poll = await gmGet(`${base}/auth/poll/${encodeURIComponent(stateId)}`);
        if (poll["error"]) throw new Error(`Auth failed: ${poll["error"]}`);
        if (poll["done"]) {
          const sessionKey = poll["sessionKey"];
          const username = poll["username"];
          GM_setValue(KEY_SESSION, sessionKey);
          GM_setValue(KEY_USERNAME, username);
          GM_deleteValue(KEY_STATE);
          return { key: sessionKey, username };
        }
      }
      throw new Error("Auth timed out \u2014 the user did not approve within 2 minutes.");
    }
    function clearSession() {
      GM_deleteValue(KEY_SESSION);
      GM_deleteValue(KEY_USERNAME);
      GM_deleteValue(KEY_STATE);
    }
    async function scrobble(params) {
      const session = getSession();
      if (!session) throw new Error("Not authenticated \u2014 call initiateAuth() then completeAuth() first.");
      const res = await gmPostJson(`${base}/scrobble`, {
        sessionKey: session.key,
        artist: params.artist,
        track: params.track,
        timestamp: params.timestamp,
        album: params.album,
        trackNumber: params.trackNumber,
        duration: params.duration
      });
      if (res["error"]) throw new Error(res["error"]);
    }
    async function updateNowPlaying(params) {
      const session = getSession();
      if (!session) throw new Error("Not authenticated \u2014 call initiateAuth() then completeAuth() first.");
      const res = await gmPostJson(`${base}/now-playing`, {
        sessionKey: session.key,
        artist: params.artist,
        track: params.track,
        album: params.album,
        trackNumber: params.trackNumber,
        duration: params.duration
      });
      if (res["error"]) throw new Error(res["error"]);
    }
    return { getSession, initiateAuth, completeAuth, clearSession, scrobble, updateNowPlaying };
  }

  // src/app.ts
  var soundtrackMap = new Map(
    soundtrackData.map((record) => [record.name, record])
  );
  var html = `
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
    let loopInterval = null;
    let currentlyPlaying = null;
    setInterval(() => {
      scrobbleTimer++;
    }, 1e3);
    hookOpen((...args) => {
      const path = args[0];
      if (typeof path === "string" && path.match("/easyrpg/.*/Music/") && path.endsWith(".opus")) {
        const trackName = path.match(/([^/]+)\.opus$/)?.[1];
        if (!trackName) return;
        const trackData = soundtrackMap.get(trackName);
        console.log(trackData);
        if (trackData) {
          getAudioBuffer(path).then((buffer) => {
            const duration = Math.floor(buffer.duration) >= 30 ? Math.floor(buffer.duration) : 30;
            console.log(`Track duration: ${duration} seconds`);
            if (session && scrobblingEnabled) {
              if (currentlyPlaying && scrobbleTimer > 30) {
                const prevData = currentlyPlaying.data;
                fm.scrobble({
                  artist: prevData.author,
                  track: prevData.name?.toLowerCase() ?? prevData.id ?? "Unknown Track",
                  album: prevData.location,
                  duration,
                  timestamp: Math.floor(Date.now() / 1e3) - scrobbleTimer
                }).catch((e) => console.error("Failed to scrobble track:", e));
              }
              fm.updateNowPlaying({
                artist: trackData.author,
                track: trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track",
                album: trackData.location
              }).catch((e) => console.error("Failed to update Now Playing:", e));
              if (loopInterval) clearInterval(loopInterval);
              loopInterval = setInterval(() => {
                fm.scrobble({
                  artist: trackData.author,
                  track: trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track",
                  album: trackData.location,
                  duration,
                  timestamp: Math.floor(Date.now() / 1e3) - duration
                }).catch((e) => console.error("Failed to scrobble track:", e));
                scrobbleTimer = 0;
              }, duration * 1e3);
            }
            currentlyPlaying = {
              AudioBuffer: buffer,
              data: trackData
            };
            scrobbleTimer = 0;
          });
        }
      }
    });
    window.addEventListener("DOMContentLoaded", () => {
      document.querySelector("#leftControls")?.insertAdjacentHTML("afterbegin", html);
      const button = document.querySelector("#fmButton");
      const afterFMAuth = async () => {
        button.querySelector("span").style.display = "none";
        button.querySelector("svg")?.querySelector("path")?.setAttribute("fill", !scrobblingEnabled ? "#c00" : "white");
      };
      if (session) afterFMAuth();
      button.addEventListener("click", () => {
        if (!session) {
          console.log("No session found, starting authentication process...");
          fm.initiateAuth().then(() => {
            fm.completeAuth().then((authData) => {
              console.log("Authentication successful! Session:", authData);
              session = authData;
              afterFMAuth();
            }).catch((err) => {
              console.error("Error completing authentication:", err);
            });
          }).catch((err) => {
            console.error("Error initiating authentication:", err);
          });
        } else {
          scrobblingEnabled = !scrobblingEnabled;
          GM_setValue("lastfm_scrobbling_enabled", scrobblingEnabled);
          button.querySelector("svg")?.querySelector("path")?.setAttribute("fill", !scrobblingEnabled ? "#c00" : "white");
          if (scrobblingEnabled && session && currentlyPlaying) {
            const trackData = currentlyPlaying.data;
            fm.updateNowPlaying({
              artist: trackData.author,
              track: trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track",
              album: trackData.location
            }).catch((e) => console.error("Failed to update Now Playing:", e));
          }
          if (!scrobblingEnabled && session && currentlyPlaying) {
            const trackData = currentlyPlaying.data;
            fm.scrobble({
              artist: trackData.author,
              track: trackData.name?.toLowerCase() ?? trackData.id ?? "Unknown Track",
              album: trackData.location,
              duration: Math.floor(currentlyPlaying.AudioBuffer.duration),
              timestamp: Math.floor(Date.now() / 1e3) - scrobbleTimer
            }).catch((e) => console.error("Failed to scrobble track:", e));
            fm.updateNowPlaying({
              artist: "shh",
              track: "shh",
              album: "shh",
              duration: 0
            }).catch((e) => console.error("Failed to clear Now Playing:", e));
          }
        }
      });
    });
  })();
})();
