import type * as AlphaTabNamespace from '@coderline/alphatab';

/**
 * alphaTab 由 <script src="alphaTab.min.js"> 以 UMD 形式引入，挂在 globalThis 上。
 * 这里只 `import type`，编译后整条 import 会被抹掉，一个字节都不会打进 app.js。
 */
declare global {
    // eslint-disable-next-line no-var
    var alphaTab: typeof AlphaTabNamespace;
    // eslint-disable-next-line no-var
    var __alphaTabScriptUri: string | undefined;
}

export const at = globalThis.alphaTab;
export type AlphaTabApi = AlphaTabNamespace.AlphaTabApi;
export type Settings = AlphaTabNamespace.Settings;
export type Beat = AlphaTabNamespace.model.Beat;
export type Note = AlphaTabNamespace.model.Note;
export type Track = AlphaTabNamespace.model.Track;
