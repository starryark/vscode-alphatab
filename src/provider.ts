import * as vscode from 'vscode';

import { KEYWORDS, KEYWORD_BY_NAME, SCOPE_LABEL } from './tab-keywords';
import { ScoreModel } from './score-model';
import {
    parseFretToken, parseTuning, fretToMidi, midiToName,
    openStringName, STANDARD_TUNING_MIDI
} from './fretboard';

/**
 * 语言功能：补全、悬停、大纲、折叠。
 *
 * 旧的补全 provider 把 document / position / context 全部忽略，
 * 不管光标在哪都吐同一批词——包括在字符串和注释里面。
 */

/** 光标是不是在字符串或注释里面。 */
function inStringOrComment(line: string, character: number): boolean {
    const before = line.slice(0, character);
    if (before.includes('//')) {
        return true;
    }
    // 数一下前面有几个未转义的引号，奇数说明在字符串里
    let quotes = 0;
    for (let i = 0; i < before.length; i++) {
        if (before[i] === '"' && before[i - 1] !== '\\') {
            quotes++;
        }
    }
    return quotes % 2 === 1;
}

const SCOPE_ORDER: Record<string, number> = { score: 0, staff: 1, bar: 2, layout: 3 };

class AlphatabKeywordCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] | undefined {
        const line = document.lineAt(position.line).text;
        if (inStringOrComment(line, position.character)) {
            return undefined;
        }

        return KEYWORDS.map(keyword => {
            const item = new vscode.CompletionItem(
                `\\${keyword.name}`, vscode.CompletionItemKind.Keyword
            );
            item.detail = SCOPE_LABEL[keyword.scope];
            item.documentation = new vscode.MarkdownString(keyword.doc);
            // 触发字符 `\` 已经在文档里了，所以插入内容不带反斜杠。
            item.insertText = keyword.snippet
                ? new vscode.SnippetString(keyword.snippet)
                : keyword.name;
            item.filterText = keyword.name;
            // 让作用域相近的排在一起：元数据 → 音轨 → 小节 → 排版
            item.sortText = `${SCOPE_ORDER[keyword.scope]}${keyword.name}`;
            return item;
        });
    }
}

const FRET_TOKEN = /\b\d+\.\d+(?:\.\d+)?\b/;
const KEYWORD_TOKEN = /\\[a-zA-Z]+/;

class AlphatabHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const keywordRange = document.getWordRangeAtPosition(position, KEYWORD_TOKEN);
        if (keywordRange) {
            const name = document.getText(keywordRange).slice(1).toLowerCase();
            const keyword = KEYWORD_BY_NAME.get(name);
            if (!keyword) {
                return undefined;
            }
            return new vscode.Hover(
                new vscode.MarkdownString(
                    `**\\${keyword.name}** — ${SCOPE_LABEL[keyword.scope]}\n\n${keyword.doc}`
                ),
                keywordRange
            );
        }

        const fretRange = document.getWordRangeAtPosition(position, FRET_TOKEN);
        if (!fretRange) {
            return undefined;
        }
        const parsed = parseFretToken(document.getText(fretRange));
        if (!parsed) {
            return undefined;
        }

        // 定弦从文件里读，读不到就按标准定弦算，并在提示里说明这一点。
        const tuning = parseTuning(document.getText());
        const midi = fretToMidi(parsed, tuning ?? STANDARD_TUNING_MIDI);
        if (midi === undefined) {
            return undefined;
        }
        const open = openStringName(parsed.string, tuning ?? STANDARD_TUNING_MIDI);
        const lines = [
            `**${midiToName(midi)}** — ${parsed.string} 弦（空弦 ${open}）第 ${parsed.fret} 品`,
            '',
            `MIDI ${midi}`
        ];
        if (!tuning) {
            lines.push('', '_文件里没有 \\tuning，按标准定弦计算_');
        }
        return new vscode.Hover(new vscode.MarkdownString(lines.join('\n')), fretRange);
    }
}

/** 段落的行区间：从本段起始行到下一段起始行的前一行。 */
function sectionSpans(document: vscode.TextDocument): { name: string; bar: number; start: number; end: number }[] {
    const sections = ScoreModel.parse(document.getText()).sections;
    return sections.map((section, index) => ({
        name: section.name,
        bar: section.address.bar + 1,
        start: section.range.startLine,
        end: index + 1 < sections.length
            ? Math.max(section.range.startLine, sections[index + 1].range.startLine - 1)
            : document.lineCount - 1
    }));
}

/**
 * 大纲视图 / 面包屑。段落来自 \section，正好对应编排计划里的曲式。
 * 一份 700 行的谱子没有这个基本没法导航。
 */
class AlphatabSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
        return sectionSpans(document).map(span => new vscode.DocumentSymbol(
            span.name,
            `第 ${span.bar} 小节起`,
            vscode.SymbolKind.Namespace,
            new vscode.Range(span.start, 0, span.end, document.lineAt(span.end).text.length),
            new vscode.Range(span.start, 0, span.start, document.lineAt(span.start).text.length)
        ));
    }
}

class AlphatabFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        return sectionSpans(document)
            .filter(span => span.end > span.start)
            .map(span => new vscode.FoldingRange(span.start, span.end, vscode.FoldingRangeKind.Region));
    }
}

export const alphatabKeywordCompletionItemProvider = new AlphatabKeywordCompletionItemProvider();
export const alphatabHoverProvider = new AlphatabHoverProvider();
export const alphatabSymbolProvider = new AlphatabSymbolProvider();
export const alphatabFoldingProvider = new AlphatabFoldingProvider();
