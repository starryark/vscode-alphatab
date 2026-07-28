import * as assert from 'assert';
import { ScoreModel } from '../score-model';

/**
 * 这些用例锁的是「AST 拉平索引 ↔ 渲染模型分轨索引」那套换算。
 * 期望值不是拍脑袋写的，是拿 alphaTab 自己的 ScoreLoader 跑出来对过的：
 * 每个 staff 的 bars.length 应该等于该 staff 下各 voice 小节数的最大值。
 */

const MULTI_TRACK = [
    '\\title "Multi"',
    '.',
    '\\track "Gtr"',
    '\\staff {tabs}',
    '3.3.4 4.3.4 |',
    '5.3.4 6.3.4 |',
    '\\track "Bass"',
    '\\staff {tabs}',
    '1.4.4 2.4.4 |',
    '3.4.4 4.4.4 |'
].join('\n');

const TWO_STAFF = [
    '\\title "TwoStaff"',
    '.',
    '\\track "Piano"',
    '\\staff {score}',
    'c4 d4 |',
    'e4 f4 |',
    '\\staff {tabs}',
    '3.3.4 4.3.4 |',
    '5.3.4 6.3.4 |'
].join('\n');

const TWO_VOICES = [
    '\\title "Voices"',
    '.',
    '\\track "Gtr"',
    '\\staff {tabs}',
    '3.3.4 4.3.4 |',
    '5.3.4 6.3.4 |',
    '\\voice',
    '1.1.4 2.1.4 |',
    '3.1.4 4.1.4 |'
].join('\n');

const SINGLE = '\\title "NoTrack"\n.\n3.3.4 4.3.4 |\n5.3.4 6.3.4 |';

describe('ScoreModel — track/staff/voice 索引换算', () => {
    it('把第二个 \\track 的小节算到 track 1 上，而不是覆盖 track 0', () => {
        const model = ScoreModel.parse(MULTI_TRACK);
        assert.strictEqual(model.flatBarCount, 4, 'AST 里是拉平的 4 个小节');
        assert.strictEqual(model.trackCount, 2);
        assert.strictEqual(model.barCount(0, 0, 0), 2);
        assert.strictEqual(model.barCount(1, 0, 0), 2);
    });

    it('双轨谱里两条 track 的第 0 小节指向不同的源码行', () => {
        const model = ScoreModel.parse(MULTI_TRACK);
        const first = model.rangeOf({ track: 0, staff: 0, voice: 0, bar: 0 });
        const second = model.rangeOf({ track: 1, staff: 0, voice: 0, bar: 0 });
        assert.ok(first && second);
        assert.notStrictEqual(
            first.startLine, second.startLine,
            '这正是旧代码的 bug：两者都会解析到 ast.bars[0]'
        );
        // 小节的范围**从它前面的 metaData 开始算**，所以 track 1 的第一小节
        // 是从 `\track "Bass"` 那一行（0-based 第 6 行）起，而不是音符所在的第 8 行。
        assert.strictEqual(second.startLine, 6);
    });

    it('第一个 \\staff 是配置当前 staff，第二个才新开一条', () => {
        const model = ScoreModel.parse(TWO_STAFF);
        assert.strictEqual(model.trackCount, 1);
        assert.strictEqual(model.barCount(0, 0, 0), 2);
        assert.strictEqual(model.barCount(0, 1, 0), 2);
    });

    it('voice 0 是隐式的，所以第一个 \\voice 拿到的是 voice 1', () => {
        const model = ScoreModel.parse(TWO_VOICES);
        assert.strictEqual(model.barCount(0, 0, 0), 2);
        assert.strictEqual(model.barCount(0, 0, 1), 2);
        assert.strictEqual(model.flatBarCount, 4);
    });

    it('没有任何 \\track / \\staff 时一切都归到 track 0 staff 0', () => {
        const model = ScoreModel.parse(SINGLE);
        assert.strictEqual(model.trackCount, 1);
        assert.strictEqual(model.barCount(0, 0, 0), 2);
    });
});

describe('ScoreModel — 源码范围', () => {
    it('音符范围正好框住那个记号（end 是开区间）', () => {
        const text = '(12.2 15.1).8 r.4 |';
        const model = ScoreModel.parse(text);
        const range = model.rangeOf({ track: 0, staff: 0, voice: 0, bar: 0, beat: 0, note: 1 });
        assert.ok(range);
        assert.strictEqual(text.slice(range.startCol, range.endCol), '15.1',
            'alphaTab 的 .d.ts 把 end 注释成 inclusive，实测是 exclusive；' +
            '按 inclusive 处理会多框一个字符（"15.1)"）');
    });

    it('找不到音符时退回 beat，再退回 bar', () => {
        const model = ScoreModel.parse(SINGLE);
        const note = model.rangeOf({ track: 0, staff: 0, voice: 0, bar: 0, beat: 0, note: 99 });
        const beat = model.rangeOf({ track: 0, staff: 0, voice: 0, bar: 0, beat: 0 });
        assert.deepStrictEqual(note, beat, '越界的 note 应该退回 beat 的范围');
        const bar = model.rangeOf({ track: 0, staff: 0, voice: 0, bar: 0 });
        assert.ok(bar);
    });

    it('地址 → 范围 → 地址 能往返', () => {
        const model = ScoreModel.parse(MULTI_TRACK);
        const address = { track: 1, staff: 0, voice: 0, bar: 1, beat: 1 };
        const range = model.rangeOf(address);
        assert.ok(range);
        const back = model.addressAt(range.startLine, range.startCol);
        assert.ok(back);
        assert.strictEqual(back.track, 1);
        assert.strictEqual(back.bar, 1);
        assert.strictEqual(back.beat, 1);
    });

    it('rangeOfBar 用的是 1-based 小节号', () => {
        const model = ScoreModel.parse(SINGLE);
        const first = model.rangeOfBar(1);
        const second = model.rangeOfBar(2);
        assert.ok(first && second);
        // 第 1 小节把它前面的 \title 一起算进范围了（metaData 属于紧随其后的小节）
        assert.strictEqual(first.startLine, 0);
        assert.strictEqual(second.startLine, 3);
        assert.strictEqual(model.rangeOfBar(99), undefined, '越界的小节号返回 undefined');
    });
});

describe('ScoreModel — 诊断', () => {
    it('语法错误不抛异常，而是带着精确位置进 diagnostics', () => {
        // 和 Piano-to-Guitar 的 tools/fixtures/broken-syntax.alphatab 同一种坏法：
        // 和弦括号没闭合。这一点很关键——解析器**不抛异常**，而是返回一份可用的
        // 部分 AST 并把错误记进 parserDiagnostics，所以编辑到一半的文件也能出波浪线。
        const broken = [
            '\\title "Broken syntax"', '\\tempo 120', '.', '\\ts 4 4', '(3.3 2.4 |'
        ].join('\n');
        const model = ScoreModel.parse(broken);
        const errors = model.diagnostics.filter(d => d.severity === 'error');
        assert.ok(errors.length > 0, '未闭合的和弦括号应该报 error');
        assert.strictEqual(errors[0].range.startLine, 4, '错误应定位到第 5 行（0-based 4）');
        for (const diagnostic of model.diagnostics) {
            assert.ok(diagnostic.range.startLine >= 0);
            assert.ok(diagnostic.range.startCol >= 0);
        }
    });

    it('语法坏掉时仍然能给出小节结构（编辑途中不会整个失效）', () => {
        const broken = ['\\title "Broken"', '.', '3.3.4 4.3.4 |', '(5.3 6.3 |'].join('\n');
        const model = ScoreModel.parse(broken);
        assert.ok(model.flatBarCount > 0, '部分 AST 里应该还有小节');
    });

    it('干净的文件不产生 error 级诊断', () => {
        const model = ScoreModel.parse(SINGLE);
        assert.strictEqual(model.diagnostics.filter(d => d.severity === 'error').length, 0);
    });
});

describe('ScoreModel — 段落', () => {
    it('抽出 \\section 的名字和所在小节', () => {
        const text = [
            '\\title "Sections"', '.',
            '\\section "Intro"', '3.3.4 4.3.4 |',
            '5.3.4 6.3.4 |',
            '\\section "Chorus"', '3.3.4 4.3.4 |'
        ].join('\n');
        const model = ScoreModel.parse(text);
        assert.deepStrictEqual(model.sections.map(s => s.name), ['Intro', 'Chorus']);
        assert.strictEqual(model.sections[0].address.bar, 0);
        assert.strictEqual(model.sections[1].address.bar, 2);
    });
});
