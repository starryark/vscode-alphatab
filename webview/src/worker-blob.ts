/**
 * webview 里的 worker 不能 importScripts 跨源地址，而 alphaTab 会自动去猜一个
 * vscode-cdn.net 的 URL——这就是升级之后满控制台 importScripts NetworkError、
 * 预览一片空白的根因。
 *
 * 解决办法：在主线程把包 fetch 下来，包成同源的 blob: URL，交给 core.scriptFile。
 * 渲染本身走主线程（core.useWorkers = false），但**合成器必须在 worker 里**，
 * 所以这个 blob 不能省。
 *
 * 脚本地址由扩展宿主通过消息下发。旧代码是
 * `document.querySelector('script[src*="alphaTab.min.js"]')`，
 * 那等于永久禁止给这个文件改名或加内容 hash——改了播放会静默失效。
 */
export async function prepareWorkerScript(scriptUri: string): Promise<string | undefined> {
    try {
        const response = await fetch(scriptUri);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const code = await response.text();
        return URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    } catch (error) {
        console.warn('alphaTab worker blob prep failed; playback will be disabled', error);
        return undefined;
    }
}
