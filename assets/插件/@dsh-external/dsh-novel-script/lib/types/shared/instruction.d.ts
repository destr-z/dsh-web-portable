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
import { type Annotation } from './protocol.ts';
/** 一处区域的显示名：`第 6 段` / `第 3–7 段`。 */
export declare function regionLabel(region: {
    paragraph: number;
    endParagraph?: number;
}): string;
/** 指令里的一集。 */
export interface InstructionEpisode {
    episode: number;
    /** 这一集**有效版本**的小版本号（`v2.1`）；基线为 `null`。 */
    tag: string | null;
    annotations: readonly Annotation[];
    /** 其中"引文已经找不到"的批注 id（锚点失效，要请 agent 先核对）。 */
    staleIds: readonly string[];
}
/** 组装指令要的全部输入。 */
export interface InstructionInput {
    /** **原文文件的第一行**（用来取书名；清洗在 `bookNameOf` 里做）。 */
    bookLine: string;
    /** 版本目录名（`v2`）。 */
    versionDir: string;
    scope: 'episode' | 'all';
    episodes: readonly InstructionEpisode[];
    /** 原文文件的工作区相对路径（agent 只读参考）。 */
    novelFile: string;
}
/**
 * 从原文第一行里取书名。
 *
 * ⚠️ 第一行常常不是光秃秃的书名，而是 `## 《某某》第 3 集 · 分镜剧本` 这种大标题。
 *    直接整行塞进指令会变成"修改《…第 3 集 · 分镜剧本》第 1 集的剧本"，
 *    所以这里把"第 N 集"之后的部分切掉，太长（>40 字）就干脆不写书名。
 */
export declare function bookNameOf(bookLine: string): string;
/**
 * 组装指令正文。
 *
 * @param input - 见 {@link InstructionInput}。
 * @returns 可以直接粘进对话的整段文本；没有任何一集时返回空串。
 */
export declare function buildInstruction(input: InstructionInput): string;
