/**
 * @dsh-external/dsh-ui-skin —— 宿主半边。
 *
 * 只做两件事，都不碰皮肤的实际渲染（渲染在浏览器半边）：
 *
 *   1. **声明设置** —— 导出 `Config`（schemastery），可写字段标 `.volatile()`。
 *      0.1.7 起设置由插件自己的 Config 声明、按 **profile 条目 id** 定位；客户端经
 *      `ctx.configForms` 读写，写入持久化到 profile 的 cordis patch。旧的命令式
 *      `settings.register(ns, schema, { applies: 'live' })` 在 0.1.7 已移除。
 *   2. **注册素材路由** —— 把"本地素材目录"里的图喂给浏览器（见 asset-serve.ts）。
 *      仓库里不带任何图片：个人素材不随插件分发，位图由使用者自己放进目录。
 *
 * 启动时打印生效的素材目录，让"图为什么没生效"一眼可查。
 *
 * @module @dsh-external/dsh-ui-skin
 */
import z from '@deepseek-ai/schemastery';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SKIN, SKIN_IDS } from "./skin-settings.js";
/** 本插件资产路由的挂载前缀。 */
export const ASSETS_ROUTE_PREFIX = '/dsh-ui-skin/assets';
// 设置常量与形状的唯一真相源是 skin-settings.ts；素材相关的是 asset-serve.ts。
export { ASSETS_DIR_FIELD, DEFAULT_SKIN, SKIN_ENTRY_ID, SKIN_FIELD, SKIN_IDS, isSkinId, } from "./skin-settings.js";
export { SKIN_ASSET_NAMES, assetFilePath, defaultAssetsDir, describeAssetsDir, isSkinAssetName, lookupAsset, openAsset, resolveAssetsDir, } from "./asset-serve.js";
import { ASSETS_ROUTE_PREFIX as ROUTE_PREFIX, SKIN_ASSET_NAMES, describeAssetsDir, lookupAsset, } from "./asset-serve.js";
/**
 * 设置命名空间声明（0.1.7 声明式模型）。
 *
 * `.volatile()` = 字段出现在设置面、可被客户端表单写入；写入持久化到 profile
 * 的 cordis patch，条目重载后 apply() 带新 config 再跑一次。旧的
 * `settings.register(ns, schema, { applies: 'live' })` 与 `settings.get(ns)`
 * 在 0.1.7 均已不存在。
 *
 * ⚠️ 必须是**真的** schemastery：设置描述面会调 `schema.toJSON()`、解析会调
 * `schema(value)`；手写"长得像 schema"的对象少了这些就抛错（表现为设置里
 * 写不进去）。
 */
export const Config = z.object({
    skin: z.union([...SKIN_IDS]).default(DEFAULT_SKIN).volatile(),
    assetsDir: z.string().default('').volatile(),
});
export const name = 'ui-skin';
/** settings 与 webServer 都是硬依赖：前者存目录，后者发图片。 */
export const inject = ['settings', 'webServer'];
/**
 * 把请求路径尾部的资产名取出来。
 * @param url - 请求的原始 url（可含查询串）。
 * @param prefix - 路由前缀。
 * @returns 资产名（可能是空串或含斜杠的非法值，交给白名单挡掉）。
 */
function assetNameFromUrl(url, prefix) {
    const path = (url ?? '').split('?')[0] ?? '';
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    return decodeURIComponent(rest.replace(/^\/+/, ''));
}
/**
 * 列出目录里**实际存在**的资产名。客户端先问这个，再决定哪几张图用位图 ——
 * 免得每次加载都甩一串 404（404 不致命，但会在控制台留噪声、也不好看）。
 * @param dir - 素材目录。
 * @returns 存在的资产名数组。
 */
async function listAvailable(dir) {
    const found = [];
    for (const assetName of SKIN_ASSET_NAMES) {
        const hit = await lookupAsset(dir, assetName);
        if (hit.ok)
            found.push(assetName);
    }
    return found;
}
/**
 * 注册资产路由。两条：
 *   · `GET <prefix>/manifest.json` → `{ dir, assets: [...] }`（客户端用它决定用哪几张图）
 *   · `GET <prefix>/<name>`        → 文件；不在白名单/目录里没有 → 404
 * @param ctx - 宿主上下文（需已拿到 webServer）。
 * @param getConfiguredDir - 取当前设置的素材目录（每次请求都读，设置改动即时生效）。
 */
function registerAssetRoutes(ctx, getConfiguredDir) {
    const server = ctx.webServer;
    if (server === undefined) {
        console.warn('[ui-skin] 没有 webServer 服务，素材路由未注册（皮肤将只用内置矢量标记）');
        return;
    }
    const handler = async (req, res) => {
        const configured = getConfiguredDir();
        const { dir } = describeAssetsDir(configured);
        const assetName = assetNameFromUrl(req.url, ROUTE_PREFIX);
        if (assetName === 'manifest.json') {
            const assets = await listAvailable(dir);
            const body = JSON.stringify({ dir, assets });
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            // manifest 必须每次新鲜：用户放图/删图后刷新页面就该看到变化
            res.setHeader('cache-control', 'no-store');
            res.end(body);
            return;
        }
        const hit = await lookupAsset(dir, assetName);
        if (!hit.ok) {
            res.statusCode = hit.status;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end(hit.reason);
            return;
        }
        // ⚠️ 不要用 `res.pipe(openAsset(...))`：实测在 0.1.7 的 webServer 上，响应头虽已
        // 按命中设置（content-type / cache-control），body 却写不进去，客户端收到的是
        // **400 空响应** → 位图全部走 onError 回退。位图素材很小（白名单里最大 ~1MB），
        // 直接读进内存再 end() 最稳，也摆脱了对响应对象形态的依赖。
        //
        // ⚠️ 响应头一律在**读成功之后**才设：先设长缓存再失败，会让浏览器把那个失败响应
        // 缓存 24 小时（踩过：服务端修好了，客户端仍在用缓存的 400）。
        try {
            const body = await readFile(hit.path);
            res.statusCode = 200;
            res.setHeader('content-type', hit.contentType);
            // 单张图的内容不会变（名字固定）——让它长缓存，省掉重复读取
            res.setHeader('cache-control', 'public, max-age=86400');
            res.end(body);
        }
        catch (error) {
            res.statusCode = 404;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(`cannot read asset: ${String(error)}`);
        }
    };
    ctx.effect(() => server.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'ui-skin: asset route');
}
/**
 * 插件主体。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx, config) {
    // settings 只是"持久化出口"：命名空间由导出的 Config 声明，无需注册。
    ctx.inject(['settings'], (settingsCtx) => {
        const settings = settingsCtx.get('settings');
        if (settings === undefined)
            return;
        // 本插件自带设置行（settings.general.item），关掉自动生成的表单。
        ctx.effect(() => settings.configure({ auto: false }, ctx.fiber), 'ui-skin: settings presentation');
        const { dir, isDefault } = describeAssetsDir(config?.assetsDir);
        console.info(`[ui-skin] 素材目录：${dir}${isDefault ? '（默认）' : '（设置指定）'}`);
        console.info('[ui-skin] 把 codex-icon.png / claude-icon.png 等放进该目录即可显示位图；缺图自动回退内置矢量标记。');
    });
    // 路由每次请求都读当前 config；设置写入后条目重载，闭包随之更新。
    registerAssetRoutes(ctx, () => config?.assetsDir);
}
//# sourceMappingURL=index.js.map