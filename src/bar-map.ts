import type { BarRange } from './protocol';

/**
 * A 侧（改编谱）小节 ↔ B 侧（参照谱）小节的分段映射。
 *
 * 数据来自 Piano-to-Guitar 的 sidecar.json：每条 entry 带 tabBars [a,b] 和
 * sourceBars [c,d]，正好构成一张分段线性映射表。`free` 模式的段落是新写的材料，
 * 没有 sourceBars——这种段落映射不过去，只能落到最近的已映射小节上。
 *
 * 这个模块同时被扩展宿主和 webview 使用，所以不能 import vscode，也不能碰 DOM。
 */

export interface BarMapEntry {
    from: BarRange;
    to: BarRange;
}

export interface SidecarEntry {
    tabBars?: [number, number];
    sourceBars?: [number, number];
    mode?: string;
    note?: string;
}

export interface Sidecar {
    song?: string;
    entries?: SidecarEntry[];
}

/** 从 sidecar.json 的内容里抽出映射表。没有 sourceBars 的段落直接跳过。 */
export function barMapFromSidecar(sidecar: Sidecar | undefined | null): BarMapEntry[] {
    const entries: BarMapEntry[] = [];
    for (const entry of sidecar?.entries ?? []) {
        const tab = entry.tabBars;
        const source = entry.sourceBars;
        if (!Array.isArray(tab) || !Array.isArray(source)) {
            continue;
        }
        if (tab.length < 2 || source.length < 2) {
            continue;
        }
        entries.push({
            from: { start: tab[0], end: tab[1] },
            to: { start: source[0], end: source[1] }
        });
    }
    return entries.sort((a, b) => a.from.start - b.from.start);
}

/**
 * A 侧小节 → B 侧小节。
 *
 * 命中某一段时按段内比例换算（两段长度可能不同：改编时压缩或展开都很常见）。
 * 落在段与段之间的空隙（多半是 `free` 段）就退到最近一段的边界，
 * 这样 A/B 切换永远有个去处，不会静默失败。
 * 完全没有映射表时按 1:1 处理。
 */
export function mapBar(bar: number, entries: readonly BarMapEntry[]): number {
    if (entries.length === 0) {
        return bar;
    }

    for (const entry of entries) {
        if (bar < entry.from.start || bar > entry.from.end) {
            continue;
        }
        const fromSpan = entry.from.end - entry.from.start;
        const toSpan = entry.to.end - entry.to.start;
        if (fromSpan === 0) {
            return entry.to.start;
        }
        const ratio = (bar - entry.from.start) / fromSpan;
        return entry.to.start + Math.round(ratio * toSpan);
    }

    // 没命中任何一段：贴到最近的边界。
    let best = entries[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
        const distance = bar < entry.from.start
            ? entry.from.start - bar
            : bar - entry.from.end;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = entry;
        }
    }
    return bar < best.from.start ? best.to.start : best.to.end;
}

/** 反向映射，B 侧小节 → A 侧小节。 */
export function invert(entries: readonly BarMapEntry[]): BarMapEntry[] {
    return entries
        .map(entry => ({ from: entry.to, to: entry.from }))
        .sort((a, b) => a.from.start - b.from.start);
}

/** 区间映射，用于把循环范围从一侧带到另一侧。 */
export function mapRange(range: BarRange, entries: readonly BarMapEntry[]): BarRange {
    const start = mapBar(range.start, entries);
    const end = mapBar(range.end, entries);
    return start <= end ? { start, end } : { start: end, end: start };
}
