/**
 * 人工编辑模式的**纯函数层**（设计：`人工编辑模式-实施计划.md` v6）。
 *
 * 这里只做机械的事：解析文件名、算小版本号、把"改之前"和"改之后"两份文本
 * **按内容对上号**、把段落与批注迁过去、把这次改动写成一份历史记录。
 * 不碰文件、不碰界面、不判断剧情内容。
 *
 * 三条硬规则（计划 §9，改这里之前先读）：
 *   1. **按内容对齐，不按行号对比** —— 行号被挤下去（平移）不算改动，
 *      既不算"修改"也不算"新增"；
 *   2. **新增内容找不到出处就记"新增（无对应）"** —— 绝不搜索原文、
 *      绝不继承相邻段落的对应关系；
 *   3. 拿不准宁可记"新增"，也不凑一个对应关系上去。
 *
 * ⚠️ 与 `validate.ts` 的分工：那边管"读进来的东西合不合法"，这边管
 *    "人工改完之后，行号、段落对应、批注锚点怎么跟着走"。两边都不判断剧情。
 */
import { MANIFEST_SCHEMA, } from "./protocol.js";
import { isBlankLine, normalizeNewlines, splitLines } from "./validate.js";
/**
 * 名字规则（设计文档 §2.3）。
 *
 * ⚠️ 顺序要紧："历史"是唯一一条"集号后面直接跟 .txt"的规则，必须排最后，
 *    否则 `第1集剧本.txt` 会被它先吃掉。
 * ⚠️ 正文那一类同时收"剧本"和"提示词"两个词 —— 两个插件刻意同构，
 *    这里共用一份规则，由 `word` 字段区分；放错词的由调用方报出来。
 *    用**具名分组**取字段：前三条规则的括号位置不一样，靠下标取太容易错。
 */
const NAME_PATTERNS = [
    { kind: 'content', re: /^第(?<ep>\d+)集(?<word>剧本|提示词)(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/ },
    { kind: 'manifest', re: /^第(?<ep>\d+)集清单(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/ },
    { kind: 'annotation', re: /^第(?<ep>\d+)集批注(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/ },
    { kind: 'history', re: /^第(?<ep>\d+)集(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/ },
];
/**
 * 解析一个文件名。
 * @param name - 只有文件名（不含目录）。
 * @returns 不认识时 `undefined`（调用方应当把"文件名不认识"报出来，不猜）。
 */
export function parseContentName(name) {
    for (const { kind, re } of NAME_PATTERNS) {
        const m = re.exec(name);
        if (m === null)
            continue;
        const g = m.groups ?? {};
        const episode = Number.parseInt(g.ep ?? '', 10);
        if (!Number.isInteger(episode) || episode < 1)
            return undefined;
        const word = g.word === '剧本' || g.word === '提示词' ? g.word : undefined;
        const base = { episode, kind, ...(word === undefined ? {} : { word }) };
        /* 基线文件：没有小版本后缀。 */
        if (g.major === undefined || g.minor === undefined)
            return base;
        const minor = Number.parseInt(g.minor, 10);
        /* 小版本号从 1 起（`v2.0` 这种名字不认识）。 */
        if (!Number.isInteger(minor) || minor < 1)
            return undefined;
        return { ...base, major: `v${g.major}`, minor, tag: `v${g.major}.${minor}` };
    }
    return undefined;
}
/** `v2.1` 这样的形式才算小版本号（大版本目录名不算）。 */
export function isMinorTag(tag) {
    const m = /^v(\d+)\.(\d+)$/.exec(tag);
    if (m === null)
        return false;
    const minor = Number.parseInt(m[2] ?? '', 10);
    return Number.isInteger(minor) && minor >= 1;
}
/** `v2.1` → `v2`；没有点就原样返回。 */
export function tagMajor(tag) {
    const dot = tag.indexOf('.');
    return dot === -1 ? tag : tag.slice(0, dot);
}
/** `('v2', 1)` → `v2.1`。 */
export function formatMinor(major, minor) {
    return `${major}.${minor}`;
}
/**
 * 小版本号里的 `v2` 必须等于它所在的大版本目录名。
 *
 * 为什么校验它：`第1集剧本.v3.1.txt` 要是躺在 `v2/` 里，说明文件被挪错过
 * （或者人手工拷错了），照着用它会把 v3 的内容当成 v2 的人工版本。
 */
export function tagMatchesDir(tag, versionDir) {
    return tagMajor(tag) === versionDir;
}
/**
 * 这一集的**下一个**小版本号。
 *
 * 规则（计划 §3）：小版本号**每一集各算各的**，所以只数这一集自己的小版本
 * 文件，取最大号 + 1；一个都没有就是 1。
 *
 * @param names - 同一个大版本目录下的文件名（可以混着别的集，函数自己筛）。
 */
export function nextMinorNumber(names, episode) {
    let max = 0;
    for (const name of names) {
        const parsed = parseContentName(name);
        if (parsed === undefined || parsed.episode !== episode || parsed.minor === undefined)
            continue;
        if (parsed.minor > max)
            max = parsed.minor;
    }
    return max + 1;
}
/** 精细比对的开销上限（单元格数）。超过就退化成"整块都算改了"。 */
const MAX_DP_CELLS = 262_144;
/**
 * 把两份文本**按内容对上号**（这是整个功能的地基）。
 *
 * 做法，三步：
 *   1. 先剥掉**两端完全一样**的部分（真实编辑绝大多数都落在这条路上）；
 *   2. 中间那段找"最长的公共行序列"（内容相同、先后顺序也一致），连上线；
 *   3. 连不上的地方就是改动：只有旧行 = 删了，只有新行 = 新增，两边都有 = 改了。
 *
 * ⚠️ 为什么不能按行号逐行对比：在第 2 行后面插一行，旧的第 3—10 行会被挤到
 *    新的第 4—11 行；按行号比就会得出"后面全被改了、末尾还多出一行"的
 *    错误结论（计划 §9 的硬规则）。
 *
 * ⚠️ 内容完全相同的重复行（空行、重复台词）之间**无法分辨**被插进去的是哪一行。
 *    本实现取"两端的相同行优先配上、改动尽量落在中间"的确定性解；这只影响
 *    "标记落在哪一行"，**不影响段/块的行范围**。
 */
export function alignLines(oldLines, newLines) {
    const oldCount = oldLines.length;
    const newCount = newLines.length;
    const oldToNew = new Array(oldCount).fill(0);
    const newToOld = new Array(newCount).fill(0);
    const matches = [];
    /* ① 公共前缀 */
    let head = 0;
    while (head < oldCount && head < newCount && oldLines[head] === newLines[head]) {
        oldToNew[head] = head + 1;
        newToOld[head] = head + 1;
        matches.push({ oldLine: head + 1, newLine: head + 1 });
        head += 1;
    }
    /* ② 公共后缀（不许越过前缀区） */
    let tail = 0;
    while (oldCount - 1 - tail >= head
        && newCount - 1 - tail >= head
        && oldLines[oldCount - 1 - tail] === newLines[newCount - 1 - tail]) {
        const oldLine = oldCount - tail;
        const newLine = newCount - tail;
        oldToNew[oldLine - 1] = newLine;
        newToOld[newLine - 1] = oldLine;
        matches.push({ oldLine, newLine });
        tail += 1;
    }
    /* ③ 中间那段做精细比对 */
    const oStart = head;
    const nStart = head;
    const n = oldCount - tail - oStart;
    const m = newCount - tail - nStart;
    if (n > 0 && m > 0) {
        if (n * m <= MAX_DP_CELLS) {
            const width = m + 1;
            /* dp[i * width + j] = 旧[i..] 与 新[j..] 的最长公共行数 */
            const dp = new Int32Array((n + 1) * width);
            for (let i = n - 1; i >= 0; i -= 1) {
                for (let j = m - 1; j >= 0; j -= 1) {
                    dp[i * width + j] = oldLines[oStart + i] === newLines[nStart + j]
                        ? (dp[(i + 1) * width + j + 1] ?? 0) + 1
                        : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
                }
            }
            let i = 0;
            let j = 0;
            while (i < n && j < m) {
                if (oldLines[oStart + i] === newLines[nStart + j]) {
                    const oldLine = oStart + i + 1;
                    const newLine = nStart + j + 1;
                    oldToNew[oldLine - 1] = newLine;
                    newToOld[newLine - 1] = oldLine;
                    matches.push({ oldLine, newLine });
                    i += 1;
                    j += 1;
                    continue;
                }
                /* 平手时先跳新行（把"新增"记在更靠前的位置）；两种取法都确定。 */
                if ((dp[(i + 1) * width + j] ?? 0) > (dp[i * width + j + 1] ?? 0))
                    i += 1;
                else
                    j += 1;
            }
            matches.sort((a, b) => a.oldLine - b.oldLine);
            return { oldToNew, newToOld, matches, degraded: false };
        }
        /* 太大：不做精细比对，中间整块按"全改了"处理，让调用方标待复核。 */
        matches.sort((a, b) => a.oldLine - b.oldLine);
        return { oldToNew, newToOld, matches, degraded: true };
    }
    matches.sort((a, b) => a.oldLine - b.oldLine);
    return { oldToNew, newToOld, matches, degraded: false };
}
/**
 * 把对齐结果整理成"一处一处"的改动。
 *
 * 用途：① 历史文件里的步骤；② 判断某个段落是不是"被改过"（判「待复核」）；
 * ③ 判断批注所标的位置有没有被动过。
 */
export function diffHunks(oldLines, newLines, alignment = alignLines(oldLines, newLines)) {
    const hunks = [];
    /* 相邻两个"连上的行"之间就是一处改动；首尾各补一个哨兵。 */
    const anchors = [
        { oldLine: 0, newLine: 0 },
        ...alignment.matches,
        { oldLine: oldLines.length + 1, newLine: newLines.length + 1 },
    ];
    for (let index = 1; index < anchors.length; index += 1) {
        const prev = anchors[index - 1];
        const next = anchors[index];
        if (prev === undefined || next === undefined)
            continue;
        const oldFrom = prev.oldLine + 1;
        const oldTo = next.oldLine - 1;
        const newFrom = prev.newLine + 1;
        const newTo = next.newLine - 1;
        const removed = oldFrom <= oldTo ? oldLines.slice(oldFrom - 1, oldTo) : [];
        const added = newFrom <= newTo ? newLines.slice(newFrom - 1, newTo) : [];
        if (removed.length === 0 && added.length === 0)
            continue;
        hunks.push({
            kind: removed.length === 0 ? 'insert' : added.length === 0 ? 'delete' : 'replace',
            atNewLine: added.length > 0
                ? newFrom
                : Math.min(Math.max(1, prev.newLine + 1), Math.max(1, newLines.length)),
            oldSpan: removed.length === 0 ? null : { start: oldFrom, end: oldTo },
            newSpan: added.length === 0 ? null : { start: newFrom, end: newTo },
            removed,
            added,
        });
    }
    return hunks;
}
/** 新文件里"被动过"的行区间（新增的 + 被替换进来的），用来判批注的 touched。 */
export function changedNewSpans(hunks) {
    const out = [];
    for (const hunk of hunks)
        if (hunk.newSpan !== null)
            out.push(hunk.newSpan);
    return out;
}
/** 两个区间有没有交集。 */
export function spansOverlap(a, b) {
    return a.start <= b.end && b.start <= a.end;
}
/* ══ 四、段落（剧本侧的"段"）═══════════════════════════════════════════ */
/**
 * 按空行把正文切成段落（设计文档 §6.1：段间恰好一个空行、段内不许有空行）。
 *
 * ⚠️ 连续多个空行只当**一个**分隔符、首尾的空行丢掉 —— 不产生空段落。
 *    这条很要紧：`computeScriptLines` 假设"下一段起点 = 上一段终点 + 2"，
 *    切出一个空段落会让行号与正文再也对不上。
 */
export function splitParagraphs(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
        while (i < lines.length && isBlankLine(lines[i] ?? ''))
            i += 1;
        if (i >= lines.length)
            break;
        const start = i;
        while (i < lines.length && !isBlankLine(lines[i] ?? ''))
            i += 1;
        out.push({ start: start + 1, end: i });
    }
    return out;
}
/** 内部：造一个段落对象。 */
function makeParagraph(index, span, text, origin, fromIndex, sourceRanges, needsReview, shared) {
    return {
        index,
        span,
        scriptLines: [span.start, span.end],
        text,
        origin,
        fromIndex,
        sourceRanges: origin === 'added' ? null : sourceRanges,
        needsReview,
        shared,
    };
}
/** 旧段落原文（清单坏了 / 越界时给空串）。 */
function textOfOldParagraph(oldLines, paragraph) {
    if (paragraph === undefined)
        return '';
    const [start, end] = paragraph.scriptLines;
    if (start < 1 || end < start)
        return '';
    return oldLines.slice(start - 1, end).join('\n');
}
/**
 * 两段文字"像不像"：按**字符**的最长公共子序列算个 0—1 的比值。
 *
 * 用途：人工改稿通常是"在一句话上改几个字"，两段文字会长得很像；而"删掉一整段"
 * 留下的空缺跟隔壁段八竿子打不着。靠这个比值，程序能分清"这一段是改出来的"
 * 还是"这一段是新写的"，比"数目对不对得上"可靠得多（见 `deriveParagraphs` 的说明）。
 *
 * ⚠️ 很长的文字（乘积超过 4096）退化成"共同前缀 + 共同后缀"的粗略值 ——
 *    剧本段落不会那么长，真遇到了也不值得为它多花时间。
 */
export function textSimilarity(a, b) {
    const x = normalizeNewlines(a);
    const y = normalizeNewlines(b);
    if (x === '' || y === '')
        return 0;
    if (x === y)
        return 1;
    const n = x.length;
    const m = y.length;
    if (n * m > 4096) {
        let head = 0;
        while (head < n && head < m && x[head] === y[head])
            head += 1;
        let tail = 0;
        while (tail < n - head && tail < m - head && x[n - 1 - tail] === y[m - 1 - tail])
            tail += 1;
        return (2 * (head + tail)) / (n + m);
    }
    const width = m + 1;
    const dp = new Int32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i * width + j] = x[i] === y[j]
                ? (dp[(i + 1) * width + j + 1] ?? 0) + 1
                : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
        }
    }
    return (2 * (dp[0] ?? 0)) / (n + m);
}
/** "像不像"的门槛：低于它就不认作同一段（宁可记"新增"）。 */
export const SIMILARITY_FLOOR = 0.5;
/**
 * 把旧段落"迁移"到新正文上。
 *
 * 判断顺序（计划 §9）：
 *   ① 原样没动 → `same`，对应关系原样沿用；
 *   ② 是原来某一段改出来的 → `edited`，沿用 + 待复核；
 *   ③ 都不是 → `added`，对应关系记空（**不搜索、不继承邻居**）。
 *
 * ⚠️ "是原来某一段改出来的"怎么判：先看这一段的文字有没有对回某一段旧段落
 *    （对齐结果里能连线）；整段被重写、连不上线时，再看它**夹在哪两段之间** ——
 *    如果它落在"上一段对应旧 X、下一段对应旧 Y"的中间，而 X 与 Y 之间恰好有
 *    同样数目的旧段落没人认领，那就认作"那几段被重写了"（沿用 + 待复核）。
 *    数目对不上就按新增登记（宁可记新增，不凑对应关系）。
 */
export function deriveParagraphs(oldLines, newLines, oldParagraphs, alignment = alignLines(oldLines, newLines)) {
    const issues = [];
    const spans = splitParagraphs(newLines);
    const texts = spans.map(span => newLines.slice(span.start - 1, span.end).join('\n'));
    /* 旧行 → 旧段落号 */
    const oldLineToParagraph = new Map();
    oldParagraphs.forEach((p, index) => {
        const [start, end] = p.scriptLines;
        if (start === 0 && end === 0)
            return; /* 清单本来就坏的占位区间，不参与 */
        for (let line = start; line <= end; line += 1)
            oldLineToParagraph.set(line, index + 1);
    });
    /* 每一段对回了哪些旧段落 */
    const refs = spans.map((span) => {
        const set = new Set();
        for (let line = span.start; line <= span.end; line += 1) {
            const oldLine = alignment.newToOld[line - 1] ?? 0;
            if (oldLine === 0)
                continue;
            const paragraph = oldLineToParagraph.get(oldLine);
            if (paragraph !== undefined)
                set.add(paragraph);
        }
        return [...set].sort((a, b) => a - b);
    });
    /* 被认领的旧段落；没被认领的可能是"被删了"，也可能是"被整段重写" */
    const referenced = new Set();
    for (const list of refs)
        for (const n of list)
            referenced.add(n);
    const orphans = oldParagraphs
        .map((_, index) => index + 1)
        .filter(n => !referenced.has(n));
    /* 拆段 / 并段：同一个旧段落被不止一段认领 */
    const useCount = new Map();
    for (const list of refs)
        for (const n of list)
            useCount.set(n, (useCount.get(n) ?? 0) + 1);
    /* 每一段前面最近一次认领到的旧段落号 / 后面最近一次 */
    const prevRef = [];
    const nextRef = [];
    {
        let last = 0;
        for (let i = 0; i < refs.length; i += 1) {
            prevRef.push(last);
            const list = refs[i];
            if (list !== undefined && list.length > 0)
                last = list[list.length - 1] ?? last;
        }
        let next = oldParagraphs.length + 1;
        for (let i = refs.length - 1; i >= 0; i -= 1) {
            nextRef[i] = next;
            const list = refs[i];
            if (list !== undefined && list.length > 0)
                next = list[0] ?? next;
        }
    }
    /* 降级：整块太大没做精细比对，按位置一一对上，全部标待复核 */
    if (alignment.degraded) {
        issues.push('这一集改动很大，程序没能逐行精细比对；下面的对应关系是按位置推的，请复核');
        const paragraphs = spans.map((span, index) => {
            const text = texts[index] ?? '';
            const old = oldParagraphs[index];
            const same = old !== undefined && textOfOldParagraph(oldLines, old) === text;
            const origin = same ? 'same' : old === undefined ? 'added' : 'edited';
            return makeParagraph(index + 1, span, text, origin, origin === 'added' ? null : index + 1, old?.sourceRanges ?? null, !same, false);
        });
        return { paragraphs, deleted: orphans, degraded: true, issues };
    }
    const out = spans.map((span, index) => {
        const text = texts[index] ?? '';
        const list = refs[index] ?? [];
        if (list.length === 1) {
            const from = list[0] ?? 1;
            const shared = (useCount.get(from) ?? 0) > 1;
            const same = textOfOldParagraph(oldLines, oldParagraphs[from - 1]) === text && !shared;
            return makeParagraph(index + 1, span, text, same ? 'same' : 'edited', from, oldParagraphs[from - 1]?.sourceRanges ?? null, !same || shared, shared);
        }
        if (list.length > 1) {
            /* 并段：好几段旧段落拼成了一段 */
            const from = list[0] ?? 1;
            return makeParagraph(index + 1, span, text, 'edited', from, oldParagraphs[from - 1]?.sourceRanges ?? null, true, true);
        }
        /* 认领不到：先当新增；下面第二遍再看能不能配到"被整段重写"的旧段落 */
        return makeParagraph(index + 1, span, text, 'added', null, null, false, false);
    });
    /*
     * 第二遍：认领不到的段落（整段被重写的那几种情况）。
     *
     * ⚠️ 这里踩过一次坑（2026-09-15，`t1/剧本工作台` 第 1 集真事）：用户**改了一句**
     *    又**删掉相邻的一段** —— 于是"没人认领的旧段落"有**两个**，而对不上的新段落
     *    只有**一个**。原先要求"数目必须相等"才配对，数目不等就整段按"新增"登记，
     *    结果那句只改了几个字的话被标成新增、连原文对应也丢了。
     *
     * 所以改成两步：
     *   ① **先按内容像不像配**（"以后那个人就是你爸爸！" → "以后那个人就是你的爸爸了！"
     *      相似度很高，一眼就是同一段的改写；被删的那一段跟它八竿子打不着）；
     *   ② 剩下的（真的整段重写、内容完全不同）再看**数目对不对得上**，对上就按顺序配
     *      —— 这一步只是猜测，配到的照样标「待复核」；对不上仍按"新增"登记。
     */
    const consumed = new Set();
    let cursor = 0;
    while (cursor < out.length) {
        if (out[cursor]?.origin !== 'added') {
            cursor += 1;
            continue;
        }
        let end = cursor;
        while (end + 1 < out.length && out[end + 1]?.origin === 'added')
            end += 1;
        const runLength = end - cursor + 1;
        const from = prevRef[cursor] ?? 0;
        const to = nextRef[cursor] ?? oldParagraphs.length + 1;
        const candidates = orphans.filter(n => n > from && n < to && !consumed.has(n));
        /* ① 按内容相似度配（一个旧段落只能配一次） */
        const pairs = new Map();
        for (let offset = 0; offset < runLength; offset += 1) {
            const target = out[cursor + offset];
            if (target === undefined)
                continue;
            let best = null;
            for (const candidate of candidates) {
                if ([...pairs.values()].includes(candidate))
                    continue;
                const score = textSimilarity(target.text, textOfOldParagraph(oldLines, oldParagraphs[candidate - 1]));
                if (score < SIMILARITY_FLOOR)
                    continue;
                if (best === null || score > best.score)
                    best = { index: candidate, score };
            }
            if (best !== null)
                pairs.set(offset, best.index);
        }
        /* ② 剩下的：数目对得上就按顺序配 */
        const leftoverRun = [...Array(runLength).keys()].filter(offset => !pairs.has(offset));
        const leftoverCandidates = candidates.filter(n => ![...pairs.values()].includes(n));
        if (leftoverRun.length > 0 && leftoverRun.length === leftoverCandidates.length) {
            leftoverRun.forEach((offset, index) => {
                const candidate = leftoverCandidates[index];
                if (candidate !== undefined)
                    pairs.set(offset, candidate);
            });
        }
        /* ③ 落定 */
        for (const [offset, fromIndex] of pairs) {
            const target = out[cursor + offset];
            if (target === undefined)
                continue;
            consumed.add(fromIndex);
            out[cursor + offset] = {
                ...target,
                origin: 'edited',
                fromIndex,
                sourceRanges: oldParagraphs[fromIndex - 1]?.sourceRanges ?? null,
                needsReview: true,
            };
        }
        const unmatched = [...Array(runLength).keys()].filter(offset => !pairs.has(offset)).length;
        if (unmatched > 0 && candidates.length > 0) {
            const where = runLength === 1 ? `第 ${cursor + 1} 段` : `第 ${cursor + 1}—${end + 1} 段`;
            issues.push(`${where}改动太大，说不清对应原来哪一段，已按"新增"登记`);
        }
        cursor = end + 1;
    }
    return {
        paragraphs: out,
        deleted: orphans.filter(n => !consumed.has(n)),
        degraded: false,
        issues,
    };
}
/** 派生结果 → 新清单（`scriptLines` 用新行号、`sourceRanges` 沿用或置空）。 */
export function toManifest(paragraphs) {
    return {
        schema: MANIFEST_SCHEMA,
        paragraphs: paragraphs.map(p => ({
            scriptLines: [p.span.start, p.span.end],
            sourceRanges: p.sourceRanges,
        })),
    };
}
/**
 * 把批注的"第几段"迁到新正文上，并判断引文还成不成立。
 *
 * ⚠️ 三种结果都要**说出来**，不许静默：段落被删 / 引文找不到 = 锚点失效；
 *    引文还在但位置被动过 = 请人核对是否已经人工处理（**不自动算已处理**）。
 */
export function remapAnnotations(annotations, input) {
    return annotations.map((annotation) => {
        const reasons = [];
        let touched = false;
        const kept = [];
        for (const region of annotation.regions) {
            const start = input.paragraphMap.get(region.paragraph);
            const startSpan = start === undefined ? undefined : input.paragraphSpans[start - 1];
            if (start === undefined || startSpan === undefined) {
                reasons.push(`第 ${region.paragraph} 段已被删除`);
                continue;
            }
            let end = start;
            if (region.endParagraph !== undefined) {
                const mappedEnd = input.paragraphMap.get(region.endParagraph);
                if (mappedEnd === undefined) {
                    reasons.push(`跨段的尾段（第 ${region.endParagraph} 段）已被删除，已缩成一段`);
                    touched = true;
                }
                else {
                    end = mappedEnd;
                }
            }
            const endSpan = input.paragraphSpans[end - 1] ?? startSpan;
            const text = input.paragraphTexts.slice(start - 1, end).join('\n');
            if (!containsQuote(text, region.quote)) {
                reasons.push(`第 ${region.paragraph} 段的引文在新正文里找不到了`);
                continue;
            }
            const whole = { start: startSpan.start, end: endSpan.end };
            if (input.changedSpans.some(changed => spansOverlap(changed, whole)))
                touched = true;
            kept.push({ paragraph: start, ...(end > start ? { endParagraph: end } : {}), quote: region.quote });
        }
        if (kept.length === 0 || kept.length !== annotation.regions.length) {
            return { id: annotation.id, status: 'stale', annotation: null, original: annotation, reasons };
        }
        if (touched)
            reasons.push('所标位置在人工编辑中被改动过，请核对是否已被人工处理');
        return {
            id: annotation.id,
            status: touched ? 'touched' : 'ok',
            annotation: { ...annotation, regions: kept },
            original: annotation,
            reasons,
        };
    });
}
/**
 * 引文还在不在正文里。
 *
 * ⚠️ 先用原样子串比（设计文档 §7.3 的口径）；失败再退一步，按"每行去首尾
 *    空白、连续空白压成一个空格"比一次 —— 人工编辑很容易在行尾多一个空格，
 *    那种情况不该判成"锚点失效"。两次都不中才算失效。
 */
export function containsQuote(text, quote) {
    if (quote === '')
        return false;
    if (normalizeNewlines(text).includes(quote))
        return true;
    const squash = (value) => normalizeNewlines(value).split('\n')
        .map(line => line.trim()).join('\n').replace(/[ \t]+/g, ' ');
    return squash(text).includes(squash(quote));
}
/**
 * 生成历史文件正文。
 *
 * ⚠️ 被删掉的行**照录**（计划 §8.2）：那是 agent 最需要的线索（"他试过什么
 *    又推翻了"）。文件名由调用方拼：`<大版本>/历史/第N集.<小版本>.txt`。
 */
export function renderHistory(input) {
    const out = [];
    out.push(`第${input.episode}集 · 人工编辑 → ${input.tag}`);
    out.push('');
    out.push(`基线：${input.baseFile}（${input.baseTag}）`);
    if (input.startedAt !== undefined && input.endedAt !== undefined) {
        out.push(`时间：${input.startedAt} → ${input.endedAt}`);
    }
    out.push(`结果：+${input.addedLines} 行 / -${input.removedLines} 行`);
    if (input.paragraphNotes.length > 0) {
        out.push('对照：');
        for (const note of input.paragraphNotes)
            out.push(`  · ${note}`);
    }
    if (input.annotationNotes.length > 0) {
        out.push('批注：');
        for (const note of input.annotationNotes)
            out.push(`  · ${note}`);
    }
    if (input.issues !== undefined && input.issues.length > 0) {
        out.push('需要留意：');
        for (const issue of input.issues)
            out.push(`  · ${issue}`);
    }
    if (input.steps.length > 0) {
        out.push('');
        out.push('步骤：');
        input.steps.forEach((step, index) => {
            const when = step.at === undefined ? '' : ` ${step.at}`;
            out.push(`${index + 1}.${when} ${step.label}`);
            for (const line of step.removed)
                out.push(`   - ${line}`);
            for (const line of step.added)
                out.push(`   + ${line}`);
        });
    }
    return `${out.join('\n')}\n`;
}
/**
 * 快照太多就掐掉中间、留首尾。
 *
 * 为什么留首尾：开头是"动手之前"、结尾是"最后停手的地方"；掐掉中间只损失细节，
 * 历史读起来还是接得上的。
 */
export function trimSnapshots(snapshots, max = 200) {
    if (snapshots.length <= max)
        return [...snapshots];
    const head = Math.ceil(max / 2);
    const tail = max - head;
    return [...snapshots.slice(0, head), ...snapshots.slice(snapshots.length - tail)];
}
/** 新正文里某一行落在第几段（`before` = 落在这一段之前）。落在最后一段之后返回 `null`。 */
export function paragraphAt(paragraphs, line) {
    for (const p of paragraphs) {
        if (line >= p.span.start && line <= p.span.end)
            return { index: p.index, before: false };
        if (line < p.span.start)
            return { index: p.index, before: true };
    }
    return null;
}
/** 把"当时的行号"映射到最终正文的行号（那一行后来被删了，就往外找最近的一根线）。 */
function probeFinalLine(alignment, line) {
    const mapped = alignment.oldToNew[line - 1] ?? 0;
    if (mapped > 0)
        return mapped;
    for (let step = 1; step < alignment.oldToNew.length; step += 1) {
        const up = alignment.oldToNew[line - 1 - step];
        if (up !== undefined && up > 0)
            return up;
        const down = alignment.oldToNew[line - 1 + step];
        if (down !== undefined && down > 0)
            return down;
    }
    return 0;
}
/** 一句话说清这一处改动（`第 3 段：替换 2 行（删 2、加 2）`）。 */
function describeHunk(hunk, at) {
    const where = at === null ? '正文末尾' : at.before ? `第 ${at.index} 段前` : `第 ${at.index} 段`;
    const removed = hunk.removed.length;
    const added = hunk.added.length;
    if (removed === 0)
        return `${where}：插入 ${added} 行`;
    if (added === 0)
        return `${where}：删除 ${removed} 行`;
    return `${where}：替换 ${Math.min(removed, added)} 行（删 ${removed}、加 ${added}）`;
}
/** 每一步最多照录几行（多的用一行省略号带过）。 */
const MAX_STEP_LINES = 12;
function capLines(lines) {
    if (lines.length <= MAX_STEP_LINES)
        return [...lines];
    return [...lines.slice(0, MAX_STEP_LINES), `…（还有 ${lines.length - MAX_STEP_LINES} 行）`];
}
function sameLines(a, b) {
    return a.length === b.length && a.every((line, i) => line === b[i]);
}
/**
 * 把"基线 → 一串快照 → 最终正文"整理成历史里的步骤。
 *
 * ⚠️ 段号说的是**最终正文**里的段号（agent 拿到的是那一版），所以每一步都要把
 *    "当时的行号"再映射一次到最终正文上 —— 中间过程的行号会漂，直接用会指错段。
 * ⚠️ 客户端已经保证"中文输入法组合期间不拍快照"；这里再兜一次：内容与上一张
 *    完全一样的快照直接跳过（多余的空帧不该占一行历史）。
 */
export function buildHistorySteps(baseLines, snapshots, finalLines, finalParagraphs) {
    const steps = [];
    const frames = trimSnapshots(snapshots).filter(s => s.text.trim() !== '');
    const push = (from, to, at) => {
        const hunks = diffHunks(from, to);
        if (hunks.length === 0)
            return;
        const toFinal = alignLines(to, finalLines);
        for (const hunk of hunks) {
            const line = probeFinalLine(toFinal, hunk.atNewLine);
            const where = line === 0 ? null : paragraphAt(finalParagraphs, line);
            steps.push({
                ...(at === undefined ? {} : { at }),
                label: describeHunk(hunk, where),
                removed: capLines(hunk.removed),
                added: capLines(hunk.added),
            });
        }
    };
    let prev = [...baseLines];
    for (const frame of frames) {
        const cur = linesOf(frame.text);
        if (sameLines(prev, cur))
            continue;
        push(prev, cur, frame.at);
        prev = cur;
    }
    if (!sameLines(prev, finalLines))
        push(prev, finalLines, undefined);
    return steps;
}
/** 一段文字 → 每一行（口径与 `validate.ts` 的 `splitLines` 一致）。 */
export function linesOf(text) {
    return splitLines(text);
}
/* ══ 八、编辑期间的快照（防中文输入法污染）═══════════════════════════════ */
/** 停手多久算"一步"。 */
export const SNAPSHOT_IDLE_MS = 3000;
/** 中文上屏之后再等多久拍一张（等浏览器把最后一次 input 也发完）。 */
export const SNAPSHOT_SETTLE_MS = 250;
/** 开一个状态。 */
export function initialSnapshotState(baseText) {
    return { text: baseText, baseText, frames: [], composing: false, pending: false, lastInputMs: 0, settleAtMs: null };
}
/** 两张帧内容一样（按行比，忽略行尾的换行差异）。 */
function sameFrameText(a, b) {
    return sameLines(linesOf(a), linesOf(b));
}
/**
 * 拍一张帧（内容与上一张或基线一样就不拍）。
 *
 * ⚠️ 为什么"一样就不拍"：拼音敲到一半按 Esc 取消、候选窗里翻页，都会让文本框
 *    的值来回变；不比较的话历史里会塞满没意义的帧。
 */
function takeFrame(state, at, nowMs) {
    const last = state.frames[state.frames.length - 1]?.text ?? state.baseText;
    if (sameFrameText(state.text, last)) {
        return { ...state, pending: false, settleAtMs: null, lastInputMs: nowMs };
    }
    return {
        ...state,
        frames: [...state.frames, { text: state.text, ...(at === '' ? {} : { at }) }],
        pending: false,
        settleAtMs: null,
        lastInputMs: nowMs,
    };
}
/**
 * 快照状态机（计划 §8.1）。
 *
 * 规则：
 *   · **组合中（在拼拼音）不计时、绝不拍** —— 这时候文本框里是拼音/候选串，
 *     拍下来就把拼音写进历史了；
 *   · 组合结束（上屏）后隔 `SNAPSHOT_SETTLE_MS` 拍一张，拿到的是汉字；
 *   · 非组合输入按"停手 `SNAPSHOT_IDLE_MS`"拍一张；
 *   · 离开输入框 / 保存前强制补一张；
 *   · 内容与上一张一样就不拍。
 *
 * ⚠️ 调用方还要保证：提交给宿主之前若仍在组合中，**丢掉最后一张**
 *    （见 `dropLastFrameIfComposing`），宿主侧也会再兜一次。
 */
export function snapshotReducer(state, event) {
    switch (event.kind) {
        case 'input': {
            const next = { ...state, text: event.text, pending: true };
            /* 组合期间：只跟着草稿走，计时器不动（思考多久都不算"停手"）。 */
            if (state.composing)
                return { ...next, settleAtMs: null };
            return { ...next, lastInputMs: event.nowMs, settleAtMs: null };
        }
        case 'compositionStart':
            return { ...state, text: event.text, composing: true, pending: true, settleAtMs: null };
        case 'compositionEnd': {
            const next = { ...state, text: event.text, composing: false, pending: true };
            if (sameFrameText(next.text, next.frames[next.frames.length - 1]?.text ?? next.baseText)) {
                return { ...next, pending: false, settleAtMs: null, lastInputMs: event.nowMs };
            }
            return { ...next, settleAtMs: event.nowMs + SNAPSHOT_SETTLE_MS };
        }
        case 'blur':
            return event.text === state.text && state.composing
                ? { ...state, composing: false }
                : takeFrame({ ...state, text: event.text, composing: false }, event.at, event.nowMs);
        case 'flush':
            return takeFrame({ ...state, text: event.text, composing: false }, event.at, event.nowMs);
        case 'tick': {
            if (state.composing || !state.pending)
                return state;
            if (state.settleAtMs !== null) {
                return event.nowMs >= state.settleAtMs ? takeFrame(state, event.at, event.nowMs) : state;
            }
            return event.nowMs - state.lastInputMs >= SNAPSHOT_IDLE_MS
                ? takeFrame(state, event.at, event.nowMs)
                : state;
        }
        default:
            return state;
    }
}
/**
 * 提交给宿主的帧。
 *
 * ⚠️ 为什么不需要"丢掉最后一张"：组合期间**从来没有拍过帧**，所以帧里不会有
 *    拼音。真正要防的是"提交时文本框里还是拼音" —— 那由两件事兜住：
 *    ① 点「保存」会让文本框失焦，浏览器会**先把组合提交掉**（`compositionend`
 *    先到），所以那一刻 `composing` 已经是 false；
 *    ② 万一事件顺序不对，`composing` 会是 true，界面据此提示一句、
 *    宿主侧也会把最后一帧与最终正文不一致的情况忽略掉。
 */
export function snapshotsForSubmit(state) {
    return { frames: [...state.frames], composing: state.composing };
}
//# sourceMappingURL=edit.js.map