/**
 * "哪堆文件属于哪一集、哪一版" —— **纯函数**，输入只是目录里的文件名清单。
 *
 * 为什么单独放一层：这段判断以前长在浏览器的扫描函数里（跟着 `workspaceFiles`
 * 一起），错不错都没法测。把它拎出来之后，`scripts/verify-edit.mjs` 可以直接
 * 喂一堆文件名断言结果，P1 的规则就有了回归网。
 *
 * 规则（设计文档 §2、计划 §3）：
 *   · 基线文件（不带 `.vN.M`）与同集的小版本文件共处一个大版本目录；
 *   · 小版本号是**每一集各算各的**；
 *   · **有效版本** = 这一集"正文 + 清单都齐"的最高小版本；都没有就是基线；
 *   · 批注文件不参与"齐不齐"的判断（它是写了第一条批注才有的），
 *     但要跟着有效版本走 —— 谁有效就读谁那一份。
 */
import { type ContentWord } from './edit.ts';
/** 一个版本目录里，某一集的那几个文件（`null` = 没有）。 */
export interface FileTriple {
    /** 正文：剧本批注是"剧本"，提示词对照是"提示词"。 */
    content: string | null;
    manifest: string | null;
    annotation: string | null;
}
/** 一个人工小版本。 */
export interface MinorEntry {
    /** `v2.1`。 */
    tag: string;
    /** 小版本序号（这一集自己的序号）。 */
    minor: number;
    files: FileTriple;
}
/** 某一集"当前该看/该改"的那一版。 */
export interface EffectiveVersion {
    /** `v2.1`；基线时为 `null`。 */
    tag: string | null;
    files: FileTriple;
}
/** 一集在大版本里的存在情况。 */
export interface EpisodeEntry {
    episode: number;
    baseline: FileTriple;
    /** 按小版本号升序。 */
    minors: MinorEntry[];
    effective: EffectiveVersion;
    /** 这一集自己的问题（缺件、哪一版不完整……）。 */
    issues: string[];
}
/** 一个大版本目录。 */
export interface VersionEntry {
    /** 版本号（不带 `v`），如 `2`。 */
    version: string;
    /** 目录名，如 `v2`。 */
    dir: string;
    episodes: EpisodeEntry[];
    hasChangelog: boolean;
    issues: string[];
}
/** `groupVersion` 的输入。 */
export interface VersionGroupInput {
    /** 目录名，如 `v2`（`v` 必须带）。 */
    dir: string;
    /** 这个插件的"正文"用哪个词。 */
    word: ContentWord;
    /** 子目录名 → 文件名。只认 正文目录 / 清单 / 批注 / 历史。 */
    files: Readonly<Record<string, readonly string[]>>;
    hasChangelog: boolean;
}
/**
 * 把一个版本目录里的文件名清单整理成"每集有哪些版本、哪一版有效"。
 *
 * @param input - 见 {@link VersionGroupInput}。
 * @returns 版本结构 + 这个版本自己的问题清单（给界面原样显示，不当错误处理）。
 */
export declare function groupVersion(input: VersionGroupInput): VersionEntry;
/** 从版本结构里找某一集。 */
export declare function findEpisode(version: VersionEntry, episode: number): EpisodeEntry | undefined;
/**
 * 这一集当前该读 / 该写的**批注文件**。
 *
 * ⚠️ 读和写必须是同一个：有效版本是小版本时，批注也落在那一版自己的批注文件上
 *    （计划 §10.1：批注跟小版本分叉），否则会出现"看到的是 v2.2 的批注、写进
 *    v2.1 的文件"这种错位。
 */
export declare function annotationFileOf(entry: EpisodeEntry): string | null;
/** 界面上给这一集打的版本标签：`v2.3（人工）` 或 `v2`。 */
export declare function effectiveLabel(entry: EpisodeEntry, version: string): string;
