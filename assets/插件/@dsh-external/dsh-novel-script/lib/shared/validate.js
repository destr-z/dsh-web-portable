/**
 * 两侧共用的**解析与校验**层（设计文档 §4、§7、§13）。
 *
 * 这里只做机械的事：怎么把段落拼成剧本文件、怎么算行号、清单/批注读不读得懂、
 * 剧本文件与清单对不对得上。**不判断任何剧情内容**（谁是角色、哪句是台词、对应得对不对）。
 *
 * 总原则：读不懂就报出来，不猜、不降级。
 */
import { MANIFEST_SCHEMA, annotationId, } from "./protocol.js";
const err = (where, message) => ({ level: 'error', where, message });
/** 空行判定：去掉空白后为空。 */
export function isBlankLine(line) {
    return line.trim() === '';
}
/** 换行规范化：`\r\n` → `\n`，单独的 `\r` → `\n`。 */
export function normalizeNewlines(raw) {
    return raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
/** 按 LF 切行。 */
export function splitLines(text) {
    return normalizeNewlines(text).split('\n');
}
/**
 * 一个段落的 `text` 是否合格（设计文档 §4 ④）。
 *
 * 规则：规范化后不能为空；**首尾不能是空白行**；**内部不能包含空白行**；
 * 不 trim 普通文字与空格。
 *
 * @returns 不合格时返回原因，合格返回 `null`。
 */
export function paragraphTextError(raw) {
    const text = normalizeNewlines(raw);
    if (text === '')
        return '段落文字为空';
    const lines = text.split('\n');
    if (lines.some(isBlankLine)) {
        return '段落内部（含首尾）不能有空白行 —— 空白行是段落之间的分隔符';
    }
    return null;
}
/** 把各段落拼成剧本文件内容：段落之间**恰好一个空白行**，末尾不写额外换行。 */
export function buildScriptText(texts) {
    return texts.map(t => normalizeNewlines(t)).join('\n\n');
}
/**
 * 按拼接规则算出每一段占的行号区间（设计文档 §4 ②）。
 * 第 1 段从第 1 行开始；下一段的开始行 = 上一段结束行 + 2。
 */
export function computeScriptLines(texts) {
    const out = [];
    let cursor = 1;
    for (const raw of texts) {
        const count = normalizeNewlines(raw).split('\n').length;
        out.push([cursor, cursor + count - 1]);
        cursor += count + 1;
    }
    return out;
}
/** 一个段落是不是"合法区间"。 */
function asRange(value) {
    if (!Array.isArray(value) || value.length < 2)
        return undefined;
    const a = typeof value[0] === 'number' ? value[0] : Number(value[0]);
    const b = typeof value[1] === 'number' ? value[1] : Number(value[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b))
        return undefined;
    if (a < 1 || b < a)
        return undefined;
    return [a, b];
}
/** `sourceRanges`：`null`，或者非空的、每项都合法的区间数组。 */
function asSourceRanges(value) {
    if (value === null || value === undefined)
        return null;
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    const out = [];
    for (const item of value) {
        const range = asRange(item);
        if (range === undefined)
            return undefined;
        out.push(range);
    }
    return out;
}
/**
 * 校验工具参数里的 `sourceRanges`（宿主写入前用）。
 * @returns `ranges` 或 `error`（两者必有其一）。
 */
export function checkSourceRanges(value) {
    const ranges = asSourceRanges(value);
    if (ranges === undefined) {
        return { ranges: null, error: `不是 null 也不是 [[起,止], …]（给的是 ${JSON.stringify(value)}）` };
    }
    return { ranges, error: null };
}
/** 清单里那个"这一段坏了"的占位区间（保留数组下标，免得批注的段落号错位）。 */
const BROKEN_LINES = [0, 0];
/**
 * 解析一集的清单。
 *
 * ⚠️ 段落坏了**不跳过**，而是填一个 `scriptLines: [0, 0]` 的占位：
 *    段落编号是批注的锚点，一旦跳过，后面所有段落编号都会前移，
 *    批注就会指到别的段落上。填占位既保住了编号，又能把问题报出来。
 */
export function parseEpisodeManifest(raw) {
    const issues = [];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { manifest: null, issues: [err('清单', '不是一个 JSON 对象')] };
    }
    const obj = raw;
    if (obj.schema !== MANIFEST_SCHEMA) {
        return {
            manifest: null,
            issues: [err('清单', `格式版本不认识（schema=${JSON.stringify(obj.schema)}，本程序只认 ${MANIFEST_SCHEMA}）`)],
        };
    }
    if (!Array.isArray(obj.paragraphs) || obj.paragraphs.length === 0) {
        return { manifest: null, issues: [err('清单', 'paragraphs 不是非空数组')] };
    }
    const paragraphs = obj.paragraphs.map((item, index) => {
        const where = `第 ${index + 1} 段`;
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            issues.push(err(where, '不是一个 JSON 对象'));
            return { scriptLines: BROKEN_LINES, sourceRanges: null };
        }
        const rec = item;
        const scriptLines = asRange(rec.scriptLines);
        if (scriptLines === undefined) {
            issues.push(err(where, `scriptLines 不是合法行号区间（${JSON.stringify(rec.scriptLines)}）`));
        }
        const sourceRanges = asSourceRanges(rec.sourceRanges);
        if (sourceRanges === undefined) {
            issues.push(err(where, `sourceRanges 不是 null 也不是 [[起,止], …]（${JSON.stringify(rec.sourceRanges)}）`));
        }
        return {
            scriptLines: scriptLines ?? BROKEN_LINES,
            sourceRanges: sourceRanges ?? null,
        };
    });
    return { manifest: { schema: MANIFEST_SCHEMA, paragraphs }, issues };
}
/**
 * 剧本文件与清单对不对得上（设计文档 §13）。
 *
 * 规则：第 1 段从第 1 行开始；相邻段落之间恰好一个空白行；
 * 下一段开始行 = 上一段结束行 + 2；最后一段结束行 = 文件总行数；
 * 间隔行必须是空行；段落内部不得有空白行。
 *
 * **能力边界**：能发现增行、删行、空行变化；**发现不了保持行数不变的文字替换**。
 */
export function checkScriptStructure(scriptText, manifest) {
    const issues = [];
    const lines = splitLines(scriptText);
    const total = lines.length;
    let expectedStart = 1;
    manifest.paragraphs.forEach((p, index) => {
        const where = `第 ${index + 1} 段`;
        const [start, end] = p.scriptLines;
        if (start === 0 && end === 0)
            return; // 清单这一段本来就坏了，上面已经报过
        if (start !== expectedStart) {
            issues.push(err(where, `声明从第 ${start} 行开始，但按段落分隔规则应当是第 ${expectedStart} 行`));
        }
        if (end > total) {
            issues.push(err(where, `声明到第 ${end} 行，但剧本文件只有 ${total} 行`));
            return;
        }
        if (index > 0 && start >= 2 && !isBlankLine(lines[start - 2] ?? '')) {
            issues.push(err(where, `与上一段之间的第 ${start - 1} 行应当是空白行`));
        }
        for (let i = start; i <= end; i += 1) {
            if (isBlankLine(lines[i - 1] ?? '')) {
                issues.push(err(where, `第 ${i} 行是空白行 —— 段落内部不允许空白行`));
                break;
            }
        }
        expectedStart = end + 2;
    });
    const last = manifest.paragraphs[manifest.paragraphs.length - 1];
    if (last !== undefined && last.scriptLines[0] !== 0 && last.scriptLines[1] !== total) {
        issues.push(err('清单', `最后一段声明到第 ${last.scriptLines[1]} 行，但剧本文件共 ${total} 行`));
    }
    return issues;
}
/** 本集覆盖的原文范围（由所有 `sourceRanges` 机械取最小/最大；全为 null 时返回 null）。 */
export function computeNovelRange(manifest) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = 0;
    for (const p of manifest.paragraphs) {
        for (const [a, b] of p.sourceRanges ?? []) {
            if (a < lo)
                lo = a;
            if (b > hi)
                hi = b;
        }
    }
    return hi === 0 ? null : [lo, hi];
}
/** 清单里所有 `sourceRanges` 里出现的最大行号（用于越界校验）。 */
export function maxSourceLine(manifest) {
    let max = 0;
    for (const p of manifest.paragraphs) {
        for (const [, b] of p.sourceRanges ?? [])
            if (b > max)
                max = b;
    }
    return max;
}
/**
 * 解析批注文件。
 *
 * @returns 合法条目与问题列表；整个文件不是数组时 `annotations` 为 `null`（= 不可用）。
 */
export function parseAnnotations(raw) {
    if (!Array.isArray(raw)) {
        return { annotations: null, issues: [err('批注', '不是一个 JSON 数组')] };
    }
    const issues = [];
    const out = [];
    const seen = new Set();
    raw.forEach((item, index) => {
        const where = `第 ${index + 1} 条`;
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            issues.push(err(where, '不是一个 JSON 对象'));
            return;
        }
        const rec = item;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        const problem = typeof rec.problem === 'string' ? rec.problem : '';
        if (id === '') {
            issues.push(err(where, 'id 缺失'));
            return;
        }
        if (seen.has(id)) {
            issues.push(err(where, `id ${id} 重复，已忽略这一条`));
            return;
        }
        /* 区域：新格式 `regions` 数组；老格式（扁平 paragraph/endParagraph/quote）折成一处。 */
        const rawRegions = Array.isArray(rec.regions)
            ? rec.regions
            : (rec.paragraph !== undefined || rec.quote !== undefined ? [rec] : []);
        const regions = [];
        for (const [regionIndex, rawRegion] of rawRegions.entries()) {
            const regionWhere = rawRegions.length > 1 ? `${where} 第 ${regionIndex + 1} 处` : where;
            if (typeof rawRegion !== 'object' || rawRegion === null || Array.isArray(rawRegion)) {
                issues.push(err(regionWhere, '不是一个 JSON 对象'));
                continue;
            }
            const region = rawRegion;
            const paragraph = typeof region.paragraph === 'number' ? region.paragraph : Number(region.paragraph);
            const quote = typeof region.quote === 'string' ? region.quote : '';
            if (!Number.isInteger(paragraph) || paragraph < 1) {
                issues.push(err(regionWhere, `paragraph 不是正整数（${JSON.stringify(region.paragraph)}）`));
                continue;
            }
            if (quote.trim() === '') {
                issues.push(err(regionWhere, 'quote 为空'));
                continue;
            }
            /* 连续跨段：结束段落必须是 > 起始段落的整数；不合格按单段处理，并把问题说出来。 */
            let endParagraph;
            if (region.endParagraph !== undefined && region.endParagraph !== null) {
                const end = typeof region.endParagraph === 'number' ? region.endParagraph : Number(region.endParagraph);
                if (Number.isInteger(end) && end > paragraph)
                    endParagraph = end;
                else if (end !== paragraph) {
                    issues.push(err(regionWhere, `endParagraph 不是 ≥ paragraph 的整数（${JSON.stringify(region.endParagraph)}），已按单段处理`));
                }
            }
            regions.push({ paragraph, ...(endParagraph === undefined ? {} : { endParagraph }), quote });
        }
        if (regions.length === 0) {
            issues.push(err(where, '没有任何可用的区域，已忽略这一条'));
            return;
        }
        seen.add(id);
        out.push({
            id,
            regions,
            problem,
            done: rec.done === true,
            resolvedIn: typeof rec.resolvedIn === 'string' && rec.resolvedIn !== '' ? rec.resolvedIn : null,
        });
    });
    return { annotations: out, issues };
}
/**
 * 保存前的合并：以**内存里**的列表为准（用户刚编辑的内容），
 * `done` / `resolvedIn` 取**磁盘上**的值（agent 勾的结果）。
 */
export function mergeAnnotations(memory, disk) {
    const byId = new Map(disk.map(a => [a.id, a]));
    return memory.map((a) => {
        const saved = byId.get(a.id);
        return saved === undefined ? a : { ...a, done: saved.done, resolvedIn: saved.resolvedIn };
    });
}
/** 下一个可用的批注序号（接着已有的最大编号往下排）。 */
export function nextAnnotationSeq(existing) {
    let max = 0;
    for (const a of existing) {
        const m = /^a-(\d+)$/.exec(a.id);
        if (m?.[1] !== undefined)
            max = Math.max(max, Number.parseInt(m[1], 10));
    }
    return max + 1;
}
/**
 * 生成一条新批注（程序在用户划词时调）。
 * @param regions - 这条批注挂的几处（至少一处；Ctrl 多选就是多处）。
 */
export function makeAnnotation(seq, regions, problem) {
    return {
        id: annotationId(seq),
        regions: regions.map(r => ({ ...r })),
        problem,
        done: false,
        resolvedIn: null,
    };
}
//# sourceMappingURL=validate.js.map