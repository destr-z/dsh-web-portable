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
/** 与各级 persona 同名的 prompt section（此段在会话作用域遮蔽全局/预设）。 */
const PERSONA_SECTION = 'deployment:persona';
/** 与 system-prompt 全局 persona 相同的 order。 */
const PERSONA_ORDER = 0;
/** 模板库初始内容（首次安装时写入；用户可增删改）。 */
const BUILTIN_TEMPLATES = [
    {
        id: 'neko-catgirl',
        name: '猫娘',
        text: '你是一个猫娘',
    },
];
/** 校验一个模板条目的字段形状，返回清洗后的条目或 null。模板文字允许为空
 * （未填完的草稿模板可先保存）；名称必须非空。 */
function checkTemplate(entry) {
    if (entry === null || typeof entry !== 'object')
        return null;
    const e = entry;
    if (typeof e.id !== 'string' || e.id.trim() === '')
        return null;
    if (typeof e.name !== 'string' || e.name.trim() === '')
        return null;
    if (typeof e.text !== 'string')
        return null;
    return { id: e.id, name: e.name, text: e.text };
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
export const Config = z.object({
    // 内置模板直接作为 schema 默认值（0.1.7 的 base 层）：不需要命令式写入，
    // 用户清空后是"显式覆盖"、内置的不会长回来；清除该字段则回落到内置。
    templates: z.array(z.object({
        id: z.string(),
        name: z.string(),
        text: z.string(),
    })).default(BUILTIN_TEMPLATES.map(t => ({ ...t }))).volatile(),
    sessions: z.dict(z.object({
        id: z.string(),
        name: z.string(),
        text: z.string(),
    })).default({}).volatile(),
});
/** Required services：agents（会话枚举与生命周期）、settings（持久化）。 */
export const inject = ['agents', 'settings'];
/** Cordis plugin name（loader 诊断用）。 */
export const name = '@dsh-external/dsh-persona-switcher';
export function apply(ctx, config) {
    const personas = new Map();
    // 0.1.7：设置值就是本插件的 Config（声明式）。写入落到 profile 的 cordis
    // patch，条目重载后本函数带新 config 重新执行，因此不再需要 scope.watch。
    const doc = () => config ?? {};
    /** 该会话当前应显示的人设；undefined = 未选择（插件不干预）。 */
    const currentFor = (sessionId) => {
        const entry = doc().sessions?.[sessionId];
        if (entry === undefined)
            return undefined;
        if (typeof entry.name !== 'string' || entry.name.trim() === '')
            return undefined;
        if (typeof entry.text !== 'string' || entry.text.trim() === '')
            return undefined;
        return entry;
    };
    /** 为 one agent 注册人设段（幂等；未选择时跳过）。 */
    const ensure = (agent) => {
        if (personas.has(agent))
            return;
        const sessionId = agent.session.id;
        if (currentFor(sessionId) === undefined)
            return;
        const fiber = agent.ctx.inject(['systemPrompt'], (ascope) => {
            ascope.systemPrompt.section({
                name: PERSONA_SECTION,
                order: PERSONA_ORDER,
                text: () => currentFor(sessionId)?.text ?? '',
            });
        });
        personas.set(agent, fiber);
    };
    /** 移除 one agent 的人设段（幂等）。 */
    const drop = (agent) => {
        const fiber = personas.get(agent);
        if (fiber === undefined)
            return;
        personas.delete(agent);
        try {
            fiber.dispose();
        }
        catch {
            // teardown 尽力而为
        }
    };
    /** 对全部现存 agent 依据当前设置重放（新选择 → 注册；清空 → 摘除）。 */
    const reconcile = () => {
        for (const agent of ctx.agents.list()) {
            if (currentFor(agent.session.id) !== undefined) {
                ensure(agent);
            }
            else {
                drop(agent);
            }
        }
    };
    // settings 只是"展示策略出口"：命名空间由导出的 Config 声明，无需注册，
    // 内置模板走 schema 默认值，也不需要写入。
    ctx.inject(['settings'], (sctx) => {
        // 本插件自带设置页（settings.plugins.tab），关掉自动生成的表单。
        ctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), 'persona-switcher: settings presentation');
    });
    reconcile();
    // 会话（agent）生命周期。
    ctx.on('agent/created', ({ agent }) => { ensure(agent); });
    ctx.on('agent/disposed', ({ agent }) => { drop(agent); });
    // 插件卸载：摘除所有人设段。
    ctx.effect(() => () => {
        for (const [agent] of [...personas.entries()]) {
            drop(agent);
        }
    }, 'persona-switcher: teardown');
}
//# sourceMappingURL=index.js.map