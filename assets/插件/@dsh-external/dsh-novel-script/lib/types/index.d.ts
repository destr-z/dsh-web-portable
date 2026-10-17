/**
 * @dsh-external/dsh-novel-script —— 宿主半边（设计文档 `docs/执行设计-v2.md`）。
 *
 * 这一半只做两件事：
 *   1. `novel_script_write_episode` 工具：agent 交"若干剧本段落 + 每段来自原文哪几行"，
 *      工具同时生成**剧本文件**和**清单文件**（行号由工具算，agent 不填）。
 *   2. 批注通道：浏览器把界面上的批注存/取到 `<工作区>/剧本工作台/<版本>/批注/`。
 *
 * 刻意不做：版本管理（agent 用 Copy-Item / Move-Item / Remove-Item 自己做）、
 * 内容判断（谁是角色、哪句是台词、对应得对不对）、事务与状态机。
 *
 * ⚠️ 写文件的唯一正确姿势（踩过两次的坑）：
 *     目标目录 = 调用方会话的 `header.cwd`；策略 = `sandboxPolicy.resolve({ session })`；
 *     把策略作为 `writeText` 的**第 5 个参数**传下去。不带策略时会退回部署默认策略，
 *     其根是 DSH 服务进程目录 → 写工作区一律被拒。
 */
/** 插件名（loader 诊断用）。 */
export declare const name = "@dsh-external/dsh-novel-script";
/** 硬依赖：没有 fs 和 tools 这个插件不起效。 */
export declare const inject: string[];
interface FsTarget {
    readonly [k: string]: unknown;
}
/** `fs.listDir` 返回的一项（只要最小面）。 */
interface FsDirEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
}
/** 一次写入要带的沙箱策略。 */
interface SandboxPolicy {
    mode?: string;
    workspaceRoot?: string;
    sessionId?: string;
}
interface FsFace {
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    writeText(target: FsTarget, text: string, expected?: unknown, signal?: AbortSignal, sandboxPolicy?: SandboxPolicy): Promise<unknown>;
    stat(target: FsTarget, signal?: AbortSignal): Promise<{
        size?: number;
    } | undefined>;
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
}
interface ToolsFace {
    register(tool: unknown): () => void;
}
interface LoggerFace {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
/** Connection 的 exact Fetch route（`/api` 载体自带认证与 Host/Origin 校验）。 */
interface ConnectionFetchRoute {
    path: string;
    methods: readonly string[];
    requestBody: 'buffered' | 'streaming';
    fetch: (request: Request) => Promise<Response>;
}
interface HostScope {
    connection?: {
        fetch: {
            register(route: ConnectionFetchRoute): () => Promise<void>;
        };
    };
}
interface HostContext {
    fs: FsFace;
    tools: ToolsFace;
    logger: LoggerFace;
    effect(fn: () => void | (() => void), label?: string): void;
    /** 可选服务查询（cordis `ctx.get`）。 */
    get?(name: string): unknown;
    /** 等服务就绪后再跑（cordis `ctx.inject`）。 */
    inject?(names: string[], fn: (scope: HostScope) => void): void;
}
interface PluginConfig {
    workspaceRoot?: string;
}
/**
 * @param ctx - 宿主上下文（已声明 fs / tools 依赖）。
 * @param config - 插件配置；`workspaceRoot` 只是**没有会话时**的兜底目录（测试用）。
 */
export declare function apply(ctx: HostContext, config?: PluginConfig): void;
export {};
