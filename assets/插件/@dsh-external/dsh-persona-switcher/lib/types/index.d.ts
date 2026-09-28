/**
 * @dsh-external/dsh-persona-switcher — 按会话记忆人设（persona）的 host 端。
 *
 * 两层数据：
 * - `templates`：用户维护的人设模板库（名称 + 文字），在设置页编辑。
 * - `sessions`：会话 → 快照（模板选中的那一刻复制；模板后续修改不追溯）。
 *
 * 生效规则：**未选择的会话 = 插件完全不干预**（不注册任何段，与未装插件
 * 一致）；只有给某会话选择了模板（或清空后重新选择）才注册 `/` 摘除段。
 * 段注册在 agent 作用域（名为 deployment:persona、order 0），比 agent preset
 * 的 persona 行更贴近会话，因此必然遮蔽预设与全局人设。文本动态读取：
 * 设置变更后无需重注册，下一次模型请求即生效。
 *
 * 依赖：只 import 裸名 `schemastery`（构建时由 scripts/build.sh 链到
 * $DSH_CHECKOUT/vendor/schemastery，装载时模块解析路径可预期），不 import
 * 任何 @deepseek-ai 包——与 dsh-mode-boost 同样的理由。
 *
 * 0.1.7 起设置改为**声明式**：导出 `Config`（schemastery），可编辑字段用
 * `.volatile()` 标记；设置服务按 profile 条目 id 自动成表，写入持久化到
 * profile 的 cordis patch，条目重载后本 apply() 带新 config 再跑一次。
 * 旧的 `settings.register(ns, schema, { applies: 'live' })` 与 scope 的
 * `get()` / `watch()` 在 0.1.7 均已不存在。
 */
import z from 'schemastery';
/** 一个会话的人设快照。 */
interface PersonaEntry {
    /** 来源模板 id（快照自旧数据时可缺省）。 */
    id?: string;
    name: string;
    text: string;
}
/** 模板库条目。 */
interface PersonaTemplate {
    id: string;
    name: string;
    text: string;
}
/** settings namespace 文档形状。 */
interface SessionsDoc {
    templates?: PersonaTemplate[];
    sessions?: Record<string, PersonaEntry>;
}
/** 一个会话的 agent（行为契约最小面）。 */
interface SessionAgent {
    session: {
        id: string;
    };
    ctx: AgentScope;
}
/** agent 作用域 ctx（我们只调 inject）。 */
interface AgentScope {
    inject<Scope>(inject: string[], callback: (scope: Scope) => void): FiberHandle;
}
/** 可释放的 fiber 句柄。 */
interface FiberHandle {
    dispose(): unknown;
}
/** 宿主 ctx（行为契约最小面，避免依赖 cordis 声明合并与事件键类型）。 */
interface HostContext {
    agents: {
        list(): SessionAgent[];
    };
    on(event: string, listener: (payload: {
        agent: SessionAgent;
    }) => void): void;
    inject<Scope>(inject: string[], callback: (scope: Scope) => void): void;
    effect(fn: () => void | (() => void), label?: string): void;
    /** 本插件的 fiber（settings.configure 的 owner 参数）。 */
    fiber: unknown;
}
/**
 * 设置命名空间声明（0.1.7 声明式模型）。
 *
 * 命名空间 = profile 条目 id = `persona-switcher`（客户端半边有同名常量）。
 * `.volatile()` = 字段出现在设置描述面、客户端表单可写；写入经
 * `settings.update()` 落到 profile 的 cordis patch。
 *
 * 内置模板用 `.default()` 表达（0.1.7 的 base 层）——**不要**在 apply() 里
 * 命令式写入：describe() 只把 `fiber.state === ACTIVE` 的条目算作可配置，
 * 而 apply() 执行时自己的 fiber 还没 ACTIVE，写入必被拒。
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    templates: z<NoInfer<({
        id?: string | null | undefined;
        name?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        name: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>[]>, "volatile-defined">;
    sessions: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        id?: string | null | undefined;
        name?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        name: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>, string>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    templates: z<NoInfer<({
        id?: string | null | undefined;
        name?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        name: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>[]>, "volatile-defined">;
    sessions: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        id?: string | null | undefined;
        name?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        name: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>, string>>, "volatile-defined">;
}>>, "plain">;
/** Required services：agents（会话枚举与生命周期）、settings（持久化）。 */
export declare const inject: string[];
/** Cordis plugin name（loader 诊断用）。 */
export declare const name = "@dsh-external/dsh-persona-switcher";
export declare function apply(ctx: HostContext, config: SessionsDoc): void;
export {};
