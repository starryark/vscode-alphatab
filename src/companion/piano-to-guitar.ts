import * as fspath from 'path';
import * as fs from 'fs';

import {
    CompanionAdapter, CompanionCommand, CompanionContext,
    CommandResult, Finding, GateResult, ReportRow
} from './contract';

/**
 * Piano-to-Guitar（C:\Users\lyang\Code\Music\Piano-to-Guitar）的适配器。
 *
 * 两种模式：
 *   lint     只有谱面文件时能跑的：validate.mjs + playability.mjs
 *   fidelity 同目录还有 sidecar.json 和 source.json（digest）时，再跑 check.mjs
 *
 * 两个必须硬编码进来的陷阱：
 *
 *   1. **playability.mjs 有警告时也 exit 1。**它的退出码不是通过/失败信号，
 *      判定只能看 errors[] 是不是空。AGENTS.md、check.mjs、playground/serve.mjs
 *      三处都点名过这一条。
 *   2. **0/0 是「空门禁」，不是干净通过。**AGENTS.md §A.2 记过一次事故：
 *      比对用的音级集合过宽（平均 6.33/12 个音级），随便什么音符都能过，
 *      看起来是 PASS，其实什么都没检。所以报告行必须带计数，并把 0/0 标红。
 */

export const PIANO_TO_GUITAR = 'piano-to-guitar';

interface ToolPaths {
    root: string;
    validate: string;
    playability: string;
    check: string;
}

/** 从谱面文件往上找带 tools/check.mjs 和 AGENTS.md 的仓库根。 */
export function findToolRoot(startDir: string): ToolPaths | undefined {
    let dir = startDir;
    for (let depth = 0; depth < 8; depth++) {
        const check = fspath.join(dir, 'tools', 'check.mjs');
        if (fs.existsSync(check) && fs.existsSync(fspath.join(dir, 'AGENTS.md'))) {
            return {
                root: dir,
                validate: fspath.join(dir, 'tools', 'validate.mjs'),
                playability: fspath.join(dir, 'tools', 'playability.mjs'),
                check
            };
        }
        const parent = fspath.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return undefined;
}

export interface PianoToGuitarOptions {
    /** 改编谱比原谱高几个半音。推断不出来，只能由用户配置。 */
    transpose?: number;
    gain?: 'high' | 'crunch' | 'clean';
    warningsAsErrors?: boolean;
    nodePath?: string;
}

export class PianoToGuitarAdapter implements CompanionAdapter {
    readonly id = PIANO_TO_GUITAR;

    constructor(private readonly options: PianoToGuitarOptions = {}) {}

    detect(context: CompanionContext): boolean {
        return findToolRoot(fspath.dirname(context.file)) !== undefined;
    }

    plan(context: CompanionContext): CompanionCommand[] {
        const tools = findToolRoot(fspath.dirname(context.file));
        if (!tools) {
            return [];
        }
        const node = this.options.nodePath ?? process.execPath;
        const projectDir = fspath.dirname(context.file);
        const commands: CompanionCommand[] = [];

        commands.push({
            name: 'validate',
            argv: [node, tools.validate, context.file, '--json'],
            cwd: tools.root,
            trustExitCode: true
        });

        const policy = fspath.join(projectDir, 'guitar-policy.json');
        const playabilityArgs = [node, tools.playability, context.file, '--json'];
        if (this.options.gain) {
            playabilityArgs.push('--gain', this.options.gain);
        }
        if (fs.existsSync(policy)) {
            playabilityArgs.push('--policy', policy);
        }
        if (this.options.warningsAsErrors) {
            playabilityArgs.push('--warnings-as-errors');
        }
        commands.push({
            name: 'playability',
            argv: playabilityArgs,
            cwd: tools.root,
            // 有警告也会 exit 1，所以退出码不可信，只看 errors[]
            trustExitCode: false
        });

        // ---- fidelity 模式：需要 sidecar + digest ----
        const sidecar = fspath.join(projectDir, 'sidecar.json');
        const digest = fspath.join(projectDir, 'source.json');
        if (fs.existsSync(sidecar) && fs.existsSync(digest) && context.lastBar > 0) {
            const checkArgs = [
                node, tools.check, context.file,
                '--bars', `1-${context.lastBar}`,
                '--map', sidecar,
                '--digest', digest,
                '--json'
            ];
            if (this.options.transpose !== undefined) {
                checkArgs.push('--transpose', String(this.options.transpose));
            }
            if (this.options.gain) {
                checkArgs.push('--gain', this.options.gain);
            }
            const contract = fspath.join(projectDir, 'melody-contract.json');
            if (fs.existsSync(contract)) {
                checkArgs.push('--contract', contract);
            }
            if (fs.existsSync(policy)) {
                checkArgs.push('--policy', policy);
            }
            if (this.options.warningsAsErrors) {
                checkArgs.push('--warnings-as-errors');
            }
            commands.push({
                name: 'check',
                argv: checkArgs,
                cwd: tools.root,
                trustExitCode: true
            });
        }

        return commands;
    }

    reduce(results: CommandResult[]): GateResult {
        const findings: Finding[] = [];
        const report: ReportRow[] = [];
        let ok = true;

        for (const result of results) {
            if (result.failure) {
                // 跑不起来 / 超时 / 输出不是 JSON —— 一律当失败，不当通过。
                ok = false;
                report.push({ label: result.name, status: 'fail', detail: result.failure });
                findings.push({
                    severity: 'error',
                    message: `${result.name} 未能完成：${result.failure}`,
                    source: result.name
                });
                continue;
            }

            const json = result.json;
            switch (result.name) {
                case 'validate':
                    ok = this.reduceValidate(json, findings, report) && ok;
                    break;
                case 'playability':
                    ok = this.reducePlayability(json, findings, report) && ok;
                    break;
                case 'check':
                    ok = this.reduceCheck(json, findings, report) && ok;
                    break;
            }
        }

        const errors = findings.filter(f => f.severity === 'error').length;
        const warnings = findings.filter(f => f.severity === 'warning').length;
        const summary = ok
            ? (warnings > 0 ? `门禁通过（${warnings} 条提示）` : '门禁通过')
            : `门禁未通过（${errors} 个错误）`;

        return { ok, findings, report, summary };
    }

    private reduceValidate(json: any, findings: Finding[], report: ReportRow[]): boolean {
        if (!json) {
            return true;
        }
        // 解析失败时 validate 给出的 errors[] 其实是**全部诊断**——
        // 里面混着 hint / warning / error 三种 severity（见 analysis.mjs 的
        // SEVERITY 表：0=hint 1=warning 2=error）。按字段原样分级，
        // 不能一律当 error，否则「点号可以省略」这种提示会变成红色报错。
        for (const item of json.errors ?? []) {
            findings.push({
                severity: item.severity === 'error' ? 'error'
                    : item.severity === 'warning' ? 'warning' : 'info',
                message: item.message,
                source: 'validate',
                code: item.code !== undefined ? `AT${item.code}` : undefined,
                line: item.line,
                col: item.col,
                endLine: item.endLine,
                endCol: item.endCol
            });
        }
        for (const warning of json.warnings ?? []) {
            findings.push({
                severity: 'warning',
                message: warning.message,
                source: 'validate',
                code: warning.type,
                bar: warning.bar
            });
        }
        const ok = json.ok !== false;
        report.push({
            label: 'validate',
            status: ok ? (json.warnings?.length ? 'warn' : 'pass') : 'fail',
            detail: json.stats
                ? `${json.stats.bars} 小节 · ${json.stats.notes} 音符 · ${json.stats.timeSignature ?? ''}`
                : undefined
        });
        return ok;
    }

    private reducePlayability(json: any, findings: Finding[], report: ReportRow[]): boolean {
        if (!json) {
            return true;
        }
        const errors = json.errors ?? [];
        const warnings = json.warnings ?? [];

        for (const error of errors) {
            findings.push({
                severity: 'error',
                message: error.message,
                source: 'playability',
                code: error.type,
                bar: error.bar,
                beat: error.beat
            });
        }
        for (const warning of warnings) {
            findings.push({
                severity: 'warning',
                message: warning.message,
                source: 'playability',
                code: warning.type,
                bar: warning.bar,
                beat: warning.beat
            });
        }

        // 只看 errors[]。退出码在有警告时也是 1，信它会把「通过但有提示」误判成失败。
        const ok = errors.length === 0;
        report.push({
            label: 'playability',
            status: ok ? (warnings.length ? 'warn' : 'pass') : 'fail',
            detail: `${errors.length} 个错误 · ${warnings.length} 条提示`,
            counts: json.stats
                ? { passed: json.stats.notesAnalyzed ?? 0, total: json.stats.notesAnalyzed ?? 0 }
                : undefined
        });
        return ok;
    }

    private reduceCheck(json: any, findings: Finding[], report: ReportRow[]): boolean {
        if (!json) {
            return true;
        }
        const compare = json.hard?.compare;
        if (compare) {
            // compare 有两种形态：
            //   带 --map 时是 mapResults[]，每条对应 sidecar 的一个段落，
            //     形状是 {mode, tabBars, sourceBars, ok, failures[]}——**没有覆盖率计数**
            //   不带 --map 时是 hardGates.{melodicSkeleton,harmonicRoots}，
            //     形状是 {covered, total, ok}——0/0 的判断只在这一种形态下有意义
            //  （playground/public/playground.js:206 也是这么区分的）
            if (Array.isArray(compare.mapResults)) {
                for (const row of compare.mapResults) {
                    const bars: number[] | undefined = Array.isArray(row.tabBars) ? row.tabBars : undefined;
                    report.push({
                        label: `compare ${bars ? `${bars[0]}–${bars[1]}` : ''} ${row.mode ?? ''}`.trim(),
                        status: row.ok === false ? 'fail' : 'pass'
                    });
                    for (const failure of row.failures ?? []) {
                        const entry: number[] | undefined = Array.isArray(failure.entry)
                            ? failure.entry
                            : bars;
                        findings.push({
                            severity: 'error',
                            message: failure.message ?? JSON.stringify(failure),
                            source: 'compare',
                            code: failure.gate,
                            bar: entry?.[0]
                        });
                    }
                }
            } else if (compare.hardGates) {
                for (const [key, label] of [
                    ['melodicSkeleton', '旋律骨架'],
                    ['harmonicRoots', '和声根音']
                ] as const) {
                    const gate = compare.hardGates[key];
                    if (!gate) {
                        continue;
                    }
                    const total = gate.total ?? 0;
                    const covered = gate.covered ?? 0;
                    report.push({
                        label: `compare ${label}`,
                        // 0/0 会「通过」是设计使然，但那是空检查，不能显示成绿色。
                        // AGENTS.md §A.2：干净得可疑的 0/0 是要排查的故障，不是战果。
                        status: gate.ok === false ? 'fail' : (total === 0 ? 'warn' : 'pass'),
                        counts: { passed: covered, total },
                        detail: total === 0
                            ? '0/0 是空过——这条门禁没有可比对的内容，需要排查'
                            : undefined
                    });
                }
                for (const failure of compare.failures ?? []) {
                    findings.push({
                        severity: 'error',
                        message: typeof failure === 'string'
                            ? failure
                            : (failure.message ?? JSON.stringify(failure)),
                        source: 'compare',
                        code: typeof failure === 'object' ? failure.gate : undefined,
                        bar: typeof failure === 'object' && Array.isArray(failure.entry)
                            ? failure.entry[0]
                            : undefined
                    });
                }
            }
        }

        const softCompare = json.soft?.compare;
        if (softCompare?.dropped?.length) {
            findings.push({
                severity: 'info',
                message: `比对提示：丢弃了 ${softCompare.dropped.length} 个音`,
                source: 'compare'
            });
        }

        const ok = json.ok !== false;
        report.push({
            label: 'check',
            status: ok ? 'pass' : 'fail',
            detail: ok ? undefined : (json.failReasons ?? []).join('；')
        });
        return ok;
    }
}
