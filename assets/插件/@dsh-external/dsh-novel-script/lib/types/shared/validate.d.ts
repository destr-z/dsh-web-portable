/**
 * 两侧共用的**解析与校验**层（设计文档 §4、§7、§13）。
 *
 * 这里只做机械的事：怎么把段落拼成剧本文件、怎么算行号、清单/批注读不读得懂、
 * 剧本文件与清单对不对得上。**不判断任何剧情内容**（谁是角色、哪句是台词、对应得对不对）。
 *
 * 总原则：读不懂就报出来，不猜、不降级。
 */
import { type Annotation, type AnnotationRegion, type EpisodeManifest, type SourceRange, type SourceRanges } from './protocol.ts';
/** 一条问题。`error` = 这块内容用不了；`warn` = 能用但缺东西。 */
export interface Issue {
    level: 'error' | 'warn';
    /** 出问题的位置（如 `第 3 段`）。 */
    where: string;
    /** 给人看的一句话。 */
    message: string;
}
/** 空行判定：去掉空白后为空。 */
export declare function isBlankLine(line: string): boolean;
/** 换行规范化：`\r\n` → `\n`，单独的 `\r` → `\n`。 */
export declare function normalizeNewlines(raw: string): string;
/** 按 LF 切行。 */
export declare function splitLines(text: string): string[];
/**
 * 一个段落的 `text` 是否合格（设计文档 §4 ④）。
 *
 * 规则：规范化后不能为空；**首尾不能是空白行**；**内部不能包含空白行**；
 * 不 trim 普通文字与空格。
 *
 * @returns 不合格时返回原因，合格返回 `null`。
 */
export declare function paragraphTextError(raw: string): string | null;
/** 把各段落拼成剧本文件内容：段落之间**恰好一个空白行**，末尾不写额外换行。 */
export declare function buildScriptText(texts: readonly string[]): string;
/**
 * 按拼接规则算出每一段占的行号区间（设计文档 §4 ②）。
 * 第 1 段从第 1 行开始；下一段的开始行 = 上一段结束行 + 2。
 */
export declare function computeScriptLines(texts: readonly string[]): SourceRange[];
/**
 * 校验工具参数里的 `sourceRanges`（宿主写入前用）。
 * @returns `ranges` 或 `error`（两者必有其一）。
 */
export declare function checkSourceRanges(value: unknown): {
    ranges: SourceRanges | null;
    error: string | null;
};
/**
 * 解析一集的清单。
 *
 * ⚠️ 段落坏了**不跳过**，而是填一个 `scriptLines: [0, 0]` 的占位：
 *    段落编号是批注的锚点，一旦跳过，后面所有段落编号都会前移，
 *    批注就会指到别的段落上。填占位既保住了编号，又能把问题报出来。
 */
export declare function parseEpisodeManifest(raw: unknown): {
    manifest: EpisodeManifest | null;
    issues: Issue[];
};
/**
 * 剧本文件与清单对不对得上（设计文档 §13）。
 *
 * 规则：第 1 段从第 1 行开始；相邻段落之间恰好一个空白行；
 * 下一段开始行 = 上一段结束行 + 2；最后一段结束行 = 文件总行数；
 * 间隔行必须是空行；段落内部不得有空白行。
 *
 * **能力边界**：能发现增行、删行、空行变化；**发现不了保持行数不变的文字替换**。
 */
export declare function checkScriptStructure(scriptText: string, manifest: EpisodeManifest): Issue[];
/** 本集覆盖的原文范围（由所有 `sourceRanges` 机械取最小/最大；全为 null 时返回 null）。 */
export declare function computeNovelRange(manifest: EpisodeManifest): SourceRange | null;
/** 清单里所有 `sourceRanges` 里出现的最大行号（用于越界校验）。 */
export declare function maxSourceLine(manifest: {
    paragraphs: readonly {
        sourceRanges: SourceRanges | null;
    }[];
}): number;
/**
 * 解析批注文件。
 *
 * @returns 合法条目与问题列表；整个文件不是数组时 `annotations` 为 `null`（= 不可用）。
 */
export declare function parseAnnotations(raw: unknown): {
    annotations: Annotation[] | null;
    issues: Issue[];
};
/**
 * 保存前的合并：以**内存里**的列表为准（用户刚编辑的内容），
 * `done` / `resolvedIn` 取**磁盘上**的值（agent 勾的结果）。
 */
export declare function mergeAnnotations(memory: readonly Annotation[], disk: readonly Annotation[]): Annotation[];
/** 下一个可用的批注序号（接着已有的最大编号往下排）。 */
export declare function nextAnnotationSeq(existing: readonly Annotation[]): number;
/**
 * 生成一条新批注（程序在用户划词时调）。
 * @param regions - 这条批注挂的几处（至少一处；Ctrl 多选就是多处）。
 */
export declare function makeAnnotation(seq: number, regions: readonly AnnotationRegion[], problem: string): Annotation;
