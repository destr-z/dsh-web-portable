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
 * 零运行时依赖：不 import 任何 @deepseek-ai 包（schemastery 兼容的极简
 * schema 就地实现），与 dsh-mode-boost 同样的理由——注入器装载时模块
 * 解析路径可预期。
 */
/** Settings namespace（kebab-case）。 */
const NS = 'persona-switcher';
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
 * 极简 schemastery 兼容 schema：可直接调用校验，且带 toJSON 供 settings
 * 描述面渲染。undefined（未设置）合法且无默认值。
 */
const personaSchema = Object.assign((value) => {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('persona-switcher: section must be an object');
    }
    const doc = value;
    if (doc.templates !== undefined) {
        if (!Array.isArray(doc.templates)) {
            throw new TypeError('persona-switcher: templates must be an array');
        }
        for (const [index, tpl] of doc.templates.entries()) {
            if (checkTemplate(tpl) === null) {
                throw new TypeError(`persona-switcher: templates[${index}] must be { id, name, text } with non-empty id/name and string text`);
            }
        }
    }
    if (doc.sessions !== undefined) {
        if (typeof doc.sessions !== 'object' || doc.sessions === null) {
            throw new TypeError('persona-switcher: sessions must be an object');
        }
        for (const [sid, entry] of Object.entries(doc.sessions)) {
            if (entry === null || typeof entry !== 'object') {
                throw new TypeError(`persona-switcher: sessions.${sid} must be an object`);
            }
            const named = entry;
            if (typeof named.name !== 'string' || named.name.trim() === '') {
                throw new TypeError(`persona-switcher: sessions.${sid}.name must be a non-empty string`);
            }
            if (typeof named.text !== 'string' || named.text.trim() === '') {
                throw new TypeError(`persona-switcher: sessions.${sid}.text must be a non-empty string`);
            }
            if (named.id !== undefined && (typeof named.id !== 'string' || named.id.trim() === '')) {
                throw new TypeError(`persona-switcher: sessions.${sid}.id must be a non-empty string when present`);
            }
        }
    }
    return value;
}, {
    toJSON: () => ({
        type: 'object',
        properties: {
            templates: { type: 'array' },
            sessions: { type: 'object' },
        },
    }),
});
/** Required services：agents（会话枚举与生命周期）、settings（持久化）。 */
export const inject = ['agents', 'settings'];
/** Cordis plugin name（loader 诊断用）。 */
export const name = '@dsh-external/dsh-persona-switcher';
export function apply(ctx) {
    const personas = new Map();
    let scope;
    /** 该会话当前应显示的人设；undefined = 未选择（插件不干预）。 */
    const currentFor = (sessionId) => {
        if (scope === undefined)
            return undefined;
        const doc = scope.get();
        const entry = doc?.sessions?.[sessionId];
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
    // 注册 settings namespace（Web 部署必备；无 settings 服务则本插件不起效）。
    ctx.inject(['settings'], (sctx) => {
        scope = sctx.settings.register(NS, personaSchema, { applies: 'live' });
        // 首次安装：写入内置模板库（幂等——已有 templates 字段则不动）。
        const doc = scope.get();
        if (doc?.templates === undefined) {
            void sctx.settings.update(NS, { templates: BUILTIN_TEMPLATES.map(t => ({ ...t })) }).catch(() => {
                // 初始化失败不影响核心功能（模板为空时用户可在设置页新增）。
            });
        }
        reconcile();
        const stopWatch = scope.watch(() => reconcile());
        // settings 服务卸载时回落：清空数据源（所有人设段被 reconcile 摘除）。
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ctx.effect(() => () => {
            stopWatch();
            scope = undefined;
            reconcile();
        }, 'persona-switcher: settings detach');
    });
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