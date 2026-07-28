import * as assert from 'assert';
import * as fs from 'fs';
import * as fspath from 'path';

import { PianoToGuitarAdapter } from '../companion/piano-to-guitar';
import { CommandResult, isVacuous, ReportRow } from '../companion/contract';

/**
 * 这些用例吃的是**真实工具跑出来的 JSON**（录在 fixtures/ 下），不是手编的样本。
 * 重录命令见每个断言旁边的注释。
 */

// tsc 只编译 .ts，不会把 JSON 复制到 out/，所以直接读源码树里的 fixtures。
// __dirname 编译后是 out/test。
const FIXTURES = fspath.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures');
const load = (name: string) => JSON.parse(fs.readFileSync(fspath.join(FIXTURES, name), 'utf-8'));

const result = (name: string, json: any, exitCode: number): CommandResult =>
    ({ name, json, exitCode, stderr: '' });

describe('piano-to-guitar 适配器 — playability 的退出码陷阱', () => {
    const adapter = new PianoToGuitarAdapter();

    it('只有警告没有错误时判定为通过，哪怕退出码是 1', () => {
        // 录自：node tools/playability.mjs tools/fixtures/position-jump-slow.alphatab --json
        // 这个文件真实表现是 exit=1、errors=0、warnings=14。
        // playability.mjs 有警告时也会 exit 1，所以退出码不能当判定依据——
        // AGENTS.md、check.mjs、playground/serve.mjs 三处都点名过这个坑。
        const json = load('playability-warnings-only.json');
        assert.strictEqual(json.errors.length, 0, 'fixture 前提：没有错误');
        assert.ok(json.warnings.length > 0, 'fixture 前提：有警告');

        const gate = adapter.reduce([result('playability', json, 1)]);

        assert.strictEqual(gate.ok, true, '退出码是 1，但没有 error，就该判通过');
        assert.strictEqual(gate.findings.filter(f => f.severity === 'error').length, 0);
        assert.strictEqual(gate.findings.filter(f => f.severity === 'warning').length, json.warnings.length);
    });

    it('有 errors 时判定为失败', () => {
        // 录自：node tools/playability.mjs tools/fixtures/non-adjacent-dyad.alphatab --json
        const json = load('playability-error.json');
        const gate = adapter.reduce([result('playability', json, 1)]);

        assert.strictEqual(gate.ok, false);
        const errors = gate.findings.filter(f => f.severity === 'error');
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, 'non-adjacent-strings');
        assert.strictEqual(errors[0].bar, 1, '结论要带小节号才能定位到源码');
    });

    it('退出码为 0 但有 errors 时同样判失败（只认 errors）', () => {
        const json = load('playability-error.json');
        const gate = adapter.reduce([result('playability', json, 0)]);
        assert.strictEqual(gate.ok, false, '判定只看 errors[]，两个方向都不看退出码');
    });
});

describe('piano-to-guitar 适配器 — validate', () => {
    const adapter = new PianoToGuitarAdapter();

    it('语法错误带着精确行列进结论', () => {
        // 录自：node tools/validate.mjs tools/fixtures/broken-syntax.alphatab --json
        const json = load('validate-broken.json');
        const gate = adapter.reduce([result('validate', json, 1)]);

        assert.strictEqual(gate.ok, false);
        const errors = gate.findings.filter(f => f.severity === 'error');
        assert.ok(errors.length > 0, '应该有 error 级结论');
        assert.strictEqual(errors[0].line, 5, 'broken-syntax 的 AT202 在第 5 行');
        assert.strictEqual(errors[0].col, 10);
        assert.strictEqual(errors[0].code, 'AT202');
    });

    it('validate 的 errors[] 里混着三种 severity，要按字段分级', () => {
        // 这个数组名字叫 errors，装的却是全部诊断：AT400 是 hint、AT301 是 warning、
        // AT202/AT206 才是 error。一律当 error 会把「点号可以省略」画成红波浪线。
        const json = load('validate-broken.json');
        const gate = adapter.reduce([result('validate', json, 1)]);
        const bySeverity = (s: string) => gate.findings.filter(f => f.severity === s).length;

        assert.strictEqual(bySeverity('info'), 1, 'AT400 是 hint → info');
        assert.strictEqual(bySeverity('warning'), 1, 'AT301 是 warning');
        assert.strictEqual(bySeverity('error'), 2, 'AT202 + AT206');
    });

    it('小节填充警告带小节号，且不算硬失败', () => {
        // 录自：node tools/validate.mjs tools/fixtures/overfull-voice.alphatab --json
        const json = load('validate-overfull.json');
        const gate = adapter.reduce([result('validate', json, 0)]);

        const warnings = gate.findings.filter(f => f.severity === 'warning');
        assert.strictEqual(warnings.length, 1);
        assert.strictEqual(warnings[0].bar, 1);
        assert.match(warnings[0].message, /overfull/i);
        assert.strictEqual(gate.ok, true, 'bar-fill 是警告，不是硬失败');
    });
});

describe('piano-to-guitar 适配器 — 执行失败不能变成通过', () => {
    const adapter = new PianoToGuitarAdapter();

    it('超时判失败', () => {
        const gate = adapter.reduce([
            { name: 'check', exitCode: null, stderr: '', failure: '超时（15000 ms）——按未完成处理，不算通过' }
        ]);
        assert.strictEqual(gate.ok, false, '门禁没跑完 ≠ 门禁通过');
        assert.strictEqual(gate.findings[0].severity, 'error');
    });

    it('输出不是 JSON 时判失败', () => {
        const gate = adapter.reduce([
            { name: 'validate', exitCode: 0, stderr: 'boom', failure: '输出不是 JSON：boom' }
        ]);
        assert.strictEqual(gate.ok, false);
    });
});

describe('piano-to-guitar 适配器 — check 的两种 compare 形态', () => {
    const adapter = new PianoToGuitarAdapter();

    it('带 --map 时读 mapResults，且不伪造覆盖率计数', () => {
        // 录自 liezhijiuba：node tools/check.mjs cover.alphatab --bars 1-108 --map sidecar.json ...
        // mapResults 的行只有 {mode, tabBars, sourceBars, ok, failures}，**没有 covered/total**。
        // 之前这里凭空读出 0/0，把每一段都误标成「空门禁」，真正的空过反而被淹了。
        const json = load('check-map-pass.json');
        assert.ok(Array.isArray(json.hard.compare.mapResults), 'fixture 前提：是 map 形态');

        const gate = adapter.reduce([result('check', json, 0)]);
        assert.strictEqual(gate.ok, true);

        const compareRows = gate.report.filter(r => r.label.startsWith('compare'));
        assert.ok(compareRows.length > 0, '每个 sidecar 段落都该有一行');
        assert.ok(
            compareRows.every(r => r.counts === undefined),
            'map 形态没有覆盖率，就不该编出计数来'
        );
        assert.strictEqual(compareRows.filter(isVacuous).length, 0, '不该有任何行被判成空门禁');
    });

    it('map 形态下的 failure 带上段落起始小节，才能定位到源码', () => {
        // 录自 your-love-is-a-drug：第 9–16 小节的 quote 段没通过旋律骨架门禁
        const json = load('check-map-fail.json');
        const gate = adapter.reduce([result('check', json, 1)]);

        assert.strictEqual(gate.ok, false);
        const compareFindings = gate.findings.filter(f => f.source === 'compare');
        assert.ok(compareFindings.length > 0);
        assert.strictEqual(compareFindings[0].bar, 9, '锚定到 tabBars 的第一小节');
        assert.strictEqual(compareFindings[0].code, 'melodicSkeleton');
    });

    it('不带 --map 时读 hardGates 的 covered/total', () => {
        // 录自：node tools/check.mjs cover.alphatab --bars 1-8 --digest source.json --json
        // 这一形态才有 {covered, total, ok}，0/0 的判断只在这里有意义
        // （playground/public/playground.js:206 也是这么区分的）。
        const json = load('check-baraligned.json');
        assert.ok(json.hard.compare.hardGates, 'fixture 前提：是 bar-aligned 形态');

        const gate = adapter.reduce([result('check', json, 0)]);
        const withCounts = gate.report.filter(r => r.counts !== undefined);
        assert.strictEqual(withCounts.length, 2, '旋律骨架 + 和声根音');
        assert.ok(withCounts.every(r => r.counts!.total > 0), 'fixture 里两条都是非空的');
        assert.strictEqual(withCounts.filter(isVacuous).length, 0);
    });

    it('hardGates 报 0/0 时判为可疑，不显示成通过', () => {
        // 手工把 fixture 的计数改成 0，模拟 §A.2 那种「比对范围过宽 → 空过」的情况
        const json = JSON.parse(JSON.stringify(load('check-baraligned.json')));
        json.hard.compare.hardGates.melodicSkeleton = { covered: 0, total: 0, ok: true };

        const gate = adapter.reduce([result('check', json, 0)]);
        const row = gate.report.find(r => r.label.includes('旋律骨架'))!;
        assert.strictEqual(row.status, 'warn', '0/0 不能是绿色的 pass');
        assert.strictEqual(isVacuous(row), true);
    });
});

describe('空门禁（0/0）识别', () => {
    it('总数为 0 的报告行标记为可疑', () => {
        // AGENTS.md §A.2：比对范围过宽时随便什么音符都能过，
        // 看起来是干净的 PASS，其实什么都没检。0/0 是要排查的故障，不是战果。
        const vacuous: ReportRow = { label: 'compare 1–8', status: 'pass', counts: { passed: 0, total: 0 } };
        const real: ReportRow = { label: 'compare 1–8', status: 'pass', counts: { passed: 8, total: 8 } };
        assert.strictEqual(isVacuous(vacuous), true);
        assert.strictEqual(isVacuous(real), false);
    });

    it('没有计数的行不会被误判成空门禁', () => {
        assert.strictEqual(isVacuous({ label: 'validate', status: 'pass' }), false);
    });
});
