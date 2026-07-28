import * as fspath from 'path';
import * as vscode from 'vscode';

import { ScoreModel } from '../score-model';
import { DiagnosticSink, DIAGNOSTIC_SOURCE, toVsRange } from '../diagnostics';
import { CompanionAdapter, CompanionContext, Finding, GateResult, EMPTY_GATE, isVacuous } from './contract';
import { runAll } from './runner';
import { PianoToGuitarAdapter, PIANO_TO_GUITAR } from './piano-to-guitar';

/**
 * 把伴生工具接到 VS Code 上：跑命令、把结论变成 Problems 面板的波浪线、
 * 在状态栏显示门禁状态。
 */

function severityToVs(severity: Finding['severity']): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error': return vscode.DiagnosticSeverity.Error;
        case 'warning': return vscode.DiagnosticSeverity.Warning;
        default: return vscode.DiagnosticSeverity.Information;
    }
}

/**
 * 把一条结论定位到源码上。
 * 工具直接给了行列就用行列（1-based → 0-based）；只给了小节号就查 ScoreModel。
 * 两者都没有的落到文件开头，总比丢掉这条信息强。
 */
function rangeForFinding(finding: Finding, model: ScoreModel): vscode.Range {
    if (finding.line !== undefined && finding.col !== undefined) {
        const startLine = Math.max(0, finding.line - 1);
        const startCol = Math.max(0, finding.col - 1);
        const endLine = Math.max(0, (finding.endLine ?? finding.line) - 1);
        const endCol = Math.max(0, (finding.endCol ?? finding.col) - 1);
        return new vscode.Range(startLine, startCol, endLine, Math.max(endCol, startCol + 1));
    }
    if (finding.bar !== undefined) {
        const range = model.rangeOfBar(finding.bar);
        if (range) {
            return toVsRange(range);
        }
    }
    return new vscode.Range(0, 0, 0, 1);
}

export class CompanionService {
    private readonly statusBar: vscode.StatusBarItem;
    private readonly results = new Map<string, GateResult>();
    private readonly running = new Map<string, AbortController>();

    constructor(private readonly diagnostics: DiagnosticSink) {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
        this.statusBar.command = 'alphatab.runGate';
        this.statusBar.hide();
    }

    resultFor(uri: vscode.Uri): GateResult {
        return this.results.get(uri.toString()) ?? EMPTY_GATE;
    }

    private adapterFor(uri: vscode.Uri): CompanionAdapter | undefined {
        const config = vscode.workspace.getConfiguration('alphatab', uri);
        if (!config.get<boolean>('companion.enabled', true)) {
            return undefined;
        }
        const preset = config.get<string>('companion.preset', 'auto');
        if (preset === 'none') {
            return undefined;
        }
        if (preset === 'auto' || preset === PIANO_TO_GUITAR) {
            return new PianoToGuitarAdapter({
                transpose: config.get<number | null>('companion.transpose', null) ?? undefined,
                gain: config.get<'high' | 'crunch' | 'clean' | null>('companion.gain', null) ?? undefined,
                warningsAsErrors: config.get<boolean>('companion.warningsAsErrors', false)
            });
        }
        return undefined;
    }

    /** 跑一次门禁。同一个文件重复触发时，前一次会被取消。 */
    async run(uri: vscode.Uri, text: string): Promise<GateResult | undefined> {
        const adapter = this.adapterFor(uri);
        if (!adapter) {
            return undefined;
        }

        const context: CompanionContext = {
            file: uri.fsPath,
            cwd: fspath.dirname(uri.fsPath),
            lastBar: ScoreModel.parse(text).lastBar
        };
        if (!adapter.detect(context)) {
            return undefined;
        }

        const key = uri.toString();
        this.running.get(key)?.abort();
        const controller = new AbortController();
        this.running.set(key, controller);

        this.statusBar.text = '$(sync~spin) 门禁运行中';
        this.statusBar.tooltip = fspath.basename(uri.fsPath);
        this.statusBar.backgroundColor = undefined;
        this.statusBar.show();

        const commands = adapter.plan(context);
        const results = await runAll(commands, { signal: controller.signal });

        if (controller.signal.aborted) {
            return undefined;
        }
        this.running.delete(key);

        const gate = adapter.reduce(results);
        this.results.set(key, gate);
        this.publish(uri, text, gate);
        return gate;
    }

    private publish(uri: vscode.Uri, text: string, gate: GateResult): void {
        const model = ScoreModel.parse(text);
        const diagnostics = gate.findings.map(finding => {
            const item = new vscode.Diagnostic(
                rangeForFinding(finding, model),
                finding.message,
                severityToVs(finding.severity)
            );
            item.source = `${DIAGNOSTIC_SOURCE}:${finding.source}`;
            if (finding.code !== undefined) {
                item.code = finding.code;
            }
            return item;
        });
        this.diagnostics.setCompanionDiagnostics(uri, diagnostics);
        this.updateStatusBar(gate);
    }

    private updateStatusBar(gate: GateResult): void {
        const vacuous = gate.report.filter(isVacuous).length;
        if (!gate.ok) {
            const errors = gate.findings.filter(f => f.severity === 'error').length;
            this.statusBar.text = `$(error) 门禁未通过 ×${errors}`;
            this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (vacuous > 0) {
            // 干净得可疑的 0/0 不能显示成绿色的通过。
            this.statusBar.text = `$(warning) 门禁通过（${vacuous} 条空检查）`;
            this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            const warnings = gate.findings.filter(f => f.severity === 'warning').length;
            this.statusBar.text = warnings > 0 ? `$(check) 门禁通过 · ${warnings} 提示` : '$(check) 门禁通过';
            this.statusBar.backgroundColor = undefined;
        }
        this.statusBar.tooltip = new vscode.MarkdownString(
            [
                `**${gate.summary}**`,
                '',
                ...gate.report.map(row => {
                    const mark = row.status === 'pass' ? '✓' : row.status === 'fail' ? '✗' : '!';
                    const counts = row.counts ? ` \`${row.counts.passed}/${row.counts.total}\`` : '';
                    const suspect = isVacuous(row) ? ' ⚠ 空检查' : '';
                    return `- ${mark} ${row.label}${counts}${suspect}${row.detail ? ` — ${row.detail}` : ''}`;
                }),
                '',
                '_点击重新运行_'
            ].join('\n')
        );
        this.statusBar.show();
    }

    clear(uri: vscode.Uri): void {
        this.running.get(uri.toString())?.abort();
        this.running.delete(uri.toString());
        this.results.delete(uri.toString());
        this.diagnostics.clearCompanionDiagnostics(uri);
        this.statusBar.hide();
    }

    dispose(): void {
        for (const controller of this.running.values()) {
            controller.abort();
        }
        this.statusBar.dispose();
    }
}
