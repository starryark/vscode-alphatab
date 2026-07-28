import * as fspath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { barMapFromSidecar, BarMapEntry, Sidecar } from './bar-map';

/**
 * A/B 对照的另一半是谁。
 *
 * Piano-to-Guitar 的工作流里，人耳审听每个片段时都要拿改编谱和钢琴原谱来回对比
 * （docs/workflow.md 里这条指令出现了五次）。约定的目录结构是
 * `projects/<slug>/{cover,source}.alphatab`，所以默认就按这一对文件名去找。
 *
 * 同目录下如果有 sidecar.json，还能顺带拿到小节映射表：它的每条 entry 带
 * tabBars 和 sourceBars，正好说明改编谱第几小节对应原谱第几小节。
 */

export interface Partner {
    uri: vscode.Uri;
    alphatex: string;
    fileName: string;
    barMap?: BarMapEntry[];
}

function readJson<T>(path: string): T | undefined {
    try {
        return JSON.parse(fs.readFileSync(path, 'utf-8')) as T;
    } catch {
        return undefined;
    }
}

/**
 * 按配置里的文件名组合找同目录的对照文件。
 * 配置形如 ["cover.alphatab", "source.alphatab"]：打开其中一个，另一个就是参照谱。
 */
export function findPartner(uri: vscode.Uri): Partner | undefined {
    const names = vscode.workspace
        .getConfiguration('alphatab', uri)
        .get<string[]>('ab.partner', ['cover.alphatab', 'source.alphatab']);

    const dir = fspath.dirname(uri.fsPath);
    const self = fspath.basename(uri.fsPath);
    const index = names.findIndex(name => name.toLowerCase() === self.toLowerCase());
    if (index < 0) {
        return undefined;
    }

    for (let offset = 1; offset < names.length; offset++) {
        const candidate = fspath.join(dir, names[(index + offset) % names.length]);
        if (!fs.existsSync(candidate)) {
            continue;
        }
        let alphatex: string;
        try {
            alphatex = fs.readFileSync(candidate, 'utf-8');
        } catch {
            continue;
        }
        // 映射方向始终是「当前文件 → 参照文件」。sidecar 记的是
        // tabBars → sourceBars，所以打开的是 source 时要把映射反过来。
        const sidecar = readJson<Sidecar>(fspath.join(dir, 'sidecar.json'));
        const forward = barMapFromSidecar(sidecar);
        const selfIsTab = index === 0;
        const barMap = forward.length === 0
            ? undefined
            : selfIsTab
                ? forward
                : forward.map(entry => ({ from: entry.to, to: entry.from }))
                    .sort((a, b) => a.from.start - b.from.start);

        return {
            uri: vscode.Uri.file(candidate),
            alphatex,
            fileName: fspath.basename(candidate),
            barMap
        };
    }
    return undefined;
}
