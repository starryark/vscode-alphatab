import * as assert from 'assert';
import { barMapFromSidecar, mapBar, mapRange, invert } from '../bar-map';

/**
 * A/B 切换靠这张表把「改编谱第 N 小节」换算成「原谱第几小节」。
 * 结构取自 Piano-to-Guitar 真实的 projects/<slug>/sidecar.json。
 */

const SIDECAR = {
    song: 'test',
    entries: [
        { tabBars: [1, 2] as [number, number], mode: 'quote', sourceBars: [1, 2] as [number, number] },
        // free 段是新写的材料，没有 sourceBars——映射表里必须跳过它
        { tabBars: [3, 3] as [number, number], mode: 'free' },
        { tabBars: [4, 5] as [number, number], mode: 'quote', sourceBars: [4, 5] as [number, number] },
        // 压缩：原谱 8 小节被改编成 2 小节
        { tabBars: [6, 7] as [number, number], mode: 'recompose', sourceBars: [10, 17] as [number, number] }
    ]
};

describe('bar-map — 从 sidecar 构表', () => {
    it('跳过没有 sourceBars 的段落', () => {
        const entries = barMapFromSidecar(SIDECAR);
        assert.strictEqual(entries.length, 3, 'free 段没有 sourceBars，不进表');
        assert.deepStrictEqual(entries.map(e => e.from.start), [1, 4, 6]);
    });

    it('sidecar 为空或缺失时返回空表', () => {
        assert.deepStrictEqual(barMapFromSidecar(undefined), []);
        assert.deepStrictEqual(barMapFromSidecar({ entries: [] }), []);
        assert.deepStrictEqual(barMapFromSidecar({} as never), []);
    });
});

describe('bar-map — 映射', () => {
    const entries = barMapFromSidecar(SIDECAR);

    it('段内按比例换算', () => {
        assert.strictEqual(mapBar(1, entries), 1);
        assert.strictEqual(mapBar(2, entries), 2);
        assert.strictEqual(mapBar(4, entries), 4);
        assert.strictEqual(mapBar(5, entries), 5);
    });

    it('长度不同的段落按比例拉伸', () => {
        // tabBars 6-7 对 sourceBars 10-17：起点对起点，终点对终点
        assert.strictEqual(mapBar(6, entries), 10);
        assert.strictEqual(mapBar(7, entries), 17);
    });

    it('落在 free 段（表里的空隙）时贴到最近的边界，而不是静默失败', () => {
        // 第 3 小节是 free，没有对应的原谱小节
        const mapped = mapBar(3, entries);
        assert.ok(mapped === 2 || mapped === 4, `应贴到相邻段落边界，实际得到 ${mapped}`);
    });

    it('没有映射表时按 1:1 处理', () => {
        assert.strictEqual(mapBar(42, []), 42);
    });

    it('超出所有段落范围时也能给出结果', () => {
        assert.strictEqual(typeof mapBar(999, entries), 'number');
        assert.strictEqual(typeof mapBar(0, entries), 'number');
    });
});

describe('bar-map — 反向与区间', () => {
    const entries = barMapFromSidecar(SIDECAR);

    it('反向映射能把小节送回来', () => {
        const back = invert(entries);
        assert.strictEqual(mapBar(mapBar(4, entries), back), 4);
        assert.strictEqual(mapBar(mapBar(1, entries), back), 1);
    });

    it('区间映射保持 start <= end', () => {
        const mapped = mapRange({ start: 6, end: 7 }, entries);
        assert.strictEqual(mapped.start, 10);
        assert.strictEqual(mapped.end, 17);
        assert.ok(mapped.start <= mapped.end);
    });

    it('即使映射后顺序反转也会纠正过来', () => {
        const descending = [{ from: { start: 1, end: 2 }, to: { start: 9, end: 5 } }];
        const mapped = mapRange({ start: 1, end: 2 }, descending);
        assert.ok(mapped.start <= mapped.end);
    });
});
