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
import { parseContentName, tagMatchesDir, } from "./edit.js";
const emptyTriple = () => ({ content: null, manifest: null, annotation: null });
const FIELD_LABEL = {
    content: '正文',
    manifest: '清单',
    annotation: '批注',
};
/**
 * 把一个版本目录里的文件名清单整理成"每集有哪些版本、哪一版有效"。
 *
 * @param input - 见 {@link VersionGroupInput}。
 * @returns 版本结构 + 这个版本自己的问题清单（给界面原样显示，不当错误处理）。
 */
export function groupVersion(input) {
    const issues = [];
    const version = input.dir.startsWith('v') ? input.dir.slice(1) : input.dir;
    const episodes = new Map();
    const bucket = (episode) => {
        const found = episodes.get(episode);
        if (found !== undefined)
            return found;
        const created = { baseline: emptyTriple(), minors: new Map() };
        episodes.set(episode, created);
        return created;
    };
    const put = (field, name, parsed) => {
        if (parsed === undefined)
            return;
        const target = bucket(parsed.episode);
        let triple;
        if (parsed.tag === undefined || parsed.minor === undefined) {
            triple = target.baseline;
        }
        else {
            const existing = target.minors.get(parsed.minor);
            if (existing !== undefined) {
                triple = existing.files;
            }
            else {
                const created = { tag: parsed.tag, minor: parsed.minor, files: emptyTriple() };
                target.minors.set(parsed.minor, created);
                triple = created.files;
            }
        }
        const already = triple[field];
        if (already !== null) {
            issues.push(`第 ${parsed.episode} 集：${FIELD_LABEL[field]}有重复文件（${already} 与 ${name}）`);
            return;
        }
        triple[field] = name;
    };
    const scanDir = (dirName, kind) => {
        for (const name of input.files[dirName] ?? []) {
            const parsed = parseContentName(name);
            if (parsed === undefined || parsed.kind !== kind) {
                issues.push(`${dirName}/${name}：文件名不认识`);
                continue;
            }
            if (kind === 'content' && parsed.word !== input.word) {
                issues.push(`${dirName}/${name}："${parsed.word ?? '?'}"不是这个工作台的正文（这里应当是"${input.word}"）`);
                continue;
            }
            if (parsed.tag !== undefined && !tagMatchesDir(parsed.tag, input.dir)) {
                issues.push(`${dirName}/${name}：小版本号与目录 ${input.dir} 对不上`);
                continue;
            }
            put(kind === 'content' ? 'content' : kind === 'manifest' ? 'manifest' : 'annotation', name, parsed);
        }
    };
    scanDir(input.word, 'content');
    scanDir('清单', 'manifest');
    scanDir('批注', 'annotation');
    /* 历史文件不参与"有效版本"，只检查名字放对没有。 */
    for (const name of input.files['历史'] ?? []) {
        const parsed = parseContentName(name);
        if (parsed === undefined || parsed.kind !== 'history') {
            issues.push(`历史/${name}：文件名不认识`);
        }
    }
    const out = [];
    for (const [episode, entry] of [...episodes.entries()].sort((a, b) => a[0] - b[0])) {
        const epIssues = [];
        if (entry.baseline.content === null)
            epIssues.push(`第 ${episode} 集：缺${input.word}文件`);
        if (entry.baseline.manifest === null)
            epIssues.push(`第 ${episode} 集：缺清单文件`);
        const minors = [...entry.minors.values()].sort((a, b) => a.minor - b.minor);
        let effective = { tag: null, files: entry.baseline };
        for (const minor of minors) {
            const hasContent = minor.files.content !== null;
            const hasManifest = minor.files.manifest !== null;
            if (!hasContent && !hasManifest) {
                epIssues.push(`第 ${episode} 集 ${minor.tag}：只有批注文件，没有对应的正文与清单`);
                continue;
            }
            if (!hasContent || !hasManifest) {
                epIssues.push(`第 ${episode} 集 ${minor.tag}：这一版不完整（缺${hasContent ? '清单' : input.word}）`);
                continue;
            }
            effective = { tag: minor.tag, files: minor.files };
        }
        out.push({ episode, baseline: entry.baseline, minors, effective, issues: epIssues });
    }
    return { version, dir: input.dir, episodes: out, hasChangelog: input.hasChangelog, issues };
}
/** 从版本结构里找某一集。 */
export function findEpisode(version, episode) {
    return version.episodes.find(e => e.episode === episode);
}
/**
 * 这一集当前该读 / 该写的**批注文件**。
 *
 * ⚠️ 读和写必须是同一个：有效版本是小版本时，批注也落在那一版自己的批注文件上
 *    （计划 §10.1：批注跟小版本分叉），否则会出现"看到的是 v2.2 的批注、写进
 *    v2.1 的文件"这种错位。
 */
export function annotationFileOf(entry) {
    return entry.effective.files.annotation;
}
/** 界面上给这一集打的版本标签：`v2.3（人工）` 或 `v2`。 */
export function effectiveLabel(entry, version) {
    return entry.effective.tag === null ? `v${version}` : `${entry.effective.tag}（人工）`;
}
//# sourceMappingURL=versions.js.map