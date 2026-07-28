import * as assert from 'assert';
import {
    fretToMidi, midiToName, parseFretToken, parseTuning,
    flipStringNumber, openStringName, STANDARD_TUNING_MIDI
} from '../fretboard';

describe('fretboard — 弦号方向', () => {
    it('alphaTex 的 1 号弦是最高的 e', () => {
        // \tuning (E4 B3 G3 D3 A2 E2) 是从高到低写的，所以下标 0 = 1 号弦 = E4
        assert.strictEqual(openStringName(1), 'E4');
        assert.strictEqual(openStringName(6), 'E2');
        assert.strictEqual(STANDARD_TUNING_MIDI[0], 64, '1 号弦是 E4 = MIDI 64');
        assert.strictEqual(STANDARD_TUNING_MIDI[5], 40, '6 号弦是 E2 = MIDI 40');
    });

    it('模型弦号与源码弦号互为镜像', () => {
        // alphaTab 内部模型反过来数：1 号弦是最低的 E。
        // 这是唯一的换算点，别在别处再写一遍。
        assert.strictEqual(flipStringNumber(1), 6);
        assert.strictEqual(flipStringNumber(6), 1);
        assert.strictEqual(flipStringNumber(3), 4);
        assert.strictEqual(flipStringNumber(flipStringNumber(2)), 2, '来回翻应该还原');
    });
});

describe('fretboard — 品位换算', () => {
    it('空弦音高正确', () => {
        assert.strictEqual(fretToMidi({ string: 6, fret: 0 }), 40);
        assert.strictEqual(midiToName(40), 'E2');
    });

    it('10.6 是 D3（Piano-to-Guitar 文档里的例子）', () => {
        // reference 里举的例子就是 `fret.mjs 10.6` → 10.6 = D3
        const midi = fretToMidi({ string: 6, fret: 10 });
        assert.strictEqual(midi, 50);
        assert.strictEqual(midiToName(midi!), 'D3');
    });

    it('同音高在下一根低弦上要 +5 品，但 2→3 弦是 +4', () => {
        const onString2 = fretToMidi({ string: 2, fret: 0 })!;   // B3
        const onString3 = fretToMidi({ string: 3, fret: 4 })!;   // G3 + 4
        assert.strictEqual(onString2, onString3, '2 弦空弦 = 3 弦第 4 品');

        const onString1 = fretToMidi({ string: 1, fret: 0 })!;   // E4
        const onString2b = fretToMidi({ string: 2, fret: 5 })!;  // B3 + 5
        assert.strictEqual(onString1, onString2b, '1 弦空弦 = 2 弦第 5 品');
    });

    it('弦号越界返回 undefined', () => {
        assert.strictEqual(fretToMidi({ string: 7, fret: 0 }), undefined);
        assert.strictEqual(fretToMidi({ string: 0, fret: 0 }), undefined);
    });
});

describe('fretboard — 记号解析', () => {
    it('解析 fret.string 和 fret.string.duration', () => {
        assert.deepStrictEqual(parseFretToken('12.2'), { fret: 12, string: 2 });
        assert.deepStrictEqual(parseFretToken('8.2.4'), { fret: 8, string: 2 });
        assert.deepStrictEqual(parseFretToken('0.6'), { fret: 0, string: 6 });
    });

    it('不是品位记号的东西不误判', () => {
        assert.strictEqual(parseFretToken('120'), undefined);
        assert.strictEqual(parseFretToken('r.4'), undefined);
        assert.strictEqual(parseFretToken('C#4'), undefined);
        assert.strictEqual(parseFretToken(''), undefined);
    });
});

describe('fretboard — 定弦解析', () => {
    it('读出标准定弦', () => {
        const tuning = parseTuning('\\tuning (E4 B3 G3 D3 A2 E2)');
        assert.deepStrictEqual(tuning, STANDARD_TUNING_MIDI);
    });

    it('读出 Drop D 并影响 6 弦音高', () => {
        const tuning = parseTuning('\\tuning (E4 B3 G3 D3 A2 D2)')!;
        assert.strictEqual(midiToName(tuning[5]), 'D2');
        assert.strictEqual(midiToName(fretToMidi({ string: 6, fret: 0 }, tuning)!), 'D2');
    });

    it('读出降半音定弦（带降号）', () => {
        const tuning = parseTuning('\\tuning (Eb4 Bb3 Gb3 Db3 Ab2 Eb2)')!;
        assert.strictEqual(midiToName(tuning[0]), 'D#4', 'Eb4 与 D#4 同音');
    });

    it('没有 \\tuning 时返回 undefined，让调用方回落到标准定弦', () => {
        assert.strictEqual(parseTuning('\\title "No tuning here"'), undefined);
    });
});
