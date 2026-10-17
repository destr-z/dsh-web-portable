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
import { type Annotation, type EpisodeManifest, type SourceRange, type SourceRanges } from './protocol.ts';
/** 工作台里四类文件。 */
export type ContentKind = 'content' | 'manifest' | 'annotation' | 'history';
/** "正文"这一类在文件里用哪个词（剧本批注是"剧本"，提示词对照是"提示词"）。 */
export type ContentWord = '剧本' | '提示词';
/** 解析出来的文件名信息。 */
export interface ParsedContentName {
    episode: number;
    kind: ContentKind;
    /** 只有 `kind === 'content'` 时有：是"剧本"还是"提示词"。 */
    word?: ContentWord;
    /** 小版本文件名里带的大版本（如 `v2`）；基线文件没有。 */
    major?: string;
    /** 小版本序号；基线文件没有。 */
    minor?: number;
    /** `v2.1`；基线文件没有。 */
    tag?: string;
}
/**
 * 解析一个文件名。
 * @param name - 只有文件名（不含目录）。
 * @returns 不认识时 `undefined`（调用方应当把"文件名不认识"报出来，不猜）。
 */
export declare function parseContentName(name: string): ParsedContentName | undefined;
/** `v2.1` 这样的形式才算小版本号（大版本目录名不算）。 */
export declare function isMinorTag(tag: string): boolean;
/** `v2.1` → `v2`；没有点就原样返回。 */
export declare function tagMajor(tag: string): string;
/** `('v2', 1)` → `v2.1`。 */
export declare function formatMinor(major: string, minor: number): string;
/**
 * 小版本号里的 `v2` 必须等于它所在的大版本目录名。
 *
 * 为什么校验它：`第1集剧本.v3.1.txt` 要是躺在 `v2/` 里，说明文件被挪错过
 * （或者人手工拷错了），照着用它会把 v3 的内容当成 v2 的人工版本。
 */
export declare function tagMatchesDir(tag: string, versionDir: string): boolean;
/**
 * 这一集的**下一个**小版本号。
 *
 * 规则（计划 §3）：小版本号**每一集各算各的**，所以只数这一集自己的小版本
 * 文件，取最大号 + 1；一个都没有就是 1。
 *
 * @param names - 同一个大版本目录下的文件名（可以混着别的集，函数自己筛）。
 */
export declare function nextMinorNumber(names: readonly string[], episode: number): number;
/** 一段行区间（1 基、闭区间）。 */
export interface LineSpan {
    start: number;
    end: number;
}
/** 对齐上的一行（两边都是 1 基）。 */
export interface LineMatch {
    oldLine: number;
    newLine: number;
}
/** 对齐结果。 */
export interface LineAlignment {
    /** 旧文件每一行 → 新文件行号；`0` = 这一行被删了。下标 0 = 第 1 行。 */
    oldToNew: number[];
    /** 新文件每一行 → 旧文件行号；`0` = 这一行是新加的。 */
    newToOld: number[];
    /** 按内容连上的行（两边行号，1 基，按旧行号升序）。 */
    matches: LineMatch[];
    /**
     * 中间那块太大、没做精细比对；此时中间整块按"全改了"处理，
     * 调用方应当把相关单元标「待复核」。
     */
    degraded: boolean;
}
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
export declare function alignLines(oldLines: readonly string[], newLines: readonly string[]): LineAlignment;
/** 一处改动。 */
export interface DiffHunk {
    kind: 'insert' | 'delete' | 'replace';
    /**
     * 这一处改动发生在**新文件**的第几行（写历史时用来定位"改的是哪一段"）。
     * 插入 / 替换取新增区间的第一行；纯删除取"删完之后那根线"的下一行。
     */
    atNewLine: number;
    /** 旧文件里被牵涉的行号区间；纯新增时为 `null`。 */
    oldSpan: LineSpan | null;
    /** 新文件里被牵涉的行号区间；纯删除时为 `null`。 */
    newSpan: LineSpan | null;
    /** 被删掉的行（照录，写历史用）。 */
    removed: string[];
    /** 新加的行（照录）。 */
    added: string[];
}
/**
 * 把对齐结果整理成"一处一处"的改动。
 *
 * 用途：① 历史文件里的步骤；② 判断某个段落是不是"被改过"（判「待复核」）；
 * ③ 判断批注所标的位置有没有被动过。
 */
export declare function diffHunks(oldLines: readonly string[], newLines: readonly string[], alignment?: LineAlignment): DiffHunk[];
/** 新文件里"被动过"的行区间（新增的 + 被替换进来的），用来判批注的 touched。 */
export declare function changedNewSpans(hunks: readonly DiffHunk[]): LineSpan[];
/** 两个区间有没有交集。 */
export declare function spansOverlap(a: LineSpan, b: LineSpan): boolean;
/**
 * 按空行把正文切成段落（设计文档 §6.1：段间恰好一个空行、段内不许有空行）。
 *
 * ⚠️ 连续多个空行只当**一个**分隔符、首尾的空行丢掉 —— 不产生空段落。
 *    这条很要紧：`computeScriptLines` 假设"下一段起点 = 上一段终点 + 2"，
 *    切出一个空段落会让行号与正文再也对不上。
 */
export declare function splitParagraphs(lines: readonly string[]): LineSpan[];
/** 派生出来的一个段落。 */
export interface DerivedParagraph {
    /** 新段落号（从 1 开始，顺序号）。 */
    index: number;
    /** 在**新**文件里占的行区间。 */
    span: LineSpan;
    /** 同上，清单要的元组形状。 */
    scriptLines: SourceRange;
    text: string;
    /**
     * `same` = 原样没动（照旧准）；`edited` = 由原来某一段改来的（沿用对应 + 待复核）；
     * `added` = 新增，原文里没有对应。
     */
    origin: 'same' | 'edited' | 'added';
    /** 来自旧文件的第几段（1 基）；`added` 时为 `null`。 */
    fromIndex: number | null;
    /** 沿用下来的原文对应关系；`added` 时为 `null`。 */
    sourceRanges: SourceRanges | null;
    /** 需要人 / agent 复核对照关系。 */
    needsReview: boolean;
    /** 和别的段落共用了同一个旧段落（拆段 / 并段）。 */
    shared: boolean;
}
/** 派生结果。 */
export interface DeriveParagraphResult {
    paragraphs: DerivedParagraph[];
    /** 在新正文里彻底找不到的旧段落号（被删掉、也没被"重写"认领）。 */
    deleted: number[];
    degraded: boolean;
    issues: string[];
}
/** 旧段落（清单里的一项）。 */
export interface OldParagraph {
    scriptLines: SourceRange;
    sourceRanges: SourceRanges | null;
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
export declare function textSimilarity(a: string, b: string): number;
/** "像不像"的门槛：低于它就不认作同一段（宁可记"新增"）。 */
export declare const SIMILARITY_FLOOR = 0.5;
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
export declare function deriveParagraphs(oldLines: readonly string[], newLines: readonly string[], oldParagraphs: readonly OldParagraph[], alignment?: LineAlignment): DeriveParagraphResult;
/** 派生结果 → 新清单（`scriptLines` 用新行号、`sourceRanges` 沿用或置空）。 */
export declare function toManifest(paragraphs: readonly DerivedParagraph[]): EpisodeManifest;
/** 一条批注迁移后的状态。 */
export interface RemappedAnnotation {
    id: string;
    /**
     * `ok` = 还好；`touched` = 所标位置被人工改动过（引文还在，可能已经被人
     * 自己处理了）；`stale` = 锚点失效（所在段落被删了，或引文找不到了）。
     */
    status: 'ok' | 'touched' | 'stale';
    /** 迁移成功时的批注；`stale` 时为 `null`。 */
    annotation: Annotation | null;
    /**
     * 原始那条批注（**永远是它**）。
     *
     * ⚠️ 为什么留着：设计文档 §7.3 说锚点失效是**正常状态、不是错误** ——
     *    失效的条目要原样留在文件里、由界面标「锚点已失效」，**不能删、也不能
     *    偷偷挪到同名文字上去**。所以调用方对 `stale` 的条目要写 `original`。
     */
    original: Annotation;
    reasons: string[];
}
/**
 * 把批注的"第几段"迁到新正文上，并判断引文还成不成立。
 *
 * ⚠️ 三种结果都要**说出来**，不许静默：段落被删 / 引文找不到 = 锚点失效；
 *    引文还在但位置被动过 = 请人核对是否已经人工处理（**不自动算已处理**）。
 */
export declare function remapAnnotations(annotations: readonly Annotation[], input: {
    /** 旧段落号 → 新段落号（被删的段落不在表里）。 */
    paragraphMap: ReadonlyMap<number, number>;
    /** 新正文每一段的行区间，下标 = 段落号 - 1。 */
    paragraphSpans: readonly LineSpan[];
    /** 新正文每一段的文字，下标 = 段落号 - 1。 */
    paragraphTexts: readonly string[];
    /** 新正文里"被动过"的行区间（`changedNewSpans(hunks)`）。 */
    changedSpans: readonly LineSpan[];
}): RemappedAnnotation[];
/**
 * 引文还在不在正文里。
 *
 * ⚠️ 先用原样子串比（设计文档 §7.3 的口径）；失败再退一步，按"每行去首尾
 *    空白、连续空白压成一个空格"比一次 —— 人工编辑很容易在行尾多一个空格，
 *    那种情况不该判成"锚点失效"。两次都不中才算失效。
 */
export declare function containsQuote(text: string, quote: string): boolean;
/** 历史文件里的一段步骤。 */
export interface HistoryStep {
    /** 人看的时间（`14:20:44`）；不知道就省略。 */
    at?: string;
    /** 一句话说清这一步干了什么（如 `第 3 段：替换 2 行、删除 1 行`）。 */
    label: string;
    removed: readonly string[];
    added: readonly string[];
}
/** 写历史文件需要的全部输入。 */
export interface HistoryInput {
    episode: number;
    /** 这一版（`v2.2`）。 */
    tag: string;
    /** 上一版（`v2.1`，或基线 `v2`）。 */
    baseTag: string;
    /** 基线文件的工作区相对路径。 */
    baseFile: string;
    startedAt?: string;
    endedAt?: string;
    addedLines: number;
    removedLines: number;
    paragraphNotes: readonly string[];
    annotationNotes: readonly string[];
    steps: readonly HistoryStep[];
    issues?: readonly string[];
}
/**
 * 生成历史文件正文。
 *
 * ⚠️ 被删掉的行**照录**（计划 §8.2）：那是 agent 最需要的线索（"他试过什么
 *    又推翻了"）。文件名由调用方拼：`<大版本>/历史/第N集.<小版本>.txt`。
 */
export declare function renderHistory(input: HistoryInput): string;
/** 编辑期间的一张快照（客户端按"停手"拍；中文输入法组合期间不拍）。 */
export interface EditSnapshot {
    text: string;
    /** 客户端本地时间（`14:20:44`）。 */
    at?: string;
}
/**
 * 快照太多就掐掉中间、留首尾。
 *
 * 为什么留首尾：开头是"动手之前"、结尾是"最后停手的地方"；掐掉中间只损失细节，
 * 历史读起来还是接得上的。
 */
export declare function trimSnapshots(snapshots: readonly EditSnapshot[], max?: number): EditSnapshot[];
/** 新正文里某一行落在第几段（`before` = 落在这一段之前）。落在最后一段之后返回 `null`。 */
export declare function paragraphAt(paragraphs: readonly DerivedParagraph[], line: number): {
    index: number;
    before: boolean;
} | null;
/**
 * 把"基线 → 一串快照 → 最终正文"整理成历史里的步骤。
 *
 * ⚠️ 段号说的是**最终正文**里的段号（agent 拿到的是那一版），所以每一步都要把
 *    "当时的行号"再映射一次到最终正文上 —— 中间过程的行号会漂，直接用会指错段。
 * ⚠️ 客户端已经保证"中文输入法组合期间不拍快照"；这里再兜一次：内容与上一张
 *    完全一样的快照直接跳过（多余的空帧不该占一行历史）。
 */
export declare function buildHistorySteps(baseLines: readonly string[], snapshots: readonly EditSnapshot[], finalLines: readonly string[], finalParagraphs: readonly DerivedParagraph[]): HistoryStep[];
/** 一段文字 → 每一行（口径与 `validate.ts` 的 `splitLines` 一致）。 */
export declare function linesOf(text: string): string[];
/** 停手多久算"一步"。 */
export declare const SNAPSHOT_IDLE_MS = 3000;
/** 中文上屏之后再等多久拍一张（等浏览器把最后一次 input 也发完）。 */
export declare const SNAPSHOT_SETTLE_MS = 250;
/** 快照状态机的状态。 */
export interface SnapshotState {
    /** 当前草稿全文（就是文本框里的值）。 */
    text: string;
    baseText: string;
    /** 已经拍下的帧（**不含**基线）。 */
    frames: EditSnapshot[];
    /** 正在拼中文（IME 组合中）。 */
    composing: boolean;
    /** 上次拍帧之后又改过、还没拍。 */
    pending: boolean;
    /** 最近一次**非组合**输入的毫秒时刻（"停手"就是从这里算）。 */
    lastInputMs: number;
    /** 组合结束后约定的拍帧时刻；`null` = 没有约定。 */
    settleAtMs: number | null;
}
/**
 * 状态机收到的事件。
 *
 * `at` 是给人看的时间（`14:20:44`），由调用方格式化；`nowMs` 是毫秒时刻，
 * 只用来算间隔 —— 这样状态机本身是纯的，node 里能喂事件序列做用例。
 */
export type SnapshotEvent = {
    kind: 'input';
    text: string;
    nowMs: number;
} | {
    kind: 'compositionStart';
    text: string;
    nowMs: number;
} | {
    kind: 'compositionEnd';
    text: string;
    at: string;
    nowMs: number;
} | {
    kind: 'blur';
    text: string;
    at: string;
    nowMs: number;
} | {
    kind: 'tick';
    at: string;
    nowMs: number;
} | {
    kind: 'flush';
    text: string;
    at: string;
    nowMs: number;
};
/** 开一个状态。 */
export declare function initialSnapshotState(baseText: string): SnapshotState;
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
export declare function snapshotReducer(state: SnapshotState, event: SnapshotEvent): SnapshotState;
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
export declare function snapshotsForSubmit(state: SnapshotState): {
    frames: EditSnapshot[];
    composing: boolean;
};
