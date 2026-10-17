/**
 * 两侧共用的**解析与校验**层（设计文档 §4.2、§5、§5.3、§6.2、§8）。
 *
 * 这一版是从 `dsh-novel-script` 的 `shared/validate.ts` **移植**过来的：
 * 批注那一整段是**刻意逐字保留**的（两条插件的批注格式永远一致，见 protocol.ts 开头），
 * 换掉的是"块/清单/锚点"那半 —— 对照方向反了，规则也就不是同一套。
 *
 * 新语义与旧语义的**根本差别**，一句话：
 *   **旧**：剧本由工具生成，段落之间恰好一个空行、段内不许有空行 → 行号是算出来的。
 *   **新**：提示词由 agent 写，工具只能从**锚点（每块首行原文）**反推行号 →
 *         行号是**找**出来的，而且块内**天然带空行**（实测每块 4 个）。
 *
 * 所以这里只做机械的事：块正文合不合格、按锚点找出每块占哪几行、清单读不读得懂、
 * 清单里声明的剧本行号越不越界。**不判断任何内容**（哪块该对应剧本哪几行是 agent 的判断）。
 *
 * 总原则：读不懂就报出来，不猜、不降级。
 */
import { type Annotation, type AnnotationRegion, type EpisodeManifest, type LineRange, type ManifestBlock, type ScriptRanges } from './protocol.ts';
/** 一条问题。`error` = 这块内容用不了；`warn` = 能用但缺东西。 */
export interface ValidationIssue {
    level: 'error' | 'warn';
    /** 出问题的位置（如 `第 3 块`）。 */
    where: string;
    /** 给人看的一句话。 */
    message: string;
}
/**
 * 旧名字，留着只为 **过渡兼容**。
 *
 * ⚠️ 并行改写期间，`client/data.ts` 之类还在 `import { type Issue }`；
 *    等它们全部改成 `ValidationIssue` 就可以删掉这一行。新代码请用 `ValidationIssue`。
 */
export type Issue = ValidationIssue;
/** 空行判定：去掉空白后为空。 */
export declare function isBlankLine(line: string): boolean;
/** 换行规范化：`\r\n` → `\n`，单独的 `\r` → `\n`。 */
export declare function normalizeNewlines(raw: string): string;
/**
 * 按 LF 切行。
 *
 * ⚠️ 行号一律以**这个结果的下标 + 1** 为准（`splitLines(text)[n - 1]` 就是第 n 行）。
 *    锚点定位、`promptLines`、`scriptRanges` 三处必须用同一个切法，
 *    否则"第 12 行"在哪一层都会对不上。
 */
export declare function splitLines(text: string): string[];
/**
 * 一个**块**的正文是否合格（设计文档 §4.2）。
 *
 * 规则：规范化后不能为空；**首尾不能是空行**；**块内允许空行**；
 * 不 trim 普通文字与空格（正文必须原样落盘，一个字都不能动）。
 *
 * ⚠️ 与旧 `paragraphTextError` 的**唯一**差别就是"块内允许空行"：
 *    实测提示词每块天然带 4 个块内空行（小标题与正文之间就是空行），
 *    照搬旧规则会把每一块都判成非法、整个功能用不了。
 *    代价是它**看不出**"两块之间少了一个空行"——那由 `computePromptLinesByAnchors`
 *    用锚点顺序定位兜住（块间空行不参与 `promptLines` 计算）。
 *
 * @param text - 块正文（可含多行）。
 * @returns 不合格时返回原因，合格返回 `null`。
 */
export declare function blockTextError(text: string): string | null;
/**
 * 把 header 与各块拼成提示词全文，并算出每块占的行号区间（设计文档 §4.2 ②）。
 *
 * 排布：`header` + 空行 + 块1 + 空行 + 块2 + …；文件末尾**有且只有一个换行**。
 * （旧版是"末尾不写换行"—— 提示词是 markdown，末尾换行是通行写法；
 *   行号按 `splitLines` 的语义不受它影响，但字节层面必须稳定，所以定死一个。）
 *
 * 行号（1 基、闭区间）：**含块内空行、不含块间空行**；`header` 占的行数计入偏移。
 * 例：`header = '第一集提示词'`、块1 正文 5 行含 1 个块内空行 →
 *     header 在第 1 行、第 2 行空、块1 = `[3, 7]`、第 8 行空、块2 从第 9 行起。
 *
 * ⚠️ 两个刻意的选择（都是踩过才知道的）：
 *    1. `header` 为 `undefined` / 空串 → **当没有 header**（不占行）。
 *       空串当"占一行的空 header"会让第 1 行是空行，直接违反"文件首行不是空行"。
 *    2. 每个块（含 header）都是**先切行再替换换行符**，不是先替换再切 ——
 *       否则块内自带的 `\n\n` 会在这一步与"块间分隔空行"混在一起，行号整个错位。
 *
 * 它**不检查**块首尾有没有空行（那是 `blockTextError` 的活）：这里只管"块之间恰好一个空行"，
 * 块自己的首尾空行会原样写进文件、并被算进这一块的行号区间。
 *
 * @param header - 可选抬头（如 `第1集提示词`）；不给就不占行。
 * @param blocks - 各块正文，按顺序。
 * @returns 文件全文与每块的行号区间（下标与 `blocks` 一一对应）。
 */
export declare function buildPromptText(header: string | undefined, blocks: readonly string[]): {
    text: string;
    promptLines: LineRange[];
};
/**
 * 从 `fromLine`（1 基，含）起，**整行精确匹配**找 `anchor`（设计文档 §6.2）。
 *
 * ⚠️ 是"某一**行**等于 anchor"，**不是** `includes`、**不是** trim 后比较：
 *    提示词里 `【第 3 场】` 可能既是块首行、又在别处被引用一次；
 *    用 `includes` 会命中引用它的那行，整块的 `promptLines` 就指到别处去了
 *    （提示词首行还常带 BOM 或全角空格，trim 之后反而更容易撞上）。
 *    **找得到才算数；找不到、或找到不止一处，一律 `line: null` 交给人处理。**
 *
 * @param lines - 目标文件的每一行。
 * @param anchor - 块首行原文（**原样**，不 trim）。
 * @param fromLine - 从第几行开始找（1 基；含这一行）。
 * @returns 唯一命中时 `line` 是行号、`matches` 是命中列表；0 处或多处命中时 `line: null`。
 */
export declare function locateAnchor(lines: readonly string[], anchor: string, fromLine: number): {
    line: number | null;
    matches: number[];
};
/**
 * 按锚点顺序，一块一块地算 `promptLines`（设计文档 §6.2）。
 *
 * 规则：第 k 块的锚点在**前一块结束行之后**找（顺序推进，所以同一个锚点出现两次时，
 * 靠后那一块从正确的位置往下找）；每块的结束行 = **下一个锚点行之前最后一个非空行**；
 * 最后一块算到文件末尾最后一个非空行。块间空行因此自动被排除在区间之外。
 *
 * ⚠️ 为什么必须顺序推进、不能每块都从头 `indexOf`：
 *    提示词里跨集复用的模板行（`【结尾钩子】`之类）会重复出现，
 *    从头找必然撞到第一处，从第 2 块起 `promptLines` 就全部指错。
 *
 * 三种失败情形都**只让这一块**变 `null`，其余块照算，并把锚点与命中行号写进 message
 * 交给 agent 自己纠正（它看得到文件，比程序更知道该改哪一行）：
 *    ① 一处都没命中；② 命中多处（分不清是哪一块）；③ 锚点为空。
 *
 * @param lines - 提示词文件的每一行。
 * @param anchors - 各块首行，按顺序；下标即块序号。
 * @returns `promptLines`（与 `anchors` 等长，坏块为 `null`）与问题列表。
 */
export declare function computePromptLinesByAnchors(lines: readonly string[], anchors: readonly string[]): {
    promptLines: Array<LineRange | null>;
    issues: ValidationIssue[];
};
/**
 * 一个"合法区间"：`[a, b]`，`a`、`b` 都是整数且 `1 ≤ a ≤ b`。
 *
 * ⚠️ 数字沿用 `Number(...)` 兜一层：宿主侧拿到的是工具参数（可能带字符串数字），
 *    浏览器侧拿到的是 `JSON.parse` 的结果（数字）；两边都用同一把尺子，
 *    免得"宿主收、客户端拒"这种一半好一半坏的状态。
 *
 * @returns 合法时返回规范化后的区间，否则 `undefined`（**空数组也返回 `undefined`**）。
 */
export declare function asRange(value: unknown): LineRange | undefined;
/**
 * `scriptRanges` 字段形状校验：`null`（剧本里没有对应），或者**非空的**、每项都合法的区间数组。
 *
 * 形状与"行号越不越界"是两件事：这里管形状，越界由 `checkScriptRanges` 拿原文总行数去比。
 *
 * @returns `null`（合法）、合法数组，或 `undefined`（形状不认识）。
 */
export declare function asScriptRanges(value: unknown): ScriptRanges | null | undefined;
/**
 * 校验一组 `scriptRanges` 是否合格（宿主写入前用，设计文档 §5.2 规则 4）。
 *
 * 规则：`null` **合法**（= 新增、剧本里没有对应，这是正常情况，不是缺东西）；
 * 否则必须是**非空**数组，每一项都满足 `1 ≤ a ≤ b ≤ scriptLines`。
 * 范围**不连续、不递增都合法** —— 提示词本来就可能调换/穿插剧本的顺序，那不是错（只进 §5.3 的提示）。
 *
 * ⚠️ `scriptLines` 传 0（剧本还没读到 / 文件不存在）时任何区间都会被判越界；
 *    §5.2 规则 5 要求"剧本文件必须存在"，所以调用方**先确保读到了剧本**再调这里。
 *
 * @param ranges - 待校验的区间；`null` 直接通过。
 * @param scriptLines - **本集**剧本文件总行数。
 * @param where - 出错时写进 `where` 的位置说明（如 `第 3 块`）。
 */
export declare function checkScriptRanges(ranges: ScriptRanges | null, scriptLines: number, where: string): ValidationIssue[];
/**
 * 解析一集的清单（设计文档 §5）。
 *
 * 形状：`{schema: 1, blocks: [{anchor, promptLines, scriptRanges}, …]}`。
 *
 * 两级处理，刻意分开：
 *   - `schema` 不认识 / 根本没有 `blocks` → **`manifest: null`**：整份都用不了，
 *     也不去猜"是不是老格式"，猜错比报错危险得多。
 *   - **单个块**坏了 → 填一个占位块（`anchor` 为空、`promptLines: [0,0]`、`scriptRanges: null`），
 *     **保持数组下标不变**，只把问题报出来。
 *
 * ⚠️ 为什么坏块要占位而不是跳过（旧插件踩过、这里一模一样）：
 *    块的位置序号（第几块）**就是批注的锚点**（`AnnotationRegion.paragraph`）。
 *    一旦跳过，后面所有块序号整体前移一位，用户之前写的批注全部指到隔壁块上,
 *    而且**没有任何报错** —— 这是最坏的一类 bug。占位既保住编号，又让问题看得见。
 *
 * ⚠️ `promptLines` 是**工具当时算的**，这里只做形状校验，**不重算**：
 *    提示词是 agent 写的，文件改了行号就可能变；重算会把"文件被改过"这件事掩盖掉。
 *    要重算的话，调用方拿 `lines + anchors + computePromptLinesByAnchors` 自己来。
 */
export declare function parseEpisodeManifest(raw: unknown): {
    manifest: EpisodeManifest | null;
    issues: ValidationIssue[];
};
/**
 * 清单的**自检信息**（设计文档 §5.3）—— 给 agent 看的，**只报告，绝不阻断写入**。
 *
 * 三条（都是"可疑但合法"的情况，所以是字符串而不是 `ValidationIssue`）：
 *   ① 某块 `scriptRanges` 为 `null`（这块在剧本里没有对应，可能是忘了写）；
 *   ② 起始行相对前一块**回退**（引用顺序跳回去了，通常是块顺序写乱了）；
 *   ③ 相邻两块引用的区间**重叠**（大概率有一块的边界划错了）。
 *
 * ⚠️ 为什么不阻断：以上三条**都可能是有意为之**（提示词本来就可能重排、重复引用同一段）。
 *    程序的职责是把疑点摆到 agent 面前，判断权在 agent ——
 *    拦死会把"合法的重排"变成写不进去。
 *    比较只在**相邻两块**之间做：越远的块顺序倒挂本来就正常（闪回、多线叙事）。
 *
 * @param blocks - 清单里的块（顺序即块序号）。
 * @returns 每条一句人话，没问题就是空数组。
 */
export declare function manifestWarnings(blocks: readonly ManifestBlock[]): string[];
/**
 * 解析批注文件。
 *
 * ⚠️ 这一段与 `dsh-novel-script` **逐字一致**（含兼容旧扁平格式的逻辑），
 *    两条插件的批注格式是刻意保持一致的，改一边必须同时改另一边（protocol.ts 开头）。
 *    `paragraph` 字段的含义是"**块**的位置序号"，是 protocol 定死的名字，不改。
 *
 * @returns 合法条目与问题列表；整个文件不是数组时 `annotations` 为 `null`（= 不可用）。
 */
export declare function parseAnnotations(raw: unknown): {
    annotations: Annotation[] | null;
    issues: ValidationIssue[];
};
/**
 * 保存前的合并：以**内存里**的列表为准（用户刚编辑的内容），
 * `done` / `resolvedIn` 取**磁盘上**的值（agent 勾的结果）。
 *
 * ⚠️ 磁盘上**多出来**的条目不会带回来：用户在界面上删掉的批注就是该删掉，
 *    不然"删了又自己长回来"。所以合并没有"并集"这一步。
 */
export declare function mergeAnnotations(memory: readonly Annotation[], disk: readonly Annotation[]): Annotation[];
/** 下一个可用的批注序号（接着已有的最大编号往下排）。 */
export declare function nextAnnotationSeq(existing: readonly Annotation[]): number;
/**
 * 生成一条新批注（程序在用户划词时调）。
 *
 * @param seq - 序号（由 `nextAnnotationSeq` 给）。
 * @param regions - 这条批注挂的几处（至少一处；Ctrl 多选就是多处）。
 * @param problem - 用户写的问题。
 */
export declare function makeAnnotation(seq: number, regions: readonly AnnotationRegion[], problem: string): Annotation;
