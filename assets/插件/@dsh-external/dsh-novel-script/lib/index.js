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
import { ANNOTATION_DIR, ANNOTATION_ROUTE, EDIT_ROUTE, HISTORY_DIR, MANIFEST_DIR, MANIFEST_SCHEMA, RE_VERSION_ARG, SCRIPT_DIR, annotationPath, historyPath, manifestPath, novelPath, scriptPath, versionPath, } from "./shared/protocol.js";
import { buildScriptText, checkSourceRanges, checkScriptStructure, computeNovelRange, computeScriptLines, mergeAnnotations, normalizeNewlines, paragraphTextError, parseAnnotations, parseEpisodeManifest, splitLines, } from "./shared/validate.js";
import { alignLines, buildHistorySteps, changedNewSpans, deriveParagraphs, diffHunks, formatMinor, isMinorTag, linesOf, nextMinorNumber, remapAnnotations, renderHistory, tagMajor, toManifest, } from "./shared/edit.js";
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
/** 人工编辑一次最多接受多少行（防手滑把一整本书贴进来）。 */
const MAX_EDIT_LINES = 20_000;
/**
 * 去掉末尾多出来的那**一个**换行。
 *
 * 正文文件的约定是"末尾不写额外换行"（`buildScriptText` 就是这么拼的），
 * 而文本框里很容易在末尾留下一个换行；不去掉的话文件会多出一个空行，
 * `checkScriptStructure` 会判"最后一段没到文件末尾"，行号也跟着飘。
 * （只去一个，且会在历史里留一条 warning，不偷偷改内容。）
 */
function stripTrailingNewline(text) {
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}
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
            + '越界就直接报错，**剧本和清单一个都不写**。'
            + '【人工小版本】文件名里带 `.vN.M` 的（如 `第1集剧本.v1.1.txt`）是**人工编辑模式**'
            + '产生的版本，本工具不要碰它。若某一集已经有这种小版本，说明人在那一版上改过：'
            + '你出新的大版本时，要先把"该集当前最新的一版"读回来当底稿，改完再写进新大版本；'
            + '**不要**回头去覆盖旧大版本的基线。',
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
        /*
         * 小版本（可选，如 `v2.1`）。
         *
         * 人工编辑之后，批注跟着**有效版本**走：界面上看的是 v2.2 的正文，批注就得
         * 落在 `第1集批注.v2.2.txt`。所以要拦住两种错：形式不对、以及"大版本对不上"
         * （那说明调用方拼错了路径，宁可不写）。
         */
        const minorRaw = typeof body?.minor === 'string' && body.minor !== '' ? body.minor : null;
        if (minorRaw !== null && (!isMinorTag(minorRaw) || tagMajor(minorRaw) !== version)) {
            return annotationFailure(`minor 形式不对或与 ${version} 对不上（应当是同一个大版本下的 v2.1 这样）`);
        }
        const sessions = ctx.get?.('sessions');
        const session = sessions?.get(sessionId);
        if (session === undefined) {
            return annotationFailure('找不到这个会话（它可能已经关闭）—— 请回到工作台所在的会话再试');
        }
        const cwd = session.header?.cwd;
        if (typeof cwd !== 'string' || cwd.trim() === '')
            return annotationFailure('这个会话没有工作区目录');
        const { root, policy } = target(undefined, session);
        const relative = annotationPath(version, episode, minorRaw);
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
    /* ── 保存通道：人工编辑 ⇄ 宿主 ─────────────────────────────────────────── */
    /** 列一个大版本目录下某个子目录的文件名（目录不在 / 列不了就当空）。 */
    async function listNames(root, policy, relative, signal) {
        try {
            const dir = await ctx.fs.resolve(`${posix(root)}/${relative}`, {
                ...(policy?.workspaceRoot === undefined ? {} : { cwd: policy.workspaceRoot }),
                ...(signal === undefined ? {} : { signal }),
            });
            const entries = await ctx.fs.listDir(dir, signal);
            return entries.filter(entry => entry.type === 'file').map(entry => entry.name);
        }
        catch {
            return [];
        }
    }
    /**
     * 这一集在该大版本目录里已经有哪些文件名。
     *
     * 四处（正文 / 清单 / 批注 / 历史）合起来数，才能算对"下一个不重号的小版本号" ——
     * 只数正文的话，上次写到一半失败留下的清单/批注会让新版本号撞车。
     */
    async function versionFileNames(root, policy, version, signal) {
        const base = versionPath(version);
        const out = [];
        for (const sub of [SCRIPT_DIR, MANIFEST_DIR, ANNOTATION_DIR, HISTORY_DIR]) {
            out.push(...await listNames(root, policy, `${base}/${sub}`, signal));
        }
        return out;
    }
    /**
     * 处理一次"人工编辑保存"（计划 §5.2 的十一步）。
     *
     * ⚠️ 两条不许破的底线：
     *   1. **只新增文件**：基线、旧小版本、旧批注，一个字节都不动；
     *   2. 写盘前先**读盘比对**（`baseText`）：编辑期间 agent 改过同一集就拒绝保存，
     *      绝不用界面上的旧内容把它盖掉。
     */
    async function handleEdit(request) {
        if (request.method !== 'POST')
            return annotationFailure('保存通道只接受 POST');
        let body;
        try {
            body = (await request.json());
        }
        catch {
            return annotationFailure('请求体不是合法 JSON');
        }
        /* ① 校验参数 */
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
        const version = typeof body?.version === 'string' ? body.version : '';
        const episode = typeof body?.episode === 'number' ? body.episode : Number(body?.episode);
        const baseMinor = typeof body?.baseMinor === 'string' && body.baseMinor !== '' ? body.baseMinor : null;
        const text = typeof body?.text === 'string' ? body.text : null;
        if (sessionId === '')
            return annotationFailure('缺少 sessionId');
        if (!RE_VERSION_ARG.test(version))
            return annotationFailure('version 形式不对');
        if (!Number.isInteger(episode) || episode < 1)
            return annotationFailure('episode 必须是正整数');
        if (baseMinor !== null && (!isMinorTag(baseMinor) || tagMajor(baseMinor) !== version)) {
            return annotationFailure(`baseMinor 形式不对，或者与 ${version} 对不上`);
        }
        if (text === null)
            return annotationFailure('缺少 text（编辑后的正文）');
        /* ② 会话与沙箱策略 —— 拿不到会话就报错，绝不退回默认策略硬写 */
        const sessions = ctx.get?.('sessions');
        const session = sessions?.get(sessionId);
        if (session === undefined) {
            return annotationFailure('找不到这个会话（它可能已经关闭）—— 请回到工作台所在的会话再试');
        }
        const cwd = session.header?.cwd;
        if (typeof cwd !== 'string' || cwd.trim() === '')
            return annotationFailure('这个会话没有工作区目录');
        const { root, policy } = target(undefined, session);
        const signal = request.signal;
        /* ③ 读基线那一份的正文 */
        const baseContentRel = scriptPath(version, episode, baseMinor);
        let diskText;
        try {
            diskText = await readWorkspaceFile(root, policy, baseContentRel, signal);
        }
        catch (error) {
            return annotationFailure(`读不了 ${baseContentRel}：${messageOf(error)}`);
        }
        if (diskText === undefined) {
            return annotationFailure(`读不到 ${baseContentRel} —— 这一版的正文不在，先刷新工作台`);
        }
        /* ④ 冲突检测（编辑期间 agent 可能也在改同一集） */
        const baseText = typeof body?.baseText === 'string' ? body.baseText : null;
        if (baseText !== null && normalizeNewlines(baseText) !== normalizeNewlines(diskText)) {
            return annotationFailure('这一集的正文已经被改动过（可能是 agent 刚改完）—— 请刷新工作台再看一眼；'
                + '这次**没有写入任何文件**');
        }
        /* ⑤ 读基线那一份的清单（行号与段落对应的依据） */
        const baseManifestRel = manifestPath(version, episode, baseMinor);
        let oldManifestRaw;
        try {
            const manifestText = await readWorkspaceFile(root, policy, baseManifestRel, signal);
            if (manifestText === undefined) {
                return annotationFailure(`读不到 ${baseManifestRel} —— 清单不在，先让 agent 补上再改`);
            }
            oldManifestRaw = JSON.parse(manifestText);
        }
        catch (error) {
            return annotationFailure(`清单读不了（${baseManifestRel}）：${messageOf(error)}`);
        }
        const parsedOld = parseEpisodeManifest(oldManifestRaw);
        if (parsedOld.manifest === null || parsedOld.issues.some(issue => issue.level === 'error')) {
            const detail = parsedOld.issues.map(issue => `${issue.where}：${issue.message}`).join('；');
            return annotationFailure(`清单有问题（${baseManifestRel}），先让 agent 修好再改：${detail}`);
        }
        /* ⑥ 规范化 + 校验 */
        const trimmedTrailing = text.endsWith('\n');
        const normalized = stripTrailingNewline(normalizeNewlines(text));
        if (normalized.trim() === '')
            return annotationFailure('正文是空的，没有可保存的内容');
        const oldLines = linesOf(diskText);
        const newLines = linesOf(normalized);
        if (newLines.length > MAX_EDIT_LINES) {
            return annotationFailure(`正文太长了（${newLines.length} 行，一次最多 ${MAX_EDIT_LINES} 行）`);
        }
        /* ⑦ 按内容对齐 → 段落、原文对照、批注序号全迁过去 */
        const alignment = alignLines(oldLines, newLines);
        const derived = deriveParagraphs(oldLines, newLines, parsedOld.manifest.paragraphs, alignment);
        const hunks = diffHunks(oldLines, newLines, alignment);
        const nextManifest = toManifest(derived.paragraphs);
        const addedLines = hunks.reduce((n, hunk) => n + hunk.added.length, 0);
        const removedLines = hunks.reduce((n, hunk) => n + hunk.removed.length, 0);
        const warnings = [...derived.issues];
        if (trimmedTrailing)
            warnings.push('末尾多出来的那个换行已经去掉（正文文件末尾不写额外换行）');
        for (const issue of checkScriptStructure(normalized, nextManifest)) {
            warnings.push(`保存后自检：${issue.where}：${issue.message}`);
        }
        /* ⑧ 新小版本号（每一集各算各的；必然不撞车，绝不覆盖） */
        const names = await versionFileNames(root, policy, version, signal);
        const newTag = formatMinor(version, nextMinorNumber(names, episode));
        const contentRel = scriptPath(version, episode, newTag);
        const manifestRel = manifestPath(version, episode, newTag);
        const annotationRel = annotationPath(version, episode, newTag);
        const historyRel = historyPath(version, episode, newTag);
        /* ⑨ 先写正文 + 清单（这两个是一体的：没有清单，这一版就不算成立） */
        const written = [];
        try {
            await writeWorkspaceFile(root, policy, contentRel, normalized, signal);
            written.push(contentRel);
            await writeWorkspaceFile(root, policy, manifestRel, `${JSON.stringify(nextManifest, null, 2)}\n`, signal);
            written.push(manifestRel);
        }
        catch (error) {
            return annotationFailure(`写到一半失败了：${messageOf(error)}；已经写下的文件：${written.join('、') || '（无）'}`);
        }
        /* ⑩ 批注跟着分叉一份：能迁的迁，迁不了的**原样留着**（界面标"锚点已失效"） */
        const stale = [];
        const touched = [];
        const annotationNotes = [];
        let annotationWritten = null;
        let keptCount = 0;
        try {
            const baseAnnotationRel = annotationPath(version, episode, baseMinor);
            const annotationText = await readWorkspaceFile(root, policy, baseAnnotationRel, signal);
            if (annotationText !== undefined) {
                const parsedAnno = parseAnnotations(JSON.parse(annotationText));
                if (parsedAnno.annotations === null || parsedAnno.issues.some(issue => issue.level === 'error')) {
                    /* 上一版的批注文件坏了：原样留在那儿，既不复制、也不覆盖成空数组。 */
                    annotationNotes.push(`上一版的批注文件有问题，没有复制过来（${baseAnnotationRel}）`);
                }
                else if (parsedAnno.annotations.length > 0) {
                    const paragraphMap = new Map();
                    for (const paragraph of derived.paragraphs) {
                        if (paragraph.fromIndex !== null && !paragraphMap.has(paragraph.fromIndex)) {
                            paragraphMap.set(paragraph.fromIndex, paragraph.index);
                        }
                    }
                    const remapped = remapAnnotations(parsedAnno.annotations, {
                        paragraphMap,
                        paragraphSpans: derived.paragraphs.map(p => p.span),
                        paragraphTexts: derived.paragraphs.map(p => p.text),
                        changedSpans: changedNewSpans(hunks),
                    });
                    const carried = [];
                    for (const item of remapped) {
                        if (item.status === 'stale')
                            stale.push(item.id);
                        else {
                            if (item.status === 'touched')
                                touched.push(item.id);
                            keptCount += 1;
                        }
                        for (const reason of item.reasons)
                            annotationNotes.push(`${item.id}：${reason}`);
                        /* ⚠️ 失效的也要写进去：设计文档 §7.3 说锚点失效是**正常状态**，
                           要由界面标出来，不能悄悄丢掉。 */
                        carried.push(item.annotation ?? item.original);
                    }
                    await writeWorkspaceFile(root, policy, annotationRel, `${JSON.stringify(carried, null, 2)}\n`, signal);
                    written.push(annotationRel);
                    annotationWritten = annotationRel;
                }
            }
        }
        catch (error) {
            return annotationFailure(`批注没能跟着迁过去：${messageOf(error)}；已经写下的文件：${written.join('、') || '（无）'}`);
        }
        /* ⑪ 历史（一次保存一份，纯文本） */
        const steps = buildHistorySteps(oldLines, Array.isArray(body?.snapshots) ? body.snapshots : [], newLines, derived.paragraphs);
        const paragraphNotes = [];
        for (const paragraph of derived.paragraphs) {
            if (paragraph.origin === 'added') {
                paragraphNotes.push(`第 ${paragraph.index} 段：新增内容，原文里没有对应`);
            }
            else if (paragraph.origin === 'edited') {
                paragraphNotes.push(`第 ${paragraph.index} 段：沿用 ${baseMinor ?? version} 的原文对应（待复核）`);
            }
        }
        for (const deleted of derived.deleted)
            paragraphNotes.push(`原第 ${deleted} 段：在新正文里找不到了（已删）`);
        const firstAt = steps[0]?.at;
        const lastAt = steps[steps.length - 1]?.at;
        const historyText = renderHistory({
            episode,
            tag: newTag,
            baseTag: baseMinor ?? version,
            baseFile: baseContentRel,
            ...(firstAt === undefined ? {} : { startedAt: firstAt }),
            ...(lastAt === undefined ? {} : { endedAt: lastAt }),
            addedLines,
            removedLines,
            paragraphNotes,
            annotationNotes,
            steps,
            issues: warnings,
        });
        try {
            await writeWorkspaceFile(root, policy, historyRel, historyText, signal);
            written.push(historyRel);
        }
        catch (error) {
            return annotationFailure(`历史记录没写成：${messageOf(error)}；已经写下的文件：${written.join('、') || '（无）'}`);
        }
        ctx.logger.info(`[novel-script] 人工编辑已保存：${version} 第 ${episode} 集 → ${newTag}`
            + `（${derived.paragraphs.length} 段 / ${newLines.length} 行，工作区 ${posix(root)}）`);
        return jsonResponse({
            ok: true,
            minor: newTag,
            files: { content: contentRel, manifest: manifestRel, annotation: annotationWritten, history: historyRel },
            summary: {
                added: addedLines,
                removed: removedLines,
                steps: steps.length,
                paragraphs: derived.paragraphs.length,
                changed: derived.paragraphs.filter(p => p.origin === 'edited').map(p => p.index),
                addedParagraphs: derived.paragraphs.filter(p => p.origin === 'added').map(p => p.index),
                deleted: derived.deleted,
                degraded: derived.degraded,
            },
            annotations: { kept: keptCount, stale, touched },
            warnings,
        });
    }
    ctx.inject?.(['connection'], (scope) => {
        const fetch = scope.connection?.fetch;
        if (fetch === undefined) {
            ctx.logger.warn('[novel-script] 没有 connection.fetch —— 批注通道与人工编辑的保存通道都没装上（界面会明确提示保存失败）');
            return;
        }
        ctx.effect(() => fetch.register({
            path: ANNOTATION_ROUTE,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: request => handleAnnotations(request),
        }), 'novel-script: annotation route');
        ctx.logger.info(`[novel-script] 批注通道已注册：${ANNOTATION_ROUTE}`);
        ctx.effect(() => fetch.register({
            path: EDIT_ROUTE,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: request => handleEdit(request),
        }), 'novel-script: edit route');
        ctx.logger.info(`[novel-script] 人工编辑的保存通道已注册：${EDIT_ROUTE}`);
    });
    ctx.effect(() => () => { disposeWrite(); }, 'novel-script: tool teardown');
}
//# sourceMappingURL=index.js.map