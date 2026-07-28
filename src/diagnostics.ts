import * as vscode from 'vscode';
import { ScoreModel, SourceRange, ParseDiagnostic, DiagnosticSeverity } from './score-model';

/**
 * Problems 面板。两个来源合并到同一个 DiagnosticCollection：
 *
 *   1. alphaTab 解析器自带的 lexer / parser 诊断——在进程内就能拿到，
 *      不用起子进程，所以可以跟着每次编辑实时更新。
 *   2. 伴生工具（Piano-to-Guitar 的 validate / playability / check）跑出来的结论，
 *      按 1-based 小节号回填成源码范围。见 companion/。
 *
 * 之前这两类信息一条都没进过 VS Code：解析错误只在 webview 里画一个红块，
 * 而且只有「首次渲染之前就失败」才画得出来。
 */

export const DIAGNOSTIC_SOURCE = 'alphatab';

export function toVsRange(range: SourceRange): vscode.Range {
    return new vscode.Range(range.startLine, range.startCol, range.endLine, range.endCol);
}

function toVsSeverity(severity: DiagnosticSeverity): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error': return vscode.DiagnosticSeverity.Error;
        case 'warning': return vscode.DiagnosticSeverity.Warning;
        default: return vscode.DiagnosticSeverity.Hint;
    }
}

function fromParseDiagnostic(diagnostic: ParseDiagnostic): vscode.Diagnostic {
    const item = new vscode.Diagnostic(
        toVsRange(diagnostic.range),
        diagnostic.message,
        toVsSeverity(diagnostic.severity)
    );
    item.source = DIAGNOSTIC_SOURCE;
    if (diagnostic.code >= 0) {
        // alphaTab 的诊断码对外是 AT<code> 的形式（AT202、AT301 …）
        item.code = `AT${diagnostic.code}`;
    }
    return item;
}

export class DiagnosticSink {
    private readonly collection: vscode.DiagnosticCollection;
    /** 解析诊断和伴生工具诊断分开存，各自更新互不覆盖。 */
    private readonly parse = new Map<string, vscode.Diagnostic[]>();
    private readonly companion = new Map<string, vscode.Diagnostic[]>();

    constructor() {
        this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
    }

    setParseDiagnostics(uri: vscode.Uri, model: ScoreModel): void {
        this.parse.set(uri.toString(), model.diagnostics.map(fromParseDiagnostic));
        this.flush(uri);
    }

    setCompanionDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
        this.companion.set(uri.toString(), diagnostics);
        this.flush(uri);
    }

    clearCompanionDiagnostics(uri: vscode.Uri): void {
        this.companion.delete(uri.toString());
        this.flush(uri);
    }

    forget(uri: vscode.Uri): void {
        const key = uri.toString();
        this.parse.delete(key);
        this.companion.delete(key);
        this.collection.delete(uri);
    }

    private flush(uri: vscode.Uri): void {
        const key = uri.toString();
        this.collection.set(uri, [
            ...(this.parse.get(key) ?? []),
            ...(this.companion.get(key) ?? [])
        ]);
    }

    dispose(): void {
        this.collection.dispose();
    }
}
