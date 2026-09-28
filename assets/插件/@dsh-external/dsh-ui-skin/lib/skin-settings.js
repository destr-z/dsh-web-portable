/**
 * 皮肤插件的常量与形状（宿主半边与浏览器半边共用，**唯一真相源**）。
 *
 * 0.1.7 的数据模型（与 0.1.5 不同，别按旧模型读）：
 *   · 皮肤 id 与素材目录**都是本插件的设置**：宿主导出 `Config` 并用 `.volatile()`
 *     标记可写字段；客户端用 `ctx.configForms.get(SKIN_ENTRY_ID)` 读写，写入落到
 *     profile 的 cordis patch，条目重载后宿主 `apply()` 带新 config 再跑一次。
 *   · 皮肤 id 另存一份 **localStorage 镜像**（`SKIN_STORAGE_KEY`），只为首屏不闪；
 *     权威值始终在设置里。跨标签页同步由设置镜像负责，不靠 `storage` 事件。
 *   · 0.1.7 起设置**按 profile 条目 id 定位**，不再有独立的"命名空间名"
 *     （0.1.5 时代那个 `dsh-ui-skin` 命名空间已不存在）。
 */
/** 可选皮肤 id（DeepSeek 是产品默认）。 */
export const SKIN_IDS = ['deepseek', 'codex', 'claude-code'];
/**
 * 设置定位 id = 本插件在 profile 里的条目 id。**必须与 `cordis.patch.yml` 的行 id 一致**：
 * 它同时就是 0.1.7 的设置命名空间，写错的表现是设置读不出来（`status: 'unavailable'`）。
 *
 * ⚠️ 刻意用 `external-ui-skin` 而不是 `ui-skin`：树内曾有条目叫 `ui-skin`，同 id 会让
 * loader 报 `duplicate loader entry id` 并使整个界面起不来（实测踩过）。0.1.7 虽已移除
 * 树内皮肤，仍保留前缀，避免将来重新引入时再次撞车。
 */
export const SKIN_ENTRY_ID = 'external-ui-skin';
/** 设置字段名：皮肤 id。 */
export const SKIN_FIELD = 'skin';
/** 设置字段名：素材目录。 */
export const ASSETS_DIR_FIELD = 'assetsDir';
/** 没有任何持久化时的默认皮肤。 */
export const DEFAULT_SKIN = 'deepseek';
/** 皮肤 id 的 localStorage 镜像键（只为首屏不闪，不是权威值）。 */
export const SKIN_STORAGE_KEY = 'dsh.dshUiSkin.skin';
/** 承载当前皮肤品牌面的 body 属性。 */
export const SKIN_ATTRIBUTE = 'data-dsh-ui-skin';
/**
 * 把一个值收窄成合法皮肤 id。
 * @param value - 跨存储边界的值。
 * @returns 是否是内置皮肤 id。
 */
export function isSkinId(value) {
    return SKIN_IDS.some(id => id === value);
}
//# sourceMappingURL=skin-settings.js.map