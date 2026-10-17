/**
 * @dsh-external/dsh-prompt-compare —— 宿主半边（设计文档 `docs/执行设计-v1.md`）。
 *
 * 这一半只做三件事：
 *   1. `prompt_compare_write_episode` 工具：agent 交"若干提示词块 + 每块来自剧本哪几行"，
 *      工具同时生成**提示词文件**和**清单文件**（行号由工具算，agent 不填）。
 *   2. `prompt_compare_write_manifest` 工具：提示词已经落盘（agent 直接改过 / 上一版就存在），
 *      只有清单要更新 —— 按每块**首行**（anchor）在提示词文件里定位，再算出 `promptLines`。
 *   3. 批注通道：浏览器把界面上的批注存/取到 `<工作区>/对照工作台/<版本>/批注/`。
 *
 * 锚点侧是**剧本**（只读参考，不随版本变）、作业侧是**提示词**（随版本走）——
 * 这与 `dsh-novel-script`（剧本批注）刻意同构，只是"哪边是锚点"换了方向。
 *
 * 刻意不做：版本管理（agent 用 Copy-Item / Move-Item / Remove-Item 自己做）、
 * 内容判断（哪块对应哪段剧情、对应得对不对）、事务与状态机。
 *
 * ⚠️ 写文件的唯一正确姿势（踩过两次的坑）：
 *     目标目录 = 调用方会话的 `header.cwd`；策略 = `sandboxPolicy.resolve({ session })`；
 *     把策略作为 `writeText` 的**第 5 个参数**传下去。不带策略时会退回部署默认策略，
 *     其根是 DSH 服务进程目录 → 写工作区一律被拒。
 *
 * ⚠️ 路径一律**工作区相对、正斜杠**（`对照工作台/v1/清单/第1集清单.txt`）：
 *     拼路径只用 `shared/protocol.ts` 里那几个函数，不要自己按 `../提示词/…` 换算 ——
 *     fs.resolve 的基准是会话工作区，多一层相对换算就多一处出错。
 */
/** 插件名（loader 诊断用）。 */
export declare const name = "@dsh-external/dsh-prompt-compare";
/** 硬依赖：没有 fs 和 tools 这个插件不起效。 */
export declare const inject: string[];
interface FsTarget {
    readonly [k: string]: unknown;
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
