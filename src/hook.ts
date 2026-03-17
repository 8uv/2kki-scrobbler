import { yieldForGlobal, yieldForProp } from "./util";

type player = {
    HEAPU32: Uint32Array<ArrayBuffer>,
    FS: {
        open: (...args: any[]) => void,
        readFile: (path: string, opts?: { flags?: number, encoding?: string }) => string | Uint8Array,
        read: (stream: any, buffer: Uint8Array, offset: number, length: number, position: number) => void,
        stat: (path: string) => { size: number },
        close: (stream: any) => void
    },
    SDL2: {
        audioContext: {
            decodeAudioData: (buffer: ArrayBuffer) => Promise<AudioBuffer>
        }
    }
};

declare const easyrpgPlayer: player;

export const hookOpen = async (cb: (...args: any[]) => void) => {
    await yieldForGlobal("easyrpgPlayer") as player;
    await yieldForProp(easyrpgPlayer, "FS");
    await yieldForProp(easyrpgPlayer.FS, "open");

    const FS = easyrpgPlayer.FS;
    const open = FS.open;

    easyrpgPlayer.FS.open = function (...args) {
        cb(...args);
        return open.apply(this, args);
    };

    easyrpgPlayer.FS.readFile = function (path, opts: { flags?: number, encoding?: string } = {}): string | Uint8Array {
        var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder : undefined;
        var UTF8ArrayToString = (heapOrArray: Uint8Array, idx = 0, maxBytesToRead = NaN) => {
            var endIdx = idx + maxBytesToRead;
            var endPtr = idx;
            while (heapOrArray[endPtr] && !(endPtr >= endIdx))
                ++endPtr;
            if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
                return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr))
            }
            var str = "";
            while (idx < endPtr) {
                var u0 = heapOrArray[idx++]!;
                if (!(u0 & 128)) {
                    str += String.fromCharCode(u0);
                    continue
                }
                var u1 = heapOrArray[idx++]! & 63;
                if ((u0 & 224) == 192) {
                    str += String.fromCharCode((u0 & 31) << 6 | u1);
                    continue
                }
                var u2 = heapOrArray[idx++]! & 63;
                if ((u0 & 240) == 224) {
                    u0 = (u0 & 15) << 12 | u1 << 6 | u2
                } else {
                    u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++]! & 63
                }
                if (u0 < 65536) {
                    str += String.fromCharCode(u0)
                } else {
                    var ch = u0 - 65536;
                    str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023)
                }
            }
            return str
        }

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
            ret = UTF8ArrayToString(buf)
        } else if (opts.encoding === "binary") {
            ret = buf
        }
        FS.close(stream);
        return ret!;
    }
}

export const getAudioBuffer = async (path: string): Promise<AudioBuffer> => {
    await yieldForGlobal("easyrpgPlayer") as player;
    await yieldForProp(easyrpgPlayer, "SDL2");
    await yieldForProp(easyrpgPlayer.SDL2, "audioContext");
    const buffer = (easyrpgPlayer.FS.readFile(path) as Uint8Array).buffer;
    return easyrpgPlayer.SDL2.audioContext.decodeAudioData(buffer as ArrayBuffer);
}

// await easyrpgPlayer.SDL2.audioContext.decodeAudioData(easyrpgPlayer.FS.readFile("/easyrpg/2kki/Music/uwa_bgm18.opus").buffer)