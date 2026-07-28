import { execFile } from 'child_process';
import { CompanionCommand, CommandResult } from './contract';

/**
 * 跑伴生工具的子进程。
 *
 * 超时后一律报成执行失败，**绝不当成 PASS**——门禁没跑完和门禁通过是两回事。
 * Piano-to-Guitar 的 playground/serve.mjs 也是这么处理的（15 秒超时 → HTTP 500）。
 */

const DEFAULT_TIMEOUT_MS = 15000;

export interface RunOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}

export function runCommand(command: CompanionCommand, options: RunOptions = {}): Promise<CommandResult> {
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const [executable, ...args] = command.argv;

    return new Promise<CommandResult>(resolve => {
        if (!executable) {
            resolve({ name: command.name, exitCode: null, stderr: '', failure: '命令为空' });
            return;
        }

        execFile(executable, args, {
            cwd: command.cwd,
            timeout,
            // 门禁工具的 JSON 可能很大（比如整份谱子的统计），给足缓冲区
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true,
            signal: options.signal
        }, (error, stdout, stderr) => {
            const anyError = error as
                (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;

            if (anyError && (anyError.killed || anyError.code === 'ABORT_ERR')) {
                resolve({
                    name: command.name,
                    exitCode: null,
                    stderr: String(stderr ?? ''),
                    failure: anyError.code === 'ABORT_ERR'
                        ? '已取消'
                        : `超时（${timeout} ms）——按未完成处理，不算通过`
                });
                return;
            }
            if (anyError && anyError.code === 'ENOENT') {
                resolve({
                    name: command.name,
                    exitCode: null,
                    stderr: String(stderr ?? ''),
                    failure: `找不到可执行文件：${executable}`
                });
                return;
            }

            const exitCode = typeof anyError?.code === 'number' ? anyError.code : (anyError ? 1 : 0);

            let json: any;
            try {
                json = JSON.parse(stdout);
            } catch {
                json = undefined;
            }

            resolve({
                name: command.name,
                json,
                exitCode,
                stderr: String(stderr ?? ''),
                failure: json === undefined
                    ? `输出不是 JSON${stderr ? `：${String(stderr).trim().slice(0, 200)}` : ''}`
                    : undefined
            });
        });
    });
}

export async function runAll(
    commands: CompanionCommand[],
    options: RunOptions = {}
): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const command of commands) {
        results.push(await runCommand(command, options));
        if (options.signal?.aborted) {
            break;
        }
    }
    return results;
}
