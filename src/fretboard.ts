/**
 * 品位 ↔ 音高换算。
 *
 * ⚠️ **弦号有两套编号，这里是唯一的换算边界。**
 *
 *   - alphaTex 源码里（也就是用户敲的 `12.2`）：**1 号弦是最高的那根 e**，
 *     6 号弦是最低的 E。`\tuning (E4 B3 G3 D3 A2 E2)` 也是从高到低写的。
 *   - alphaTab 内部模型的 `note.string`：**反过来，1 号弦是最低的 E**。
 *
 * 任何要在这两者之间转换的地方都必须走这个模块，别在别处再写一遍。
 */

/** 十二平均律音名，用升号拼写。 */
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 标准定弦，按 alphaTex 的顺序（下标 0 = 1 号弦 = 最高的 e）。 */
export const STANDARD_TUNING_MIDI = [64, 59, 55, 50, 45, 40];

export interface FretPosition {
    /** alphaTex 顺序的弦号，1 = 最高弦。 */
    string: number;
    fret: number;
}

/** MIDI 音高 → 音名，例如 55 → "G3"。 */
export function midiToName(midi: number): string {
    const name = PITCH_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${name}${octave}`;
}

/**
 * alphaTex 的 `fret.string` → MIDI 音高。
 * `tuning` 按 alphaTex 顺序给（下标 0 是最高弦），留空用标准定弦。
 */
export function fretToMidi(
    position: FretPosition,
    tuning: readonly number[] = STANDARD_TUNING_MIDI
): number | undefined {
    const open = tuning[position.string - 1];
    if (open === undefined || position.fret < 0) {
        return undefined;
    }
    return open + position.fret;
}

/** 该弦的空弦音名，用于「3 弦（G）」这种提示。 */
export function openStringName(
    string: number,
    tuning: readonly number[] = STANDARD_TUNING_MIDI
): string | undefined {
    const open = tuning[string - 1];
    return open === undefined ? undefined : midiToName(open);
}

/**
 * alphaTab 模型的弦号 ↔ alphaTex 源码的弦号。
 * 两者互为镜像，所以同一个函数双向都能用。
 */
export function flipStringNumber(string: number, stringCount = 6): number {
    return stringCount + 1 - string;
}

/**
 * 解析一个 `fret.string` 或 `fret.string.duration` 记号。
 * 不是这种形状就返回 undefined。
 */
export function parseFretToken(token: string): FretPosition | undefined {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(token);
    if (!match) {
        return undefined;
    }
    return { fret: Number(match[1]), string: Number(match[2]) };
}

/** 从 `\tuning (E4 B3 G3 D3 A2 E2)` 这样的文本里解析定弦。 */
export function parseTuning(text: string): number[] | undefined {
    const match = /\\tuning\s*\(([^)]*)\)/i.exec(text);
    if (!match) {
        return undefined;
    }
    const midi: number[] = [];
    for (const token of match[1].trim().split(/\s+/)) {
        const parsed = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(token);
        if (!parsed) {
            return undefined;
        }
        const base = PITCH_NAMES.indexOf(parsed[1].toUpperCase());
        if (base < 0) {
            return undefined;
        }
        const accidental = parsed[2] === '#' ? 1 : parsed[2] === 'b' ? -1 : 0;
        midi.push((Number(parsed[3]) + 1) * 12 + base + accidental);
    }
    return midi.length > 0 ? midi : undefined;
}
