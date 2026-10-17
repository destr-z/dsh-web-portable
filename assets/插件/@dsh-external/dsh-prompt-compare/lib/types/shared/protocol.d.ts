/**
 * 宿主与浏览器两侧共用的**契约**：固定目录、文件名规则、数据结构、路径拼法。
 *
 * 这个文件是唯一的真相源。设计依据见 `docs/执行设计-v1.md`。
 *
 * 三条硬约定（改之前先读设计文档 §3）：
 *   1. 工作台固定在 `<工作区根>/对照工作台/`，不需要任何设置项；
 *   2. **锚点侧是剧本**（只读参考，不随版本变）、**作业侧是提示词**（随版本走）；
 *      版本号由目录名（`v1`）决定、集号由文件名（`第3集提示词.txt`）决定，
 *      **不在清单里重复保存**；
 *   3. 集号一律用阿拉伯数字 —— 程序不解析中文数字。
 *
 * ⚠️ 本插件与 `dsh-novel-script`（剧本批注）**刻意同构**：批注结构、清单形状、
 *    目录层级一一对应，只是"哪边是锚点、哪边是作业区"换了方向。
 *    两边一起改的时候请同时更新两份设计文档。
 */
/** 插件 id（与 package.json 的 name 一致）。 */
export declare const PLUGIN_ID = "@dsh-external/dsh-prompt-compare";
/**
 * 全屏浮层席位。
 *
 * ⚠️ 不注册 `main` / `main.conversation` —— 那是官方对话区的单占席位，
 * 注册进去就是替换掉官方对话。这里只需要"浮在上面"。
 */
export declare const OVERLAY_SLOT = "shell.overlay";
/** 插件在席位里的 id（须唯一）。 */
export declare const PANEL_ID = "prompt-compare";
/** 工作台根目录（工作区里的固定名字）。 */
export declare const WORKBENCH_DIR = "\u5BF9\u7167\u5DE5\u4F5C\u53F0";
export declare const SCRIPT_DIR = "\u5267\u672C";
export declare const PROMPT_DIR = "\u63D0\u793A\u8BCD";
export declare const MANIFEST_DIR = "\u6E05\u5355";
export declare const ANNOTATION_DIR = "\u6279\u6CE8";
export declare const CHANGELOG_FILE = "\u53D8\u66F4\u8BB0\u5F55.txt";
export declare const RE_VERSION_DIR: RegExp;
export declare const RE_SCRIPT_FILE: RegExp;
export declare const RE_PROMPT_FILE: RegExp;
export declare const RE_MANIFEST_FILE: RegExp;
export declare const RE_ANNOTATION_FILE: RegExp;
/** 工具的 version 参数。 */
export declare const RE_VERSION_ARG: RegExp;
/** 清单格式版本。 */
export declare const MANIFEST_SCHEMA = 1;
/**
 * 批注的浏览器 → 宿主通道。
 *
 * ⚠️ 为什么是 HTTP 路由而不是 Typert Remote：官方给"浏览器→宿主"这类
 * 非 JSON-Remote 数据的通道就是 Connection 的 exact Fetch route
 * （`/api` 载体自带 Host/Origin 校验与浏览器认证，见
 * `packages/client/connection/src/index.ts` 的 `/api` 路由）。
 * Typert 那条路要生成式 zod 清单（40 KB 级、由生成器产出，本插件的离线构建
 * 跑不了生成器），代价与收益不成比例。设计文档 §8 记了这条。
 */
export declare const ANNOTATION_ROUTE = "/api/prompt-compare/annotations";
/** 一个行号区间 `[起, 止]`（都是 1 基、闭区间）。 */
export type LineRange = readonly [number, number];
/** 一个提示词块覆盖的剧本范围：可能有不连续的多段；`null` = 剧本里没有对应。 */
export type ScriptRanges = readonly LineRange[];
/** 清单里的一个提示词块。 */
export interface ManifestBlock {
    /**
     * 块首行文本（用于定位）。
     *
     * 为什么存它：入库时提示词文件已经存在，agent 只需给"每块首行 + 对应剧本行号"，
     * **不必逐字复述正文**；工具按它在文件里找唯一命中位置，再算出行号。
     * 它不是"防手改"的兜底 —— 用户不会手改文件（设计文档 §2.2）。
     */
    anchor: string;
    /** 这一块在提示词文件里占的行号区间（工具算出来的，agent 不填）。 */
    promptLines: LineRange;
    /** 这一块覆盖剧本哪几行（agent 判断的）；`null` = 剧本里没有对应。 */
    scriptRanges: ScriptRanges | null;
}
/** 一集的清单。 */
export interface EpisodeManifest {
    schema: number;
    blocks: ManifestBlock[];
}
/**
 * 批注挂的**一处**区域。
 *
 * 用户按住 Ctrl 可以连着选好几处（互不连续），所以一条批注是**一组 region**。
 * `paragraph` = **块的位置序号**（1 基；与正文里写的 `Block N` 无关）。
 */
export interface AnnotationRegion {
    /** 块的位置序号（**从 1 开始**）。连续跨块时是**起始**那一块。 */
    paragraph: number;
    /** 连续跨块的**结束**块（含）；只选了一块时不写。 */
    endParagraph?: number;
    /** 这一处选中的提示词原文（跨块时含换行）。 */
    quote: string;
}
/**
 * 一条批注。
 *
 * 用户只写 `problem`；`id` / `regions` 由程序在用户划词时记录；
 * `done` / `resolvedIn` 由 agent 审核时更新。
 *
 * ⚠️ 与剧本批注**格式完全相同**，也**没有**剧本上下文字段 ——
 *    批注只针对提示词；agent 需要剧本时自己按清单去找（设计文档 §2.2）。
 */
export interface Annotation {
    /** 程序生成的唯一编号（`a-0001`），在"这一集这一版"内唯一。 */
    id: string;
    /** 这条批注挂了哪几处（至少 1 处）。按住 Ctrl 选的就是**几个不连续的地方**。 */
    regions: AnnotationRegion[];
    /** 用户写的问题。 */
    problem: string;
    /** 是否已处理（agent 勾）。 */
    done: boolean;
    /** 在哪一版处理掉的（如 `v2`）；未处理为 `null`。 */
    resolvedIn: string | null;
}
/** 批注通道的请求体。 */
export interface AnnotationRequest {
    op: 'load' | 'save';
    sessionId: string;
    version: string;
    episode: number;
    /** `op: 'save'` 时必填。 */
    annotations?: Annotation[];
}
/** 批注通道的响应体。 */
export type AnnotationResponse = {
    ok: true;
    annotations: Annotation[];
} | {
    ok: false;
    error: string;
};
export declare const workbenchPath: () => string;
export declare const scriptDirPath: () => string;
/**
 * 把"版本"统一成**目录名**。
 *
 * ⚠️ 两种写法都收：`v1`（目录名）和 `1`（去掉 v 的版本号）。
 *    踩过一次（剧本批注那边）：扫描结果里存的是去掉 v 的 `1`，直接拼路径就成了
 *    `对照工作台/1/清单/…`，清单永远找不到、整栏空白。
 *    在拼路径这一层归一，比要求每个调用方都记得传哪种更稳。
 */
export declare function asVersionDir(version: string): string;
export declare const versionPath: (version: string) => string;
/** 剧本：在根下，不带版本。 */
export declare const scriptPath: (episode: number) => string;
export declare const promptPath: (version: string, episode: number) => string;
export declare const manifestPath: (version: string, episode: number) => string;
export declare const annotationPath: (version: string, episode: number) => string;
export declare const changelogPath: (version: string) => string;
/**
 * 版本号排序：`1 < 2 < 10`（按数字比，不是按字符串）。
 * 参数是**不带 v 的数字串**。
 */
export declare function compareVersions(a: string, b: string): number;
/** 目录名 → 版本号（不带 v）；不是版本目录就返回 undefined。 */
export declare function versionOfDir(name: string): string | undefined;
/**
 * 程序生成的批注编号。
 * @param seq - 从 1 开始的序号。
 */
export declare function annotationId(seq: number): string;
