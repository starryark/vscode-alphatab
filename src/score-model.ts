import * as alphaTab from '@coderline/alphatab';

/**
 * 用 alphaTab 自己的 alphaTex 解析器把源码变成「地址 → 源码范围」的查找表，
 * 顺便收集诊断信息和 \section 标记。
 *
 * 这个模块**不 import vscode**，位置一律用下面的 SourceRange（0-based，
 * 左闭右开，和 vscode.Range 语义一致）。这样它可以直接跑单元测试，
 * 转成 vscode.Range 的活交给调用方。
 *
 * 要解决的核心问题是两套编号对不上：
 *
 *   - 渲染出来的乐谱模型里，`bar.index` 是**每个 staff 各自从 0 开始**的，
 *     `beat.index` 是每个 voice 各自从 0 开始的。
 *   - alphaTex 的 AST 里，`ast.bars[]` 是**整个文件拉平的一维数组**，
 *     `\track` / `\staff` / `\voice` 只是挂在后面那个 bar 上的 metaData。
 *
 * 也就是说双轨谱里 track 1 的第 0 小节，在 AST 里其实是 `ast.bars[2]`。
 * 旧代码直接拿模型的 bar.index 去索引 ast.bars，所以只要文件里出现第二个
 * \track / \staff / \voice，点音符就会跳到错误的行上。
 */
export interface SourceRange {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}

export interface ScoreAddress {
    track: number;
    staff: number;
    voice: number;
    /** staff 内的小节序号（与 alphaTab 模型的 bar.index 一致） */
    bar: number;
    /** 该 voice 内的 beat 序号 */
    beat?: number;
    /** beat 内的音符序号 */
    note?: number;
}

export interface SectionMarker {
    name: string;
    address: ScoreAddress;
    /** \section "Name" 这一行的范围 */
    range: SourceRange;
}

export type DiagnosticSeverity = 'hint' | 'warning' | 'error';

export interface ParseDiagnostic {
    code: number;
    message: string;
    severity: DiagnosticSeverity;
    range: SourceRange;
}

/**
 * alphaTab 的 severity 编号。与 Piano-to-Guitar 的 tools/lib/analysis.mjs:708
 * 用的是同一张表，改这里要同步确认那边。
 */
const SEVERITY = new Map<number, DiagnosticSeverity>([
    [0, 'hint'],
    [1, 'warning'],
    [2, 'error']
]);

const ZERO_RANGE: SourceRange = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };

/** AST 节点上可能带的位置信息（1-based line/col，0-based offset）。 */
interface AstLocation {
    line: number;
    col: number;
    offset: number;
}

interface AstNode {
    start?: AstLocation;
    end?: AstLocation;
}

/**
 * 把 AST 位置转成 0-based 的 SourceRange。
 *
 * 注意：alphaTab 的 .d.ts 把 `end` 注释成 "The end (inclusive)"，但实测是
 * **左闭右开**的——`text.slice(start.offset, end.offset)` 正好取到整个记号
 * （对 note / beat / bar / 和弦都验证过）。SourceRange 的 end 同样是开区间，
 * 所以两边都只要减 1 换成 0-based 即可，不要因为那句注释去「修」这个偏移。
 */
function toRange(node: AstNode | undefined | null): SourceRange | undefined {
    const start = node?.start;
    const end = node?.end;
    if (!start || !end) {
        return undefined;
    }
    if (typeof start.line !== 'number' || typeof start.col !== 'number' ||
        typeof end.line !== 'number' || typeof end.col !== 'number') {
        return undefined;
    }
    return {
        startLine: Math.max(0, start.line - 1),
        startCol: Math.max(0, start.col - 1),
        endLine: Math.max(0, end.line - 1),
        endCol: Math.max(0, end.col - 1)
    };
}

/** 位置是否落在范围内（含起点，不含终点，与 vscode.Range.contains 一致）。 */
export function rangeContains(range: SourceRange, line: number, col: number): boolean {
    if (line < range.startLine || line > range.endLine) {
        return false;
    }
    if (line === range.startLine && col < range.startCol) {
        return false;
    }
    if (line === range.endLine && col > range.endCol) {
        return false;
    }
    return true;
}

/** metaData 节点长这样：{ tag: { tag: { text: 'track' } }, arguments: { arguments: [...] } } */
function tagName(meta: any): string | undefined {
    const text = meta?.tag?.tag?.text;
    return typeof text === 'string' ? text.toLowerCase() : undefined;
}

function firstArgumentText(meta: any): string | undefined {
    const args = meta?.arguments?.arguments;
    const text = Array.isArray(args) && args.length > 0 ? args[0]?.text : undefined;
    return typeof text === 'string' ? text : undefined;
}

interface BarEntry {
    address: ScoreAddress;
    node: any;
    range: SourceRange | undefined;
}

const addressKey = (track: number, staff: number, voice: number, bar: number) =>
    `${track}:${staff}:${voice}:${bar}`;

export class ScoreModel {
    private constructor(
        private readonly barsByKey: Map<string, BarEntry>,
        private readonly barsInOrder: BarEntry[],
        readonly diagnostics: readonly ParseDiagnostic[],
        readonly sections: readonly SectionMarker[],
        /** key `track:staff:voice` → 该 voice 的小节数 */
        private readonly barCounts: Map<string, number>
    ) {}

    static parse(text: string): ScoreModel {
        const barsByKey = new Map<string, BarEntry>();
        const barsInOrder: BarEntry[] = [];
        const sections: SectionMarker[] = [];
        const barCounts = new Map<string, number>();
        const diagnostics: ParseDiagnostic[] = [];

        let parser: any;
        let ast: any;
        try {
            parser = new alphaTab.importer.alphaTex.AlphaTexParser(text);
            ast = parser.read();
        } catch (e) {
            // 解析器正常情况下不抛异常——语法错误会进 parserDiagnostics，
            // 同时返回一份能用的部分 AST。真抛出来说明是我们没预料到的情况。
            return new ScoreModel(barsByKey, barsInOrder, [{
                code: -1,
                message: e instanceof Error ? e.message : String(e),
                severity: 'error',
                range: ZERO_RANGE
            }], sections, barCounts);
        }

        for (const bag of [parser?.lexer?.diagnostics, parser?.parserDiagnostics]) {
            for (const item of bag?.items ?? []) {
                diagnostics.push({
                    code: item.code,
                    message: item.message,
                    severity: SEVERITY.get(item.severity) ?? 'error',
                    range: toRange(item) ?? ZERO_RANGE
                });
            }
        }

        // ---- 走一遍拉平的 bar 列表，重建 track/staff/voice 游标 ----
        //
        // 规则（已用真实文件验证过，见 src/test/fixtures 下的 multi / twostaff / voices）：
        //   \track  总是开一条新 track，并把游标重置到 staff 0 / voice 0
        //   \staff  当前 staff 还没写过小节时是「配置它」，否则是「新开一个」
        //   \voice  同理，但 voice 0 是隐式存在的，所以第一个 \voice 拿到的是 1
        let track = 0;
        let staff = 0;
        let voice = 0;
        let nextTrack = 0;
        const nextStaff = new Map<number, number>();
        const nextVoice = new Map<string, number>();

        const bump = (key: string) => {
            const n = (barCounts.get(key) ?? 0);
            barCounts.set(key, n + 1);
            return n;
        };

        for (const node of ast?.bars ?? []) {
            for (const meta of node.metaData ?? []) {
                const tag = tagName(meta);
                if (tag === 'track') {
                    track = nextTrack++;
                    staff = 0;
                    voice = 0;
                    nextStaff.set(track, 0);
                    nextVoice.set(`${track}:${staff}`, 0);
                } else if (tag === 'staff') {
                    const counter = nextStaff.get(track) ?? 0;
                    staff = counter;
                    nextStaff.set(track, counter + 1);
                    voice = 0;
                    nextVoice.set(`${track}:${staff}`, 0);
                } else if (tag === 'voice') {
                    const staffKey = `${track}:${staff}`;
                    // voice 0 是隐式的：只要它已经写过小节，\voice 就该开新的一条
                    const used = nextVoice.get(staffKey) ?? 0;
                    const voiceZeroUsed = (barCounts.get(`${track}:${staff}:0`) ?? 0) > 0;
                    voice = used === 0 && voiceZeroUsed ? 1 : used;
                    nextVoice.set(staffKey, voice + 1);
                }
            }

            const bar = bump(`${track}:${staff}:${voice}`);
            const address: ScoreAddress = { track, staff, voice, bar };
            const entry: BarEntry = { address, node, range: toRange(node) };
            barsByKey.set(addressKey(track, staff, voice, bar), entry);
            barsInOrder.push(entry);

            for (const meta of node.metaData ?? []) {
                if (tagName(meta) !== 'section') {
                    continue;
                }
                const name = firstArgumentText(meta);
                const range = toRange(meta);
                if (name && range) {
                    sections.push({ name, address: { ...address }, range });
                }
            }
        }

        return new ScoreModel(barsByKey, barsInOrder, diagnostics, sections, barCounts);
    }

    /** 该 voice 的小节数。默认问的是主音轨主声部。 */
    barCount(track = 0, staff = 0, voice = 0): number {
        return this.barCounts.get(`${track}:${staff}:${voice}`) ?? 0;
    }

    /** 整份谱子里最长那条 voice 的小节数——给 `--bars 1-N` 之类的参数用。 */
    get lastBar(): number {
        let max = 0;
        for (const count of this.barCounts.values()) {
            max = Math.max(max, count);
        }
        return max;
    }

    get trackCount(): number {
        let max = 0;
        for (const key of this.barCounts.keys()) {
            max = Math.max(max, Number(key.split(':')[0]) + 1);
        }
        return max;
    }

    /** 拉平后的小节总数，等于 AST 里的 bar 节点数。 */
    get flatBarCount(): number {
        return this.barsInOrder.length;
    }

    /**
     * 地址 → 源码范围。从最精确的音符开始找，找不到就逐级退回到 beat、bar。
     */
    rangeOf(address: ScoreAddress): SourceRange | undefined {
        const entry = this.barsByKey.get(
            addressKey(address.track, address.staff, address.voice, address.bar)
        );
        if (!entry) {
            return undefined;
        }

        const beats = entry.node?.beats;
        if (address.beat !== undefined && Array.isArray(beats) &&
            address.beat >= 0 && address.beat < beats.length) {
            const beat = beats[address.beat];
            const notes = beat?.notes?.notes;
            if (address.note !== undefined && Array.isArray(notes) &&
                address.note >= 0 && address.note < notes.length) {
                const noteRange = toRange(notes[address.note]);
                if (noteRange) {
                    return noteRange;
                }
            }
            const beatRange = toRange(beat);
            if (beatRange) {
                return beatRange;
            }
        }

        return entry.range;
    }

    /**
     * 源码位置 → 地址（编辑器光标反向同步到预览时用）。
     * 小节范围在源码里不重叠，所以线性找第一个包含该位置的即可。
     */
    addressAt(line: number, col: number): ScoreAddress | undefined {
        for (const entry of this.barsInOrder) {
            if (!entry.range || !rangeContains(entry.range, line, col)) {
                continue;
            }
            const address: ScoreAddress = { ...entry.address };
            const beats = entry.node?.beats ?? [];
            for (let b = 0; b < beats.length; b++) {
                const beatRange = toRange(beats[b]);
                if (!beatRange || !rangeContains(beatRange, line, col)) {
                    continue;
                }
                address.beat = b;
                const notes = beats[b]?.notes?.notes ?? [];
                for (let n = 0; n < notes.length; n++) {
                    const noteRange = toRange(notes[n]);
                    if (noteRange && rangeContains(noteRange, line, col)) {
                        address.note = n;
                        break;
                    }
                }
                break;
            }
            return address;
        }
        return undefined;
    }

    /**
     * 1-based 小节号 → 源码范围。伴生工具（validate / playability / check）
     * 报的都是 1-based 小节号，这是它们变成波浪线的入口。
     *
     * 找不到指定 voice 时会退回到同一 staff 的其它 voice：钢琴谱里各声部写的
     * 小节数常常不一样（alphaTab 会把短的那条补齐到最长的长度），所以「第 59 小节」
     * 可能只存在于 voice 4 里。少画一条波浪线比画错位置更糟。
     */
    rangeOfBar(bar1Based: number, track = 0, staff = 0, voice = 0): SourceRange | undefined {
        const bar = bar1Based - 1;
        const exact = this.barsByKey.get(addressKey(track, staff, voice, bar))?.range;
        if (exact) {
            return exact;
        }
        for (const entry of this.barsInOrder) {
            if (entry.address.track === track && entry.address.staff === staff &&
                entry.address.bar === bar && entry.range) {
                return entry.range;
            }
        }
        return undefined;
    }
}
