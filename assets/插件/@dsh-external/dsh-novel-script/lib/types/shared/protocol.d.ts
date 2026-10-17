/**
 * 宿主与浏览器两侧共用的**契约**：固定目录、文件名规则、数据结构、路径拼法。
 *
 * 这个文件是唯一的真相源。设计依据见 `docs/执行设计-v2.md`。
 *
 * 三条硬约定（改之前先读文档 §1）：
 *   1. 工作台固定在 `<工作区根>/剧本工作台/`，不需要任何设置项；
 *   2. 版本号由目录名（`v1`）决定、集号由文件名（`第1集剧本.txt`）决定，
 *      **不在清单里重复保存**；
 *   3. 集号一律用阿拉伯数字 —— 程序不解析中文数字。
 */
/** 插件 id（与 package.json 的 name 一致）。 */
export declare const PLUGIN_ID = "@dsh-external/dsh-novel-script";
/**
 * 全屏浮层席位。
 *
 * ⚠️ 不注册 `main` / `main.conversation` —— 那是官方对话区的单占席位，
 * 注册进去就是替换掉官方对话。这里只需要"浮在上面"。
 */
export declare const OVERLAY_SLOT = "shell.overlay";
/** 插件在席位里的 id（须唯一）。 */
export declare const PANEL_ID = "novel-script";
/** 工作台根目录（工作区里的固定名字）。 */
export declare const WORKBENCH_DIR = "\u5267\u672C\u5DE5\u4F5C\u53F0";
/** 原文文件名（固定）。原文只有一份，行号以它的物理行为准。 */
export declare const NOVEL_FILE = "\u5C0F\u8BF4\u539F\u6587.txt";
export declare const SCRIPT_DIR = "\u5267\u672C";
export declare const MANIFEST_DIR = "\u6E05\u5355";
export declare const ANNOTATION_DIR = "\u6279\u6CE8";
/** 人工编辑的历史记录（一次保存一份）。 */
export declare const HISTORY_DIR = "\u5386\u53F2";
export declare const CHANGELOG_FILE = "\u53D8\u66F4\u8BB0\u5F55.txt";
export declare const RE_VERSION_DIR: RegExp;
/**
 * 工具的 version 参数。
 *
 * ⚠️ 只认大版本目录名（`v1`、`v2`）—— 小版本**不是目录**，它是同一个目录里的
 *    另一组文件（`第1集剧本.v2.1.txt`），所以不在这里出现。
 */
export declare const RE_VERSION_ARG: RegExp;
/**
 * 单集文件名（正文 / 清单 / 批注 / 历史）的解析**不在这里**：
 * 名字规则（含小版本尾巴）只在 `shared/edit.ts` 的 `parseContentName` 一处，
 * 免得两份规则各说各话。
 */
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
 * 跑不了生成器），代价与收益不成比例。设计文档 §17 记了这条偏离。
 */
export declare const ANNOTATION_ROUTE = "/api/novel-script/annotations";
/**
 * 人工编辑的**保存通道**（浏览器 → 宿主）。
 *
 * 与批注通道同一种做法（Connection 的 exact Fetch route，`/api` 载体自带
 * 校验与浏览器认证）。写盘、冲突检测、行号与"原文对照"的迁移全部在宿主侧
 * 一次完成，浏览器只把"我改完的全文 + 编辑过程中的快照"送过去。
 *
 * ⚠️ 这个通道**只新增文件**（新小版本的三件套 + 一份历史记录），
 *    老版本一个字节都不动（计划 §1 不变量）。
 */
export declare const EDIT_ROUTE = "/api/novel-script/edit";
/** 一个行号区间 `[起, 止]`（都是 1 基、闭区间）。 */
export type SourceRange = readonly [number, number];
/** 一个剧本段落对应的原文范围：可能有不连续的多段；`null` = 原文里没有（新增）。 */
export type SourceRanges = readonly SourceRange[];
/** 清单里的一个剧本段落。 */
export interface ManifestParagraph {
    /** 这一段在剧本文件里占的行号区间（工具算出来的，agent 不填）。 */
    scriptLines: SourceRange;
    /** 这一段来自原文哪几行（agent 判断的）。 */
    sourceRanges: SourceRanges | null;
}
/** 一集的清单。 */
export interface EpisodeManifest {
    schema: number;
    paragraphs: ManifestParagraph[];
}
/**
 * 批注挂的**一处**区域。
 *
 * 用户按住 Ctrl 可以连着选好几处（互不连续），所以一条批注是**一组 region**。
 */
export interface AnnotationRegion {
    /** 段落编号（**从 1 开始**）。连续跨段时是**起始**那一段。 */
    paragraph: number;
    /** 连续跨段的**结束**段落（含）；只选了一段时不写。 */
    endParagraph?: number;
    /** 这一处选中的剧本原文（跨段时含换行）。 */
    quote: string;
}
/**
 * 一条批注。
 *
 * 用户只写 `problem`；`id` / `regions` 由程序在用户划词时记录；
 * `done` / `resolvedIn` 由 agent 审核时更新。
 */
export interface Annotation {
    /** 程序生成的唯一编号（`a-0001`），在"这一集这一版"内唯一。 */
    id: string;
    /**
     * 这条批注挂了哪几处（至少 1 处）。按住 Ctrl 选的就是**几个不连续的地方**。
     *
     * 历史（2026-09-14）：早期存的是扁平的 `paragraph` / `endParagraph` / `quote`（只支持一处）。
     * 解析层**仍然兼容**那种老格式（读到时折成单元素数组），但**写出去一律是新格式**。
     */
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
    /**
     * 小版本号（`v2.1`）；不传 / `null` = 基线。
     *
     * ⚠️ 必须传**有效版本**那一份：界面上看的是 v2.2 的正文，批注就得存在
     *    `第1集批注.v2.2.txt` 里；两边不一致会出现"看到的是 v2.2 的批注、
     *    写进 v2.1 的文件"。
     */
    minor?: string;
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
/** 编辑过程中的一张快照（客户端按"停手"拍；输入法组合期间不拍）。 */
export interface EditSnapshotBody {
    text: string;
    /** 客户端本地时间（`14:20:44`）。 */
    at?: string;
}
/** 保存通道的请求体。 */
export interface EditRequest {
    sessionId: string;
    version: string;
    episode: number;
    /** 客户端读到的**旧全文**：用来防"我改的时候 agent 也改了同一集"。 */
    baseText?: string | null;
    /** 旧全文是小版本那一份时带上小版本号（`v2.1`）；基线不传。 */
    baseMinor?: string | null;
    /** 用户编辑后的全文（逐字写入）。 */
    text: string;
    /** 编辑期间的快照；可空。 */
    snapshots?: EditSnapshotBody[];
}
/** 保存成功后的摘要（界面显示 + 历史文件都靠它）。 */
export interface EditSummary {
    added: number;
    removed: number;
    /** 历史里记了几步。 */
    steps: number;
    /** 新正文一共几段。 */
    paragraphs: number;
    /** 新正文里"改过"的段号（沿用旧对照 + 待复核）。 */
    changed: number[];
    /** 新正文里"新增"的段号（原文里没有对应）。 */
    addedParagraphs: number[];
    /** 被删掉的旧段号。 */
    deleted: number[];
    /** 改动太大、没能逐行精细比对（此时对照是按位置推的）。 */
    degraded: boolean;
}
/** 保存通道的响应体。 */
export type EditResponse = {
    ok: true;
    /** 新产生的小版本号（`v2.1`）。 */
    minor: string;
    /** 新产生的那几个文件（工作区相对路径）。 */
    files: {
        content: string;
        manifest: string;
        annotation: string | null;
        history: string;
    };
    summary: EditSummary;
    /** 批注的三个数：还算数的、锚点失效的、位置被动过的。 */
    annotations: {
        kept: number;
        stale: string[];
        touched: string[];
    };
    warnings: string[];
} | {
    ok: false;
    error: string;
};
export declare const workbenchPath: () => string;
export declare const novelPath: () => string;
/**
 * 把"版本"统一成**目录名**。
 *
 * ⚠️ 两种写法都收：`v1`（目录名）和 `1`（去掉 v 的版本号）。
 *    踩过一次：扫描结果里存的是去掉 v 的 `1`，直接拼路径就成了
 *    `剧本工作台/1/清单/…`，清单永远找不到、剧本栏整个空白。
 *    在拼路径这一层归一，比要求每个调用方都记得传哪种更稳。
 */
export declare function asVersionDir(version: string): string;
export declare const versionPath: (version: string) => string;
/**
 * 小版本文件的尾巴：`v2.1` → `.v2.1`；`null` / `undefined`（基线）→ 空串。
 *
 * 基线文件与各小版本文件**共处同一个大版本目录**，靠这个尾巴区分。
 */
export declare function minorSuffix(tag?: string | null): string;
export declare const scriptPath: (version: string, episode: number, tag?: string | null) => string;
export declare const manifestPath: (version: string, episode: number, tag?: string | null) => string;
export declare const annotationPath: (version: string, episode: number, tag?: string | null) => string;
/** 人工编辑的历史记录：`剧本工作台/v2/历史/第1集.v2.1.txt`。 */
export declare const historyPath: (version: string, episode: number, tag: string) => string;
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
