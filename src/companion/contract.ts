/**
 * 伴生工具的通用契约。
 *
 * 「伴生工具」= 任何吃一个谱面文件、往 stdout 吐 JSON 的命令行程序。
 * 适配器（adapter）负责把它自己的 JSON 形状翻译成下面这套统一结构，
 * 扩展只认这套结构。这样扩展本身不绑定任何特定项目，
 * 同时又能把 Piano-to-Guitar 的门禁结论原样搬进 Problems 面板。
 *
 * 这个模块不 import vscode，方便单测。
 */

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
    severity: FindingSeverity;
    message: string;
    /** 哪个工具报的，会显示在 Problems 面板里，例如 'playability'。 */
    source: string;
    code?: string | number;
    /** 1-based 小节号。会通过 ScoreModel 换算成源码范围。 */
    bar?: number;
    /** 小节内的 beat 序号，0-based。 */
    beat?: number;
    /** 工具如果直接给了行列（1-based），优先用它，不再靠小节号换算。 */
    line?: number;
    col?: number;
    endLine?: number;
    endCol?: number;
}

/** 报告里的一行，用来在预览面板里显示门禁结论。 */
export interface ReportRow {
    label: string;
    status: 'pass' | 'fail' | 'warn' | 'info';
    detail?: string;
    /**
     * 「N/M」这类计数。**0/0 必须显式标出来**：
     * Piano-to-Guitar 的 AGENTS.md §A.2 记录过一次「空门禁」事故——
     * 比对范围过宽时随便什么音符都能通过，看起来是干净的 PASS，其实什么都没检。
     * 干净得可疑的 0/0 是要去查的故障，不是战果。
     */
    counts?: { passed: number; total: number };
}

export interface GateResult {
    ok: boolean;
    findings: Finding[];
    report: ReportRow[];
    /** 给状态栏用的一句话。 */
    summary: string;
}

export const EMPTY_GATE: GateResult = { ok: true, findings: [], report: [], summary: '' };

/**
 * 某一行是不是「可疑的 0/0」——通过数和总数都是 0，意味着这条门禁其实没检到东西。
 */
export function isVacuous(row: ReportRow): boolean {
    return row.counts !== undefined && row.counts.total === 0;
}

export interface CompanionContext {
    /** 被检查的谱面文件绝对路径。 */
    file: string;
    /** 工具的工作目录。 */
    cwd: string;
    /** 谱面最后一小节的号码，用来拼 `--bars 1-N`。 */
    lastBar: number;
}

export interface CompanionAdapter {
    readonly id: string;
    /** 这个适配器在当前上下文下能不能用（比如工具脚本存不存在）。 */
    detect(context: CompanionContext): boolean;
    /** 要跑哪些命令。按顺序执行，结果合并。 */
    plan(context: CompanionContext): CompanionCommand[];
    /** 把所有命令的输出合并成一份结论。 */
    reduce(results: CommandResult[]): GateResult;
}

export interface CompanionCommand {
    /** 这一步叫什么，会作为 Finding.source。 */
    name: string;
    argv: string[];
    cwd: string;
    /**
     * 退出码是否可信。
     * playability.mjs 有警告时也会 exit 1，所以它的退出码**不能**当成败标志——
     * 这个陷阱在 AGENTS.md、check.mjs 和 playground/serve.mjs 里都被点名过。
     */
    trustExitCode: boolean;
}

export interface CommandResult {
    name: string;
    /** stdout 解析出来的 JSON；解析失败为 undefined。 */
    json?: any;
    exitCode: number | null;
    stderr: string;
    /** 超时、找不到可执行文件之类的执行层面错误。 */
    failure?: string;
}
