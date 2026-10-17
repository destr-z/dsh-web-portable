/**
 * 组装"交给 agent"的那份指令（实施计划 §10）。
 *
 * 为什么单独放一层、而且做成纯函数：这份指令是**人与 agent 之间的接口** ——
 * 路径写错、少了"以最新版本为基线"那一句、漏掉"引文已找不到"的提醒，
 * agent 就会改错地方，而界面上完全看不出来。所以它有回归用例
 * （`scripts/verify-edit.mjs` 第 21 节）。
 *
 * ⚠️ 一份指令**同时**包含两件事：**人工已经改过的地方**（含历史记录文件路径）
 *    与**批注**（含"锚点已失效"的提醒）。人工改过之后，批注的引文可能已经对不上
 *    正文了 —— agent 只看批注会改错地方，只看人工改动又会漏掉批注。
 */
import { annotationPath, historyPath, manifestPath, scriptPath, } from "./protocol.js";
/** 一处区域的显示名：`第 6 段` / `第 3–7 段`。 */
export function regionLabel(region) {
    const to = region.endParagraph ?? region.paragraph;
    return to > region.paragraph ? `第 ${region.paragraph}–${to} 段` : `第 ${region.paragraph} 段`;
}
/**
 * 从原文第一行里取书名。
 *
 * ⚠️ 第一行常常不是光秃秃的书名，而是 `## 《某某》第 3 集 · 分镜剧本` 这种大标题。
 *    直接整行塞进指令会变成"修改《…第 3 集 · 分镜剧本》第 1 集的剧本"，
 *    所以这里把"第 N 集"之后的部分切掉，太长（>40 字）就干脆不写书名。
 */
export function bookNameOf(bookLine) {
    const cleaned = bookLine
        .replace(/^#+\s*/, '')
        .replace(/^[《【[]/, '')
        .replace(/第\s*\d+[\s\S]*$/, '')
        .replace(/[》】\]·|｜\s]+$/, '')
        .trim();
    return cleaned.length > 0 && cleaned.length <= 40 ? cleaned : '';
}
/**
 * 组装指令正文。
 *
 * @param input - 见 {@link InstructionInput}。
 * @returns 可以直接粘进对话的整段文本；没有任何一集时返回空串。
 */
export function buildInstruction(input) {
    const episodes = [...input.episodes].sort((a, b) => a.episode - b.episode);
    if (episodes.length === 0)
        return '';
    const dir = input.versionDir;
    const book = bookNameOf(input.bookLine);
    const where = input.scope === 'all'
        ? `${book === '' ? '这一部' : `《${book}》`}第 ${episodes.map(e => e.episode).join('、')} 集`
        : `${book === '' ? '这一集' : `《${book}》第 ${episodes[0]?.episode ?? '?'} 集`}`;
    const out = [];
    out.push(`请按下面这份说明修改${where}的剧本。`);
    out.push('');
    out.push('⚠️ 每一集都以它自己的"基线"文件为准；旧版本只作参考，**不要用旧版本覆盖基线**。');
    out.push('');
    for (const item of episodes) {
        const tag = item.tag;
        out.push(`【第 ${item.episode} 集】`);
        out.push('基线（改这一集从它开始）：');
        out.push(`  正文：${scriptPath(dir, item.episode, tag)}`);
        out.push(`  清单：${manifestPath(dir, item.episode, tag)}`);
        out.push(`  批注：${annotationPath(dir, item.episode, tag)}`);
        out.push(`  小说原文（参考，一个字都不要动）：${input.novelFile}`);
        if (tag !== null) {
            out.push(`一、人工已经改过这一集（${dir} → ${tag}）`);
            out.push(`  完整改动记录：${historyPath(dir, item.episode, tag)}`);
            out.push('  （里面写了改了哪些行、删了什么、哪几段的原文对照需要复核）');
            out.push('  提醒：改动后的正文就是基线，不要把它改回去。');
            out.push('二、批注（需要处理）');
        }
        else {
            out.push('一、批注（需要处理）');
        }
        if (item.annotations.length === 0) {
            out.push('  （这一集没有批注，按上面的人工改动保持一致即可）');
        }
        item.annotations.forEach((annotation, index) => {
            const spans = (annotation.regions ?? [])
                .map(region => `${regionLabel(region)}「${region.quote.replaceAll('\n', ' ')}」`)
                .join('；');
            out.push(`  ${index + 1}. ${spans}——${annotation.problem}`);
            if (item.staleIds.includes(annotation.id)) {
                out.push('     ⚠️ 这一条的引文在正文里已经找不到（锚点已失效，可能已经被人改掉），请先核对。');
            }
        });
        out.push('');
    }
    out.push('要求：');
    out.push('1. 每一集都以它自己的"基线"为起点改，不要用旧版本覆盖；');
    out.push('2. 改完出一个**新的大版本**；新大版本里每一集都取"该集当前最新的一版"（基线或最高小版本）作为起点，不要整目录照抄；');
    out.push('3. 上面列出的批注文件里，已处理的条目改成 done: true、resolvedIn 写新版本号（没采纳的保持 done: false）；');
    out.push('4. 人工新增的内容，原文里没有对应就按"新增（无对应）"登记，不要硬找一段原文来凑，也不要把相邻段落的对应关系抄给它。');
    return out.join('\n');
}
//# sourceMappingURL=instruction.js.map