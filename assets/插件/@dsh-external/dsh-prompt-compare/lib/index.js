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
import { ANNOTATION_ROUTE, MANIFEST_SCHEMA, RE_VERSION_ARG, annotationPath, manifestPath, promptPath, scriptPath, } from "./shared/protocol.js";
import { blockTextError, buildPromptText, checkScriptRanges, computePromptLinesByAnchors, locateAnchor, manifestWarnings, mergeAnnotations, normalizeNewlines, parseAnnotations, splitLines, } from "./shared/validate.js";
/** 插件名（loader 诊断用）。 */
export const name = '@dsh-external/dsh-prompt-compare';
/** 硬依赖：没有 fs 和 tools 这个插件不起效。 */
export const inject = ['fs', 'tools'];
/* ── 小工具 ────────────────────────────────────────────────────────────── */
/** 路径统一成正斜杠。 */
const posix = (p) => p.replaceAll('\\', '/');
/** 换行规范化 / 按 LF 切行**一律用校验层那一份**（`validate.ts` 的行号口径就在这里）——
    自己再写一份，哪天那边改了（比如多认一种换行），宿主算出来的行号就会和清单对不上。 */
/** 这次调用所属**会话的工作区**（agent 的不可变 cwd）。 */
function sessionWorkspace(exec) {
    const cwd = exec?.agent?.session?.header?.cwd;
    return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined;
}
/** 把错误压成一句话。 */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
/** 统一的 JSON 响应。 */
function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}
/** 批注通道的错误响应（HTTP 一律 200，错误写在 body 里，客户端好统一处理）。 */
const annotationFailure = (error) => jsonResponse({ ok: false, error });
/**
 * 提示词文件的总行数。
 *
 * `promptLines` 是**每块**的区间（§6.1），没有现成的总数；
 * 最后一块的结束行就是文件总行数（末尾不留额外空行，§4.2），没块时为 0。
 */
const lastLineOf = (ranges) => ranges.at(-1)?.[1] ?? 0;
/** 块行号区间压成一行（render 用，最多列前几块，免得回执太长）。 */
function rangesBrief(ranges) {
    const head = ranges.slice(0, 6).map(r => `L${r[0]}—L${r[1]}`).join('、');
    return ranges.length <= 6 ? head : `${head} …（共 ${ranges.length} 块）`;
}
/**
 * 是不是 `[起, 止]` 形状。
 *
 * ⚠️ 自己判一遍形状，别直接把 agent 给的 JSON 丢给校验层：
 *    工具参数是外部输入，形状检查放在最外层，错的时候能说清"是形状不对"还是"是越界"。
 */
function asLineRange(value) {
    if (!Array.isArray(value) || value.length < 2)
        return undefined;
    const start = typeof value[0] === 'number' ? value[0] : Number(value[0]);
    const end = typeof value[1] === 'number' ? value[1] : Number(value[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end))
        return undefined;
    if (start < 1 || end < start)
        return undefined;
    return [start, end];
}
/** `scriptRanges`：`null`（剧本里没有对应）或非空区间数组；`undefined` = 没填。 */
function asScriptRanges(value) {
    if (value === null)
        return null;
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    const out = [];
    for (const item of value) {
        const range = asLineRange(item);
        if (range === undefined)
            return undefined;
        out.push(range);
    }
    return out;
}
/**
 * `checkScriptRanges` 的薄封装 —— **所有** `scriptRanges` 越界判定都走这里。
 *
 * ⚠️ 越界逻辑**不在这里复制**：复制一份就会和校验层两边不一致
 *    （"两边都改了、还改得不一样"是这类双半边插件最贵的错）。
 *    这里只做两件事：调用它、把 `ValidationIssue[]` 压成 agent 能直接改的一句话。
 *
 * @returns 空数组 = 全部通过。
 */
function assertScriptRanges(ranges, scriptLineCount, where) {
    const issues = checkScriptRanges(ranges, scriptLineCount, where);
    if (issues.length === 0)
        return;
    throw new Error(issues.map(issueText).join('；'));
}
/** 把 `ValidationIssue` 压成给 agent 看的一行。 */
function issueText(issue) {
    if (typeof issue === 'string')
        return issue;
    if (issue === null || typeof issue !== 'object')
        return String(issue);
    const where = typeof issue.where === 'string' ? issue.where : '';
    const message = typeof issue.message === 'string' ? issue.message : JSON.stringify(issue);
    return where === '' ? message : `${where}：${message}`;
}
/* ── 插件入口 ──────────────────────────────────────────────────────────── */
/**
 * @param ctx - 宿主上下文（已声明 fs / tools 依赖）。
 * @param config - 插件配置；`workspaceRoot` 只是**没有会话时**的兜底目录（测试用）。
 */
export function apply(ctx, config = {}) {
    const fallbackRoot = config.workspaceRoot ?? process.cwd();
    ctx.logger.info(`[prompt-compare] host apply · fallback=${fallbackRoot}`);
    /* ── 写文件：解析目标 + 带策略写入 ─────────────────────────────────────── */
    /**
     * 解析出一次调用的落点：会话工作区 + 沙箱策略。
     *
     * @param exec - 工具执行上下文（有会话时用它的 cwd）。
     * @param session - 批注通道那条路拿到的会话（浏览器调用没有 exec）。
     */
    function target(exec, session) {
        const policy = ctx.get?.('sandboxPolicy')
            ?.resolve(session === undefined ? {} : { session });
        const root = session?.header?.cwd?.trim()
            || sessionWorkspace(exec)
            || policy?.workspaceRoot
            || fallbackRoot;
        return { root, policy };
    }
    /** 写一个工作区相对路径的文件（自动建父目录；带沙箱策略）。 */
    async function writeWorkspaceFile(root, policy, relative, text, signal) {
        const file = await ctx.fs.resolve(`${posix(root)}/${relative}`, {
            ...(policy?.workspaceRoot === undefined ? {} : { cwd: policy.workspaceRoot }),
            ...(signal === undefined ? {} : { signal }),
        });
        await ctx.fs.writeText(file, text, undefined, signal, policy);
    }
    /** 读一个工作区相对路径的文本；不存在返回 undefined。 */
    async function readWorkspaceFile(root, policy, relative, signal) {
        const file = await ctx.fs.resolve(`${posix(root)}/${relative}`, {
            ...(policy?.workspaceRoot === undefined ? {} : { cwd: policy.workspaceRoot }),
            ...(signal === undefined ? {} : { signal }),
        });
        const info = await ctx.fs.stat(file, signal);
        if (info === undefined)
            return undefined;
        return await ctx.fs.readText(file, signal);
    }
    /**
     * 读**剧本**文件，返回"内容行"（行号 → 行的映射照 `splitLines`，不变）。
     *
     * ⚠️ 末尾那个空元素要去掉：文件末尾通常带一个换行，`splitLines` 会多切出一个空串，
     *    于是"行数"比实际内容行多 1 格 —— 那会让 `scriptRanges` 的越界校验**松一格**
     *    （第 1 集剧本实际 205 行，却放行 `[[1,206]]`，而第 206 行在文件里根本不存在）。
     *    行号口径不动：第 i 行仍然是 `splitLines` 的下标 i-1。
     *
     * 读不到就直接报错：剧本是 `scriptRanges` 的**上界**来源，没有它连"越没越界"都算不出来；
     * 而且它读不到通常意味着工作台根本没摆好（剧本是只读参考，应当由人先拷进去）。
     */
    async function readScriptLines(root, policy, version, episode, signal) {
        const relative = scriptPath(episode);
        const text = await readWorkspaceFile(root, policy, relative, signal);
        if (text === undefined) {
            throw new Error(`读不到剧本文件 ${relative} —— 剧本是只读参考，也是 scriptRanges 的行号上界，`
                + '没有它算不出越界。请先把这一集的剧本放到 `对照工作台/剧本/` 下再登记。');
        }
        const all = splitLines(text);
        return all.length > 0 && all[all.length - 1] === '' ? all.slice(0, -1) : all;
    }
    /** 组装给 agent 看的成功回执（§6.1 的返回形状）。 */
    function outcome(episode, blocks, scriptLineCount, promptRanges, promptRel, manifestRel, scriptRel) {
        return {
            ok: true,
            episode,
            blocks: blocks.length,
            promptLines: promptRanges.map(range => [range[0], range[1]]),
            scriptLines: scriptLineCount,
            /* §5.3 的三类提示（某块 scriptRanges 为 null / 起始行回退 / 相邻块重叠）直接原样交给 agent。 */
            warnings: [...manifestWarnings(blocks)],
            promptPath: promptRel,
            manifestPath: manifestRel,
            ...(scriptRel === undefined ? {} : { scriptPath: scriptRel }),
        };
    }
    /** 两个工具共用的落点 + 剧本行数解析。 */
    async function prepare(exec, version, episode) {
        const session = exec?.agent?.session;
        const { root, policy } = target(exec, session);
        const scriptLines = await readScriptLines(root, policy, version, episode, exec?.signal);
        return { root, policy, scriptLines };
    }
    /* ── 工具 ①：prompt_compare_write_episode ───────────────────────────────── */
    const disposeWrite = ctx.tools.register({
        name: 'prompt_compare_write_episode',
        description: '【用途】把一集的**提示词**和它的**清单**一次写成两个文件，成套出现。'
            + '锚点侧是剧本（只读参考）、作业侧是提示词（随版本走）。'
            + '工作台固定目录：`对照工作台/<版本>/提示词/第N集提示词.txt` 与 `…/清单/第N集清单.txt`；'
            + '剧本在 `对照工作台/剧本/第N集剧本.txt`（**只读，本工具不改它、也不要手改**）。'
            + '【纪律：改提示词必须同步清单】提示词和清单是一对，只改一边工作台就会错位。'
            + '所以：新建或整集重写 → 用本工具一次写两个；'
            + '只改了提示词（或提示词本来就在）→ 改完必须补一次 `prompt_compare_write_manifest` 把清单刷新。'
            + '【你只需要交两样】每块的 `text`（这一块完整文字，可含多行）'
            + '和 `scriptRanges`（这块覆盖剧本哪几行）。'
            + '【工具负责】每块的 `promptLines`（在提示词文件里的行号）、块之间恰好一个空白行、'
            + '文件末尾不写额外换行，全部由工具算，你不要填、也不要自己写这两个文件。'
            + '【header 可选】提示词开头的公共段落（角色设定、风格约束之类）；给了它就占开头若干行，'
            + '块的行号会自动往后顺延，你不用自己数。'
            + '【整集重写要**原样保留排版**】每块的 `text` 要**连着它的首行一起交** —— '
            + '源文件里那一块若以 `── Block 1 | 27s ──` 这类标记行开头，这一行**也算块的一部分**。'
            + '漏了它，重写出来的文件就少了标记行、块首行退化成内容行（`场景：@…` 这种还会连着几块重复，'
            + '以后 `prompt_compare_write_manifest` 就再也定不了位）。'
            + '文件开头那种 `《…》第 N 集 视频提示词｜…` 属于 `header` 参数，别漏。'
            + '一句话：**整集重写是"换内容"，不是重新排版。**'
            + '【scriptRanges 写法】`[[12,15]]` = 剧本第 12—15 行；`[[12,13],[30,30]]` = 不连续两段；'
            + '`null` = 剧本里没有对应（新增）。'
            + '【块内规则】块**首尾不能有空白行**（工具会在块之间恰好插一个空白行，块自己再带就会出现两个）；'
            + '**块内部允许空白行、原样保留** —— 提示词的块天然用空行分组字段（设计文档 §4.2），'
            + '不要为了"整齐"把它们删掉，删了块的排版就变了。'
            + '【写入前校验】工具会先读本集剧本的总行数，任何 `scriptRanges` 越界、'
            + '或任何一块文字不合格，就直接报错，**提示词和清单一个都不写**（宁可不写，不写半成品）。',
        parameters: {
            type: 'object',
            properties: {
                version: { type: 'string', description: '版本目录名，如 `v1`、`v2`。' },
                episode: { type: 'integer', description: '集号（正整数）。' },
                header: {
                    type: 'string',
                    description: '可选：提示词开头的公共段落（可含多行），会在所有块之前，与第一块之间隔一个空白行。',
                },
                blocks: {
                    type: 'array',
                    description: '这一集的提示词块，按文件里的先后顺序。',
                    items: {
                        type: 'object',
                        properties: {
                            text: {
                                type: 'string',
                                description: '这一块的完整文字。可以含多行（用 \\n 分隔）；'
                                    + '内部可以有空白行（原样保留），但首尾不能是空白行。',
                            },
                            scriptRanges: {
                                type: 'array',
                                description: '这一块覆盖剧本哪几行：[[起,止], …]；剧本里没有对应就写 null。',
                                items: { type: 'array', items: { type: 'integer' } },
                            },
                        },
                        required: ['text', 'scriptRanges'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['version', 'episode', 'blocks'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    episode: { type: 'integer' },
                    blocks: { type: 'integer' },
                    promptLines: {
                        type: 'array',
                        description: '每块在提示词文件里的行号区间（1 基、闭区间）。',
                        items: { type: 'array', items: { type: 'integer' } },
                    },
                    scriptLines: { type: 'integer' },
                    warnings: { type: 'array', items: { type: 'string' } },
                    promptPath: { type: 'string' },
                    manifestPath: { type: 'string' },
                    scriptPath: { type: 'string' },
                },
                required: [
                    'ok', 'episode', 'blocks', 'promptLines', 'scriptLines', 'warnings',
                    'promptPath', 'manifestPath', 'scriptPath',
                ],
                additionalProperties: false,
            },
            render(_args, value) {
                const v = value;
                const warn = v.warnings.length === 0 ? '' : `\n  ⚠️ ${v.warnings.join('\n  ⚠️ ')}`;
                return [{
                        type: 'text',
                        text: `✅ 第 ${v.episode} 集已写入 ${v.blocks} 块`
                            + `（提示词 ${lastLineOf(v.promptLines)} 行 · 剧本 ${v.scriptLines} 行）\n`
                            + `  块行号：${rangesBrief(v.promptLines)}\n`
                            + `  提示词：${v.promptPath}\n  清单：${v.manifestPath}\n  剧本（只读，未改动）：${v.scriptPath ?? scriptPath(v.episode)}`
                            + warn,
                    }];
            },
        },
        async execute(args, exec) {
            const a = (args ?? {});
            /* ① 版本 / 集号 */
            const version = typeof a.version === 'string' ? a.version.trim() : '';
            if (!RE_VERSION_ARG.test(version))
                throw new Error('version 必须是 `v1` / `v2` 这样的形式');
            const episode = typeof a.episode === 'number' ? a.episode : Number(a.episode);
            if (!Number.isInteger(episode) || episode < 1)
                throw new Error('episode 必须是正整数');
            /* ② header（可选） */
            if (a.header !== undefined && typeof a.header !== 'string')
                throw new Error('header 给了就必须是字符串');
            const header = typeof a.header === 'string' && a.header.trim() !== '' ? a.header : undefined;
            /* ③ 每块的文字 + scriptRanges */
            if (!Array.isArray(a.blocks) || a.blocks.length === 0) {
                throw new Error('blocks 必须是非空数组（至少一个提示词块）');
            }
            const texts = [];
            const ranges = [];
            a.blocks.forEach((item, index) => {
                const where = `第 ${index + 1} 块`;
                if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                    throw new Error(`${where}：不是一个对象`);
                }
                const rec = item;
                if (typeof rec.text !== 'string')
                    throw new Error(`${where}：text 必须是字符串`);
                const textError = blockTextError(rec.text);
                if (textError !== null)
                    throw new Error(`${where}：${textError}`);
                const checked = asScriptRanges(rec.scriptRanges);
                if (checked === undefined) {
                    throw new Error(`${where}：scriptRanges 必须写，写法是 [[起,止], …]（不连续就写多段），`
                        + '剧本里没有对应就写 null');
                }
                texts.push(normalizeNewlines(rec.text));
                ranges.push(checked);
            });
            /* ④ 落点 + 读剧本行数（越界就不写；读不到剧本直接报错） */
            const { root, policy, scriptLines } = await prepare(exec, version, episode);
            const scriptLineCount = scriptLines.length;
            ranges.forEach((list, index) => {
                assertScriptRanges(list, scriptLineCount, `第 ${index + 1} 块`);
            });
            /*
             * ⑤ 拼提示词：anchor 由工具从每块首行自己取，行号由 `buildPromptText` 一处算出来。
             *
             * ⚠️ 不要自己"按块行数累加 + 在文件里找 anchor"再算一遍：
             *    块内空行、块间空行、header 偏移这三件事的口径都在校验层里，
             *    自己复算一份就会和清单/界面两边对不上（提示词块天然带块内空行，最容易错在这里）。
             */
            const anchors = texts.map(text => splitLines(text)[0] ?? '');
            const built = buildPromptText(header, texts);
            const promptText = built.text;
            const promptRanges = built.promptLines;
            const lines = splitLines(promptText);
            if (promptRanges.length !== texts.length) {
                throw new Error(`内部错误：拼出 ${promptRanges.length} 块的行号，但交进来 ${texts.length} 块 —— 没有写任何文件`);
            }
            /* ⑥ 清单（promptLines 由工具算，agent 不填） */
            const blocks = texts.map((_, index) => ({
                anchor: anchors[index],
                promptLines: promptRanges[index],
                scriptRanges: ranges[index] ?? null,
            }));
            const manifest = { schema: MANIFEST_SCHEMA, blocks };
            /* ⑦ 两个文件一起写 —— 上面任何一条不合法都在到这里之前抛了，一个字节都没落盘 */
            const promptRel = promptPath(version, episode);
            const manifestRel = manifestPath(version, episode);
            await writeWorkspaceFile(root, policy, promptRel, promptText, exec?.signal);
            await writeWorkspaceFile(root, policy, manifestRel, `${JSON.stringify(manifest, null, 2)}\n`, exec?.signal);
            ctx.logger.info(`[prompt-compare] ${version} 第 ${episode} 集已写入：${blocks.length} 块 / `
                + `提示词 ${lines.length} 行 · 剧本 ${scriptLines.length} 行（工作区 ${posix(root)}）`);
            return outcome(episode, blocks, scriptLines.length, promptRanges, promptRel, manifestRel, scriptPath(episode));
        },
    });
    /* ── 工具 ②：prompt_compare_write_manifest ──────────────────────────────── */
    const disposeManifest = ctx.tools.register({
        name: 'prompt_compare_write_manifest',
        description: '【用途】提示词文件**已经在工作台里**（agent 直接改过、或上一版就存在），'
            + '按每块的**首行**在文件里定位、算出 `promptLines`，然后**只更新清单**。'
            + '它**不碰提示词文件**（一个字节都不写），也不动剧本。'
            + '【什么时候用】只改了提示词的文字 / 加了删了块 —— 改完必须补一次本工具，'
            + '否则清单里的行号和块数就跟提示词对不上了（工作台会显示"引用不到/错位"）。'
            + '【你要交什么】每块的 `anchor` = 这一块在提示词文件里的**首行原文**，'
            + '加它的 `scriptRanges`（这块覆盖剧本哪几行，写法同 '
            + '`prompt_compare_write_episode`：`[[起,止], …]` 或 `null`）。'
            + '**不用交 `text` 正文**：工具按 anchor 自己找位置、自己算行号。'
            + '【anchor 要求唯一】anchor **必须是这一块的首行原文**（工具靠它定出这一块的起点），'
            + '并且在整份提示词里**只命中一处**。'
            + '⚠️ 提示词块的首行常常**天然重复** —— 同一场景连着几块、首行都是 `场景：@某地_夜` 时，'
            + '本入口用不了；**别硬凑**，改用 `prompt_compare_write_episode` 整集重写'
            + '（它由工具按块切分直接算行号，不需要搜）。'
            + '空行之类太短的行也容易撞车；工具找不到或多处命中会直接报错，'
            + '并把 anchor 和命中的行号回给你，**不要靠猜位置、也不要自己编行号**。'
            + '【写入前校验】工具会先读本集剧本的总行数，任何 `scriptRanges` 越界，'
            + '或任何一块定位不上、提示词文件不存在，就直接报错，**清单不写**（不会写半份）。'
            + '【纪律】剧本只读，不要改；改提示词必须同步清单。',
        parameters: {
            type: 'object',
            properties: {
                version: { type: 'string', description: '版本目录名，如 `v1`、`v2`。' },
                episode: { type: 'integer', description: '集号（正整数）。' },
                blocks: {
                    type: 'array',
                    description: '这一集的提示词块，按文件里的先后顺序。',
                    items: {
                        type: 'object',
                        properties: {
                            anchor: {
                                type: 'string',
                                description: '这一块的首行原文，必须在整份提示词里唯一命中（可含 \\n 表示这一块有多行）。',
                            },
                            scriptRanges: {
                                type: 'array',
                                description: '这一块覆盖剧本哪几行：[[起,止], …]；剧本里没有对应就写 null。',
                                items: { type: 'array', items: { type: 'integer' } },
                            },
                        },
                        required: ['anchor', 'scriptRanges'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['version', 'episode', 'blocks'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    episode: { type: 'integer' },
                    blocks: { type: 'integer' },
                    promptLines: {
                        type: 'array',
                        description: '每块在提示词文件里的行号区间（1 基、闭区间）。',
                        items: { type: 'array', items: { type: 'integer' } },
                    },
                    scriptLines: { type: 'integer' },
                    warnings: { type: 'array', items: { type: 'string' } },
                    promptPath: { type: 'string' },
                    manifestPath: { type: 'string' },
                },
                required: [
                    'ok', 'episode', 'blocks', 'promptLines', 'scriptLines', 'warnings',
                    'promptPath', 'manifestPath',
                ],
                additionalProperties: false,
            },
            render(_args, value) {
                const v = value;
                const warn = v.warnings.length === 0 ? '' : `\n  ⚠️ ${v.warnings.join('\n  ⚠️ ')}`;
                return [{
                        type: 'text',
                        text: `✅ 第 ${v.episode} 集清单已更新 ${v.blocks} 块`
                            + `（提示词 ${lastLineOf(v.promptLines)} 行 · 剧本 ${v.scriptLines} 行）\n`
                            + `  块行号：${rangesBrief(v.promptLines)}\n`
                            + `  清单：${v.manifestPath}\n  提示词（只读，未改动）：${v.promptPath}`
                            + warn,
                    }];
            },
        },
        async execute(args, exec) {
            const a = (args ?? {});
            /* ① 版本 / 集号 */
            const version = typeof a.version === 'string' ? a.version.trim() : '';
            if (!RE_VERSION_ARG.test(version))
                throw new Error('version 必须是 `v1` / `v2` 这样的形式');
            const episode = typeof a.episode === 'number' ? a.episode : Number(a.episode);
            if (!Number.isInteger(episode) || episode < 1)
                throw new Error('episode 必须是正整数');
            /* ② anchor + scriptRanges */
            if (!Array.isArray(a.blocks) || a.blocks.length === 0) {
                throw new Error('blocks 必须是非空数组（至少一个提示词块）');
            }
            const anchors = [];
            const ranges = [];
            a.blocks.forEach((item, index) => {
                const where = `第 ${index + 1} 块`;
                if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                    throw new Error(`${where}：不是一个对象`);
                }
                const rec = item;
                if (typeof rec.anchor !== 'string' || rec.anchor.trim() === '') {
                    throw new Error(`${where}：anchor 必须是非空字符串（这一块的首行原文）`);
                }
                /*
                 * ⚠️ anchor 必须是**单行**：协议里它就是"块首行文本"，校验层也是拿它跟**一整行**比
                 *    （只比整行、不 trim、不做 includes）。整段正文塞进来只会一处都命中不了，
                 *    那种错报出来很难看懂，所以在参数这一层就挡住。
                 */
                if (splitLines(rec.anchor).length !== 1) {
                    throw new Error(`${where}：anchor 只能是**一行**（块的首行原文），` + '不要整段正文都塞进来');
                }
                const checked = asScriptRanges(rec.scriptRanges);
                if (checked === undefined) {
                    throw new Error(`${where}：scriptRanges 必须写，写法是 [[起,止], …]（不连续就写多段），`
                        + '剧本里没有对应就写 null');
                }
                anchors.push(rec.anchor);
                ranges.push(checked);
            });
            /* ③ 落点 + 剧本行数 */
            const { root, policy, scriptLines } = await prepare(exec, version, episode);
            /* ④ 读**已存在**的提示词（它才是定位的基准） */
            const promptRel = promptPath(version, episode);
            const promptRaw = await readWorkspaceFile(root, policy, promptRel, exec?.signal);
            if (promptRaw === undefined) {
                throw new Error(`读不到提示词文件 ${promptRel} —— 本工具只按已存在的提示词算行号，`
                    + '不会凭空造一份。整集还没有提示词就先用 `prompt_compare_write_episode` 写两个文件。');
            }
            const lines = splitLines(promptRaw);
            /*
             * ⑤ 逐块定位（设计文档 §6.2）：顺序推进 + 唯一命中 + 块结束行取下一个锚点之前最后一个非空行。
             *    这三条**全在校验层里**（`computePromptLinesByAnchors`），
             *    宿主不再自己实现一遍 —— 复算的代价是两边口径会漂。
             *
             * ⚠️ 它的失败是**逐块**的（坏块 `promptLines[i] === null` + 一条 issue），
             *    不是抛异常。所以这里必须检查 `issues`：只要有 error 就整份不写。
             * ⚠️ 报错必须带上 **anchor 原文 + 命中行号**（§11），agent 才能自己换成更长的 anchor；
             *    issue 的 message 里已经写了（"锚点「…」在第 N 行之后找不到这一行（一处都没命中）"），
             *    另外再单独调一次 `locateAnchor` 拿到**全文件**的命中行号补进去 ——
             *    校验层是从游标往后找的，报的是"从第 N 行起"的命中，补全文件命中列表对它换 anchor 更有用。
             */
            const located = computePromptLinesByAnchors(lines, anchors);
            const errors = located.issues.filter(issue => issue.level === 'error');
            if (errors.length > 0) {
                const detail = errors.map((issue) => {
                    /* 从 issue 的位置文案里把块号捡回来（校验层写的是「第 N 块」）。 */
                    const index = Number(/第\s*(\d+)\s*块/.exec(issue.where)?.[1] ?? '0') - 1;
                    const anchor = anchors[index] ?? '';
                    const matches = locateAnchor(lines, anchor, 1).matches;
                    const hits = matches.length === 0 ? '全文件一处都没命中' : `全文件命中第 ${matches.join('、')} 行`;
                    return `${issueText(issue)}；anchor=${JSON.stringify(anchor)}（${hits}）`;
                }).join('\n');
                throw new Error(`清单没有写 —— 有块定位不上：\n${detail}`);
            }
            const promptLines = located.promptLines;
            if (promptLines.some(range => range === null)) {
                /* 正常情况下上面已经拦住；留一道兜底，免得半个 null 混进清单。 */
                throw new Error('清单没有写 —— 有块算不出行号（校验层报了错但 level 不是 error，这不该发生）');
            }
            const resolvedLines = promptLines;
            /* ⑥ 越界校验（不合法就不写） */
            const scriptLineCount = scriptLines.length;
            ranges.forEach((list, index) => {
                assertScriptRanges(list, scriptLineCount, `第 ${index + 1} 块`);
            });
            /* ⑦ 只写清单 */
            const blocks = anchors.map((anchor, index) => ({
                anchor,
                promptLines: resolvedLines[index],
                scriptRanges: ranges[index] ?? null,
            }));
            const manifest = { schema: MANIFEST_SCHEMA, blocks };
            const manifestRel = manifestPath(version, episode);
            await writeWorkspaceFile(root, policy, manifestRel, `${JSON.stringify(manifest, null, 2)}\n`, exec?.signal);
            ctx.logger.info(`[prompt-compare] ${version} 第 ${episode} 集清单已更新：${blocks.length} 块`
                + `（提示词 ${lines.length} 行 · 剧本 ${scriptLines.length} 行）`);
            return outcome(episode, blocks, scriptLines.length, resolvedLines, promptRel, manifestRel, undefined);
        },
    });
    /* ── 批注通道：浏览器 ⇄ 宿主 ───────────────────────────────────────────── */
    /**
     * 处理一次批注请求（load / save）。
     *
     * ⚠️ 两个要点：
     *   1. 浏览器调用**没有** `exec.agent.session`，只能靠 `sessionId` 找会话；
     *      拿不到会话就报错，**不许**退回部署默认策略硬写（会写错位置）。
     *   2. `save` 前必须先读盘：文件**不存在**才当空数组；
     *      存在但读不了 / JSON 坏了 / 字段非法 → **停止保存**，绝不用空数组覆盖。
     *      —— 这条是"宁可不保存，不丢用户已写的问题"。
     */
    async function handleAnnotations(request) {
        if (request.method !== 'POST')
            return annotationFailure('批注通道只接受 POST');
        let body;
        try {
            body = (await request.json());
        }
        catch {
            return annotationFailure('请求体不是合法 JSON');
        }
        const op = body?.op;
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
        const version = typeof body?.version === 'string' ? body.version : '';
        const episode = typeof body?.episode === 'number' ? body.episode : Number(body?.episode);
        if (op !== 'load' && op !== 'save')
            return annotationFailure('op 必须是 load / save');
        if (sessionId === '')
            return annotationFailure('缺少 sessionId');
        if (!RE_VERSION_ARG.test(version))
            return annotationFailure('version 形式不对');
        if (!Number.isInteger(episode) || episode < 1)
            return annotationFailure('episode 必须是正整数');
        const sessions = ctx.get?.('sessions');
        const session = sessions?.get(sessionId);
        if (session === undefined) {
            return annotationFailure('找不到这个会话（它可能已经关闭）—— 请回到工作台所在的会话再试');
        }
        const cwd = session.header?.cwd;
        if (typeof cwd !== 'string' || cwd.trim() === '')
            return annotationFailure('这个会话没有工作区目录');
        const { root, policy } = target(undefined, session);
        const relative = annotationPath(version, episode);
        /* 读盘：不存在 → 空数组；存在但有问题 → 报错（其中 save 直接停） */
        let disk = [];
        let fileExists = false;
        try {
            const file = await ctx.fs.resolve(`${posix(root)}/${relative}`, {
                ...(policy?.workspaceRoot === undefined ? {} : { cwd: policy.workspaceRoot }),
                signal: request.signal,
            });
            fileExists = (await ctx.fs.stat(file, request.signal)) !== undefined;
            if (fileExists) {
                const text = await ctx.fs.readText(file, request.signal);
                let raw;
                try {
                    raw = JSON.parse(text);
                }
                catch (error) {
                    return annotationFailure(`批注文件不是合法 JSON（${relative}）：${messageOf(error)}`);
                }
                const parsed = parseAnnotations(raw);
                if (parsed.annotations === null || parsed.issues.some(i => i.level === 'error')) {
                    const detail = parsed.issues.map(i => `${i.where}：${i.message}`).join('；');
                    return annotationFailure(`批注文件内容有问题，已停止保存（不会覆盖它）：${detail}`);
                }
                disk = parsed.annotations;
            }
        }
        catch (error) {
            return annotationFailure(`读不了批注文件（${relative}）：${messageOf(error)}`);
        }
        if (op === 'load')
            return jsonResponse({ ok: true, annotations: disk });
        /* save：**内存列表为准**（用户刚编辑的内容），磁盘上的 done / resolvedIn 覆盖回来（agent 勾的结果） */
        if (!Array.isArray(body.annotations))
            return annotationFailure('save 必须带 annotations 数组');
        const incoming = parseAnnotations(body.annotations);
        if (incoming.annotations === null)
            return annotationFailure('annotations 不是数组');
        const merged = mergeAnnotations(incoming.annotations, disk);
        try {
            await writeWorkspaceFile(root, policy, relative, `${JSON.stringify(merged, null, 2)}\n`, request.signal);
        }
        catch (error) {
            return annotationFailure(`批注没有保存成功（${relative}）：${messageOf(error)}`);
        }
        ctx.logger.info(`[prompt-compare] 批注已保存：${relative}（${merged.length} 条${fileExists ? '' : ' · 新建文件'}）`);
        return jsonResponse({ ok: true, annotations: merged });
    }
    ctx.inject?.(['connection'], (scope) => {
        const fetch = scope.connection?.fetch;
        if (fetch === undefined) {
            ctx.logger.warn('[prompt-compare] 没有 connection.fetch —— 批注保存通道没装上（界面会明确提示保存失败）');
            return;
        }
        ctx.effect(() => fetch.register({
            path: ANNOTATION_ROUTE,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: request => handleAnnotations(request),
        }), 'prompt-compare: annotation route');
        ctx.logger.info(`[prompt-compare] 批注通道已注册：${ANNOTATION_ROUTE}`);
    });
    ctx.effect(() => () => { disposeWrite(); disposeManifest(); }, 'prompt-compare: tool teardown');
}
//# sourceMappingURL=index.js.map