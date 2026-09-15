window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-prompt-compare",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/protocol.ts
		/**
		* 全屏浮层席位。
		*
		* ⚠️ 不注册 `main` / `main.conversation` —— 那是官方对话区的单占席位，
		* 注册进去就是替换掉官方对话。这里只需要"浮在上面"。
		*/
		const OVERLAY_SLOT = "shell.overlay";
		/** 插件在席位里的 id（须唯一）。 */
		const PANEL_ID = "prompt-compare";
		/** 工作台根目录（工作区里的固定名字）。 */
		const WORKBENCH_DIR = "对照工作台";
		const SCRIPT_DIR = "剧本";
		const PROMPT_DIR = "提示词";
		const MANIFEST_DIR = "清单";
		const ANNOTATION_DIR = "批注";
		const CHANGELOG_FILE = "变更记录.txt";
		const RE_VERSION_DIR = /^v(\d+)$/;
		const RE_SCRIPT_FILE = /^第(\d+)集剧本\.txt$/;
		const RE_PROMPT_FILE = /^第(\d+)集提示词\.txt$/;
		const RE_MANIFEST_FILE = /^第(\d+)集清单\.txt$/;
		const RE_ANNOTATION_FILE = /^第(\d+)集批注\.txt$/;
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
		const ANNOTATION_ROUTE = "/api/prompt-compare/annotations";
		const scriptDirPath = () => `${WORKBENCH_DIR}/${SCRIPT_DIR}`;
		/**
		* 把"版本"统一成**目录名**。
		*
		* ⚠️ 两种写法都收：`v1`（目录名）和 `1`（去掉 v 的版本号）。
		*    踩过一次（剧本批注那边）：扫描结果里存的是去掉 v 的 `1`，直接拼路径就成了
		*    `对照工作台/1/清单/…`，清单永远找不到、整栏空白。
		*    在拼路径这一层归一，比要求每个调用方都记得传哪种更稳。
		*/
		function asVersionDir(version) {
			return RE_VERSION_DIR.test(version) ? version : `v${version.replace(/^v/i, "")}`;
		}
		const versionPath = (version) => `${WORKBENCH_DIR}/${asVersionDir(version)}`;
		/** 剧本：在根下，不带版本。 */
		const scriptPath = (episode) => `${WORKBENCH_DIR}/${SCRIPT_DIR}/第${episode}集剧本.txt`;
		const promptPath = (version, episode) => `${versionPath(version)}/${PROMPT_DIR}/第${episode}集提示词.txt`;
		const manifestPath = (version, episode) => `${versionPath(version)}/${MANIFEST_DIR}/第${episode}集清单.txt`;
		/**
		* 版本号排序：`1 < 2 < 10`（按数字比，不是按字符串）。
		* 参数是**不带 v 的数字串**。
		*/
		function compareVersions(a, b) {
			const na = Number.parseInt(a, 10);
			const nb = Number.parseInt(b, 10);
			if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
			return a < b ? -1 : a > b ? 1 : 0;
		}
		/** 目录名 → 版本号（不带 v）；不是版本目录就返回 undefined。 */
		function versionOfDir(name) {
			return RE_VERSION_DIR.exec(name)?.[1];
		}
		/**
		* 程序生成的批注编号。
		* @param seq - 从 1 开始的序号。
		*/
		function annotationId(seq) {
			return `a-${String(seq).padStart(4, "0")}`;
		}
		//#endregion
		//#region src/shared/validate.ts
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
		const err = (where, message) => ({
			level: "error",
			where,
			message
		});
		/** 坏块的占位行号区间。 */
		const BROKEN_LINES = [0, 0];
		/** 换行规范化：`\r\n` → `\n`，单独的 `\r` → `\n`。 */
		function normalizeNewlines(raw) {
			return raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
		}
		/**
		* 按 LF 切行。
		*
		* ⚠️ 行号一律以**这个结果的下标 + 1** 为准（`splitLines(text)[n - 1]` 就是第 n 行）。
		*    锚点定位、`promptLines`、`scriptRanges` 三处必须用同一个切法，
		*    否则"第 12 行"在哪一层都会对不上。
		*/
		function splitLines(text) {
			return normalizeNewlines(text).split("\n");
		}
		/**
		* 一个"合法区间"：`[a, b]`，`a`、`b` 都是整数且 `1 ≤ a ≤ b`。
		*
		* ⚠️ 数字沿用 `Number(...)` 兜一层：宿主侧拿到的是工具参数（可能带字符串数字），
		*    浏览器侧拿到的是 `JSON.parse` 的结果（数字）；两边都用同一把尺子，
		*    免得"宿主收、客户端拒"这种一半好一半坏的状态。
		*
		* @returns 合法时返回规范化后的区间，否则 `undefined`（**空数组也返回 `undefined`**）。
		*/
		function asRange(value) {
			if (!Array.isArray(value) || value.length < 2) return void 0;
			const a = typeof value[0] === "number" ? value[0] : Number(value[0]);
			const b = typeof value[1] === "number" ? value[1] : Number(value[1]);
			if (!Number.isInteger(a) || !Number.isInteger(b)) return void 0;
			if (a < 1 || b < a) return void 0;
			return [a, b];
		}
		/**
		* `scriptRanges` 字段形状校验：`null`（剧本里没有对应），或者**非空的**、每项都合法的区间数组。
		*
		* 形状与"行号越不越界"是两件事：这里管形状，越界由 `checkScriptRanges` 拿原文总行数去比。
		*
		* @returns `null`（合法）、合法数组，或 `undefined`（形状不认识）。
		*/
		function asScriptRanges(value) {
			if (value === null || value === void 0) return null;
			if (!Array.isArray(value) || value.length === 0) return void 0;
			const out = [];
			for (const item of value) {
				const range = asRange(item);
				if (range === void 0) return void 0;
				out.push(range);
			}
			return out;
		}
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
		function parseEpisodeManifest(raw) {
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {
				manifest: null,
				issues: [err("清单", "不是一个 JSON 对象")]
			};
			const obj = raw;
			if (obj.schema !== 1) return {
				manifest: null,
				issues: [err("清单", `格式版本不认识（schema=${JSON.stringify(obj.schema)}，本程序只认 1）`)]
			};
			if (!Array.isArray(obj.blocks) || obj.blocks.length === 0) return {
				manifest: null,
				issues: [err("清单", "blocks 不是非空数组")]
			};
			const issues = [];
			return {
				manifest: {
					schema: 1,
					blocks: obj.blocks.map((item, index) => {
						const where = `第 ${index + 1} 块`;
						if (typeof item !== "object" || item === null || Array.isArray(item)) {
							issues.push(err(where, "不是一个 JSON 对象"));
							return {
								anchor: "",
								promptLines: BROKEN_LINES,
								scriptRanges: null
							};
						}
						const rec = item;
						const anchor = typeof rec.anchor === "string" ? rec.anchor : "";
						if (typeof rec.anchor !== "string") issues.push(err(where, `anchor 不是字符串（${JSON.stringify(rec.anchor)}）`));
						else if (anchor === "") issues.push(err(where, "anchor 为空 —— 定位不了这一块"));
						const promptLines = asRange(rec.promptLines);
						if (promptLines === void 0) issues.push(err(where, `promptLines 不是合法行号区间（${JSON.stringify(rec.promptLines)}）`));
						const scriptRanges = asScriptRanges(rec.scriptRanges);
						if (scriptRanges === void 0) issues.push(err(where, `scriptRanges 不是 null 也不是 [[起,止], …]（${JSON.stringify(rec.scriptRanges)}）`));
						return {
							anchor,
							promptLines: promptLines ?? BROKEN_LINES,
							scriptRanges: scriptRanges ?? null
						};
					})
				},
				issues
			};
		}
		/**
		* 解析批注文件。
		*
		* ⚠️ 这一段与 `dsh-novel-script` **逐字一致**（含兼容旧扁平格式的逻辑），
		*    两条插件的批注格式是刻意保持一致的，改一边必须同时改另一边（protocol.ts 开头）。
		*    `paragraph` 字段的含义是"**块**的位置序号"，是 protocol 定死的名字，不改。
		*
		* @returns 合法条目与问题列表；整个文件不是数组时 `annotations` 为 `null`（= 不可用）。
		*/
		function parseAnnotations(raw) {
			if (!Array.isArray(raw)) return {
				annotations: null,
				issues: [err("批注", "不是一个 JSON 数组")]
			};
			const issues = [];
			const out = [];
			const seen = /* @__PURE__ */ new Set();
			raw.forEach((item, index) => {
				const where = `第 ${index + 1} 条`;
				if (typeof item !== "object" || item === null || Array.isArray(item)) {
					issues.push(err(where, "不是一个 JSON 对象"));
					return;
				}
				const rec = item;
				const id = typeof rec.id === "string" ? rec.id.trim() : "";
				const problem = typeof rec.problem === "string" ? rec.problem : "";
				if (id === "") {
					issues.push(err(where, "id 缺失"));
					return;
				}
				if (seen.has(id)) {
					issues.push(err(where, `id ${id} 重复，已忽略这一条`));
					return;
				}
				const rawRegions = Array.isArray(rec.regions) ? rec.regions : rec.paragraph !== void 0 || rec.quote !== void 0 ? [rec] : [];
				const regions = [];
				for (const [regionIndex, rawRegion] of rawRegions.entries()) {
					const regionWhere = rawRegions.length > 1 ? `${where} 第 ${regionIndex + 1} 处` : where;
					if (typeof rawRegion !== "object" || rawRegion === null || Array.isArray(rawRegion)) {
						issues.push(err(regionWhere, "不是一个 JSON 对象"));
						continue;
					}
					const region = rawRegion;
					const paragraph = typeof region.paragraph === "number" ? region.paragraph : Number(region.paragraph);
					const quote = typeof region.quote === "string" ? region.quote : "";
					if (!Number.isInteger(paragraph) || paragraph < 1) {
						issues.push(err(regionWhere, `paragraph 不是正整数（${JSON.stringify(region.paragraph)}）`));
						continue;
					}
					if (quote.trim() === "") {
						issues.push(err(regionWhere, "quote 为空"));
						continue;
					}
					let endParagraph;
					if (region.endParagraph !== void 0 && region.endParagraph !== null) {
						const end = typeof region.endParagraph === "number" ? region.endParagraph : Number(region.endParagraph);
						if (Number.isInteger(end) && end > paragraph) endParagraph = end;
						else if (end !== paragraph) issues.push(err(regionWhere, `endParagraph 不是 ≥ paragraph 的整数（${JSON.stringify(region.endParagraph)}），已按单块处理`));
					}
					regions.push({
						paragraph,
						...endParagraph === void 0 ? {} : { endParagraph },
						quote
					});
				}
				if (regions.length === 0) {
					issues.push(err(where, "没有任何可用的区域，已忽略这一条"));
					return;
				}
				seen.add(id);
				out.push({
					id,
					regions,
					problem,
					done: rec.done === true,
					resolvedIn: typeof rec.resolvedIn === "string" && rec.resolvedIn !== "" ? rec.resolvedIn : null
				});
			});
			return {
				annotations: out,
				issues
			};
		}
		/** 下一个可用的批注序号（接着已有的最大编号往下排）。 */
		function nextAnnotationSeq(existing) {
			let max = 0;
			for (const a of existing) {
				const m = /^a-(\d+)$/.exec(a.id);
				if (m?.[1] !== void 0) max = Math.max(max, Number.parseInt(m[1], 10));
			}
			return max + 1;
		}
		/**
		* 生成一条新批注（程序在用户划词时调）。
		*
		* @param seq - 序号（由 `nextAnnotationSeq` 给）。
		* @param regions - 这条批注挂的几处（至少一处；Ctrl 多选就是多处）。
		* @param problem - 用户写的问题。
		*/
		function makeAnnotation(seq, regions, problem) {
			return {
				id: annotationId(seq),
				regions: regions.map((r) => ({ ...r })),
				problem,
				done: false,
				resolvedIn: null
			};
		}
		//#endregion
		//#region src/client/annotations.ts
		/**
		* 批注通道的浏览器端：把界面上的批注存/取回宿主。
		*
		* 通道是官方 `/api` 载体上的一个 exact Fetch route（自带 Host/Origin 校验与
		* 浏览器认证）。路径与请求体形状见 `shared/protocol.ts`。
		*
		* 设计文档 §17 说明：**读盘、按 id 合并、写盘都在宿主侧一次完成**，
		* 浏览器只负责把当前列表送过去；同时"文件不存在才当空数组、损坏就停止保存"
		* 也由宿主判断，这里只把错误原文带回界面。
		*/
		/** 调用批注通道。 */
		async function callAnnotations(body, signal) {
			let response;
			try {
				response = await fetch(ANNOTATION_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					...signal === void 0 ? {} : { signal }
				});
			} catch (error) {
				return {
					ok: false,
					error: `连不上批注通道（${ANNOTATION_ROUTE}）：${error instanceof Error ? error.message : String(error)}`
				};
			}
			if (!response.ok) return {
				ok: false,
				error: `批注通道返回 HTTP ${response.status}`
			};
			try {
				return await response.json();
			} catch {
				return {
					ok: false,
					error: "批注通道返回的不是合法 JSON"
				};
			}
		}
		/** 读一集的批注。 */
		function loadAnnotations(sessionId, version, episode, signal) {
			return callAnnotations({
				op: "load",
				sessionId,
				version,
				episode
			}, signal);
		}
		/** 存一集的批注（返回宿主合并后的结果）。 */
		function saveAnnotations(sessionId, version, episode, annotations) {
			return callAnnotations({
				op: "save",
				sessionId,
				version,
				episode,
				annotations: [...annotations]
			});
		}
		//#endregion
		//#region src/client/workspace.ts
		/**
		* 数据层：从**固定目录**读工作台 —— 有哪些版本、每个版本有哪些集、缺哪一侧。
		*
		* ⚠️ 与 `dsh-novel-script`（剧本工作台）**刻意同构、方向相反**，照抄之前先看清这句：
		*    那边——锚点是 `小说原文.txt`（一份、不随版本变），作业区是每版的 `剧本/`；
		*    这边——锚点是 `剧本/`（一份、**不随版本变**），作业区是每版的 `提示词/`。
		*    所以扫描出来的形状一样，但"哪边全局、哪边在版本里"正好反着来。
		*    把剧本也扫进每个版本目录，是这一步最容易犯的错。
		*
		* 一条实测出来的契约：`workspaceFiles.list/read` 的**第一个参数是会话 id**，
		* 不是工作区 id —— 会话锚定了工作区根，所以"读哪个工作区"由当前会话决定。
		*/
		/** 单次读取最多翻多少页（一页默认 5000 行）。 */
		const MAX_READ_PAGES = 40;
		/** 读一页。 */
		async function readPage(files, sessionId, path, offset, signal) {
			const result = await files.read(sessionId, path, { offset }, signal);
			if (!result.ok) throw new Error(`读不了 ${path}：${result.error.code} ${result.error.message}`);
			return {
				text: result.value.text,
				lines: result.value.lines,
				eof: result.value.eof
			};
		}
		/**
		* 读一整份文本（**自动翻页**）。
		*
		* ⚠️ `read` 一次只给一页（默认 5000 行），超出只回 `eof:false`，**不报错也不提示** ——
		*    静默截断会让人看到"看起来完整"的半份稿子。这边最容易被截的是**提示词**（作业侧，
		*    一集几千行不稀奇）和**剧本**（锚点侧，几十集攒在一起），两个都踩不得。
		*    分页语义：页间用 `\n` 拼接即可精确还原，行号与物理行号一致。
		*/
		async function readText(files, sessionId, path, signal) {
			const first = await readPage(files, sessionId, path, 1, signal);
			let text = first.text;
			let cursor = 1 + first.lines;
			let done = first.eof;
			let pages = 1;
			while (!done && pages < MAX_READ_PAGES) {
				if (signal?.aborted) break;
				const page = await readPage(files, sessionId, path, cursor, signal);
				if (page.lines === 0) break;
				text += `\n${page.text}`;
				cursor += page.lines;
				done = page.eof;
				pages += 1;
			}
			return text;
		}
		/** 读文本；**不存在**时返回 `undefined`（其它错误照抛）。 */
		async function tryReadText(files, sessionId, path, signal) {
			try {
				return await readText(files, sessionId, path, signal);
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				if (/not-found|no entry|不存在|FS_NOT_FOUND/i.test(text)) return void 0;
				throw error;
			}
		}
		async function listDir(files, sessionId, path, signal) {
			let result;
			try {
				result = await files.list(sessionId, path, signal);
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				if (/not-found|no entry|不存在|FS_NOT_FOUND/i.test(text)) return void 0;
				throw error;
			}
			if (!result.ok) {
				if (/not-found|no entry|FS_NOT_FOUND/i.test(`${result.error.code} ${result.error.message}`)) return void 0;
				throw new Error(`读不了目录 ${path}：${result.error.code} ${result.error.message}`);
			}
			const dirs = [];
			const fileNames = [];
			for (const entry of result.value.entries) if (entry.type === "directory") dirs.push(entry.name);
			else if (entry.type === "file") fileNames.push(entry.name);
			return {
				dirs,
				files: fileNames
			};
		}
		const EMPTY_SCAN = {
			phase: "error",
			scriptEpisodes: [],
			versions: [],
			issues: [],
			error: "还没有开始扫描"
		};
		/** 把目录里的文件名按 `第N集…` 认一遍。 */
		function collectEpisodeFiles(names, re) {
			const byEpisode = /* @__PURE__ */ new Map();
			const unknown = [];
			for (const name of names) {
				const m = re.exec(name);
				if (m?.[1] === void 0) {
					unknown.push(name);
					continue;
				}
				const episode = Number.parseInt(m[1], 10);
				const list = byEpisode.get(episode);
				if (list === void 0) byEpisode.set(episode, [name]);
				else list.push(name);
			}
			return {
				byEpisode,
				unknown
			};
		}
		/** 某一类文件里"集号重复"的问题文案（对齐设计文档里的说法）。 */
		function duplicateIssues(found, what, dirLabel) {
			const out = [];
			for (const [episode, names] of found) if (names.length > 1) out.push(`${dirLabel} 第 ${episode} 集重复：有 ${names.length} 个${what}文件（${names.join("、")}）`);
			return out;
		}
		/**
		* 扫 `对照工作台/`：有哪些版本、每一版有哪些集、缺哪一侧。
		*
		* 只做机械检查（文件在不在、集号有没有重号、文件名认不认识），**不判断剧情内容**。
		*/
		async function scanWorkbench(files, sessionId, signal) {
			const root = await listDir(files, sessionId, ".", signal);
			if (root === void 0 || !root.dirs.includes("对照工作台")) return {
				phase: "missing",
				scriptEpisodes: [],
				versions: [],
				issues: [],
				error: ""
			};
			const issues = [];
			const bench = await listDir(files, sessionId, WORKBENCH_DIR, signal);
			if (bench === void 0) return {
				phase: "error",
				scriptEpisodes: [],
				versions: [],
				issues: [],
				error: `读不了 ${WORKBENCH_DIR}/`
			};
			const scriptListing = await listDir(files, sessionId, scriptDirPath(), signal);
			const scriptFiles = collectEpisodeFiles(scriptListing?.files ?? [], RE_SCRIPT_FILE);
			for (const name of scriptFiles.unknown) issues.push(`${SCRIPT_DIR}/${name}：文件名不认识（要写成「第1集剧本.txt」这样）`);
			issues.push(...duplicateIssues(scriptFiles.byEpisode, "剧本", SCRIPT_DIR));
			const scriptEpisodes = [...scriptFiles.byEpisode.keys()].sort((a, b) => a - b);
			if (scriptListing === void 0) issues.push(`缺 ${SCRIPT_DIR}/ 目录 —— 剧本还没放进 ${WORKBENCH_DIR}`);
			else if (scriptEpisodes.length === 0) issues.push(`${SCRIPT_DIR}/ 里没有剧本文件（要写成「第1集剧本.txt」这样）`);
			const versionDirs = bench.dirs.map((dir) => ({
				dir,
				version: versionOfDir(dir)
			})).filter((x) => x.version !== void 0).sort((a, b) => compareVersions(a.version, b.version));
			if (versionDirs.length === 0) return {
				phase: "empty",
				scriptEpisodes,
				versions: [],
				issues,
				error: ""
			};
			const versions = [];
			for (const { dir, version } of versionDirs) {
				const vroot = versionPath(dir);
				const prompts = await listDir(files, sessionId, `${vroot}/${PROMPT_DIR}`, signal);
				const manifests = await listDir(files, sessionId, `${vroot}/${MANIFEST_DIR}`, signal);
				const annotations = await listDir(files, sessionId, `${vroot}/${ANNOTATION_DIR}`, signal);
				const versionRoot = await listDir(files, sessionId, vroot, signal);
				const promptFiles = collectEpisodeFiles(prompts?.files ?? [], RE_PROMPT_FILE);
				const manifestFiles = collectEpisodeFiles(manifests?.files ?? [], RE_MANIFEST_FILE);
				const annotationFiles = collectEpisodeFiles(annotations?.files ?? [], RE_ANNOTATION_FILE);
				for (const name of promptFiles.unknown) issues.push(`${dir}/${PROMPT_DIR}/${name}：文件名不认识（要写成「第1集提示词.txt」这样）`);
				for (const name of manifestFiles.unknown) issues.push(`${dir}/${MANIFEST_DIR}/${name}：文件名不认识（要写成「第1集清单.txt」这样）`);
				for (const name of annotationFiles.unknown) issues.push(`${dir}/${ANNOTATION_DIR}/${name}：文件名不认识（要写成「第1集批注.txt」这样）`);
				issues.push(...duplicateIssues(promptFiles.byEpisode, "提示词", dir));
				issues.push(...duplicateIssues(manifestFiles.byEpisode, "清单", dir));
				issues.push(...duplicateIssues(annotationFiles.byEpisode, "批注", dir));
				const all = new Set([
					...scriptEpisodes,
					...promptFiles.byEpisode.keys(),
					...manifestFiles.byEpisode.keys(),
					...annotationFiles.byEpisode.keys()
				]);
				const episodes = [];
				for (const episode of [...all].sort((a, b) => a - b)) {
					const hasScript = scriptFiles.byEpisode.has(episode);
					const hasPrompt = promptFiles.byEpisode.has(episode);
					const hasManifest = manifestFiles.byEpisode.has(episode);
					const hasAnnotations = annotationFiles.byEpisode.has(episode);
					if (!hasScript) issues.push(`${dir} 第 ${episode} 集：缺剧本文件（${scriptPath(episode)}）`);
					if (!hasPrompt) issues.push(`${dir} 第 ${episode} 集：缺提示词文件（${promptPath(dir, episode)}）`);
					if (!hasManifest) issues.push(`${dir} 第 ${episode} 集：缺清单文件（${manifestPath(dir, episode)}）`);
					episodes.push({
						episode,
						hasScript,
						hasPrompt,
						hasManifest,
						hasAnnotations
					});
				}
				versions.push({
					version,
					dir,
					episodes,
					hasChangelog: versionRoot?.files.includes(CHANGELOG_FILE) === true
				});
			}
			return {
				phase: "ready",
				scriptEpisodes,
				versions,
				issues,
				error: ""
			};
		}
		//#endregion
		//#region src/client/data.ts
		/**
		* 数据 hook：`对照工作台 → 版本/集 → 一集的清单+提示词 → 块 → 批注`。
		*
		* ⚠️ 与 `dsh-novel-script` 的 data.ts **刻意同构、方向相反**（见 workspace.ts 顶上那段）：
		*    那边是"原文（锚点）+ 每版的剧本（作业）"，这边是"剧本（锚点）+ 每版的提示词（作业）"。
		*    所以这里读的是 `剧本/第N集剧本.txt`（**不随版本变**）和
		*    `vN/提示词/第N集提示词.txt`；**不要**再去找 `小说原文.txt`，
		*    也**不要**把剧本塞进版本目录。
		*
		* 界面**按清单切块**（清单里的 `blocks`）：没有"段落"这个概念，
		* 也**不算覆盖范围/覆盖率**（那些明确不做）。
		*
		* 全部只做机械的事：读文件、解析、按清单把提示词正文切成块。
		* 任何读不到 / 读不懂的地方都变成**界面上看得见的错误**，不猜、不降级。
		*/
		const messageOf = (error) => error instanceof Error ? error.message : String(error);
		/**
		* 一条校验问题 → 界面上的一行字。
		*
		* ⚠️ `BlocksState.issues` / `AnnotationsState.issues` 的契约是 `string[]`，
		*    所以在这里就拼成给人看的句子。`warn` 加「提醒」两个字 ——
		*    不然界面上分不出"这文件根本不能用"和"能用但缺东西"，
		*    两种都得说，但不能长得一样。
		*/
		const formatIssue = (issue) => issue.level === "error" ? `${issue.where}：${issue.message}` : `${issue.where}（提醒）：${issue.message}`;
		/**
		* 把宿主返回的批注**统一成新格式**。
		*
		* ⚠️ 为什么需要（2026-09-14 踩过）：批注格式从扁平的 `paragraph`/`quote`
		*    改成了 `regions` 数组。**宿主半边要重启服务才会更新**，所以会出现
		*    "新客户端 + 老宿主"：老宿主返回老格式，客户端直接读 `a.regions[0]`
		*    就抛异常 —— 整个工作台组件崩掉，**浮窗什么都画不出来**。
		*    这里统一过一遍 `parseAnnotations`（它本来就兼容两种格式），
		*    顺带把坏数据挡在外面，不让一条脏数据把界面搞崩。
		*
		* 注意：这里**只返回能用的批注**，解析时发现的问题被丢掉了。
		* 要在界面上把问题说出来（`AnnotationsState.issues`），得走 `useAnnotations`，
		* 它自己再过一遍 `parseAnnotations` 把 issues 取出来。
		*/
		function toAnnotations(value) {
			return parseAnnotations(value).annotations ?? [];
		}
		function useWorkbench(files, sessionId) {
			const [scan, setScan] = (0, react.useState)(EMPTY_SCAN);
			const [phase, setPhase] = (0, react.useState)("idle");
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (files === void 0 || sessionId === void 0 || sessionId === "") {
					setPhase("idle");
					setScan(EMPTY_SCAN);
					return;
				}
				const ac = new AbortController();
				setPhase("loading");
				scanWorkbench(files, sessionId, ac.signal).then((result) => {
					if (ac.signal.aborted) return;
					setScan(result);
					setPhase("ready");
				}).catch((err) => {
					if (ac.signal.aborted) return;
					setScan({
						...EMPTY_SCAN,
						phase: "error",
						error: messageOf(err)
					});
					setPhase("error");
				});
				return () => {
					ac.abort();
				};
			}, [
				files,
				sessionId,
				nonce
			]);
			return {
				phase,
				scan,
				reload: (0, react.useCallback)(() => setNonce((n) => n + 1), [])
			};
		}
		const EMPTY_SCRIPT = {
			phase: "idle",
			lines: [],
			totalLines: 0,
			error: ""
		};
		/**
		* 读某一集的**剧本**（锚点侧，路径里**没有版本**）。
		*
		* ⚠️ 这是与剧本批注那边最容易搞混的一处：那边 `useNovel` 读的是全局一份的
		*    `小说原文.txt`，这边对应的是**每集一份**的 `剧本/第N集剧本.txt` ——
		*    全局的是"没有版本"，不是"没有集号"，所以参数里必须带 `episode`。
		*
		* `episode` 不是正整数（比如界面还没选集、传了 0）时按 `idle` 处理，
		* 不报错也不去读文件 —— 没选集不是错误。
		*/
		function useScript(files, sessionId, episode) {
			const [state, setState] = (0, react.useState)(EMPTY_SCRIPT);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (files === void 0 || sessionId === void 0 || sessionId === "" || !Number.isInteger(episode) || episode < 1) {
					setState(EMPTY_SCRIPT);
					return;
				}
				let alive = true;
				const ac = new AbortController();
				const rel = scriptPath(episode);
				setState({
					...EMPTY_SCRIPT,
					phase: "loading"
				});
				tryReadText(files, sessionId, rel, ac.signal).then((text) => {
					if (!alive) return;
					if (text === void 0) {
						setState({
							...EMPTY_SCRIPT,
							phase: "error",
							error: `读不到 ${rel} —— 这一集还没有剧本`
						});
						return;
					}
					const lines = splitLines(text);
					setState({
						phase: "ready",
						lines,
						totalLines: lines.length,
						error: ""
					});
				}).catch((err) => {
					if (!alive) return;
					setState({
						...EMPTY_SCRIPT,
						phase: "error",
						error: messageOf(err)
					});
				});
				return () => {
					alive = false;
					ac.abort();
				};
			}, [
				files,
				sessionId,
				episode,
				nonce
			]);
			const reload = (0, react.useCallback)(() => setNonce((n) => n + 1), []);
			return {
				...state,
				reload
			};
		}
		const EMPTY_BLOCKS = {
			phase: "idle",
			blocks: [],
			issues: [],
			error: ""
		};
		/**
		* 读某一版某一集的**清单 + 提示词**，按清单把提示词切成块。
		*
		* 剧本（锚点）**不在这里读** —— 块只带 `scriptRanges`（行号），
		* 剧本正文由 `useScript` 单独给界面，两边各读各的、互不拖累。
		*/
		function useBlocks(files, sessionId, version, episode) {
			const [state, setState] = (0, react.useState)(EMPTY_BLOCKS);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (files === void 0 || sessionId === void 0 || sessionId === "" || version === "" || !Number.isInteger(episode) || episode < 1) {
					setState(EMPTY_BLOCKS);
					return;
				}
				let alive = true;
				const ac = new AbortController();
				setState({
					...EMPTY_BLOCKS,
					phase: "loading"
				});
				(async () => {
					const manifestRel = manifestPath(version, episode);
					const promptRel = promptPath(version, episode);
					const manifestText = await tryReadText(files, sessionId, manifestRel, ac.signal);
					if (manifestText === void 0) {
						if (alive) setState({
							...EMPTY_BLOCKS,
							phase: "error",
							error: `缺清单文件：${manifestRel}`
						});
						return;
					}
					let raw;
					try {
						raw = JSON.parse(manifestText);
					} catch (error) {
						if (alive) setState({
							...EMPTY_BLOCKS,
							phase: "error",
							error: `${manifestRel} 不是合法 JSON：${messageOf(error)}`
						});
						return;
					}
					const parsed = parseEpisodeManifest(raw);
					if (parsed.manifest === null) {
						const detail = parsed.issues.map(formatIssue).join("；");
						if (alive) setState({
							...EMPTY_BLOCKS,
							phase: "error",
							error: `${manifestRel} 读不懂 —— ${detail}`
						});
						return;
					}
					const promptText = await tryReadText(files, sessionId, promptRel, ac.signal);
					if (promptText === void 0) {
						if (alive) setState({
							...EMPTY_BLOCKS,
							phase: "error",
							error: `缺提示词文件：${promptRel}`
						});
						return;
					}
					const lines = splitLines(promptText);
					const blocks = parsed.manifest.blocks.map((block, i) => {
						const [start, end] = block.promptLines;
						const body = start >= 1 && end >= start ? lines.slice(start - 1, end) : [];
						const promptLines = [start, end];
						return {
							index: i + 1,
							anchor: block.anchor,
							promptLines,
							scriptRanges: block.scriptRanges,
							text: body.join("\n"),
							lines: body
						};
					});
					if (!alive) return;
					setState({
						phase: "ready",
						blocks,
						issues: parsed.issues.map(formatIssue),
						error: ""
					});
				})().catch((err) => {
					if (!alive) return;
					setState({
						...EMPTY_BLOCKS,
						phase: "error",
						error: messageOf(err)
					});
				});
				return () => {
					alive = false;
					ac.abort();
				};
			}, [
				files,
				sessionId,
				version,
				episode,
				nonce
			]);
			const reload = (0, react.useCallback)(() => setNonce((n) => n + 1), []);
			return {
				...state,
				reload
			};
		}
		function useAnnotations(sessionId, version, episode) {
			const [phase, setPhase] = (0, react.useState)("idle");
			const [annotations, setAnnotations] = (0, react.useState)([]);
			const [issues, setIssues] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (sessionId === void 0 || sessionId === "" || version === "" || !Number.isInteger(episode) || episode < 1) {
					setPhase("idle");
					setAnnotations([]);
					setIssues([]);
					return;
				}
				let alive = true;
				setPhase("loading");
				setError("");
				loadAnnotations(sessionId, version, episode).then((result) => {
					if (!alive) return;
					if (!result.ok) {
						setAnnotations([]);
						setIssues([]);
						setError(result.error);
						setPhase("error");
						return;
					}
					const parsed = parseAnnotations(result.annotations);
					setAnnotations(parsed.annotations ?? []);
					setIssues(parsed.issues.map(formatIssue));
					setPhase("ready");
				}).catch((err) => {
					if (!alive) return;
					setAnnotations([]);
					setIssues([]);
					setError(messageOf(err));
					setPhase("error");
				});
				return () => {
					alive = false;
				};
			}, [
				sessionId,
				version,
				episode,
				nonce
			]);
			return {
				phase,
				annotations,
				issues,
				error,
				saving,
				reload: (0, react.useCallback)(() => setNonce((n) => n + 1), []),
				save: (0, react.useCallback)(async (next) => {
					if (sessionId === void 0 || sessionId === "" || version === "" || !Number.isInteger(episode) || episode < 1) {
						setError("还没有可用的会话 / 集，存不了批注");
						return false;
					}
					setSaving(true);
					try {
						const result = await saveAnnotations(sessionId, version, episode, next);
						if (!result.ok) {
							setError(result.error);
							return false;
						}
						const parsed = parseAnnotations(result.annotations);
						setAnnotations(parsed.annotations ?? []);
						setIssues(parsed.issues.map(formatIssue));
						setError("");
						setPhase("ready");
						return true;
					} catch (err) {
						setError(messageOf(err));
						return false;
					} finally {
						setSaving(false);
					}
				}, [
					sessionId,
					version,
					episode
				])
			};
		}
		//#endregion
		//#region src/client/geometry.ts
		/**
		* 工作台窗口的「几何」—— 位置、尺寸、三种模式，全部收在这一个 hook 里。
		*
		* 为什么单独抽出来：这块逻辑前后被改坏了六七次，根因是**状态分散**——
		* 位置 / 宽 / 高 / 是否最小化 / 胶囊位置各是一个 state，每个都能独立为 null，
		* 于是出现「有位置没宽高」「mode 已切但几何还是旧的」这类半初始化组合。
		* 收成一个对象 + 明确 mode 之后，任何时刻只有一套完整几何。
		*
		* ── 三条硬规则（都是踩出来的，别违反）──────────────────────────────────
		*
		*  1. **这个元素上永远不写 `transform`**。
		*     DSH 把浮层挂在视口上，元素一旦带 transform，位置和尺寸的读数都会把
		*     变换算进去，同时可能和宿主的行为叠加。表现是「窗口被压小、位置偏移、
		*     读数还对不上」——排查时极具误导性。
		*     所以：移动用 left/top，缩放用 width/height，定位一律不靠 transform。
		*
		*  2. **尺寸永不超出视口**。
		*     把宽度推到接近或超过视口时，观察到的实际渲染尺寸会明显小于设定值
		*     （人家测到过 1180 被渲染成 531）。宁可在设计上留白，也不去踩那条线。
		*
		*  3. **模式切换不改变 `geom`**（除了 max 记录/恢复）。
		*     这样「缩小再展开」必然回到原样，不需要「记住再恢复」那套易错的逻辑。
		*/
		/** 侧栏宽度：把候选选择器都量一遍取最宽的那个（官方侧栏可收起，56 或更宽）。 */
		function measureSidebar() {
			let sideW = 0;
			for (const sel of [
				"[data-sidebar]",
				"aside",
				"nav",
				"[class*=\"sidebar\" i]"
			]) for (const el of Array.from(document.querySelectorAll(sel))) {
				const r = el.getBoundingClientRect();
				if (r.height > 200 && r.left < 4 && r.width > sideW && r.width < 520) sideW = r.width;
			}
			return sideW > 40 ? sideW : 56;
		}
		/**
		* 默认几何：**对齐官方对话区**。
		*
		* 不要靠猜留白（那会变成「8px 到底多宽」这种没法沟通的事），而是：
		*  · 左边界 = 侧栏右边缘 + 12（官方对话也从这一带开始）
		*  · 宽度   = 官方对话的**内容宽**，直接读 DSH 发布的 CSS 变量
		*             `--dsh-chat-content-width`（定义在 ui-conversation 的
		*             ConversationRoot.module.css，公式 clamp(680, 对话列宽×0.64, 920)）
		*    读不到就退回「可用空间 - 一点留白」。
		*
		* 这样工作台看起来就和对话区**一样宽**，主人不用再去量像素。
		* 同时**永不超出视口**（超出会触发宿主的适配行为，见本文件开头的规则 2）。
		*/
		function defaultGeom() {
			const x = measureSidebar() + 12;
			const y = 56;
			const availW = window.innerWidth - x - 16;
			const availH = window.innerHeight - y - 16;
			let w = availW;
			const published = getComputedStyle(document.body).getPropertyValue("--dsh-chat-content-width").trim();
			if (published !== "") {
				const probe = document.createElement("div");
				probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${published}`;
				document.body.appendChild(probe);
				const measured = probe.getBoundingClientRect().width;
				probe.remove();
				if (measured > 200) w = measured;
			}
			return {
				x,
				y,
				w: Math.max(560, Math.min(w, availW)),
				h: Math.max(320, availH)
			};
		}
		/** 把值夹在 [lo, hi]。 */
		function clamp(v, lo, hi) {
			return Math.min(Math.max(v, lo), Math.max(lo, hi));
		}
		/**
		* 最小化胶囊的高度。
		*
		* ⚠️ 必须和 `Workbench.tsx` 里的 `PILL_H` 一致（那边写给元素的 style 用）：
		*    这里只用来把胶囊和「缩小」按钮垂直居中对齐，改一个忘了另一个会差几像素。
		* 2026-09-14：从 24 加到 36 —— 主人反馈原来"太小，有时候找不到"；
		* 36 也正好是样式里圆角 18 的两倍，是一枚完整的胶囊。
		*/
		const PILL_H = 36;
		function useWorkbenchGeometry() {
			const ref = (0, react.useRef)(null);
			const [mode, setMode] = (0, react.useState)("open");
			const [geom, setGeom] = (0, react.useState)(() => defaultGeom());
			/** max 之前的几何，供还原。 */
			const beforeMax = (0, react.useRef)(null);
			/** 收缩成胶囊前的尺寸（展开时用它，保证大小一致）。 */
			const beforeMin = (0, react.useRef)(null);
			const [minRight, setMinRight] = (0, react.useState)(null);
			const [minTop, setMinTop] = (0, react.useState)(null);
			const [pillPos, setPillPos] = (0, react.useState)(null);
			const touched = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const sync = () => {
					if (!touched.current) setGeom(defaultGeom());
				};
				sync();
				window.addEventListener("resize", sync);
				return () => window.removeEventListener("resize", sync);
			}, []);
			return {
				mode,
				geom,
				minRight,
				minTop,
				pillPos,
				toggleMin: (0, react.useCallback)((minBtn, pillEl) => {
					if (mode === "min") {
						const pill = pillEl?.getBoundingClientRect();
						const size = beforeMin.current ?? defaultGeom();
						setGeom(() => {
							if (pill === void 0) return size;
							return {
								x: clamp(Math.round(pill.right - size.w), 8, Math.max(8, window.innerWidth - size.w - 8)),
								y: clamp(Math.round(pill.top), 8, Math.max(8, window.innerHeight - size.h - 8)),
								w: size.w,
								h: size.h
							};
						});
						setMode("open");
						setMinRight(null);
						setMinTop(null);
						setPillPos(null);
						return;
					}
					beforeMin.current = mode === "open" ? geom : beforeMin.current ?? defaultGeom();
					const r = minBtn?.getBoundingClientRect();
					setMinRight(r === void 0 ? Math.max(12, window.innerWidth - 400) : Math.round(window.innerWidth - r.right));
					setMinTop(r === void 0 ? 56 : Math.round(r.top + r.height / 2 - PILL_H / 2));
					setPillPos(null);
					setMode("min");
				}, [mode, geom]),
				toggleMax: (0, react.useCallback)(() => {
					if (mode === "max") {
						setGeom(beforeMax.current ?? defaultGeom());
						touched.current = true;
						setMode("open");
						return;
					}
					beforeMax.current = geom;
					setGeom({
						x: 8,
						y: 8,
						w: window.innerWidth - 16,
						h: window.innerHeight - 16
					});
					setMinRight(null);
					setMinTop(null);
					setMode("max");
				}, [mode, geom]),
				beginDrag: (0, react.useCallback)((box, clientX, clientY, dragMode) => {
					const start = {
						x: box.left,
						y: box.top,
						w: box.width,
						h: box.height,
						px: clientX,
						py: clientY
					};
					touched.current = true;
					setMinRight(null);
					setMinTop(null);
					setMode("open");
					return {
						mode: dragMode,
						start,
						apply: (cx, cy) => {
							const dx = cx - start.px;
							const dy = cy - start.py;
							setGeom(() => {
								if (dragMode === "move") return {
									x: clamp(start.x + dx, 0, Math.max(0, window.innerWidth - start.w)),
									y: clamp(start.y + dy, 0, Math.max(0, window.innerHeight - start.h)),
									w: start.w,
									h: start.h
								};
								let w = start.w;
								let h = start.h;
								if (dragMode === "w" || dragMode === "corner") w = clamp(start.w + dx, 420, Math.max(420, window.innerWidth - start.x - 12));
								if (dragMode === "h" || dragMode === "corner") h = clamp(start.h + dy, 180, Math.max(180, window.innerHeight - start.y - 12));
								return {
									x: start.x,
									y: start.y,
									w,
									h
								};
							});
						},
						finish: () => {}
					};
				}, []),
				beginPillDrag: (0, react.useCallback)((box, clientX, clientY) => {
					const start = {
						x: box.left,
						y: box.top,
						w: box.width,
						h: box.height,
						px: clientX,
						py: clientY
					};
					touched.current = true;
					setMinRight(null);
					setMinTop(null);
					setPillPos({
						x: start.x,
						y: start.y
					});
					return {
						mode: "move",
						start,
						apply: (cx, cy) => {
							setPillPos({
								x: clamp(start.x + cx - start.px, 0, Math.max(0, window.innerWidth - start.w)),
								y: clamp(start.y + cy - start.py, 0, Math.max(0, window.innerHeight - start.h))
							});
						},
						finish: () => {}
					};
				}, []),
				ref
			};
		}
		//#endregion
		//#region src/client/Workbench.tsx
		/**
		* 提示词对照工作台（设计文档 `docs/执行设计-v1.md` §9）。
		*
		* 三栏：第 N 集剧本 / 本集提示词 / 批注。
		*
		* ⚠️ 和剧本批注（`dsh-novel-script`）的关系：**左右互换**。
		*    那边锚点是小说的行、作业区是剧本的段落；这边锚点是剧本的行（只读参考，
		*    一份，不随版本变）、作业区是提示词（随版本走，按清单切成一个个块）。
		*    所以：
		*      · 左边**不可划词、不可批注**，只做"高亮当前块引用的那几行"；
		*      · 划词和批注全在**中栏**，批注挂的是**块的位置序号**（不是正文里的 Block 号）。
		*
		* 这一版**不判断剧情内容**：块从哪里切、和剧本对不对得上，完全照清单里的
		* `promptLines` / `scriptRanges` 用；判断"对应得对不对"是人的事。
		*
		* 交互：
		*   · 悬停/点中栏某块 → 左栏高亮这一块 `scriptRanges` 覆盖的剧本行；
		*   · 悬停左栏某行 → 中栏高亮引用了这一行的块；
		*   · 在提示词里划词 → 批注框跟着选区浮出来（按住 Ctrl 可连选几处不连续的）；
		*   · 点批注卡上的「定位」→ 跳到那一块；
		*   · 清单与提示词对不上 / 文件缺失 → 顶部醒目地说出来，不猜。
		*
		* ⚠️ 没有的东西（设计文档 §2.2 明确不做，别手痒补回来）：
		*    覆盖竖条 / coverBar、漏拍统计、任何"剧本上下文"字段。
		*/
		/** 列宽约束：两侧最小 180，中间至少留 260。 */
		const MIN_SIDE = 180;
		const MIN_MID = 260;
		/** 浮动批注框的尺寸（用来把它夹进视口，免得贴边被切）。 */
		const POPUP_W = 320;
		const POPUP_H = 210;
		/**
		* 一处区域的显示名：`块 6` / `块 3–7`。
		*
		* ⚠️ 这里用的是**块的位置序号**（清单里的第几块，1 基），
		*    和提示词正文里 agent 自己写的 `Block N` 没有任何关系（设计文档 §4.3）。
		*/
		function regionLabel(region) {
			const to = region.endParagraph ?? region.paragraph;
			return to > region.paragraph ? `块 ${region.paragraph}–${to}` : `块 ${region.paragraph}`;
		}
		/** 把几处区域摊平成块序号（去重、升序）—— 高亮和跳转都用它。 */
		function blocksOfRegions(regions) {
			const out = /* @__PURE__ */ new Set();
			for (const region of regions) {
				const to = region.endParagraph ?? region.paragraph;
				for (let index = region.paragraph; index <= to; index += 1) out.add(index);
			}
			return [...out].sort((a, b) => a - b);
		}
		/** 一个块引用的剧本行。`scriptRanges` 为 null 就是**剧本里没有对应**（新增）。 */
		function scriptLinesOfBlock(block) {
			const out = [];
			for (const [a, b] of block.scriptRanges ?? []) for (let ln = a; ln <= b; ln += 1) out.push(ln);
			return out;
		}
		/** 一个块抬头右侧那枚小标：`→ 剧本 L12–L15` / `→ 剧本里没有对应`。 */
		function scriptLabelOf(block) {
			const ranges = block.scriptRanges;
			if (ranges === null || ranges.length === 0) return "→ 剧本里没有对应";
			return `→ 剧本 ${ranges.map((r) => `L${r[0]}–L${r[1]}`).join("、")}`;
		}
		/**
		* 这一块的 anchor 在提示词里**唯一命中**了没有（设计文档 §11）。
		*
		* ⚠️ 为什么必须按 anchor 判、而不是看"切出来的正文空不空"：
		*    清单里的 `promptLines` 是工具算的、程序直接信；界面能做的机械校验只有
		*    "首行在文件里能不能唯一命中"。找不到 / 命中多处的块，界面上只说这一块
		*    「清单与文件对不上」，**其余块照常渲染**（不崩、不空白）。
		*
		* 判据只有一条：**清单说的那一行，内容是不是它自己的 anchor**。
		*
		* ⚠️ 2026-09-14 连着踩了两次，两条都记下来了：
		*   ① 早先的实现是"把各块的行按行号拼回文件，再用 locateAnchor 找 anchor" —— 每块的首行
		*      拼回去永远等于它自己的 anchor，所以**永远通过**，这条界面提示等于死的。
		*   ② 补上之后又加了第二条"anchor 必须在全文件里唯一" —— **太严**：提示词块的首行常常是
		*      `场景：@某地_某时` 这种内容行，**连续的几块常在同一场景里，首行天然重复**。
		*      实测另一个工作区的第 1 集：9 块里 8 块的 anchor 重复出现（`场景：@火车站公厕外_夜`
		*      出现 3 次、`…_深夜` 出现 5 次），界面于是整片报"对不上"，而清单其实是**完全自洽**的。
		*      **唯一性只对"按 anchor 搜索"（`write_manifest`）是必需的；界面手上有准确行号，
		*      渲染根本不需要它。**
		*
		* 所以这里只比一行，不重建文件、不要求唯一 —— 判据越少越不会误报。
		*/
		function blocksMissingAnchor(blocks) {
			const out = /* @__PURE__ */ new Set();
			for (const block of blocks) if (block.lines[0] !== block.anchor) out.add(block.index);
			return out;
		}
		/**
		* 把滚动容器里的目标滚到可视区**偏上**的位置 —— 上方留一点上下文，不贴顶、也不居中。
		*
		* ⚠️ 主人 2026-09-14 连着纠了两次：
		*    ① 原来用 `scrollIntoView({ block: 'center' })`，目标被推到**中间** —— 上面空一大片、
		*       下面几行反而被切掉；
		*    ② 改成"贴顶"也不合适 —— 想看到目标**上面两行左右**的内容（对照时那两行常常正是上下文）。
		*
		* 留白口径统一成"**目标上方留 N 行**"：N × 目标元素的**计算行高**。
		*   · 左栏剧本行是单行元素，行高就是它的高度；
		*   · 中栏提示词块是个很高的容器，但它的 `line-height` 仍是正文字号的行高 ——
		*     所以同一个 `offsetLines: 2` 在两边都得到"上面留两行"的观感，而不是"按块高折算半个屏幕"。
		*   · `lineHeight` 拿不到数字（`normal`）时退回元素自身高度，保证不会算出 NaN 把滚动搞飞。
		*
		* 用 **rect 差值**算，不用 `el.offsetTop`：`offsetTop` 是相对**最近的定位祖先**的，
		* 而滚动容器并不保证是定位元素（当初为覆盖竖条加过 `position: relative`，后来删掉了）——
		* 那样算出来的偏移会悄悄差一大截，而且只在某些列宽下才看得出来。
		*
		* @param box - 滚动容器。
		* @param selector - 目标元素的 CSS 选择器（`[data-ln="12"]` / `[data-paragraph="3"]`）。
		* @param offsetLines - 目标上方留几行（默认 2）。
		*/
		function scrollTargetToTop(box, selector, offsetLines = 2) {
			const el = box?.querySelector(selector);
			if (box === null || el === null || el === void 0) return;
			const rect = el.getBoundingClientRect();
			const delta = rect.top - box.getBoundingClientRect().top;
			const parsed = Number.parseFloat(window.getComputedStyle(el).lineHeight);
			const lineHeight = Number.isFinite(parsed) && parsed > 0 ? parsed : rect.height;
			box.scrollTo({
				top: box.scrollTop + delta - lineHeight * offsetLines,
				behavior: "smooth"
			});
		}
		/**
		* 未登记时给主人复制的那句话。
		*
		* 写得具体是因为 agent 需要知道**完整流程**：建目录、拷剧本（字节复制）、
		* 一集一集调工具、先跑第 1 集。
		*
		* ⚠️ 两个工具的分工别写错：正文与清单是**一次生成**的
		*    （`prompt_compare_write_episode` 同时写 `提示词/` 与 `清单/` 两个文件），
		*    `prompt_compare_write_manifest` 是"只重算/重写清单"时用的补刀工具。
		*/
		const REGISTER_PROMPT = [
			"请把这个工作区建成「提示词对照工作台」。步骤：",
			"",
			"1. 在工作区根目录下建 `对照工作台/` 文件夹，里面再建 `剧本/`。",
			"2. 把剧本稿**拷贝**一份（用 Copy-Item，字节复制，不要用 Get-Content/Set-Content）",
			"   到 `对照工作台/剧本/第1集剧本.txt`（一集一个文件，集号用阿拉伯数字）。",
			"   用户原始的稿子一个字都不要动。",
			"3. 提示词按版本放：`对照工作台/v1/提示词/第1集提示词.txt`。",
			"   自己先把提示词写出来放进去（这一版就是 v1，目录名就写 v1）。",
			"4. 逐集登记：把提示词正文按\"块\"切开，每块判断它对应剧本的哪几行，",
			"   然后用 prompt_compare_write_episode 工具提交（一次一集）。",
			"   · 块 = 可独立高亮和批注的一段文字，内部可以多行，但**不能有空白行**；",
			"   · 剧本里没有对应的块，scriptRanges 写 null（比如新增的过场、空镜提示）；",
			"   · 只给\"每块首行 + 对应剧本行号\"，**不要逐字复述正文** —— 行号由工具算；",
			"   · 工具一次写出 `v1/提示词/第1集提示词.txt` 与 `v1/清单/第1集清单.txt` 两个文件，",
			"     不要自己手写这两个文件（行号、块编号、文件生成都由工具负责）；",
			"   · 只想重算某一集的清单时，用 prompt_compare_write_manifest。",
			"5. **先只做第 1 集**，让我在工作台看一眼，确认没问题再继续第 2 集，然后才是剩下的。"
		].join("\n");
		/**
		* 一个块的正文。
		*
		* @param block - 这一块。
		* @param missing - 它的 anchor 在提示词里找不到（§11）。
		*
		* 两条规则：
		*   · `missing` → 正文位置只写一句「清单与文件对不上」，**其余块照常渲染**；
		*   · 否则**从第 2 行开始渲染**（`slice(1)`）：第 1 行就是抬头里当标签显示的那一行
		*     （`── Block 1 | 14s ──`），再渲染一遍就重复了（设计文档 §9.2）。
		*     那一行是结构标记，没人会去批注它，不进选区没有损失；划词仍覆盖这一块
		*     `promptLines` 里其余的全部正文（含块内空行）。
		*/
		function blockBody(block, missing) {
			if (missing) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "ns-para-bad",
				children: "（清单与文件对不上：找不到这一块）"
			});
			return block.lines.slice(1).map((line, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "ns-para-line",
				children: line
			}, i));
		}
		function Workbench({ files, sessionId, sessionSource }) {
			const wb = useWorkbench(files, sessionId);
			const scan = wb.scan;
			const [pickVersion, setPickVersion] = (0, react.useState)(null);
			const [pickEpisode, setPickEpisode] = (0, react.useState)(null);
			const version = (0, react.useMemo)(() => {
				const list = scan.versions;
				if (list.length === 0) return null;
				return list.find((v) => v.version === pickVersion) ?? list[list.length - 1] ?? null;
			}, [scan.versions, pickVersion]);
			/**
			* 集号来自**版本目录里的集**，那是**超集**（提示词 / 清单 / 批注三个目录 ∪ 剧本目录）。
			*
			* ⚠️ 所以会出现 `hasScript=true && hasPrompt=false` 的集：剧本切好了、提示词还没写。
			*    那不是错误，是**正常中间状态**，中栏要直说"这一版还没写提示词"，别把它当异常
			*    （这时 `useBlocks` 会说"缺提示词文件：…"，那句话太硬，见下面 middleEmpty 的处理）。
			*    实测两侧 35/35 一一对应（设计文档 §4），所以正常做完的版本不会出现这种集。
			*/
			const episode = (0, react.useMemo)(() => {
				const list = version?.episodes ?? [];
				if (list.length === 0) return null;
				return list.find((e) => e.episode === pickEpisode) ?? list[0] ?? null;
			}, [version, pickEpisode]);
			/** 上一集 / 下一集（主人要的两个按钮）。 */
			const episodeNav = (0, react.useMemo)(() => {
				const list = version?.episodes ?? [];
				const index = episode === null ? -1 : list.findIndex((e) => e.episode === episode.episode);
				return {
					prev: index > 0 ? list[index - 1] : void 0,
					next: index >= 0 && index < list.length - 1 ? list[index + 1] : void 0
				};
			}, [version, episode]);
			const ep = episode?.episode ?? 0;
			const vdir = version?.dir ?? "";
			const script = useScript(files, sessionId, ep);
			const blk = useBlocks(files, sessionId, vdir, ep);
			const anno = useAnnotations(sessionId, vdir, ep);
			/**
			* 这一集中栏为什么画不出块。
			*
			* ⚠️ **必须放在上面三个 hook 之后**：它读 `blk.error` / `ep` / `vdir`，而这三个都是
			*    `const` —— 写在前面就是 TDZ（运行时 "Cannot access 'blk' before initialization"），
			*    表现是整个工作台被错误边界接住、只剩一句话。2026-09-14 踩过一次。
			*
			* 优先级：**缺提示词文件**（超集里还没登记的集，属于正常中间状态）→ 其余按 hook 的话说。
			* 缺剧本文件的集不用特殊处理：`useScript` 的 `error` 里本来就带完整路径，左栏直接显示。
			*/
			const promptMissing = episode !== null && !episode.hasPrompt;
			const middleEmpty = promptMissing ? `这一版还没写这一集的提示词 —— 让 AI 把它放进 ${promptPath(vdir, ep)}` : blk.error || "读不到这一集提示词";
			const [annoScope, setAnnoScope] = (0, react.useState)("episode");
			const [allAnnotations, setAllAnnotations] = (0, react.useState)({});
			const [allError, setAllError] = (0, react.useState)("");
			const [allNonce, setAllNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (annoScope !== "all" || sessionId === void 0 || sessionId === "" || version == null) return;
				const dir = version.dir;
				const list = version.episodes;
				if (list.length === 0) return;
				let alive = true;
				setAllError("");
				Promise.all(list.map(async (item) => {
					const result = await loadAnnotations(sessionId, dir, item.episode);
					return [item.episode, result];
				})).then((pairs) => {
					if (!alive) return;
					const next = {};
					const errors = [];
					for (const [episodeNo, result] of pairs) if (result.ok) next[episodeNo] = toAnnotations(result.annotations);
					else errors.push(`第 ${episodeNo} 集：${result.error}`);
					setAllAnnotations(next);
					if (errors.length > 0) setAllError(errors.join("；"));
				}).catch((err) => {
					if (alive) setAllError(err instanceof Error ? err.message : String(err));
				});
				return () => {
					alive = false;
				};
			}, [
				annoScope,
				sessionId,
				version,
				allNonce
			]);
			/** "全部"模式下总共多少条。 */
			const allCount = (0, react.useMemo)(() => Object.values(allAnnotations).reduce((n, list) => n + list.length, 0), [allAnnotations]);
			const [hoverBlock, setHoverBlock] = (0, react.useState)(null);
			const [pinnedBlocks, setPinnedBlocks] = (0, react.useState)([]);
			const [hoverLine, setHoverLine] = (0, react.useState)(null);
			/** 按块号取块（点选/定位/高亮都要用）。 */
			const blockByIndex = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const block of blk.blocks) map.set(block.index, block);
				return map;
			}, [blk.blocks]);
			/** 清单里的 anchor 在提示词里找不到（或命中多处）的块 —— 只影响那一块的显示。 */
			const missingAnchor = (0, react.useMemo)(() => blocksMissingAnchor(blk.blocks), [blk.blocks]);
			/** 当前"正在看"的块：钉住优先，否则看悬停的那一块。 */
			const activeBlocks = (0, react.useMemo)(() => {
				if (pinnedBlocks.length > 0) return pinnedBlocks.map((index) => blockByIndex.get(index)).filter((b) => b !== void 0);
				if (hoverBlock === null) return [];
				const one = blockByIndex.get(hoverBlock);
				return one === void 0 ? [] : [one];
			}, [
				blockByIndex,
				pinnedBlocks,
				hoverBlock
			]);
			/** 钉住的块引用的剧本行（左栏要滚到哪儿、也要高亮这几行）。 */
			const pinnedLines = (0, react.useMemo)(() => {
				const out = /* @__PURE__ */ new Set();
				if (pinnedBlocks.length === 0) return out;
				for (const block of activeBlocks) for (const ln of scriptLinesOfBlock(block)) out.add(ln);
				return out;
			}, [activeBlocks, pinnedBlocks]);
			/** 悬停左栏某行 → 引用这一行的块（方向二）。 */
			const hoverBlockIndices = (0, react.useMemo)(() => {
				const out = /* @__PURE__ */ new Set();
				if (hoverLine === null) return out;
				for (const block of blk.blocks) {
					const [start, end] = block.promptLines;
					if (hoverLine >= start && hoverLine <= end) out.add(block.index);
				}
				return out;
			}, [blk.blocks, hoverLine]);
			/** 左栏要高亮的行：钉住某块时听钉住的，否则听悬停那一行的块。 */
			const highlightLines = (0, react.useMemo)(() => {
				const out = /* @__PURE__ */ new Set();
				if (pinnedLines.size > 0) {
					for (const ln of pinnedLines) out.add(ln);
					return out;
				}
				for (const block of activeBlocks) for (const ln of scriptLinesOfBlock(block)) out.add(ln);
				return out;
			}, [pinnedLines, activeBlocks]);
			const promptRef = (0, react.useRef)(null);
			const scriptRef = (0, react.useRef)(null);
			/** 批注框（跟着选区浮出来的那个）的 DOM，用来判断"点框外"。 */
			const popRef = (0, react.useRef)(null);
			/** 待写的批注：已经选了哪几处（Ctrl 累积）、批注框浮在哪儿、框是否已经弹出来。 */
			const [pending, setPending] = (0, react.useState)(null);
			const [problem, setProblem] = (0, react.useState)("");
			const [toast, setToast] = (0, react.useState)("");
			/**
			* 手动刷新 = 四个 hook 各重读一次（见下面那颗 ⟳ 按钮）。
			*
			* ⚠️ **四个都要调**：`useScript` / `useBlocks` 的依赖是
			* (files, sessionId, version, episode)，只看这些的话刷新时它们一个都没变 ——
			* 只调 `wb.reload()` 那两个**不会重读**（刷新等于没刷）。
			*
			* 曾经用"给三栏换 key 强制重挂"兜过一阵子，副作用是刷新会把选中的版本/集
			* 重置回默认；四个 hook 都有 reload 之后就不需要那种做法了。
			*/
			(0, react.useEffect)(() => {
				if (toast === "") return;
				const timer = window.setTimeout(() => setToast(""), 2600);
				return () => window.clearTimeout(timer);
			}, [toast]);
			/**
			* 松手后读选区。
			*
			* 三条规则（沿用剧本批注那边实测下来的结论）：
			*   · **不按 Ctrl**：这一划就是新的全部选择（替换掉之前选的），**立刻弹输入框**；
			*   · **按住 Ctrl/Cmd**：把这一处**并进去** —— 这就是"多选不连续的几个地方"；
			*   · 按住 Ctrl 连选期间**不弹输入框**：这段时间屏幕上**只有一个反馈**：
			*     被选中的块带一层更深的底色（`.ns-para-pending`），**松开 Ctrl 之后再弹框**
			*     （见下面的 keyup 效果）。
			*     ⚠️ 不要在选区旁边飘提示文字 —— 它就压在提示词上，会把接下来要划的那几行挡住。
			* 每一处都记成"块范围"（连续跨块算一处），因为一个块是"一行一块"还是
			* "多行一块"由 agent 决定（设计文档 §4.3）。
			*/
			const onPromptMouseUp = (0, react.useCallback)((e) => {
				const multi = e.ctrlKey || e.metaKey;
				const releaseX = e.clientX;
				const releaseY = e.clientY;
				window.setTimeout(() => {
					const selection = window.getSelection();
					if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
					const range = selection.getRangeAt(0);
					const container = promptRef.current;
					if (container === null || !container.contains(range.commonAncestorContainer)) return;
					const startEl = elementOf(range.startContainer, container);
					const endEl = elementOf(range.endContainer, container);
					if (startEl === null || endEl === null) return;
					const startNo = Number(startEl.dataset.paragraph);
					const endNo = Number(endEl.dataset.paragraph);
					if (!Number.isInteger(startNo) || !Number.isInteger(endNo) || startNo < 1 || endNo < 1) return;
					const paragraph = Math.min(startNo, endNo);
					const endParagraph = Math.max(startNo, endNo);
					const quote = selection.toString().trim();
					if (quote === "") return;
					const region = {
						paragraph,
						...endParagraph > paragraph ? { endParagraph } : {},
						quote
					};
					const x = Math.min(Math.max(8, releaseX), Math.max(8, window.innerWidth - POPUP_W - 12));
					const y = Math.min(Math.max(8, releaseY + 14), Math.max(8, window.innerHeight - POPUP_H - 12));
					setPending((prev) => {
						const list = multi && prev !== null ? [...prev.regions] : [];
						if (!list.some((r) => r.paragraph === region.paragraph && r.endParagraph === region.endParagraph && r.quote === region.quote)) list.push(region);
						return {
							regions: list,
							x,
							y,
							open: !multi
						};
					});
					setProblem("");
					if (multi) window.getSelection()?.removeAllRanges();
				}, 10);
			}, []);
			/**
			* Ctrl 连选期间那几处覆盖的块号。
			*
			* 为什么需要它：连选时输入框是**不弹**的，而选区又被 removeAllRanges 清掉了 ——
			* 屏幕上就没有任何"我到底选了哪几处"的反馈。所以给这些块单独加一层底色，
			* 这也是连选期间**唯一**的反馈（不再飘提示文字，见 onPromptMouseUp 的说明）。
			*/
			const pendingBlocks = (0, react.useMemo)(() => {
				const out = /* @__PURE__ */ new Set();
				if (pending === null) return out;
				for (const region of pending.regions) {
					const end = region.endParagraph ?? region.paragraph;
					for (let n = region.paragraph; n <= end; n += 1) out.add(n);
				}
				return out;
			}, [pending]);
			(0, react.useEffect)(() => {
				if (pending === null || pending.open) return;
				const openIt = () => setPending((prev) => prev === null || prev.open ? prev : {
					...prev,
					open: true
				});
				const onKeyUp = (e) => {
					if (e.key === "Control" || e.key === "Meta") openIt();
				};
				document.addEventListener("keyup", onKeyUp);
				window.addEventListener("blur", openIt);
				return () => {
					document.removeEventListener("keyup", onKeyUp);
					window.removeEventListener("blur", openIt);
				};
			}, [pending]);
			const closePending = (0, react.useCallback)(() => {
				setPending(null);
				setProblem("");
			}, []);
			const submitAnnotation = (0, react.useCallback)(() => {
				if (pending === null || pending.regions.length === 0) return;
				const text = problem.trim();
				if (text === "") {
					setToast("先写一下问题");
					return;
				}
				const created = makeAnnotation(nextAnnotationSeq(anno.annotations), pending.regions, text);
				anno.save([...anno.annotations, created]).then((ok) => {
					if (!ok) return;
					setPending(null);
					setProblem("");
					window.getSelection()?.removeAllRanges();
					setToast("批注已保存");
				});
			}, [
				anno,
				pending,
				problem
			]);
			(0, react.useEffect)(() => {
				if (pending === null) return;
				const open = pending.open;
				const onKey = (e) => {
					if (e.key === "Escape") closePending();
				};
				const onDown = (e) => {
					if (!open) return;
					const box = popRef.current;
					if (box !== null && e.target instanceof Node && box.contains(e.target)) return;
					if (e.target instanceof Element && e.target.closest(".ns-col-prompt") !== null) return;
					closePending();
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("mousedown", onDown);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("mousedown", onDown);
				};
			}, [pending, closePending]);
			/** 跨集跳转：先切集，等这一集的块读出来再滚过去。 */
			const [pendingJump, setPendingJump] = (0, react.useState)(null);
			/** 点批注卡 → 跳到它挂的那几块（中栏滚过去 + 左栏高亮）；跨集也能跳。 */
			const jumpToBlock = (0, react.useCallback)((episodeNo, regions) => {
				const targets = blocksOfRegions(regions);
				const first = targets[0];
				if (first === void 0) return;
				if (episode?.episode === episodeNo) {
					setPinnedBlocks(targets);
					requestAnimationFrame(() => {
						scrollTargetToTop(promptRef.current, `[data-paragraph="${first}"]`);
					});
					return;
				}
				setPickEpisode(episodeNo);
				setPendingJump(targets);
			}, [episode]);
			(0, react.useEffect)(() => {
				const first = pendingJump?.[0];
				if (pendingJump === null || first === void 0 || blk.phase !== "ready") return;
				setPinnedBlocks(pendingJump);
				setPendingJump(null);
				requestAnimationFrame(() => {
					scrollTargetToTop(promptRef.current, `[data-paragraph="${first}"]`);
				});
			}, [pendingJump, blk.phase]);
			/**
			* 选中提示词某几块 → 左栏剧本**自动滚到对应位置**。
			*
			* 只在**点选 / 定位**（`pinnedBlocks`）时滚；悬停不滚 ——
			* 鼠标扫过块时剧本跟着乱跳会很难读。
			*/
			(0, react.useEffect)(() => {
				if (pinnedBlocks.length === 0) return;
				let first = Number.POSITIVE_INFINITY;
				for (const index of pinnedBlocks) {
					const block = blockByIndex.get(index);
					if (block === void 0) continue;
					for (const [a] of block.scriptRanges ?? []) first = Math.min(first, a);
				}
				if (!Number.isFinite(first)) return;
				requestAnimationFrame(() => {
					scrollTargetToTop(scriptRef.current, `[data-ln="${first}"]`);
				});
			}, [pinnedBlocks, blockByIndex]);
			/**
			* 删除一条批注。
			*
			* 批注是**按集一个文件**存的，所以"全部"模式下要写回**它所属那一集**的文件，
			* 不能一股脑写当前集。
			*/
			const deleteOne = (0, react.useCallback)((episodeNo, id) => {
				if (episode?.episode === episodeNo) {
					anno.save(anno.annotations.filter((a) => a.id !== id)).then((ok) => {
						if (ok) setToast("批注已删除");
					});
					return;
				}
				const dir = version?.dir;
				if (sessionId === void 0 || sessionId === "" || dir === void 0) return;
				saveAnnotations(sessionId, dir, episodeNo, (allAnnotations[episodeNo] ?? []).filter((a) => a.id !== id)).then((result) => {
					if (result.ok) {
						setAllAnnotations((prev) => ({
							...prev,
							[episodeNo]: result.annotations
						}));
						setToast("批注已删除");
					} else setAllError(result.error);
				});
			}, [
				anno,
				allAnnotations,
				episode,
				version,
				sessionId
			]);
			/** 这一轮要下发的条目（按集模式只有当前集；全部模式是所有集）。 */
			const sendItems = (0, react.useMemo)(() => {
				if (annoScope === "episode") return episode === null ? [] : anno.annotations.map((a) => ({
					episode: episode.episode,
					a
				}));
				return Object.entries(allAnnotations).flatMap(([ep, list]) => list.map((a) => ({
					episode: Number(ep),
					a
				}))).sort((x, y) => x.episode - y.episode || (x.a.regions?.[0]?.paragraph ?? 0) - (y.a.regions?.[0]?.paragraph ?? 0));
			}, [
				annoScope,
				episode,
				anno.annotations,
				allAnnotations
			]);
			const sendCount = sendItems.length;
			/**
			* 下发这一批批注。
			*
			* ⚠️ 为什么是"复制到剪贴板"而不是直接写官方输入框：`shell.overlay` 这个席位
			* 拿不到 `inputActions`（只有 `conversation.*` 那些席位有），所以浮层里
			* 没法定向写官方输入框。主人粘一下即可（这是流程的下一步）。
			*
			* ⚠️ 批注格式与剧本批注**完全一致**：只有"块 + 引文 + 问题"，
			*    **不带任何剧本上下文** —— agent 需要剧本时自己按清单去找（设计文档 §2.2）。
			*/
			const sendBatch = (0, react.useCallback)(() => {
				if (sendItems.length === 0) return;
				const grouped = /* @__PURE__ */ new Map();
				for (const item of sendItems) {
					const list = grouped.get(item.episode) ?? [];
					list.push(item.a);
					grouped.set(item.episode, list);
				}
				const episodes = [...grouped.entries()].sort((x, y) => x[0] - y[0]);
				const where = annoScope === "all" ? `v${version?.version ?? "?"}（${episodes.length} 集）` : `v${version?.version ?? "?"} 第 ${episode?.episode ?? "?"} 集`;
				const body = [];
				for (const [episodeNo, list] of episodes) {
					body.push(`【第 ${episodeNo} 集】`);
					body.push(`清单：${manifestPath(version?.dir ?? "", episodeNo)}（里面是"块 → 剧本行号"的对应）`);
					body.push(`提示词：${promptPath(version?.dir ?? "", episodeNo)}`);
					body.push(`剧本（参考，不要改）：${scriptPath(episodeNo)}`);
					body.push("");
					for (const a of list) {
						const spans = (a.regions ?? []).map((r) => `${regionLabel(r)}「${r.quote.replaceAll("\n", " ")}」`).join("；");
						body.push(`· ${spans}——${a.problem}`);
					}
					body.push("");
				}
				const text = [
					`请按下面这批批注改提示词（${where}）：`,
					"",
					...body,
					"改完请出新版本：",
					"1. 用 Copy-Item -Recurse 把这一版目录整份复制成新版本；",
					"2. 删掉新版本里复制过来的批注文件（不是写成空数组）；",
					"3. 对改过的每一集重新调 prompt_compare_write_episode；",
					"4. 写新版本的 变更记录.txt；",
					"5. 最后把这一版批注文件里已处理的条目改成 done: true、resolvedIn 写新版本号。"
				].join("\n");
				navigator.clipboard?.writeText(text).then(() => setToast(`已复制 ${sendItems.length} 条批注的指令 —— 粘到对话里发给 AI 即可`), () => setToast("复制失败（浏览器拒绝剪贴板）"));
			}, [
				sendItems,
				annoScope,
				version,
				episode
			]);
			const geo = useWorkbenchGeometry();
			const wbRef = geo.ref;
			const minBtnRef = (0, react.useRef)(null);
			const isMin = geo.mode === "min";
			/** 收起成胶囊时的高度：原来 24 太小，找不到也点不着（主人反馈）。
			36 = 样式里圆角 18 的两倍，正好是一枚完整的胶囊。 */
			const PILL_H = 36;
			(0, react.useEffect)(() => {
				if (isMin) return;
				const onKey = (e) => {
					if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
					if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
					if (e.target?.closest("input, textarea, select, [contenteditable=\"true\"]") != null) return;
					if (pending !== null) return;
					const next = e.key === "ArrowLeft" ? episodeNav.prev : episodeNav.next;
					if (next === void 0) return;
					e.preventDefault();
					setPickEpisode(next.episode);
				};
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("keydown", onKey);
				};
			}, [
				episodeNav,
				pending,
				isMin
			]);
			const startDrag = (0, react.useCallback)((e, dragMode) => {
				const el = wbRef.current;
				if (el === null) return;
				const session = geo.beginDrag(el.getBoundingClientRect(), e.clientX, e.clientY, dragMode);
				document.body.classList.add(dragMode === "move" ? "ns-dragging" : "ns-resizing");
				const onMove = (ev) => session.apply(ev.clientX, ev.clientY);
				const onUp = () => {
					document.body.classList.remove("ns-dragging", "ns-resizing");
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
					session.finish();
				};
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
				e.preventDefault();
			}, [geo, wbRef]);
			const colsRef = (0, react.useRef)(null);
			const [srcW, setSrcW] = (0, react.useState)(300);
			const [annoW, setAnnoW] = (0, react.useState)(300);
			const startColDrag = (0, react.useCallback)((e, side) => {
				const startX = e.clientX;
				const startW = side === "src" ? srcW : annoW;
				const total = colsRef.current?.clientWidth ?? 0;
				const max = Math.max(MIN_SIDE, total - (side === "src" ? annoW : srcW) - MIN_MID - 22);
				document.body.classList.add("ns-colresizing");
				const onMove = (ev) => {
					const d = ev.clientX - startX;
					const next = Math.min(Math.max(MIN_SIDE, startW + (side === "src" ? d : -d)), max);
					if (side === "src") setSrcW(next);
					else setAnnoW(next);
				};
				const onUp = () => {
					document.body.classList.remove("ns-colresizing");
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
				};
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
			}, [srcW, annoW]);
			const wbStyle = isMin ? {
				...geo.pillPos === null ? {
					right: geo.minRight ?? 12,
					top: geo.minTop ?? 56,
					width: "auto"
				} : {
					left: geo.pillPos.x,
					top: geo.pillPos.y,
					width: "auto"
				},
				height: PILL_H
			} : {
				left: geo.geom.x,
				top: geo.geom.y,
				width: geo.geom.w,
				height: geo.geom.h
			};
			const notices = [];
			if (scan.phase === "error" && scan.error !== "") notices.push(`扫描出错：${scan.error}`);
			notices.push(...scan.issues);
			if (script.error !== "") notices.push(script.error);
			if (blk.error !== "" && !promptMissing) notices.push(blk.error);
			notices.push(...blk.issues);
			if (anno.error !== "") notices.push(`批注：${anno.error}`);
			notices.push(...anno.issues);
			if (sessionSource === "fallback") notices.push("当前没有选中会话，借用的是工作区里的另一个会话；想更准请切到提示词所在工作区的会话。");
			const episodeLabel = episode === null ? "—" : `${episode.episode}`;
			const versionLabel = version === null ? "—" : `v${version.version}`;
			/**
			* 一张批注卡。
			*
			* @param a - 批注内容（块范围从 `regions` 里取）。
			* @param episodeNo - 给了就显示"第 N 集"（"全部"模式用），并据此定位 / 删除。
			*/
			const annotationCard = (a, episodeNo) => {
				const episodeOfCard = episodeNo ?? episode?.episode ?? 0;
				const regions = a.regions ?? [];
				const first = regions[0];
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `ns-acard${a.done ? " ns-acard-done" : ""}`,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ns-acard-r1",
							children: [
								episodeNo === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "ns-tag",
									children: [
										"第 ",
										episodeNo,
										" 集"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ns-tag",
									children: first === void 0 ? "（没有区域）" : regionLabel(first)
								}),
								regions.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "ns-tag",
									children: [
										"共 ",
										regions.length,
										" 处"
									]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `ns-tag${a.done ? " ns-tag-done" : ""}`,
									children: a.done ? `已处理${a.resolvedIn === null ? "" : ` · ${a.resolvedIn}`}` : "未处理"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-x",
									title: episodeNo === void 0 ? "定位到这些地方" : `定位到第 ${episodeNo} 集`,
									onClick: () => jumpToBlock(episodeOfCard, a.regions),
									children: "◎"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-x",
									title: "删除这条批注",
									onClick: () => deleteOne(episodeOfCard, a.id),
									children: "✕"
								})
							]
						}),
						regions.map((region, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ns-acard-q",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ns-acard-ln",
									children: regionLabel(region)
								}),
								"“",
								region.quote.length > 60 ? `${region.quote.slice(0, 60)}…` : region.quote,
								"”"
							]
						}, `${region.paragraph}-${index}`)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ns-why",
							children: a.problem
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ns-ameta",
							children: a.id
						})
					]
				}, a.id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `ns-workbench${isMin ? " ns-min" : ""}`,
				ref: wbRef,
				style: wbStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-wb-hd",
						onMouseDown: (e) => {
							if (e.target.closest("button, select, input, textarea, a, [contenteditable=\"true\"]")) return;
							const el = wbRef.current;
							if (el === null) return;
							if (isMin) {
								const session = geo.beginPillDrag(el.getBoundingClientRect(), e.clientX, e.clientY);
								const down = {
									x: e.clientX,
									y: e.clientY
								};
								let moved = false;
								const onMove = (ev) => {
									if (!moved && Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y) > 4) moved = true;
									if (moved) session.apply(ev.clientX, ev.clientY);
								};
								const onUp = () => {
									document.removeEventListener("mousemove", onMove);
									document.removeEventListener("mouseup", onUp);
								};
								document.addEventListener("mousemove", onMove);
								document.addEventListener("mouseup", onUp);
								e.preventDefault();
								return;
							}
							if (geo.mode === "max") return;
							startDrag(e, "move");
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-grip",
								"aria-hidden": true,
								children: "⋮⋮"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-t",
								children: "提示词对照"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-meta",
								children: scan.phase === "missing" ? "这个工作区还没登记" : `${versionLabel} · 第 ${episodeLabel} 集`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
							!isMin && scan.versions.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-x",
									title: "上一集（←）",
									disabled: episodeNav.prev === void 0,
									onClick: () => {
										if (episodeNav.prev !== void 0) setPickEpisode(episodeNav.prev.episode);
									},
									children: "◀"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-x",
									title: "下一集（→）",
									disabled: episodeNav.next === void 0,
									onClick: () => {
										if (episodeNav.next !== void 0) setPickEpisode(episodeNav.next.episode);
									},
									children: "▶"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "ns-sel",
									title: "选版本",
									value: version?.version ?? "",
									onChange: (e) => {
										setPickVersion(e.target.value);
										setPickEpisode(null);
									},
									children: scan.versions.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: v.version,
										children: [
											"v",
											v.version,
											"（",
											v.episodes.length,
											" 集）"
										]
									}, v.version))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "ns-sel",
									title: "选集",
									value: episode === null ? "" : String(episode.episode),
									onChange: (e) => setPickEpisode(Number(e.target.value)),
									disabled: (version?.episodes.length ?? 0) === 0,
									children: (version?.episodes ?? []).map((x) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: String(x.episode),
										children: [
											"第 ",
											x.episode,
											" 集"
										]
									}, x.episode))
								})
							] }) : null,
							!isMin ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ns-x",
								title: "刷新（重读工作台目录、清单、剧本与批注）",
								onClick: () => {
									wb.reload();
									script.reload();
									blk.reload();
									anno.reload();
								},
								children: "⟳"
							}) : null,
							!isMin ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ns-x",
								title: geo.mode === "max" ? "还原为默认大小" : "放大（占满整个界面）",
								onClick: geo.toggleMax,
								children: geo.mode === "max" ? "⤡" : "⛶"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								ref: minBtnRef,
								type: "button",
								className: "ns-x",
								title: isMin ? "展开工作台" : "收起成一枚小胶囊",
								onClick: () => geo.toggleMin(minBtnRef.current),
								children: isMin ? "▣" : "—"
							})
						]
					}),
					!isMin ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ns-rs ns-rs-r",
							title: "拖动调整宽度",
							onMouseDown: (e) => startDrag(e, "w")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ns-rs ns-rs-b",
							title: "拖动调整高度",
							onMouseDown: (e) => startDrag(e, "h")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ns-rs ns-rs-br",
							title: "拖动调整大小",
							onMouseDown: (e) => startDrag(e, "corner")
						})
					] }) : null,
					!isMin && notices.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-issues ns-issues-err",
						title: notices.join("\n"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "ns-issues-t",
								children: [
									"有问题 ",
									notices.length,
									" 条"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-issues-m",
								children: notices[0]
							}),
							notices.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-issues-n",
								children: "悬停看全部"
							}) : null
						]
					}) : null,
					!isMin && scan.phase === "missing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-onboard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ns-onboard-t",
								children: "这个工作区还没登记"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-page-d",
								children: [
									"工作台只读 ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: "对照工作台/" }),
									" 这个固定目录，它自己不认识文件、也不解析剧本格式。 把下面这段话发给对话里的 AI，它建好目录、放好剧本与提示词、一集一集登记完， 这里就会出现剧本与提示词的对照。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: "ns-copy",
								children: REGISTER_PROMPT
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-onboard-act",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-btn ns-btn-primary",
									onClick: () => {
										navigator.clipboard?.writeText(REGISTER_PROMPT).then(() => setToast("已复制 —— 粘到对话里发给 AI 即可"), () => setToast("复制失败（浏览器拒绝剪贴板）"));
									},
									children: "复制这段话"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-btn",
									onClick: () => wb.reload(),
									children: "我已经建好了，重新扫描"
								})]
							})
						]
					}) : null,
					!isMin && scan.phase === "empty" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-onboard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ns-onboard-t",
								children: "对照工作台里还没有版本"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-page-d",
								children: [
									"目录建好了，但里面还没有 ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: "v1/" }),
									"。让 AI 把第 1 集的提示词与清单登记进来 （它要用 prompt_compare_write_episode 工具，一次写出提示词与清单两个文件）。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ns-onboard-act",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-btn",
									onClick: () => wb.reload(),
									children: "重新扫描"
								})
							})
						]
					}) : null,
					!isMin && scan.phase === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-wb-cols",
						ref: colsRef,
						onMouseUp: onPromptMouseUp,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-col ns-col-src",
								style: { width: srcW },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ns-col-hd",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "剧本" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "ns-sub",
											children: [script.phase === "ready" ? `${script.totalLines} 行` : script.phase === "loading" ? "读取中…" : "—", " · 只读参考"]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ns-col-bd",
									ref: scriptRef,
									children: script.phase !== "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "ns-empty",
										children: script.phase === "loading" ? "正在读取这一集剧本…" : script.error || "读不到这一集剧本"
									}) : script.lines.map((text, index) => {
										const ln = index + 1;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											"data-ln": ln,
											className: `ns-sline${highlightLines.has(ln) ? " ns-hl" : ""}`,
											onMouseEnter: () => setHoverLine(ln),
											onMouseLeave: () => setHoverLine((prev) => prev === ln ? null : prev),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-ln",
												children: ln
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-stx",
												children: text
											})]
										}, ln);
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ns-split",
								onMouseDown: (e) => startColDrag(e, "src"),
								title: "拖动调整宽度"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-col ns-col-prompt",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ns-col-hd",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											"提示词 · 第 ",
											episodeLabel,
											" 集 · ",
											versionLabel
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ns-sub",
											children: blk.phase === "ready" ? `${blk.blocks.length} 块` : blk.phase === "loading" ? "读取中…" : "—"
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ns-col-bd",
									ref: promptRef,
									children: blk.phase !== "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "ns-empty",
										children: blk.phase === "loading" ? "正在读取这一集提示词…" : middleEmpty
									}) : blk.blocks.map((block) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										"data-paragraph": block.index,
										className: `ns-para${pinnedBlocks.includes(block.index) ? " ns-para-pinned" : ""}${pendingBlocks.has(block.index) ? " ns-para-pending" : ""}${hoverBlockIndices.has(block.index) ? " ns-para-hover" : ""}`,
										onMouseEnter: () => setHoverBlock(block.index),
										onMouseLeave: () => setHoverBlock((prev) => prev === block.index ? null : prev),
										onClick: () => setPinnedBlocks((prev) => prev.length === 1 && prev[0] === block.index ? [] : [block.index]),
										title: block.scriptRanges === null ? "剧本里没有对应（新增）" : `对应剧本 ${block.scriptRanges.map((r) => `L${r[0]}–L${r[1]}`).join("、")}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "ns-blk-hd",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "ns-blk-no",
													children: ["块 ", block.index]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "ns-blk-anchor",
													title: block.anchor,
													children: block.anchor
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `ns-para-src${block.scriptRanges === null ? " ns-para-new" : ""}`,
													children: scriptLabelOf(block)
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ns-para-tx",
											children: blockBody(block, missingAnchor.has(block.index))
										})]
									}, block.index))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ns-split",
								onMouseDown: (e) => startColDrag(e, "anno"),
								title: "拖动调整宽度"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-col ns-col-anno",
								style: { width: annoW },
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "ns-col-hd",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "批注" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "ns-seg",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: annoScope === "episode" ? "ns-seg-on" : "",
													title: "只看当前这一集",
													onClick: () => setAnnoScope("episode"),
													children: "按集"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: annoScope === "all" ? "ns-seg-on" : "",
													title: "看这一版所有集的批注",
													onClick: () => setAnnoScope("all"),
													children: "全部"
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-sub",
												children: annoScope === "all" ? `${allCount} 条` : `${anno.annotations.length} 条`
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "ns-col-bd",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "ns-empty",
											children: "在提示词里划选一段文字（Ctrl 可以连着选几处不连续的）， 批注框会在选区下方浮出来。"
										}), annoScope === "episode" ? anno.annotations.map((a) => annotationCard(a)) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											allError === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "ns-empty",
												children: ["读批注出错：", allError]
											}),
											(version?.episodes ?? []).map((item) => {
												const list = allAnnotations[item.episode] ?? [];
												if (list.length === 0) return null;
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "ns-anno-group",
													children: [
														"第 ",
														item.episode,
														" 集 · ",
														list.length,
														" 条"
													]
												}), list.map((a) => annotationCard(a, item.episode))] }, item.episode);
											}),
											allCount === 0 && allError === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "ns-empty",
												children: "这一版还没有任何批注。"
											}) : null
										] })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "ns-col-foot",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "ns-btn ns-btn-primary",
											disabled: sendCount === 0,
											title: sendCount === 0 ? "还没有批注" : "把这一批批注整理成指令复制到剪贴板",
											onClick: sendBatch,
											children: [
												"下发 ",
												sendCount,
												" 条批注"
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "ns-foot-hint",
											children: annoScope === "all" ? "这一版所有集的批注一起下发" : "复制成指令 → 粘到对话里发给 AI"
										})]
									})
								]
							})
						]
					}) : null,
					toast === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ns-toast",
						children: toast
					})
				]
			}), pending !== null && pending.open && !isMin ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ns-pop2",
				ref: popRef,
				style: {
					left: pending.x,
					top: pending.y,
					pointerEvents: "auto"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-pop2-hd",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: pending.regions.length > 1 ? `已选 ${pending.regions.length} 处` : pending.regions[0] === void 0 ? "没有选中" : regionLabel(pending.regions[0]) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-pop2-hint",
								children: "按住 Ctrl 可再选别处"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ns-x",
								title: "关掉",
								onClick: closePending,
								children: "✕"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ns-pop2-list",
						children: pending.regions.map((region, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ns-pop2-q",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ns-acard-ln",
									children: regionLabel(region)
								}),
								"“",
								region.quote,
								"”"
							]
						}, `${region.paragraph}-${index}`))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "ns-editor-t",
						placeholder: "这里有什么问题？（一句话就行）",
						value: problem,
						autoFocus: true,
						onChange: (e) => setProblem(e.target.value),
						onKeyDown: (e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitAnnotation();
							if (e.key === "Escape") closePending();
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-editor-act",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ns-btn",
								onClick: closePending,
								children: "取消"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ns-btn ns-btn-primary",
								disabled: anno.saving,
								onClick: submitAnnotation,
								children: anno.saving ? "保存中…" : "加入批注"
							})
						]
					})
				]
			}) : null] });
		}
		/**
		* 从选区的一个端点往上找"带 data-paragraph 的那个元素"。
		* @param node - 选区的 startContainer / endContainer。
		* @param within - 提示词栏容器（防止把别处的选区算进来）。
		*/
		function elementOf(node, within) {
			let el = node instanceof HTMLElement ? node : node.parentElement;
			while (el !== null && el !== within) {
				if (el.dataset.paragraph !== void 0) return el;
				el = el.parentElement;
			}
			return null;
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* 工作台的样式（字符串，由客户端 apply 注入一个 style 标签）。
		*
		* 规则：
		*   · **只用 DSH 主题变量**（--dsw-alias-*）并带 fallback，不写死颜色——
		*     写死的话切浅色主题就瞎了。变量名都是实测过的，不是猜的。
		*   · 类名统一 ns- 前缀，避免和官方样式撞车。
		*   · 尺寸取官方实测值（输入卡 22px 圆角、气泡 22px、行高 22/24px）。
		*   · ⚠️ 改这个文件时注意两件事：
		*     1. **别把选择器写重复**（人家踩过：补丁式追加导致大半段定义两遍，
		*        表现是「改了样式没反应」——同名选择器后者覆盖前者）。
		*     2. **注释里不要出现反引号字符**！整个 CSS 是一个模板字符串，
		*        注释里一个反引号就会提前闭合它，构建当场失败（也踩过）。
		*
		* 结构：根层 → 通用小件 → 工作台窗口 → 三栏 → 剧本行 → 提示词块（含块抬头）→
		*       批注区 → 划词弹卡 → 缩放手柄 → 提示条 → 滚动条
		*
		* ⚠️ 这一版**删掉了覆盖竖条**（.ns-coverbar，以及原来只为给它当定位祖先的
		*    `.ns-col-src .ns-col-bd { position: relative }`）：设计文档 §2.2 明确不做
		*    "整集覆盖范围"这件事 —— 这里没有"覆盖"，只有"当前这一块引用了剧本哪几行"，
		*    用行底色（.ns-sline.ns-hl）表达就够。
		*/
		const overlayCss = `
/* ══════════════════════════════════════════════════════════════════════
   根层：铺满视口，但**不拦截鼠标**（空白处穿透到官方界面）
   ⚠️ 这一层必须是 none，面板自己才是 auto。写反了会「整屏点不动」。
   ══════════════════════════════════════════════════════════════════════ */
.ns-root { position: absolute; inset: 0; pointer-events: none; }

/* ── 通用小件 ───────────────────────────────────────────────────────── */
.ns-spacer { flex: 1; }
.ns-x {
  background: none; border: none; padding: 1px 6px; border-radius: 6px; cursor: pointer;
  font: inherit; font-size: 12px; color: var(--dsw-alias-label-caption);
}
.ns-x:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.ns-x:disabled { opacity: .35; cursor: default; }
.ns-x:disabled:hover { background: transparent; }
.ns-x-del:hover { color: var(--dsw-alias-state-error-primary); }
.ns-btn {
  padding: 4px 12px; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: inherit;
}
.ns-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ns-btn-primary { background: var(--dsw-alias-state-business-primary); color: #fff; border-color: transparent; }
.ns-btn-primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--dsw-alias-state-business-primary); }
.ns-btn:disabled { opacity: .42; cursor: not-allowed; }

/* 标签（批注卡上的小圆角块） */
.ns-tag {
  font: inherit; font-size: 11px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid currentColor; background: transparent; cursor: default;
}
button.ns-tag { cursor: pointer; }
/* 选中态：底色取该类型自己的颜色，文字反过来用浮层底色 */
button.ns-tag.ns-on { background: currentColor; color: var(--dsw-alias-bg-overlay); }

/* ══════════════════════════════════════════════════════════════════════
   工作台窗口：可拖、可缩放；默认铺满对话区
   ══════════════════════════════════════════════════════════════════════ */
.ns-workbench {
  position: absolute;
  display: flex; flex-direction: column; min-height: 0; min-width: 0;
  border-radius: 14px; overflow: hidden;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 22px 60px rgba(0,0,0,.34), 0 6px 18px rgba(0,0,0,.18);
  color: var(--dsw-alias-label-primary);
  font: 13px/1.65 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  /* 面板自己接管鼠标事件（父层 .ns-root 是 none 的穿透层） */
  pointer-events: auto;
}
/* 划词时**用插件自己的选中样式**，不用浏览器默认那套。
   低透明度叠在正文上，浅色/深色主题都成立；只作用于工作台与批注框内部，
   官方对话区的选中样式一点都不动。 */
.ns-workbench ::selection,
.ns-pop2 ::selection,
.ns-pop2::selection {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);
  color: var(--dsw-alias-label-primary);
}
/* 最小化：一枚**小胶囊**。样式直接照抄 DSH 官方的两个定义：
     · 浮层表面 = --dsw-specific-menu（即 bg-layer-3）+ --dsw-elevation-prominent
       （后者自带 0.5px 发丝描边；见 ui-primitives/Menu.module.css）
     · 胶囊尺寸 = ui-primitives/Pill.module.css：高 24、圆角 12、padding 0 8、
       字号 12、字色 label-secondary、底色 bg-layer-2
   ⚠️ 踩过的三个坑，别重犯：
     1. 用 transform: scale 缩整个窗口 → 字和按钮一起缩小二十几倍，看着像消失。
     2. 做 36px 圆点 + visibility 隐藏标题栏其它子元素 → 那些 span 仍占布局，
        把圆点挤得只剩几像素给按钮，于是点不动。
     3. 自己编颜色（亮蓝实心）→ 和官方观感不一致。一律用官方 token。 */
/* 最小化：一枚**胶囊**。
   颜色用**主题色**：官方主按钮那一对 token ——
   ui-primitives/Button.module.css 的 .primary / .primary:hover
   （fill + label-primary-foreground）。
   文字与图标**整组居中**，形状仍是完整胶囊（高 36 = 圆角 18 的两倍）。 */
.ns-workbench.ns-min {
  overflow: hidden;
  border: none;
  border-radius: 18px;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-state-business-primary));
  color: var(--dsw-alias-label-primary-foreground, #fff);
  box-shadow: 0 8px 24px rgba(0,0,0,.28);
}
/* 胶囊里只有标题栏：透明化，让整枚胶囊是一个干净的面。
   ⚠️ 两个都要，缺一个文字就不居中：
     1. **标题栏要铺满胶囊**（height: 100%）。它是 flex: none，默认只占内容高度
        （约 20px），而胶囊高 36px —— 于是文字贴在上边。align-items: center
        一直在生效，只是没有高度可居。
     2. 标题栏里那个 .ns-spacer（flex:1）在收起状态下还在，会把文字顶到左边，
        所以也藏掉；按钮改成绝对定位贴右边缘。 */
.ns-workbench.ns-min .ns-wb-hd {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  border-bottom: none;
  background: transparent;
  border-radius: 18px;
  padding: 0 34px 0 14px;
  gap: 6px;
  justify-content: center;
  cursor: grab;
}
.ns-workbench.ns-min .ns-spacer { display: none; }
.ns-workbench.ns-min .ns-wb-hd .ns-x {
  position: absolute; right: 6px; top: 0; bottom: 0; margin: auto 0;
  height: 24px;
}
.ns-workbench.ns-min .ns-wb-hd:active { cursor: grabbing; }
/* 收起时的标题：跟主题色走（currentColor 来自上面），字号也放大一档 */
.ns-workbench.ns-min .ns-t {
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1;
  color: currentColor;
}
.ns-workbench.ns-min .ns-x { color: currentColor; }
.ns-workbench.ns-min .ns-x:hover {
  background: color-mix(in srgb, currentColor 22%, transparent);
  color: currentColor;
}
.ns-workbench.ns-min .ns-wb-cols { display: none; }
.ns-workbench.ns-min .ns-rs { display: none; }
/* 收起时只藏「元信息」和拖动手柄；标题与按钮保留（按钮要保持可点） */
.ns-workbench.ns-min .ns-meta,
.ns-workbench.ns-min .ns-hint,
.ns-workbench.ns-min .ns-grip { display: none; }

.ns-wb-hd {
  flex: none; display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  cursor: move; user-select: none;
}
.ns-grip { color: var(--dsw-alias-label-caption); letter-spacing: -2px; font-size: 11px; }
.ns-t { font-size: 12px; font-weight: 600; white-space: nowrap; }
.ns-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ns-hint { font-size: 10.5px; color: var(--dsw-alias-label-caption); white-space: nowrap; }
/* 数据来源标记（官方 Tag 规格：小、圆角、次要字色） */
.ns-badge {
  flex: none;
  font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 8px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2);
  white-space: nowrap;
}
.ns-badge-demo {
  color: var(--dsw-alias-state-warn-primary);
  box-shadow: inset 0 0 0 1px currentColor;
  background: transparent;
}
/* 版本 / 集选择器：弄成官方那种小尺寸，别抢标题栏的注意力 */
.ns-sel {
  flex: none;
  height: 22px;
  max-width: 200px;
  padding: 0 4px;
  font: inherit;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.ns-sel:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ns-sel:disabled { opacity: .5; cursor: not-allowed; }

/* 扫描诊断条：常驻可见（出问题时主人一眼就能看到，不用 hover） */
.ns-scanbar {
  flex: none;
  display: flex; align-items: center; gap: 8px;
  padding: 3px 10px; font-size: 10.5px;
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
}
.ns-scanbar-k { flex: none; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.ns-scanbar-v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 上手引导卡：工作台目录还没建时占据主区，把 DSH 的实际流程讲清楚 */
.ns-onboard {
  flex: 1;
  display: flex; flex-direction: column; justify-content: center; gap: 10px;
  padding: 24px 32px; overflow-y: auto;
  color: var(--dsw-alias-label-secondary);
}
.ns-onboard-t { font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.ns-onboard-l { margin: 0; padding-left: 20px; font-size: 12.5px; line-height: 2; }
.ns-onboard-l b { color: var(--dsw-alias-state-business-primary); }
.ns-onboard-l code {
  font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
  background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 1px 5px;
}
.ns-onboard-n {
  font-size: 11px; color: var(--dsw-alias-label-caption);
  border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px;
}

/* ── 三栏 ───────────────────────────────────────────────────────────── */
.ns-wb-cols { flex: 1; min-height: 0; display: flex; }
.ns-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.ns-col-src { flex: none; background: var(--dsw-alias-bg-layer-1); }
.ns-col-prompt { flex: 1; }
.ns-col-anno { flex: none; background: var(--dsw-alias-bg-layer-1); }
.ns-col-hd {
  flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 10.5px; font-weight: 600; letter-spacing: .05em;
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.ns-sub { font-weight: 400; letter-spacing: 0; }
.ns-col-bd { flex: 1; overflow-y: auto; padding: 11px 14px 30px; }

/* 列宽把手 */
.ns-split {
  flex: none; width: 11px; margin: 0 -5.5px; z-index: 3;
  cursor: col-resize; position: relative; align-self: stretch;
}
.ns-split::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 5px; width: 1px;
  background: var(--dsw-alias-border-l1); transition: background .12s;
}
.ns-split:hover::after { background: var(--dsw-alias-state-business-primary); }
.ns-split:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); }
body.ns-colresizing { cursor: col-resize; user-select: none; }

/* ── 剧本行（左栏，只读参考）─────────────────────────────────────────
   高亮只有一条规则：**当前这一块引用了这几行**（悬停/点中栏某块；
   或悬停左栏某行时反过来高亮中栏的那几个块，那在中栏是 .ns-para-hover）。
   ⚠️ 左栏**不可划词、不可批注**，所以这里没有"待批注"那类底色。 */
.ns-sline { display: flex; gap: 8px; border-radius: 4px; padding: 1px 0; }
.ns-sline.ns-hl {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 26%, transparent);
}
.ns-ln {
  flex: none; width: 32px; text-align: right; font-size: 12px; line-height: 1.95;
  color: var(--dsw-alias-label-tertiary); user-select: none;
  font-family: ui-monospace, Consolas, monospace;
}
/* 正文提亮：原来用 label-secondary，主人反馈"太暗、看着难受" */
.ns-stx { flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.95; color: var(--dsw-alias-label-primary); }

/* ── 提示词块（中栏，作业区）─────────────────────────────────────────
   一个块 = 清单里的一条：抬头（块 N + 正文首行 + 指向剧本哪儿）+ 正文。
   正文是划词/批注的对象；抬头**不许被划进选区**（见下面的 user-select）。 */
.ns-para {
  position: relative;
  display: flex; flex-direction: column; gap: 2px;
  border-radius: 6px; padding: 5px 8px 6px; margin-bottom: 3px;
  cursor: default;
}
.ns-para:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* 当前正在看的那几块（点选/定位）：**底色块**，和左侧剧本对应行同一种表示法。 */
.ns-para-pinned {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
}
/* 悬停左栏某行时，反过来把"引用了这一行的块"标出来（联动方向二）。
   比"正在看"浅一档，免得和真正的点选混在一起。 */
.ns-para-hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
}
/* Ctrl 连选期间被选中的块：比"当前在看"的色块更深一档。
   这段时间输入框是**不弹**的（见 Workbench 的 onPromptMouseUp），
   屏幕上就靠这层底色告诉用户"我选了哪几处"。 */
.ns-para-pending {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent);
}
.ns-para-broken { opacity: .7; }
/* 块抬头：块的位置序号 + 正文首行原样 + 指向剧本哪儿。
   ⚠️ user-select: none 是必须的 —— 抬头要是能划进选区，quote 里就会混进
      "块 12" 和 "→ 剧本 L3–L4"，回给 agent 的引文就不干净了。
      （正文从这一块的**第 2 行**开始渲染 —— 首行已经当标签显示在上面了，不重复。
        代价是标签那一行不可选；块内其余内容照常可划词。）
      ⚠️ 主人 2026-09-14：原来 10.5px 太小、而且整条都是灰的。抬头是**扫读的路标**，
      字号提到 12.5px，"块 N" 与剧本行号用**主题色**，只有中间那段正文首行留次要色
      （它是内容摘录，不该跟路标抢注意力）。 */
.ns-blk-hd {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 12.5px; line-height: 1.9;
  user-select: none;
}
.ns-blk-no {
  flex: none; font-weight: 600;
  color: var(--dsw-alias-state-business-primary);
}
/* 正文首行：一眼认出"这是哪一块"，太长就省略号 */
.ns-blk-anchor {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
/* 剧本行号跟着抬头一起放大、上主题色（它复用了 .ns-para-src 的胶囊样式） */
.ns-blk-hd .ns-para-src {
  font-size: 11.5px;
  color: var(--dsw-alias-state-business-primary);
}
/* "剧本里没有对应"必须留住警示色：上一条选择器更具体，这里显式压回来 */
.ns-blk-hd .ns-para-src.ns-para-new {
  color: var(--dsw-alias-state-warn-primary);
}
.ns-para-tx { flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.9; color: var(--dsw-alias-label-primary); }
.ns-para-line { display: block; white-space: pre-wrap; }
.ns-para-bad { color: var(--dsw-alias-state-error-primary); }
/* 抬头右侧那枚小标：「→ 剧本 L7–L9」/「→ 剧本里没有对应」。
   也不能被划进选区（序号/标签被选上过一次）。 */
.ns-para-src {
  flex: none; font-size: 10.5px; line-height: 1.8; padding: 0 5px; border-radius: 999px;
  color: var(--dsw-alias-label-tertiary); user-select: none;
  font-family: ui-monospace, Consolas, monospace;
}
.ns-para-new { color: var(--dsw-alias-state-warn-primary); }

/* ── 批注区 ─────────────────────────────────────────────────────────── */
.ns-empty { padding: 16px 8px; text-align: center; font-size: 12.5px; line-height: 1.8; color: var(--dsw-alias-label-caption); }
.ns-sec { margin-bottom: 10px; }
.ns-sec-h { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: var(--dsw-alias-label-caption); padding: 5px 3px; }
.ns-acard {
  border: 1px solid var(--dsw-alias-border-l2); border-left-width: 3px; border-radius: 8px;
  background: var(--dsw-alias-bg-base); padding: 7px 9px; margin-bottom: 6px;
}
.ns-acard-draft { border-left-color: var(--dsw-alias-state-error-primary); }
.ns-acard-sent { border-left-color: var(--dsw-alias-state-success-primary); }
.ns-acard-r1 { display: flex; align-items: center; gap: 6px; }
.ns-reg {
  display: block; width: 100%; text-align: left; font: inherit; font-size: 11px; line-height: 1.5;
  background: none; border: none; border-left: 2px solid var(--dsw-alias-border-l2);
  padding: 1px 0 1px 7px; margin: 5px 0 2px; cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
}
.ns-reg:hover { border-left-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); }
.ns-reg-ln { font-family: ui-monospace, Consolas, monospace; margin-right: 5px; }
.ns-why { font-size: 13px; margin-top: 5px; }
.ns-ameta { margin-top: 5px; font-size: 11.5px; color: var(--dsw-alias-label-caption); }
.ns-col-foot { flex: none; padding: 8px 9px; border-top: 1px solid var(--dsw-alias-border-l1); }
.ns-col-foot .ns-btn { width: 100%; justify-content: center; }
.ns-foot-hint { margin-top: 5px; font-size: 10px; text-align: center; color: var(--dsw-alias-label-caption); }

/* ══════════════════════════════════════════════════════════════════════
   划词弹卡：**跟着选区浮出来**（位置按选区算），绝不固定在批注栏里。
   连选期间**不飘任何浮层** —— 只靠 .ns-para-pending 那层底色报数。
   ══════════════════════════════════════════════════════════════════════ */
.ns-pop-anchor {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center;
  z-index: 40; pointer-events: auto;
}

/* 胶囊（按住 Ctrl 累积期间）：停在底部报数 */
.ns-pill {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 12px;
  border-radius: 999px; font-size: 12px; white-space: nowrap;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l3);
  box-shadow: 0 8px 24px rgba(0,0,0,.26);
  color: var(--dsw-alias-label-primary);
}
.ns-pill-n { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.ns-pill-btn {
  border: none; border-radius: 999px; padding: 3px 11px; cursor: pointer;
  font: inherit; font-size: 12px; color: #fff;
  background: var(--dsw-alias-state-business-primary);
}
.ns-pill-btn:hover { filter: brightness(1.08); }

/* 卡片（写问题） */
.ns-pop {
  width: 344px;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 11px; padding: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.28), 0 2px 8px rgba(0,0,0,.16);
  color: var(--dsw-alias-label-primary);
  font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}
.ns-pop-hd { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 6px; }
.ns-pop-list { max-height: 96px; overflow: auto; margin-bottom: 7px; }
.ns-pop-item {
  display: flex; align-items: center; gap: 6px; font-size: 11.5px; line-height: 1.5;
  background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 4px 7px; margin-bottom: 3px;
  color: var(--dsw-alias-label-secondary);
}
.ns-pop-ln { flex: none; font-size: 10px; color: var(--dsw-alias-label-caption); font-family: ui-monospace, Consolas, monospace; }
.ns-pop-tx { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ns-pop-lab { font-size: 10px; color: var(--dsw-alias-label-caption); margin: 7px 0 5px; }
.ns-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.ns-pop-ta {
  width: 100%; min-height: 54px; resize: vertical; font: inherit; font-size: 13px; line-height: 1.6;
  color: inherit; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 6px 8px;
}
.ns-pop-ta:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.ns-pop-acts { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.ns-pop-warn { font-size: 10.5px; color: var(--dsw-alias-state-error-primary); }
.ns-pop-tip { font-size: 10.5px; color: var(--dsw-alias-label-caption); margin-top: 6px; }

/* ── 缩放手柄：贴在边框上，够宽好点中 ───────────────────────────────── */
.ns-rs { position: absolute; z-index: 5; }
.ns-rs-r { top: 8px; right: 0; bottom: 14px; width: 7px; cursor: ew-resize; }
.ns-rs-b { left: 8px; right: 14px; bottom: 0; height: 7px; cursor: ns-resize; }
.ns-rs-br {
  right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
  /* 右下角一道斜纹，暗示这里能拉 */
  background: linear-gradient(135deg, transparent 45%,
    var(--dsw-alias-border-l3) 45%, var(--dsw-alias-border-l3) 55%, transparent 55%);
}
.ns-rs:hover { background-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); }
.ns-rs-br:hover { background-color: transparent; }
body.ns-dragging { cursor: grabbing; user-select: none; }
body.ns-resizing { user-select: none; }

/* ── 提示条（复制成功之类）──────────────────────────────────────────── */
.ns-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; z-index: 70; pointer-events: auto;
  padding: 7px 13px; border-radius: 9px; font-size: 12px;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l3);
  box-shadow: 0 8px 24px rgba(0,0,0,.24); color: var(--dsw-alias-label-primary);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}

/* ══ 设置页的排版小件（.ns-page-*）════════════════════════════════════
   这一版**不注册设置页**（设计文档 §9 只要那三个席位）。这份小件保留着，
   是因为未登记时的引导卡里那段说明的 class 就叫 ns-page-d；
   哪天要加设置页，排版也还是这几条。 */
.ns-page {
  display: flex; flex-direction: column; gap: 8px;
  padding: 4px 0;
  color: var(--dsw-alias-label-primary);
  font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}
.ns-page-t { font-size: 14px; font-weight: 500; }
.ns-page-d { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.ns-page-note {
  font-size: 11.5px; color: var(--dsw-alias-state-warn-primary);
  background: var(--dsw-alias-bg-layer-2); border-radius: 7px; padding: 5px 9px;
}
.ns-page-empty { font-size: 12px; color: var(--dsw-alias-label-caption); }
.ns-page-list { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.ns-page-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1);
  font-size: 12.5px;
}
.ns-page-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-page-item-on {
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.ns-page-item input { flex: none; cursor: pointer; }
.ns-page-name { flex: none; font-weight: 500; }
.ns-page-path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace; font-size: 11px;
  color: var(--dsw-alias-label-caption);
}
.ns-page-cur {
  flex: none; font-size: 10px; padding: 0 6px; border-radius: 999px;
  color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 0 0 1px currentColor;
}
.ns-page-foot {
  margin-top: 4px; padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 11px; color: var(--dsw-alias-label-caption);
}

/* ══ 会话标题栏上的「提示词对照」按钮 ═════════════════════════════════
   渲染在官方会话标题栏里（不在 .ns-workbench 内），所以颜色/字体自己声明。
   尺寸对齐官方那排小按钮：高 26、圆角 8、次要字色、hover 有底。 */
.ns-hbtn {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px;
  font: 12px/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  color: var(--dsw-alias-label-secondary);
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  position: relative; white-space: nowrap;
}
.ns-hbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.ns-hbtn-on { color: var(--dsw-alias-state-business-primary); }
.ns-hbtn-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}

/* 未登记时给主人复制的指令块 */
.ns-copy {
  margin: 0; padding: 10px 12px; max-height: 220px; overflow: auto;
  font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.7;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  white-space: pre-wrap; word-break: break-word;
}
/* 上手引导卡上的按钮排 */
.ns-onboard-act { display: flex; gap: 8px; margin-top: 4px; }

/* ── 清单体检条（agent 登记的问题要显式可见，不能静默）───────────────── */
.ns-issues {
  display: flex; align-items: center; gap: 8px;
  margin: 0 12px 6px; padding: 5px 9px;
  border-radius: 8px; font-size: 11.5px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.ns-issues-err {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
}
.ns-issues-t { flex: none; font-weight: 600; color: var(--dsw-alias-label-primary); }
.ns-issues-m {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.ns-issues-n { flex: none; color: var(--dsw-alias-label-caption); }

/* ── 滚动条：DSH 皮肤（8px、圆角、透明轨道；浮起来的面用 l2 那对）───── */
.ns-workbench, .ns-pop {
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4));
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, rgba(127,127,127,.6));
}
.ns-col-bd::-webkit-scrollbar,
.ns-pop-list::-webkit-scrollbar { width: 8px; height: 8px; }
.ns-col-bd::-webkit-scrollbar-track,
.ns-pop-list::-webkit-scrollbar-track { background: transparent; }
.ns-col-bd::-webkit-scrollbar-thumb,
.ns-pop-list::-webkit-scrollbar-thumb {
  border-radius: 999px; background: var(--dsh-scrollbar-thumb); background-clip: content-box;
}
.ns-col-bd::-webkit-scrollbar-thumb:hover,
.ns-pop-list::-webkit-scrollbar-thumb:hover {
  background-color: var(--dsh-scrollbar-thumb-hover);
}

/* ══ 写批注的小框（跟着选区浮出来的那个）═════════════════════════════
   position: fixed —— 它挂在浮层根下（不在工作台面板里），所以不会被面板裁剪；
   left/top 由 JS 按松手时的指针位置算好并夹进视口。 */
.ns-pop2 {
  position: fixed; z-index: 60;
  display: flex; flex-direction: column; gap: 6px;
  width: 320px; box-sizing: border-box;
  padding: 9px 10px;
  border-radius: 12px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 10px 28px rgba(0,0,0,.28);
}
/* 连选期间**不**放任何浮层。
   曾经在选区旁边飘过一条"已选 N 处"的提示条，被否掉了：
   它就压在提示词文字上，把接下来要划的那几行挡住了。反馈只用 .ns-para-pending 底色。 */
.ns-pop2-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; color: var(--dsw-alias-label-caption);
}
.ns-pop2-hint { font-size: 10px; color: var(--dsw-alias-label-caption); }
/* 多选时选中的几处列在这里，太高就自己滚 */
.ns-pop2-list { max-height: 110px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.ns-pop2-q {
  font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-primary);
  word-break: break-word;
}
/* 卡片上每一处引文前面的块标签 */
.ns-acard-ln {
  flex: none; margin-right: 4px; font-size: 10.5px;
  color: var(--dsw-alias-label-caption);
  font-family: ui-monospace, Consolas, monospace;
}

/* ══ 写批注的小框（内联那一处）════════════════════════════════════════ */
.ns-editor {
  border: 1px solid var(--dsw-alias-state-business-primary); border-radius: 9px;
  padding: 8px 9px; margin-bottom: 10px;
  background: var(--dsw-alias-bg-base);
}
.ns-editor-k { font-size: 10.5px; color: var(--dsw-alias-label-caption); margin-bottom: 2px; }
.ns-editor-q {
  font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-primary);
  margin-bottom: 6px; word-break: break-word;
}
.ns-editor-t {
  width: 100%; min-height: 54px; resize: vertical; box-sizing: border-box;
  font: inherit; font-size: 12px; line-height: 1.6; padding: 6px 7px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px;
}
.ns-editor-act { display: flex; gap: 6px; margin-top: 6px; }

/* ══ 批注卡 ══════════════════════════════════════════════════════════ */
.ns-acard-done { opacity: .72; }
.ns-acard-q {
  font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-primary);
  margin: 2px 0 4px; word-break: break-word;
}
.ns-tag-done { color: var(--dsw-alias-state-business-primary); }

/* ══ 「按集 / 全部」切换（批注栏标题里的小分段控件）═══════════════════ */
.ns-seg {
  display: inline-flex; align-items: center;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px;
  overflow: hidden;
}
.ns-seg > button {
  font: inherit; font-size: 10.5px; line-height: 1;
  padding: 3px 7px; border: none; cursor: pointer;
  color: var(--dsw-alias-label-tertiary); background: transparent;
}
.ns-seg > button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-seg > button.ns-seg-on {
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* "全部"模式下的分集小标题 */
.ns-anno-group {
  margin: 10px 0 4px; font-size: 10.5px; font-weight: 600;
  color: var(--dsw-alias-label-caption);
}

/* ══ 侧栏底部、「设置」上面那一排的常驻入口 ═══════════════════════════
   几何**照抄 DSH 的「设置」那一行**，不是自己猜的：
   · packages/client/ui-settings-general/src/client/SettingsRoot.module.css
     的 .triggerRow / .trigger（height 42px、padding 0 10px 0 8px、radius 12px、
     gap 8px、font-size 14px、color label-primary、hover interactive-bg-hover；
     rail 态 36×36 圆形只留图标）
   · 同一席位的现成例子：packages/extensions/ui-cordis/.../CordisPanel.module.css 的 .badge
   sidebar.footer.action 的契约是「每个占位者自己负责按钮几何与 hover 样式」。 */
.ns-foot {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% + 4px); height: 42px; margin: 4px -2px;
  padding: 0 10px 0 8px;
  border: none; border-radius: 12px;
  background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 14px; line-height: 1.2;
  text-align: left;
}
.ns-foot:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-foot-on { color: var(--dsw-alias-state-business-primary); }
.ns-foot-label { overflow: hidden; white-space: nowrap; }
.ns-foot svg { flex: none; }
/* 侧栏收起（rail）：36×36 圆形、只留图标 —— 同 .trigger.rail */
.ns-foot-rail {
  width: 36px; height: 36px; margin: 8px 0 10px; padding: 0;
  justify-content: center; gap: 0; border-radius: 50%;
}

/* ══ 会话标题栏上的「提示词对照」小胶囊 ═══════════════════════════════ */
.ns-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 8px; border-radius: 7px;
  font: inherit; font-size: 11.5px; line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent; border: none; cursor: pointer;
  white-space: nowrap;
}
.ns-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-chip-on {
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.ns-chip svg { flex: none; }

/* ══ 一闪而过的提示 ═══════════════════════════════════════════════════ */
.ns-toast {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  padding: 5px 11px; border-radius: 8px; font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 6px 18px rgba(0,0,0,.18);
  pointer-events: none;
}
`;
		//#endregion
		//#region src/client/index.tsx
		/**
		* @dsh-external/dsh-prompt-compare —— 浏览器半边。
		*
		* 三个挂点，都是"加在旁边"而不是"替换"：
		*   1. `sidebar.footer.action`     —— 侧栏底部、和「设置」同排的常驻入口（任何状态都在）；
		*   2. `shell.overlay`             —— 全屏浮层（工作台住在这里）；
		*   3. `conversation.session.header.actions` —— 会话标题栏上的「提示词对照」（会话开始后出现）。
		*
		* ⚠️ 不注册 `main` / `main.conversation`：那是官方对话区的**单占席位**，
		*    注册进去就是替换掉它。这里要的是"浮在官方界面之上"，官方对话一个像素不动。
		*
		* ⚠️ `shell.overlay` 这一层是 **click-through** 的：浮层根元素必须
		*    `pointer-events: none`，面板自己 `auto`；两处都要写，写错就是"整屏点不动"。
		*/
		/**
		* 依赖声明。
		*
		* `remote.workspaceFiles` 是**官方**的 Remote 命名空间（list / read / …），
		* 用来读工作区里的文件 —— 只读，够用。写批注走插件自己在宿主注册的
		* `/api/prompt-compare/annotations`（见 src/index.ts）。
		*/
		const inject = [
			"slots",
			"remote",
			"remote.workspaceFiles",
			"sessions",
			"workspaces"
		];
		/**
		* 给挂点组件用的外部句柄。
		*
		* 为什么用模块级变量：`ctx.*` 只在 `apply` 的闭包里拿得到，而挂点组件是普通组件
		* （`shell.overlay` 这个席位不挂 hook 上下文，拿不到 `useSessions` 之类的标准 prop）。
		*/
		const handles = {};
		const listeners = /* @__PURE__ */ new Set();
		let open = false;
		function setOpen(next) {
			open = next;
			for (const listener of listeners) listener();
		}
		/** 订阅开/关状态。 */
		function useOpen() {
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const listener = () => force((n) => n + 1);
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			return open;
		}
		function apply(ctx) {
			console.info("[prompt-compare] client apply: start");
			handles.files = ctx.remote.workspaceFiles;
			handles.session = {
				get: () => ctx.sessions.list.getSnapshot().current,
				subscribe: (fn) => ctx.sessions.list.subscribe(fn)
			};
			handles.workspaces = {
				get: () => ctx.workspaces.list.getSnapshot(),
				subscribe: (fn) => ctx.workspaces.list.subscribe(fn)
			};
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.setAttribute("data-prompt-compare", "workbench");
				tag.textContent = overlayCss;
				document.head.append(tag);
				return () => {
					tag.remove();
				};
			}, "prompt-compare: styles");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "prompt-compare-open",
				order: 10,
				label: "提示词对照"
			}, FooterAction));
			ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
				name: OVERLAY_SLOT,
				id: PANEL_ID,
				order: 50,
				label: "提示词对照"
			}, CompareOverlay));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "prompt-compare-open",
				order: 80,
				label: "提示词对照"
			}, OpenWorkbenchButton));
			console.info("[prompt-compare] client apply: slots registered");
		}
		/**
		* 侧栏底部、「设置」上面那一排的常驻入口。
		*
		* ⚠️ 外观必须和「设置」那一行一致：几何照抄 DSH 的 `SettingsTrigger`（见 styles.ts
		* 里 `.ns-foot` 的注释）。`sidebar.footer.action` 的契约是"每个占位者自己负责
		* 按钮几何与 hover 样式"，所以这里要自己写全，别指望容器给。
		*
		* 席位会把 `wide` 传进来（侧栏展开/收起），收起时只留图标 —— 和设置那一行一样。
		*/
		function FooterAction({ wide = true }) {
			const isOpen = useOpen();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `ns-foot${wide ? "" : " ns-foot-rail"}${isOpen ? " ns-foot-on" : ""}`,
				title: isOpen ? "收起提示词对照工作台" : "打开提示词对照工作台",
				"aria-label": "提示词对照",
				"aria-pressed": isOpen,
				onClick: () => setOpen(!isOpen),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: wide ? 16 : 18,
					height: wide ? 16 : 18,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M4.5 1.5h5L13 5v9.5H4.5z",
							stroke: "currentColor",
							strokeWidth: "1.3",
							strokeLinejoin: "round"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M9.3 1.6V5h3.5",
							stroke: "currentColor",
							strokeWidth: "1.3",
							strokeLinejoin: "round"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M6.3 8.4h4M6.3 11h2.6",
							stroke: "currentColor",
							strokeWidth: "1.2",
							strokeLinecap: "round"
						})
					]
				}), wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "ns-foot-label",
					children: "提示词对照"
				}) : null]
			});
		}
		/**
		* 输入框工具条上的「提示词对照」按钮。
		*
		* 它自报状态（不靠 hover 猜）：打开着就高亮。点开看到的是工作台，
		* 没登记的工作区里是一张"还没登记 + 可复制的指令"的卡，不会点了没反应。
		*/
		function OpenWorkbenchButton() {
			const isOpen = useOpen();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `ns-chip${isOpen ? " ns-chip-on" : ""}`,
				title: isOpen ? "收起提示词对照工作台" : "打开提示词对照工作台",
				"aria-pressed": isOpen,
				onClick: () => setOpen(!isOpen),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: "13",
					height: "13",
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4.5 1.5h5L13 5v9.5H4.5z",
						stroke: "currentColor",
						strokeWidth: "1.3",
						strokeLinejoin: "round"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M9.3 1.6V5h3.5",
						stroke: "currentColor",
						strokeWidth: "1.3",
						strokeLinejoin: "round"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "提示词对照" })]
			});
		}
		/** 全屏浮层。 */
		function CompareOverlay() {
			const isOpen = useOpen();
			const session = useSessionId();
			if (!isOpen) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "ns-root",
				style: { pointerEvents: "none" },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						pointerEvents: "auto",
						display: "contents"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverlayBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Workbench, {
						files: handles.files,
						sessionId: session.id,
						sessionSource: session.source
					}) })
				})
			});
		}
		/**
		* 浮层的错误边界。
		*
		* ⚠️ 为什么必须有（2026-09-14 踩过）：工作台里任何一处抛异常（当时是
		*    宿主返回老格式批注、客户端读 `a.regions[0]`），React 会把整棵子树卸掉 ——
		*    表现是**点了图标浮窗什么都不出来**，而且看不出原因。有这个边界，
		*    至少会把错误原文显示出来，能自查也能直接复制给开发者。
		*/
		var OverlayBoundary = class extends react.Component {
			state = { error: "" };
			static getDerivedStateFromError(error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
			render() {
				if (this.state.error !== "") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ns-root",
					style: { pointerEvents: "none" },
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ns-workbench",
						style: {
							left: 24,
							top: 80,
							width: 460,
							height: "auto",
							pointerEvents: "auto"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ns-wb-hd",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-t",
								children: "提示词对照"
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ns-empty",
							children: [
								"工作台出错了（内容没渲染出来）：",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								this.state.error,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"先刷新页面；如果反复出现，把上面这句话发给开发者。"
							]
						})]
					})
				});
				return this.props.children;
			}
		};
		/**
		* 订阅「当前会话 id」，没有就**从工作区里兜一个**。
		*
		* 为什么要兜底：`workspaceFiles` 要用会话 id，而会话属于某个工作区。
		* 在"未分组"的空会话里打开插件时 `current` 是 undefined，
		* 没有会话 id 就什么都读不了。
		*/
		function useSessionId() {
			const [state, setState] = (0, react.useState)(() => resolveSession());
			(0, react.useEffect)(() => {
				const subs = [handles.session?.subscribe(() => setState(resolveSession())), handles.workspaces?.subscribe(() => setState(resolveSession()))];
				return () => {
					for (const un of subs) un?.();
				};
			}, []);
			return state;
		}
		function resolveSession() {
			const current = handles.session?.get();
			if (current !== void 0 && current !== "") return {
				id: current,
				source: "current"
			};
			const items = handles.workspaces?.get()?.items ?? [];
			for (const w of items) {
				const first = w.sessionIds[0];
				if (first !== void 0) return {
					id: first,
					source: "fallback"
				};
			}
			return {
				id: void 0,
				source: "none"
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map