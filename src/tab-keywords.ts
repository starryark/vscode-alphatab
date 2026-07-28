/**
 * alphaTex 的 \keyword 表。
 *
 * 旧版本只有 12 个词，而且 keywordDefault 的**值全是死代码**——只有
 * Object.keys 被用到过，补全永远只插一个光秃秃的关键字。provider 里那句
 * `if (keyword.includes('$'))` 同样是死的，因为没有任何一个键含 `$`。
 * （顺带一提，那个 ts 默认值 '${1:4} ${1:4}' 两个占位符用了同一个编号，
 * 就算走到了也会让两个数字联动。）
 *
 * 关键字清单以 Piano-to-Guitar 的 reference/alphatex-language.md 为准。
 */

export type KeywordScope =
    /** 必须写在 `.` 之前的乐谱元数据 */
    | 'score'
    /** 音轨 / 谱表级 */
    | 'staff'
    /** 小节级，写在小节内容前面 */
    | 'bar'
    /** MuseScore 导出时才会带的排版指令 */
    | 'layout';

export interface Keyword {
    /** 不带反斜杠的名字 */
    name: string;
    scope: KeywordScope;
    /** 一句话说明，显示在补全和悬停里 */
    doc: string;
    /** 补全插入的片段（SnippetString 语法）。留空表示只插关键字本身。 */
    snippet?: string;
}

export const KEYWORDS: Keyword[] = [
    // ---- 乐谱元数据 ----
    { name: 'title', scope: 'score', doc: '曲名。', snippet: 'title "${1:曲名}"' },
    { name: 'subtitle', scope: 'score', doc: '副标题。', snippet: 'subtitle "${1:副标题}"' },
    { name: 'artist', scope: 'score', doc: '演出者。', snippet: 'artist "${1:演出者}"' },
    { name: 'album', scope: 'score', doc: '专辑名。', snippet: 'album "${1:专辑}"' },
    { name: 'words', scope: 'score', doc: '作词。', snippet: 'words "${1:作词}"' },
    { name: 'music', scope: 'score', doc: '作曲。', snippet: 'music "${1:作曲}"' },
    { name: 'copyright', scope: 'score', doc: '版权信息。', snippet: 'copyright "${1:版权}"' },
    { name: 'tab', scope: 'score', doc: '扒谱／编配者署名。', snippet: 'tab "${1:编配者}"' },
    { name: 'instructions', scope: 'score', doc: '演奏说明。', snippet: 'instructions "${1:说明}"' },
    { name: 'notices', scope: 'score', doc: '附注。', snippet: 'notices "${1:附注}"' },

    // ---- 音轨 / 谱表 ----
    { name: 'track', scope: 'staff', doc: '开一条新音轨。', snippet: 'track "${1:音轨名}"' },
    {
        name: 'staff',
        scope: 'staff',
        doc: '谱表种类：score 是五线谱（用 C#4 这类音名），tabs 是六线谱（用 12.2 这类品位记号），两个都写则同时显示。',
        snippet: 'staff {${1|tabs,score,score tabs|}}'
    },
    {
        name: 'tuning',
        scope: 'staff',
        doc: '各弦定音，**从最高弦写起**。标准定弦是 (E4 B3 G3 D3 A2 E2)。',
        snippet: 'tuning (${1:E4 B3 G3 D3 A2 E2})'
    },
    { name: 'capo', scope: 'staff', doc: '变调夹品位。', snippet: 'capo ${1:2}' },
    {
        name: 'instrument',
        scope: 'staff',
        doc: 'MIDI 音色号或名称（27 清音电吉他，29 过载吉他，30 失真吉他）。',
        snippet: 'instrument ${1:30}'
    },
    {
        name: 'voice',
        scope: 'staff',
        doc: '在当前谱表上开一条新声部。声部 0 是隐式存在的，所以第一个 \\voice 得到的是声部 1。'
    },
    { name: 'lyrics', scope: 'staff', doc: '按 beat 对齐的歌词。', snippet: 'lyrics "${1:歌词}"' },
    { name: 'chord', scope: 'staff', doc: '定义一个和弦图。', snippet: 'chord "${1:名称}" ${2:0 2 2 1 0 0}' },

    // ---- 小节级 ----
    { name: 'ts', scope: 'bar', doc: '拍号。', snippet: 'ts (${1:4} ${2:4})' },
    { name: 'tempo', scope: 'bar', doc: '速度（BPM）。写在小节里表示中途变速。', snippet: 'tempo ${1:120}' },
    { name: 'ks', scope: 'bar', doc: '调号，例如 c、gminor、fsharp。', snippet: 'ks ${1:c}' },
    { name: 'clef', scope: 'bar', doc: '谱号：g2 高音，f4 低音，c3、c4、n（无）。', snippet: 'clef ${1|g2,f4,c3,c4,n|}' },
    {
        name: 'section',
        scope: 'bar',
        doc: '段落标记，会显示在谱面上，也是预览里段落导航和大纲视图的来源。',
        snippet: 'section "${1:段落名}"'
    },
    { name: 'ro', scope: 'bar', doc: '反复记号开始。' },
    { name: 'rc', scope: 'bar', doc: '反复记号结束，跟反复次数。', snippet: 'rc ${1:2}' },
    { name: 'ae', scope: 'bar', doc: '房子（跳房子反复）。', snippet: 'ae (${1:1 2})' },
    { name: 'ac', scope: 'bar', doc: '弱起小节。这一小节不受「小节必须填满」的检查约束。' },
    {
        name: 'tf',
        scope: 'bar',
        doc: '摇摆感（triplet feel）。',
        snippet: 'tf ${1|none,triplet8,triplet16,dotted8,dotted16,scottish8,scottish16|}'
    },
    { name: 'accidentals', scope: 'bar', doc: '临时记号处理方式。', snippet: 'accidentals ${1|auto,explicit|}' },
    { name: 'ottava', scope: 'bar', doc: '八度移动记号。', snippet: 'ottava ${1|regular,8va,8vb,15ma,15mb|}' },
    { name: 'simile', scope: 'bar', doc: '同前记号。', snippet: 'simile ${1|none,simple,firstDouble,secondDouble|}' },
    { name: 'slash', scope: 'bar', doc: '把这一小节记成斜杠节奏。' },
    { name: 'barlineright', scope: 'bar', doc: '右侧小节线样式。' },

    // ---- 排版（多为 MuseScore 导出带来的） ----
    { name: 'defaultSystemsLayout', scope: 'layout', doc: '每行默认多少小节。', snippet: 'defaultSystemsLayout ${1:4}' },
    { name: 'systemsLayout', scope: 'layout', doc: '逐行指定小节数。', snippet: 'systemsLayout (${1:3 3 3 3})' },
    { name: 'hideDynamics', scope: 'layout', doc: '隐藏力度记号。' },
    { name: 'showDynamics', scope: 'layout', doc: '显示力度记号。' },
    {
        name: 'bracketExtendMode',
        scope: 'layout',
        doc: '括线的延伸方式。',
        snippet: 'bracketExtendMode ${1|nobrackets,groupstaves,groupsimilarinstruments|}'
    },
    {
        name: 'firstSystemTrackNameOrientation',
        scope: 'layout',
        doc: '首行音轨名的方向。',
        snippet: 'firstSystemTrackNameOrientation ${1|horizontal,vertical|}'
    },
    {
        name: 'otherSystemsTrackNameOrientation',
        scope: 'layout',
        doc: '其余各行音轨名的方向。',
        snippet: 'otherSystemsTrackNameOrientation ${1|horizontal,vertical|}'
    },
    { name: 'multiBarRest', scope: 'layout', doc: '合并多小节休止。' }
];

export const KEYWORD_BY_NAME = new Map(KEYWORDS.map(keyword => [keyword.name.toLowerCase(), keyword]));

export const SCOPE_LABEL: Record<KeywordScope, string> = {
    score: '乐谱元数据',
    staff: '音轨 / 谱表',
    bar: '小节',
    layout: '排版'
};
