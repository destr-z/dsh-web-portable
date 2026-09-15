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
import { ANNOTATION_ROUTE, MANIFEST_SCHEMA, RE_VERSION_ARG, annotationPath, manifestPath, novelPath, scriptPath, } from "./shared/protocol.js";
import { buildScriptText, checkSourceRanges, computeNovelRange, computeScriptLines, mergeAnnotations, normalizeNewlines, paragraphTextError, parseAnnotations, splitLines, } from "./shared/validate.js";
/** 插件名（loader 诊断用）。 */
export const name = '@dsh-external/dsh-novel-script';
/** 硬依赖：没有 fs 和 tools 这个插件不起效。 */
export const inject = ['fs', 'tools'];
/* ── 小工具 ────────────────────────────────────────────────────────────── */
/** 路径统一成正斜杠。 */
const posix = (p) => p.replaceAll('\\', '/');
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
/* ── 插件入口 ──────────────────────────────────────────────────────────── */
/**
 * @param ctx - 宿主上下文（已声明 fs / tools 依赖）。
 * @param config - 插件配置；`workspaceRoot` 只是**没有会话时**的兜底目录（测试用）。
 */
export function apply(ctx, config = {}) {
    const fallbackRoot = config.workspaceRoot ?? process.cwd();
    ctx.logger.info(`[novel-script] host apply · fallback=${fallbackRoot}`);
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
    /* ── 工具：novel_script_write_episode ─────────────────────────────────── */
    const disposeWrite = ctx.tools.register({
        name: 'novel_script_write_episode',
        description: '把一集的剧本段落写成剧本文件 + 清单文件，两个文件一次生成，成套出现。'
            + '工作台固定目录：`剧本工作台/<版本>/剧本/第N集剧本.txt` 与 `…/清单/第N集清单.txt`。'
            + '【你只需要交两样】每个段落的 `text`（这一段完整文字，可含多行）'
            + '和 `sourceRanges`（这一段来自原文哪几行）。'
            + '【工具负责】行号 `scriptLines`、段落之间恰好一个空白行、文件末尾不写额外换行，'
            + '全部由工具算，你不要填、也不要自己写这两个文件。'
            + '【sourceRanges 写法】`[[12,15]]` = 连续一段；`[[12,13],[30,30]]` = 不连续两段；'
            + '`null` = 原文里没有（新增）。'
            + '【段落规则】段落内部不能有空白行（空白行是段落之间的分隔符），首尾也不能是空白行。'
            + '【写入前校验】工具会先读 `剧本工作台/小说原文.txt` 的总行数，任何 `sourceRanges` '
            + '越界就直接报错，**剧本和清单一个都不写**。',
        parameters: {
            type: 'object',
            properties: {
                version: { type: 'string', description: '版本目录名，如 `v1`、`v2`。' },
                episode: { type: 'integer', description: '集号（正整数）。' },
                paragraphs: {
                    type: 'array',
                    description: '这一集的剧本段落，按顺序。',
                    items: {
                        type: 'object',
                        properties: {
                            text: {
                                type: 'string',
                                description: '这一段的完整文字。可以含多行（用 \\n 分隔），但不能含空白行。',
                            },
                            sourceRanges: {
                                type: 'array',
                                description: '这一段来自原文哪几行：[[起,止], …]；原文里没有就写 null。',
                                items: { type: 'array', items: { type: 'integer' } },
                            },
                        },
                        required: ['text'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['version', 'episode', 'paragraphs'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    scriptPath: { type: 'string' },
                    manifestPath: { type: 'string' },
                    paragraphs: { type: 'integer' },
                    scriptLines: { type: 'integer' },
                    novelRange: { type: 'array', items: { type: 'integer' } },
                },
                required: ['scriptPath', 'manifestPath', 'paragraphs', 'scriptLines'],
                additionalProperties: false,
            },
            render(_args, value) {
                const v = value;
                const range = v.novelRange === undefined ? '（本集没有任何原文对应，全是新增）' : `L${v.novelRange[0]}—L${v.novelRange[1]}`;
                return [{
                        type: 'text',
                        text: `✅ 已写入 ${v.paragraphs} 个段落（共 ${v.scriptLines} 行），本集覆盖原文 ${range}\n`
                            + `  剧本：${v.scriptPath}\n  清单：${v.manifestPath}`,
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
            /* ② 段落文字 + sourceRanges */
            if (!Array.isArray(a.paragraphs) || a.paragraphs.length === 0) {
                throw new Error('paragraphs 必须是非空数组（至少一个剧本段落）');
            }
            const texts = [];
            const ranges = [];
            a.paragraphs.forEach((item, index) => {
                const where = `第 ${index + 1} 段`;
                if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                    throw new Error(`${where}：不是一个对象`);
                }
                const rec = item;
                if (typeof rec.text !== 'string')
                    throw new Error(`${where}：text 必须是字符串`);
                const textError = paragraphTextError(rec.text);
                if (textError !== null)
                    throw new Error(`${where}：${textError}`);
                const checked = checkSourceRanges(rec.sourceRanges ?? null);
                if (checked.error !== null)
                    throw new Error(`${where}：sourceRanges ${checked.error}`);
                texts.push(normalizeNewlines(rec.text));
                ranges.push(checked.ranges);
            });
            /* ③ 落点：调用方会话的工作区 + 策略 */
            const session = exec?.agent?.session;
            const { root, policy } = target(exec, session);
            /* ④ 写入前先读原文总行数，越界就不写（设计文档 §4 ⑤） */
            const novel = await readWorkspaceFile(root, policy, novelPath(), exec?.signal);
            if (novel === undefined) {
                throw new Error(`读不到 ${novelPath()} —— 原文还没拷进剧本工作台，先把它拷进去再登记`);
            }
            const novelLines = splitLines(novel).length;
            ranges.forEach((list, index) => {
                for (const [start, end] of list ?? []) {
                    if (end > novelLines) {
                        throw new Error(`第 ${index + 1} 段：对应原文 L${start}—L${end}，但原文只有 ${novelLines} 行 —— 两个文件都没写`);
                    }
                }
            });
            /* ⑤ 生成（行号由工具算） */
            const scriptLines = computeScriptLines(texts);
            const scriptText = buildScriptText(texts);
            const manifest = {
                schema: MANIFEST_SCHEMA,
                paragraphs: texts.map((_, index) => ({
                    scriptLines: scriptLines[index],
                    sourceRanges: ranges[index] ?? null,
                })),
            };
            const scriptRel = scriptPath(version, episode);
            const manifestRel = manifestPath(version, episode);
            await writeWorkspaceFile(root, policy, scriptRel, scriptText, exec?.signal);
            await writeWorkspaceFile(root, policy, manifestRel, `${JSON.stringify(manifest, null, 2)}\n`, exec?.signal);
            const totalLines = splitLines(scriptText).length;
            const novelRange = computeNovelRange(manifest);
            ctx.logger.info(`[novel-script] ${version} 第 ${episode} 集已写入：${texts.length} 段 / ${totalLines} 行`
                + `（工作区 ${posix(root)}）`);
            return {
                scriptPath: scriptRel,
                manifestPath: manifestRel,
                paragraphs: texts.length,
                scriptLines: totalLines,
                ...(novelRange === null ? {} : { novelRange: [novelRange[0], novelRange[1]] }),
            };
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
        /* save：内存列表为准，磁盘上的 done / resolvedIn 覆盖回来 */
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
        ctx.logger.info(`[novel-script] 批注已保存：${relative}（${merged.length} 条${fileExists ? '' : ' · 新建文件'}）`);
        return jsonResponse({ ok: true, annotations: merged });
    }
    ctx.inject?.(['connection'], (scope) => {
        const fetch = scope.connection?.fetch;
        if (fetch === undefined) {
            ctx.logger.warn('[novel-script] 没有 connection.fetch —— 批注保存通道没装上（界面会明确提示保存失败）');
            return;
        }
        ctx.effect(() => fetch.register({
            path: ANNOTATION_ROUTE,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: request => handleAnnotations(request),
        }), 'novel-script: annotation route');
        ctx.logger.info(`[novel-script] 批注通道已注册：${ANNOTATION_ROUTE}`);
    });
    ctx.effect(() => () => { disposeWrite(); }, 'novel-script: tool teardown');
}
//# sourceMappingURL=index.js.map