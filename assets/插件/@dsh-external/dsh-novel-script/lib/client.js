window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-novel-script",
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
		const PANEL_ID = "novel-script";
		/** 工作台根目录（工作区里的固定名字）。 */
		const WORKBENCH_DIR = "剧本工作台";
		/** 原文文件名（固定）。原文只有一份，行号以它的物理行为准。 */
		const NOVEL_FILE = "小说原文.txt";
		const SCRIPT_DIR = "剧本";
		const MANIFEST_DIR = "清单";
		const ANNOTATION_DIR = "批注";
		/** 人工编辑的历史记录（一次保存一份）。 */
		const HISTORY_DIR = "历史";
		const CHANGELOG_FILE = "变更记录.txt";
		const RE_VERSION_DIR = /^v(\d+)$/;
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
		const ANNOTATION_ROUTE = "/api/novel-script/annotations";
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
		const EDIT_ROUTE = "/api/novel-script/edit";
		const novelPath = () => `${WORKBENCH_DIR}/${NOVEL_FILE}`;
		/**
		* 把"版本"统一成**目录名**。
		*
		* ⚠️ 两种写法都收：`v1`（目录名）和 `1`（去掉 v 的版本号）。
		*    踩过一次：扫描结果里存的是去掉 v 的 `1`，直接拼路径就成了
		*    `剧本工作台/1/清单/…`，清单永远找不到、剧本栏整个空白。
		*    在拼路径这一层归一，比要求每个调用方都记得传哪种更稳。
		*/
		function asVersionDir(version) {
			return RE_VERSION_DIR.test(version) ? version : `v${version.replace(/^v/i, "")}`;
		}
		const versionPath = (version) => `${WORKBENCH_DIR}/${asVersionDir(version)}`;
		/**
		* 小版本文件的尾巴：`v2.1` → `.v2.1`；`null` / `undefined`（基线）→ 空串。
		*
		* 基线文件与各小版本文件**共处同一个大版本目录**，靠这个尾巴区分。
		*/
		function minorSuffix(tag) {
			return tag === void 0 || tag === null || tag === "" ? "" : `.${tag}`;
		}
		const scriptPath = (version, episode, tag) => `${versionPath(version)}/${SCRIPT_DIR}/第${episode}集剧本${minorSuffix(tag)}.txt`;
		const manifestPath = (version, episode, tag) => `${versionPath(version)}/${MANIFEST_DIR}/第${episode}集清单${minorSuffix(tag)}.txt`;
		const annotationPath = (version, episode, tag) => `${versionPath(version)}/${ANNOTATION_DIR}/第${episode}集批注${minorSuffix(tag)}.txt`;
		/** 人工编辑的历史记录：`剧本工作台/v2/历史/第1集.v2.1.txt`。 */
		const historyPath = (version, episode, tag) => `${versionPath(version)}/${HISTORY_DIR}/第${episode}集${minorSuffix(tag)}.txt`;
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
		//#region src/shared/instruction.ts
		/**
		* 组装"交给 agent"的那份指令（实施计划 §10）。
		*
		* 为什么单独放一层、而且做成纯函数：这份指令是**人与 agent 之间的接口** ——
		* 路径写错、少了"以最新版本为基线"那一句、漏掉"引文已找不到"的提醒，
		* agent 就会改错地方，而界面上完全看不出来。所以它有回归用例
		* （`scripts/verify-edit.mjs` 第 21 节）。
		*
		* ⚠️ 一份指令**同时**包含两件事：**人工已经改过的地方**（含历史记录文件路径）
		*    与**批注**（含"锚点已失效"的提醒）。人工改过之后，批注的引文可能已经对不上
		*    正文了 —— agent 只看批注会改错地方，只看人工改动又会漏掉批注。
		*/
		/** 一处区域的显示名：`第 6 段` / `第 3–7 段`。 */
		function regionLabel(region) {
			const to = region.endParagraph ?? region.paragraph;
			return to > region.paragraph ? `第 ${region.paragraph}–${to} 段` : `第 ${region.paragraph} 段`;
		}
		/**
		* 从原文第一行里取书名。
		*
		* ⚠️ 第一行常常不是光秃秃的书名，而是 `## 《某某》第 3 集 · 分镜剧本` 这种大标题。
		*    直接整行塞进指令会变成"修改《…第 3 集 · 分镜剧本》第 1 集的剧本"，
		*    所以这里把"第 N 集"之后的部分切掉，太长（>40 字）就干脆不写书名。
		*/
		function bookNameOf(bookLine) {
			const cleaned = bookLine.replace(/^#+\s*/, "").replace(/^[《【[]/, "").replace(/第\s*\d+[\s\S]*$/, "").replace(/[》】\]·|｜\s]+$/, "").trim();
			return cleaned.length > 0 && cleaned.length <= 40 ? cleaned : "";
		}
		/**
		* 组装指令正文。
		*
		* @param input - 见 {@link InstructionInput}。
		* @returns 可以直接粘进对话的整段文本；没有任何一集时返回空串。
		*/
		function buildInstruction(input) {
			const episodes = [...input.episodes].sort((a, b) => a.episode - b.episode);
			if (episodes.length === 0) return "";
			const dir = input.versionDir;
			const book = bookNameOf(input.bookLine);
			const where = input.scope === "all" ? `${book === "" ? "这一部" : `《${book}》`}第 ${episodes.map((e) => e.episode).join("、")} 集` : `${book === "" ? "这一集" : `《${book}》第 ${episodes[0]?.episode ?? "?"} 集`}`;
			const out = [];
			out.push(`请按下面这份说明修改${where}的剧本。`);
			out.push("");
			out.push("⚠️ 每一集都以它自己的\"基线\"文件为准；旧版本只作参考，**不要用旧版本覆盖基线**。");
			out.push("");
			for (const item of episodes) {
				const tag = item.tag;
				out.push(`【第 ${item.episode} 集】`);
				out.push("基线（改这一集从它开始）：");
				out.push(`  正文：${scriptPath(dir, item.episode, tag)}`);
				out.push(`  清单：${manifestPath(dir, item.episode, tag)}`);
				out.push(`  批注：${annotationPath(dir, item.episode, tag)}`);
				out.push(`  小说原文（参考，一个字都不要动）：${input.novelFile}`);
				if (tag !== null) {
					out.push(`一、人工已经改过这一集（${dir} → ${tag}）`);
					out.push(`  完整改动记录：${historyPath(dir, item.episode, tag)}`);
					out.push("  （里面写了改了哪些行、删了什么、哪几段的原文对照需要复核）");
					out.push("  提醒：改动后的正文就是基线，不要把它改回去。");
					out.push("二、批注（需要处理）");
				} else out.push("一、批注（需要处理）");
				if (item.annotations.length === 0) out.push("  （这一集没有批注，按上面的人工改动保持一致即可）");
				item.annotations.forEach((annotation, index) => {
					const spans = (annotation.regions ?? []).map((region) => `${regionLabel(region)}「${region.quote.replaceAll("\n", " ")}」`).join("；");
					out.push(`  ${index + 1}. ${spans}——${annotation.problem}`);
					if (item.staleIds.includes(annotation.id)) out.push("     ⚠️ 这一条的引文在正文里已经找不到（锚点已失效，可能已经被人改掉），请先核对。");
				});
				out.push("");
			}
			out.push("要求：");
			out.push("1. 每一集都以它自己的\"基线\"为起点改，不要用旧版本覆盖；");
			out.push("2. 改完出一个**新的大版本**；新大版本里每一集都取\"该集当前最新的一版\"（基线或最高小版本）作为起点，不要整目录照抄；");
			out.push("3. 上面列出的批注文件里，已处理的条目改成 done: true、resolvedIn 写新版本号（没采纳的保持 done: false）；");
			out.push("4. 人工新增的内容，原文里没有对应就按\"新增（无对应）\"登记，不要硬找一段原文来凑，也不要把相邻段落的对应关系抄给它。");
			return out.join("\n");
		}
		//#endregion
		//#region src/shared/validate.ts
		/**
		* 两侧共用的**解析与校验**层（设计文档 §4、§7、§13）。
		*
		* 这里只做机械的事：怎么把段落拼成剧本文件、怎么算行号、清单/批注读不读得懂、
		* 剧本文件与清单对不对得上。**不判断任何剧情内容**（谁是角色、哪句是台词、对应得对不对）。
		*
		* 总原则：读不懂就报出来，不猜、不降级。
		*/
		const err = (where, message) => ({
			level: "error",
			where,
			message
		});
		/** 空行判定：去掉空白后为空。 */
		function isBlankLine(line) {
			return line.trim() === "";
		}
		/** 换行规范化：`\r\n` → `\n`，单独的 `\r` → `\n`。 */
		function normalizeNewlines(raw) {
			return raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
		}
		/** 按 LF 切行。 */
		function splitLines(text) {
			return normalizeNewlines(text).split("\n");
		}
		/** 一个段落是不是"合法区间"。 */
		function asRange(value) {
			if (!Array.isArray(value) || value.length < 2) return void 0;
			const a = typeof value[0] === "number" ? value[0] : Number(value[0]);
			const b = typeof value[1] === "number" ? value[1] : Number(value[1]);
			if (!Number.isInteger(a) || !Number.isInteger(b)) return void 0;
			if (a < 1 || b < a) return void 0;
			return [a, b];
		}
		/** `sourceRanges`：`null`，或者非空的、每项都合法的区间数组。 */
		function asSourceRanges(value) {
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
		/** 清单里那个"这一段坏了"的占位区间（保留数组下标，免得批注的段落号错位）。 */
		const BROKEN_LINES = [0, 0];
		/**
		* 解析一集的清单。
		*
		* ⚠️ 段落坏了**不跳过**，而是填一个 `scriptLines: [0, 0]` 的占位：
		*    段落编号是批注的锚点，一旦跳过，后面所有段落编号都会前移，
		*    批注就会指到别的段落上。填占位既保住了编号，又能把问题报出来。
		*/
		function parseEpisodeManifest(raw) {
			const issues = [];
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {
				manifest: null,
				issues: [err("清单", "不是一个 JSON 对象")]
			};
			const obj = raw;
			if (obj.schema !== 1) return {
				manifest: null,
				issues: [err("清单", `格式版本不认识（schema=${JSON.stringify(obj.schema)}，本程序只认 1）`)]
			};
			if (!Array.isArray(obj.paragraphs) || obj.paragraphs.length === 0) return {
				manifest: null,
				issues: [err("清单", "paragraphs 不是非空数组")]
			};
			return {
				manifest: {
					schema: 1,
					paragraphs: obj.paragraphs.map((item, index) => {
						const where = `第 ${index + 1} 段`;
						if (typeof item !== "object" || item === null || Array.isArray(item)) {
							issues.push(err(where, "不是一个 JSON 对象"));
							return {
								scriptLines: BROKEN_LINES,
								sourceRanges: null
							};
						}
						const rec = item;
						const scriptLines = asRange(rec.scriptLines);
						if (scriptLines === void 0) issues.push(err(where, `scriptLines 不是合法行号区间（${JSON.stringify(rec.scriptLines)}）`));
						const sourceRanges = asSourceRanges(rec.sourceRanges);
						if (sourceRanges === void 0) issues.push(err(where, `sourceRanges 不是 null 也不是 [[起,止], …]（${JSON.stringify(rec.sourceRanges)}）`));
						return {
							scriptLines: scriptLines ?? BROKEN_LINES,
							sourceRanges: sourceRanges ?? null
						};
					})
				},
				issues
			};
		}
		/**
		* 剧本文件与清单对不对得上（设计文档 §13）。
		*
		* 规则：第 1 段从第 1 行开始；相邻段落之间恰好一个空白行；
		* 下一段开始行 = 上一段结束行 + 2；最后一段结束行 = 文件总行数；
		* 间隔行必须是空行；段落内部不得有空白行。
		*
		* **能力边界**：能发现增行、删行、空行变化；**发现不了保持行数不变的文字替换**。
		*/
		function checkScriptStructure(scriptText, manifest) {
			const issues = [];
			const lines = splitLines(scriptText);
			const total = lines.length;
			let expectedStart = 1;
			manifest.paragraphs.forEach((p, index) => {
				const where = `第 ${index + 1} 段`;
				const [start, end] = p.scriptLines;
				if (start === 0 && end === 0) return;
				if (start !== expectedStart) issues.push(err(where, `声明从第 ${start} 行开始，但按段落分隔规则应当是第 ${expectedStart} 行`));
				if (end > total) {
					issues.push(err(where, `声明到第 ${end} 行，但剧本文件只有 ${total} 行`));
					return;
				}
				if (index > 0 && start >= 2 && !isBlankLine(lines[start - 2] ?? "")) issues.push(err(where, `与上一段之间的第 ${start - 1} 行应当是空白行`));
				for (let i = start; i <= end; i += 1) if (isBlankLine(lines[i - 1] ?? "")) {
					issues.push(err(where, `第 ${i} 行是空白行 —— 段落内部不允许空白行`));
					break;
				}
				expectedStart = end + 2;
			});
			const last = manifest.paragraphs[manifest.paragraphs.length - 1];
			if (last !== void 0 && last.scriptLines[0] !== 0 && last.scriptLines[1] !== total) issues.push(err("清单", `最后一段声明到第 ${last.scriptLines[1]} 行，但剧本文件共 ${total} 行`));
			return issues;
		}
		/** 本集覆盖的原文范围（由所有 `sourceRanges` 机械取最小/最大；全为 null 时返回 null）。 */
		function computeNovelRange(manifest) {
			let lo = Number.POSITIVE_INFINITY;
			let hi = 0;
			for (const p of manifest.paragraphs) for (const [a, b] of p.sourceRanges ?? []) {
				if (a < lo) lo = a;
				if (b > hi) hi = b;
			}
			return hi === 0 ? null : [lo, hi];
		}
		/**
		* 解析批注文件。
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
						else if (end !== paragraph) issues.push(err(regionWhere, `endParagraph 不是 ≥ paragraph 的整数（${JSON.stringify(region.endParagraph)}），已按单段处理`));
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
		* @param regions - 这条批注挂的几处（至少一处；Ctrl 多选就是多处）。
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
		*
		* ⚠️ 人工编辑模式之后多了一个 `minor`：批注跟着**有效版本**走 ——
		*    界面上看的是 `第1集剧本.v2.2.txt`，批注就要存在 `第1集批注.v2.2.txt`；
		*    两边不一致会出现"看到的是 v2.2 的批注、写进 v2.1 的文件"。
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
		/** 请求体里的小版本字段：`null` 就不带这个字段（= 基线）。 */
		function minorField(minor) {
			return minor === null || minor === void 0 || minor === "" ? {} : { minor };
		}
		/** 读一集的批注。 */
		function loadAnnotations(sessionId, version, episode, minor, signal) {
			return callAnnotations({
				op: "load",
				sessionId,
				version,
				episode,
				...minorField(minor)
			}, signal);
		}
		/** 存一集的批注（返回宿主合并后的结果）。 */
		function saveAnnotations(sessionId, version, episode, minor, annotations) {
			return callAnnotations({
				op: "save",
				sessionId,
				version,
				episode,
				...minorField(minor),
				annotations: [...annotations]
			});
		}
		//#endregion
		//#region src/shared/edit.ts
		/**
		* 名字规则（设计文档 §2.3）。
		*
		* ⚠️ 顺序要紧："历史"是唯一一条"集号后面直接跟 .txt"的规则，必须排最后，
		*    否则 `第1集剧本.txt` 会被它先吃掉。
		* ⚠️ 正文那一类同时收"剧本"和"提示词"两个词 —— 两个插件刻意同构，
		*    这里共用一份规则，由 `word` 字段区分；放错词的由调用方报出来。
		*    用**具名分组**取字段：前三条规则的括号位置不一样，靠下标取太容易错。
		*/
		const NAME_PATTERNS = [
			{
				kind: "content",
				re: /^第(?<ep>\d+)集(?<word>剧本|提示词)(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/
			},
			{
				kind: "manifest",
				re: /^第(?<ep>\d+)集清单(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/
			},
			{
				kind: "annotation",
				re: /^第(?<ep>\d+)集批注(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/
			},
			{
				kind: "history",
				re: /^第(?<ep>\d+)集(?:\.v(?<major>\d+)\.(?<minor>\d+))?\.txt$/
			}
		];
		/**
		* 解析一个文件名。
		* @param name - 只有文件名（不含目录）。
		* @returns 不认识时 `undefined`（调用方应当把"文件名不认识"报出来，不猜）。
		*/
		function parseContentName(name) {
			for (const { kind, re } of NAME_PATTERNS) {
				const m = re.exec(name);
				if (m === null) continue;
				const g = m.groups ?? {};
				const episode = Number.parseInt(g.ep ?? "", 10);
				if (!Number.isInteger(episode) || episode < 1) return void 0;
				const word = g.word === "剧本" || g.word === "提示词" ? g.word : void 0;
				const base = {
					episode,
					kind,
					...word === void 0 ? {} : { word }
				};
				if (g.major === void 0 || g.minor === void 0) return base;
				const minor = Number.parseInt(g.minor, 10);
				if (!Number.isInteger(minor) || minor < 1) return void 0;
				return {
					...base,
					major: `v${g.major}`,
					minor,
					tag: `v${g.major}.${minor}`
				};
			}
		}
		/** `v2.1` → `v2`；没有点就原样返回。 */
		function tagMajor(tag) {
			const dot = tag.indexOf(".");
			return dot === -1 ? tag : tag.slice(0, dot);
		}
		/**
		* 小版本号里的 `v2` 必须等于它所在的大版本目录名。
		*
		* 为什么校验它：`第1集剧本.v3.1.txt` 要是躺在 `v2/` 里，说明文件被挪错过
		* （或者人手工拷错了），照着用它会把 v3 的内容当成 v2 的人工版本。
		*/
		function tagMatchesDir(tag, versionDir) {
			return tagMajor(tag) === versionDir;
		}
		/** 精细比对的开销上限（单元格数）。超过就退化成"整块都算改了"。 */
		const MAX_DP_CELLS = 262144;
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
		function alignLines(oldLines, newLines) {
			const oldCount = oldLines.length;
			const newCount = newLines.length;
			const oldToNew = new Array(oldCount).fill(0);
			const newToOld = new Array(newCount).fill(0);
			const matches = [];
			let head = 0;
			while (head < oldCount && head < newCount && oldLines[head] === newLines[head]) {
				oldToNew[head] = head + 1;
				newToOld[head] = head + 1;
				matches.push({
					oldLine: head + 1,
					newLine: head + 1
				});
				head += 1;
			}
			let tail = 0;
			while (oldCount - 1 - tail >= head && newCount - 1 - tail >= head && oldLines[oldCount - 1 - tail] === newLines[newCount - 1 - tail]) {
				const oldLine = oldCount - tail;
				const newLine = newCount - tail;
				oldToNew[oldLine - 1] = newLine;
				newToOld[newLine - 1] = oldLine;
				matches.push({
					oldLine,
					newLine
				});
				tail += 1;
			}
			const oStart = head;
			const nStart = head;
			const n = oldCount - tail - oStart;
			const m = newCount - tail - nStart;
			if (n > 0 && m > 0) {
				if (n * m <= MAX_DP_CELLS) {
					const width = m + 1;
					const dp = new Int32Array((n + 1) * width);
					for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i * width + j] = oldLines[oStart + i] === newLines[nStart + j] ? (dp[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
					let i = 0;
					let j = 0;
					while (i < n && j < m) {
						if (oldLines[oStart + i] === newLines[nStart + j]) {
							const oldLine = oStart + i + 1;
							const newLine = nStart + j + 1;
							oldToNew[oldLine - 1] = newLine;
							newToOld[newLine - 1] = oldLine;
							matches.push({
								oldLine,
								newLine
							});
							i += 1;
							j += 1;
							continue;
						}
						if ((dp[(i + 1) * width + j] ?? 0) > (dp[i * width + j + 1] ?? 0)) i += 1;
						else j += 1;
					}
					matches.sort((a, b) => a.oldLine - b.oldLine);
					return {
						oldToNew,
						newToOld,
						matches,
						degraded: false
					};
				}
				matches.sort((a, b) => a.oldLine - b.oldLine);
				return {
					oldToNew,
					newToOld,
					matches,
					degraded: true
				};
			}
			matches.sort((a, b) => a.oldLine - b.oldLine);
			return {
				oldToNew,
				newToOld,
				matches,
				degraded: false
			};
		}
		/**
		* 按空行把正文切成段落（设计文档 §6.1：段间恰好一个空行、段内不许有空行）。
		*
		* ⚠️ 连续多个空行只当**一个**分隔符、首尾的空行丢掉 —— 不产生空段落。
		*    这条很要紧：`computeScriptLines` 假设"下一段起点 = 上一段终点 + 2"，
		*    切出一个空段落会让行号与正文再也对不上。
		*/
		function splitParagraphs(lines) {
			const out = [];
			let i = 0;
			while (i < lines.length) {
				while (i < lines.length && isBlankLine(lines[i] ?? "")) i += 1;
				if (i >= lines.length) break;
				const start = i;
				while (i < lines.length && !isBlankLine(lines[i] ?? "")) i += 1;
				out.push({
					start: start + 1,
					end: i
				});
			}
			return out;
		}
		/** 内部：造一个段落对象。 */
		function makeParagraph(index, span, text, origin, fromIndex, sourceRanges, needsReview, shared) {
			return {
				index,
				span,
				scriptLines: [span.start, span.end],
				text,
				origin,
				fromIndex,
				sourceRanges: origin === "added" ? null : sourceRanges,
				needsReview,
				shared
			};
		}
		/** 旧段落原文（清单坏了 / 越界时给空串）。 */
		function textOfOldParagraph(oldLines, paragraph) {
			if (paragraph === void 0) return "";
			const [start, end] = paragraph.scriptLines;
			if (start < 1 || end < start) return "";
			return oldLines.slice(start - 1, end).join("\n");
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
		function textSimilarity(a, b) {
			const x = normalizeNewlines(a);
			const y = normalizeNewlines(b);
			if (x === "" || y === "") return 0;
			if (x === y) return 1;
			const n = x.length;
			const m = y.length;
			if (n * m > 4096) {
				let head = 0;
				while (head < n && head < m && x[head] === y[head]) head += 1;
				let tail = 0;
				while (tail < n - head && tail < m - head && x[n - 1 - tail] === y[m - 1 - tail]) tail += 1;
				return 2 * (head + tail) / (n + m);
			}
			const width = m + 1;
			const dp = new Int32Array((n + 1) * width);
			for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i * width + j] = x[i] === y[j] ? (dp[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
			return 2 * (dp[0] ?? 0) / (n + m);
		}
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
		function deriveParagraphs(oldLines, newLines, oldParagraphs, alignment = alignLines(oldLines, newLines)) {
			const issues = [];
			const spans = splitParagraphs(newLines);
			const texts = spans.map((span) => newLines.slice(span.start - 1, span.end).join("\n"));
			const oldLineToParagraph = /* @__PURE__ */ new Map();
			oldParagraphs.forEach((p, index) => {
				const [start, end] = p.scriptLines;
				if (start === 0 && end === 0) return;
				for (let line = start; line <= end; line += 1) oldLineToParagraph.set(line, index + 1);
			});
			const refs = spans.map((span) => {
				const set = /* @__PURE__ */ new Set();
				for (let line = span.start; line <= span.end; line += 1) {
					const oldLine = alignment.newToOld[line - 1] ?? 0;
					if (oldLine === 0) continue;
					const paragraph = oldLineToParagraph.get(oldLine);
					if (paragraph !== void 0) set.add(paragraph);
				}
				return [...set].sort((a, b) => a - b);
			});
			const referenced = /* @__PURE__ */ new Set();
			for (const list of refs) for (const n of list) referenced.add(n);
			const orphans = oldParagraphs.map((_, index) => index + 1).filter((n) => !referenced.has(n));
			const useCount = /* @__PURE__ */ new Map();
			for (const list of refs) for (const n of list) useCount.set(n, (useCount.get(n) ?? 0) + 1);
			const prevRef = [];
			const nextRef = [];
			{
				let last = 0;
				for (let i = 0; i < refs.length; i += 1) {
					prevRef.push(last);
					const list = refs[i];
					if (list !== void 0 && list.length > 0) last = list[list.length - 1] ?? last;
				}
				let next = oldParagraphs.length + 1;
				for (let i = refs.length - 1; i >= 0; i -= 1) {
					nextRef[i] = next;
					const list = refs[i];
					if (list !== void 0 && list.length > 0) next = list[0] ?? next;
				}
			}
			if (alignment.degraded) {
				issues.push("这一集改动很大，程序没能逐行精细比对；下面的对应关系是按位置推的，请复核");
				return {
					paragraphs: spans.map((span, index) => {
						const text = texts[index] ?? "";
						const old = oldParagraphs[index];
						const same = old !== void 0 && textOfOldParagraph(oldLines, old) === text;
						const origin = same ? "same" : old === void 0 ? "added" : "edited";
						return makeParagraph(index + 1, span, text, origin, origin === "added" ? null : index + 1, old?.sourceRanges ?? null, !same, false);
					}),
					deleted: orphans,
					degraded: true,
					issues
				};
			}
			const out = spans.map((span, index) => {
				const text = texts[index] ?? "";
				const list = refs[index] ?? [];
				if (list.length === 1) {
					const from = list[0] ?? 1;
					const shared = (useCount.get(from) ?? 0) > 1;
					const same = textOfOldParagraph(oldLines, oldParagraphs[from - 1]) === text && !shared;
					return makeParagraph(index + 1, span, text, same ? "same" : "edited", from, oldParagraphs[from - 1]?.sourceRanges ?? null, !same || shared, shared);
				}
				if (list.length > 1) {
					const from = list[0] ?? 1;
					return makeParagraph(index + 1, span, text, "edited", from, oldParagraphs[from - 1]?.sourceRanges ?? null, true, true);
				}
				return makeParagraph(index + 1, span, text, "added", null, null, false, false);
			});
			const consumed = /* @__PURE__ */ new Set();
			let cursor = 0;
			while (cursor < out.length) {
				if (out[cursor]?.origin !== "added") {
					cursor += 1;
					continue;
				}
				let end = cursor;
				while (end + 1 < out.length && out[end + 1]?.origin === "added") end += 1;
				const runLength = end - cursor + 1;
				const from = prevRef[cursor] ?? 0;
				const to = nextRef[cursor] ?? oldParagraphs.length + 1;
				const candidates = orphans.filter((n) => n > from && n < to && !consumed.has(n));
				const pairs = /* @__PURE__ */ new Map();
				for (let offset = 0; offset < runLength; offset += 1) {
					const target = out[cursor + offset];
					if (target === void 0) continue;
					let best = null;
					for (const candidate of candidates) {
						if ([...pairs.values()].includes(candidate)) continue;
						const score = textSimilarity(target.text, textOfOldParagraph(oldLines, oldParagraphs[candidate - 1]));
						if (score < .5) continue;
						if (best === null || score > best.score) best = {
							index: candidate,
							score
						};
					}
					if (best !== null) pairs.set(offset, best.index);
				}
				const leftoverRun = [...Array(runLength).keys()].filter((offset) => !pairs.has(offset));
				const leftoverCandidates = candidates.filter((n) => ![...pairs.values()].includes(n));
				if (leftoverRun.length > 0 && leftoverRun.length === leftoverCandidates.length) leftoverRun.forEach((offset, index) => {
					const candidate = leftoverCandidates[index];
					if (candidate !== void 0) pairs.set(offset, candidate);
				});
				for (const [offset, fromIndex] of pairs) {
					const target = out[cursor + offset];
					if (target === void 0) continue;
					consumed.add(fromIndex);
					out[cursor + offset] = {
						...target,
						origin: "edited",
						fromIndex,
						sourceRanges: oldParagraphs[fromIndex - 1]?.sourceRanges ?? null,
						needsReview: true
					};
				}
				if ([...Array(runLength).keys()].filter((offset) => !pairs.has(offset)).length > 0 && candidates.length > 0) {
					const where = runLength === 1 ? `第 ${cursor + 1} 段` : `第 ${cursor + 1}—${end + 1} 段`;
					issues.push(`${where}改动太大，说不清对应原来哪一段，已按"新增"登记`);
				}
				cursor = end + 1;
			}
			return {
				paragraphs: out,
				deleted: orphans.filter((n) => !consumed.has(n)),
				degraded: false,
				issues
			};
		}
		/**
		* 引文还在不在正文里。
		*
		* ⚠️ 先用原样子串比（设计文档 §7.3 的口径）；失败再退一步，按"每行去首尾
		*    空白、连续空白压成一个空格"比一次 —— 人工编辑很容易在行尾多一个空格，
		*    那种情况不该判成"锚点失效"。两次都不中才算失效。
		*/
		function containsQuote(text, quote) {
			if (quote === "") return false;
			if (normalizeNewlines(text).includes(quote)) return true;
			const squash = (value) => normalizeNewlines(value).split("\n").map((line) => line.trim()).join("\n").replace(/[ \t]+/g, " ");
			return squash(text).includes(squash(quote));
		}
		function sameLines(a, b) {
			return a.length === b.length && a.every((line, i) => line === b[i]);
		}
		/** 一段文字 → 每一行（口径与 `validate.ts` 的 `splitLines` 一致）。 */
		function linesOf(text) {
			return splitLines(text);
		}
		/** 开一个状态。 */
		function initialSnapshotState(baseText) {
			return {
				text: baseText,
				baseText,
				frames: [],
				composing: false,
				pending: false,
				lastInputMs: 0,
				settleAtMs: null
			};
		}
		/** 两张帧内容一样（按行比，忽略行尾的换行差异）。 */
		function sameFrameText(a, b) {
			return sameLines(linesOf(a), linesOf(b));
		}
		/**
		* 拍一张帧（内容与上一张或基线一样就不拍）。
		*
		* ⚠️ 为什么"一样就不拍"：拼音敲到一半按 Esc 取消、候选窗里翻页，都会让文本框
		*    的值来回变；不比较的话历史里会塞满没意义的帧。
		*/
		function takeFrame(state, at, nowMs) {
			const last = state.frames[state.frames.length - 1]?.text ?? state.baseText;
			if (sameFrameText(state.text, last)) return {
				...state,
				pending: false,
				settleAtMs: null,
				lastInputMs: nowMs
			};
			return {
				...state,
				frames: [...state.frames, {
					text: state.text,
					...at === "" ? {} : { at }
				}],
				pending: false,
				settleAtMs: null,
				lastInputMs: nowMs
			};
		}
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
		function snapshotReducer(state, event) {
			switch (event.kind) {
				case "input": {
					const next = {
						...state,
						text: event.text,
						pending: true
					};
					if (state.composing) return {
						...next,
						settleAtMs: null
					};
					return {
						...next,
						lastInputMs: event.nowMs,
						settleAtMs: null
					};
				}
				case "compositionStart": return {
					...state,
					text: event.text,
					composing: true,
					pending: true,
					settleAtMs: null
				};
				case "compositionEnd": {
					const next = {
						...state,
						text: event.text,
						composing: false,
						pending: true
					};
					if (sameFrameText(next.text, next.frames[next.frames.length - 1]?.text ?? next.baseText)) return {
						...next,
						pending: false,
						settleAtMs: null,
						lastInputMs: event.nowMs
					};
					return {
						...next,
						settleAtMs: event.nowMs + 250
					};
				}
				case "blur": return event.text === state.text && state.composing ? {
					...state,
					composing: false
				} : takeFrame({
					...state,
					text: event.text,
					composing: false
				}, event.at, event.nowMs);
				case "flush": return takeFrame({
					...state,
					text: event.text,
					composing: false
				}, event.at, event.nowMs);
				case "tick":
					if (state.composing || !state.pending) return state;
					if (state.settleAtMs !== null) return event.nowMs >= state.settleAtMs ? takeFrame(state, event.at, event.nowMs) : state;
					return event.nowMs - state.lastInputMs >= 3e3 ? takeFrame(state, event.at, event.nowMs) : state;
				default: return state;
			}
		}
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
		function snapshotsForSubmit(state) {
			return {
				frames: [...state.frames],
				composing: state.composing
			};
		}
		//#endregion
		//#region src/shared/versions.ts
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
		const emptyTriple = () => ({
			content: null,
			manifest: null,
			annotation: null
		});
		const FIELD_LABEL = {
			content: "正文",
			manifest: "清单",
			annotation: "批注"
		};
		/**
		* 把一个版本目录里的文件名清单整理成"每集有哪些版本、哪一版有效"。
		*
		* @param input - 见 {@link VersionGroupInput}。
		* @returns 版本结构 + 这个版本自己的问题清单（给界面原样显示，不当错误处理）。
		*/
		function groupVersion(input) {
			const issues = [];
			const version = input.dir.startsWith("v") ? input.dir.slice(1) : input.dir;
			const episodes = /* @__PURE__ */ new Map();
			const bucket = (episode) => {
				const found = episodes.get(episode);
				if (found !== void 0) return found;
				const created = {
					baseline: emptyTriple(),
					minors: /* @__PURE__ */ new Map()
				};
				episodes.set(episode, created);
				return created;
			};
			const put = (field, name, parsed) => {
				if (parsed === void 0) return;
				const target = bucket(parsed.episode);
				let triple;
				if (parsed.tag === void 0 || parsed.minor === void 0) triple = target.baseline;
				else {
					const existing = target.minors.get(parsed.minor);
					if (existing !== void 0) triple = existing.files;
					else {
						const created = {
							tag: parsed.tag,
							minor: parsed.minor,
							files: emptyTriple()
						};
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
					if (parsed === void 0 || parsed.kind !== kind) {
						issues.push(`${dirName}/${name}：文件名不认识`);
						continue;
					}
					if (kind === "content" && parsed.word !== input.word) {
						issues.push(`${dirName}/${name}："${parsed.word ?? "?"}"不是这个工作台的正文（这里应当是"${input.word}"）`);
						continue;
					}
					if (parsed.tag !== void 0 && !tagMatchesDir(parsed.tag, input.dir)) {
						issues.push(`${dirName}/${name}：小版本号与目录 ${input.dir} 对不上`);
						continue;
					}
					put(kind === "content" ? "content" : kind === "manifest" ? "manifest" : "annotation", name, parsed);
				}
			};
			scanDir(input.word, "content");
			scanDir("清单", "manifest");
			scanDir("批注", "annotation");
			for (const name of input.files["历史"] ?? []) {
				const parsed = parseContentName(name);
				if (parsed === void 0 || parsed.kind !== "history") issues.push(`历史/${name}：文件名不认识`);
			}
			const out = [];
			for (const [episode, entry] of [...episodes.entries()].sort((a, b) => a[0] - b[0])) {
				const epIssues = [];
				if (entry.baseline.content === null) epIssues.push(`第 ${episode} 集：缺${input.word}文件`);
				if (entry.baseline.manifest === null) epIssues.push(`第 ${episode} 集：缺清单文件`);
				const minors = [...entry.minors.values()].sort((a, b) => a.minor - b.minor);
				let effective = {
					tag: null,
					files: entry.baseline
				};
				for (const minor of minors) {
					const hasContent = minor.files.content !== null;
					const hasManifest = minor.files.manifest !== null;
					if (!hasContent && !hasManifest) {
						epIssues.push(`第 ${episode} 集 ${minor.tag}：只有批注文件，没有对应的正文与清单`);
						continue;
					}
					if (!hasContent || !hasManifest) {
						epIssues.push(`第 ${episode} 集 ${minor.tag}：这一版不完整（缺${hasContent ? "清单" : input.word}）`);
						continue;
					}
					effective = {
						tag: minor.tag,
						files: minor.files
					};
				}
				out.push({
					episode,
					baseline: entry.baseline,
					minors,
					effective,
					issues: epIssues
				});
			}
			return {
				version,
				dir: input.dir,
				episodes: out,
				hasChangelog: input.hasChangelog,
				issues
			};
		}
		/** 界面上给这一集打的版本标签：`v2.3（人工）` 或 `v2`。 */
		function effectiveLabel(entry, version) {
			return entry.effective.tag === null ? `v${version}` : `${entry.effective.tag}（人工）`;
		}
		//#endregion
		//#region src/client/workspace.ts
		/**
		* 数据层：从**固定目录**读工作台，读原文 / 剧本 / 清单。
		*
		* 与旧版的区别（设计文档 §9.2）：这里是"读固定目录 + 按文件名配对"，
		* **不再扫描整个工作区、不再猜哪个文件是什么**。
		*
		* 一条实测出来的契约：`workspaceFiles.list/read` 的**第一个参数是会话 id**，
		* 不是工作区 id —— 会话锚定了工作区根，所以"读哪个工作区"由当前会话决定。
		*
		* ⚠️ 从人工编辑模式起，一个大版本目录里除了基线文件还会有**小版本文件**
		*    （`第1集剧本.v2.1.txt`）。"哪堆文件属于哪一集、哪一版有效"这段判断
		*    全部在 `shared/versions.ts` 的 `groupVersion` 里（纯函数、有回归用例），
		*    这里只负责把目录列出来喂给它。
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
		*    合集文件很容易超，静默截断会让人看到"看起来完整"的半份稿子。
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
			hasNovel: false,
			versions: [],
			issues: [],
			error: "还没有开始扫描"
		};
		/** 版本目录里我们关心的四个子目录 —— 顺序固定，方便日志与用例。 */
		const SUB_DIRS = [
			SCRIPT_DIR,
			MANIFEST_DIR,
			ANNOTATION_DIR,
			HISTORY_DIR
		];
		/**
		* 扫 `剧本工作台/`：有哪些版本、每个版本有哪些集、每集哪一版有效。
		*
		* 只做机械检查（文件在不在、名字认不认识），**不判断剧情内容**；
		* "哪一版有效"由 `groupVersion` 判定（正文 + 清单都齐的最高小版本）。
		*/
		async function scanWorkbench(files, sessionId, signal) {
			const root = await listDir(files, sessionId, ".", signal);
			if (root === void 0 || !root.dirs.includes("剧本工作台")) return {
				phase: "missing",
				hasNovel: false,
				versions: [],
				issues: [],
				error: ""
			};
			const issues = [];
			const bench = await listDir(files, sessionId, WORKBENCH_DIR, signal);
			if (bench === void 0) return {
				phase: "error",
				hasNovel: false,
				versions: [],
				issues: [],
				error: `读不了 ${WORKBENCH_DIR}/`
			};
			const hasNovel = bench.files.includes(NOVEL_FILE);
			if (!hasNovel) issues.push(`缺 ${NOVEL_FILE} —— 原文还没拷进剧本工作台`);
			const versionDirs = bench.dirs.map((dir) => ({
				dir,
				version: versionOfDir(dir)
			})).filter((x) => x.version !== void 0).sort((a, b) => compareVersions(a.version, b.version));
			if (versionDirs.length === 0) return {
				phase: "empty",
				hasNovel,
				versions: [],
				issues,
				error: ""
			};
			const versions = [];
			for (const { dir } of versionDirs) {
				const inside = await listDir(files, sessionId, `${WORKBENCH_DIR}/${dir}`, signal);
				const listed = {};
				for (const sub of SUB_DIRS) {
					if (inside === void 0 || !inside.dirs.includes(sub)) {
						listed[sub] = [];
						continue;
					}
					listed[sub] = (await listDir(files, sessionId, `剧本工作台/${dir}/${sub}`, signal))?.files ?? [];
				}
				const grouped = groupVersion({
					dir,
					word: SCRIPT_DIR,
					files: listed,
					hasChangelog: inside?.files.includes(CHANGELOG_FILE) === true
				});
				for (const issue of grouped.issues) issues.push(`${dir} ${issue}`);
				for (const entry of grouped.episodes) for (const issue of entry.issues) issues.push(`${dir} ${issue}`);
				versions.push(grouped);
			}
			return {
				phase: "ready",
				hasNovel,
				versions,
				issues,
				error: ""
			};
		}
		//#endregion
		//#region src/client/data.ts
		/**
		* 数据 hook：`工作台目录 → 版本/集 → 一集的清单+剧本 → 段落 → 批注`。
		*
		* 全部只做机械的事：读文件、解析、按规则核对行结构、把段落切出来。
		* 任何读不到 / 读不懂的地方都变成**界面上看得见的错误**，不猜、不降级。
		*/
		const messageOf = (error) => error instanceof Error ? error.message : String(error);
		/**
		* 把宿主返回的批注**统一成新格式**。
		*
		* ⚠️ 为什么需要（2026-09-14 踩过）：批注格式从扁平的 `paragraph`/`quote`
		*    改成了 `regions` 数组。**宿主半边要重启服务才会更新**，所以会出现
		*    "新客户端 + 老宿主"：老宿主返回老格式，客户端直接读 `a.regions[0]`
		*    就抛异常 —— 整个工作台组件崩掉，**浮窗什么都画不出来**。
		*    这里统一过一遍 `parseAnnotations`（它本来就兼容两种格式），
		*    顺带把坏数据挡在外面，不让一条脏数据把界面搞崩。
		*/
		function toAnnotations(value) {
			return parseAnnotations(value).annotations ?? [];
		}
		function useWorkbench(files, sessionId) {
			const [scan, setScan] = (0, react.useState)(EMPTY_SCAN);
			const [phase, setPhase] = (0, react.useState)("idle");
			const [error, setError] = (0, react.useState)("");
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (files === void 0 || sessionId === void 0 || sessionId === "") {
					setPhase("idle");
					setScan(EMPTY_SCAN);
					return;
				}
				const ac = new AbortController();
				setPhase("loading");
				setError("");
				scanWorkbench(files, sessionId, ac.signal).then((result) => {
					if (ac.signal.aborted) return;
					setScan(result);
					setPhase("ready");
				}).catch((err) => {
					if (ac.signal.aborted) return;
					setError(messageOf(err));
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
				scan,
				phase,
				error,
				reload: (0, react.useCallback)(() => setNonce((n) => n + 1), [])
			};
		}
		function useNovel(files, sessionId, enabled) {
			const [state, setState] = (0, react.useState)({
				lines: [],
				phase: "idle",
				error: ""
			});
			(0, react.useEffect)(() => {
				if (!enabled || files === void 0 || sessionId === void 0 || sessionId === "") {
					setState({
						lines: [],
						phase: "idle",
						error: ""
					});
					return;
				}
				let alive = true;
				setState({
					lines: [],
					phase: "loading",
					error: ""
				});
				tryReadText(files, sessionId, novelPath()).then((text) => {
					if (!alive) return;
					if (text === void 0) {
						setState({
							lines: [],
							phase: "error",
							error: `读不到 ${novelPath()} —— 原文还没拷进剧本工作台`
						});
						return;
					}
					setState({
						lines: splitLines(text),
						phase: "ready",
						error: ""
					});
				}).catch((err) => {
					if (!alive) return;
					setState({
						lines: [],
						phase: "error",
						error: messageOf(err)
					});
				});
				return () => {
					alive = false;
				};
			}, [
				files,
				sessionId,
				enabled
			]);
			return state;
		}
		const EMPTY_EPISODE = {
			phase: "idle",
			error: "",
			issues: [],
			paragraphs: [],
			novelRange: null,
			totalLines: 0
		};
		/**
		* 读一集的清单 + 剧本。
		*
		* @param tag - 小版本号（如 `v2.1`）；`null` = 基线。
		*   **必须传这一集的有效版本** —— 看哪一份正文，就要配哪一份清单，
		*   两者的行号是一套；传错就会出现"清单与剧本对不上"的假报警。
		*/
		function useEpisode(files, sessionId, version, episode, tag) {
			const [state, setState] = (0, react.useState)(EMPTY_EPISODE);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (files === void 0 || sessionId === void 0 || sessionId === "" || version === void 0 || episode === void 0) {
					setState(EMPTY_EPISODE);
					return;
				}
				let alive = true;
				const ac = new AbortController();
				setState({
					...EMPTY_EPISODE,
					phase: "loading"
				});
				(async () => {
					const manifestRel = manifestPath(version, episode, tag);
					const scriptRel = scriptPath(version, episode, tag);
					const manifestText = await tryReadText(files, sessionId, manifestRel, ac.signal);
					if (manifestText === void 0) {
						if (alive) setState({
							...EMPTY_EPISODE,
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
							...EMPTY_EPISODE,
							phase: "error",
							error: `${manifestRel} 不是合法 JSON：${messageOf(error)}`
						});
						return;
					}
					const parsed = parseEpisodeManifest(raw);
					if (parsed.manifest === null) {
						const detail = parsed.issues.map((i) => `${i.where}：${i.message}`).join("；");
						if (alive) setState({
							...EMPTY_EPISODE,
							phase: "error",
							error: `${manifestRel} 读不懂 —— ${detail}`
						});
						return;
					}
					const scriptText = await tryReadText(files, sessionId, scriptRel, ac.signal);
					if (scriptText === void 0) {
						if (alive) setState({
							...EMPTY_EPISODE,
							phase: "error",
							error: `缺剧本文件：${scriptRel}`
						});
						return;
					}
					const lines = splitLines(scriptText);
					const paragraphs = parsed.manifest.paragraphs.map((p, index) => {
						const [start, end] = p.scriptLines;
						const broken = start === 0 && end === 0;
						const body = broken ? [] : lines.slice(start - 1, end);
						return {
							index: index + 1,
							text: body.join("\n"),
							lines: body,
							scriptLines: p.scriptLines,
							sourceRanges: p.sourceRanges,
							broken
						};
					});
					if (!alive) return;
					setState({
						phase: "ready",
						error: "",
						issues: [...parsed.issues, ...checkScriptStructure(scriptText, parsed.manifest)],
						paragraphs,
						novelRange: computeNovelRange(parsed.manifest),
						totalLines: lines.length
					});
				})().catch((err) => {
					if (!alive) return;
					setState({
						...EMPTY_EPISODE,
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
				tag,
				nonce
			]);
			const reload = (0, react.useCallback)(() => setNonce((n) => n + 1), []);
			return {
				...state,
				reload
			};
		}
		function useAnnotations(sessionId, version, episode, tag) {
			const [phase, setPhase] = (0, react.useState)("idle");
			const [error, setError] = (0, react.useState)("");
			const [annotations, setAnnotations] = (0, react.useState)([]);
			const [saving, setSaving] = (0, react.useState)(false);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (sessionId === void 0 || sessionId === "" || version === void 0 || episode === void 0) {
					setPhase("idle");
					setAnnotations([]);
					return;
				}
				let alive = true;
				setPhase("loading");
				setError("");
				loadAnnotations(sessionId, version, episode, tag).then((result) => {
					if (!alive) return;
					if (!result.ok) {
						setAnnotations([]);
						setError(result.error);
						setPhase("error");
						return;
					}
					setAnnotations(toAnnotations(result.annotations));
					setPhase("ready");
				}).catch((err) => {
					if (!alive) return;
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
				tag,
				nonce
			]);
			const save = (0, react.useCallback)(async (next) => {
				if (sessionId === void 0 || sessionId === "" || version === void 0 || episode === void 0) {
					setError("还没有可用的会话 / 集，存不了批注");
					return false;
				}
				setSaving(true);
				try {
					const result = await saveAnnotations(sessionId, version, episode, tag, next);
					if (!result.ok) {
						setError(result.error);
						return false;
					}
					setAnnotations(result.annotations);
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
				episode,
				tag
			]);
			return {
				phase,
				error,
				annotations,
				saving,
				reload: (0, react.useCallback)(() => setNonce((n) => n + 1), []),
				save
			};
		}
		//#endregion
		//#region src/client/edit.ts
		/**
		* 保存通道的浏览器端：把"改完的全文 + 编辑过程中的快照"交给宿主。
		*
		* 通道是官方 `/api` 载体上的一个 exact Fetch route（路径见 `shared/protocol.ts`
		* 的 `EDIT_ROUTE`）。**读盘比对、按内容对齐、写新小版本的三件套、写历史**
		* 全部在宿主侧一次完成，这里只把结果带回界面。
		*
		* ⚠️ 这条通道**只新增文件**，永远不会覆盖老版本；失败时宿主会明确说
		*    "已经写了哪几个文件"，界面照原话显示，不假装成功。
		*/
		/** 提交一次人工编辑。 */
		async function submitEdit(body, signal) {
			let response;
			try {
				response = await fetch(EDIT_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					...signal === void 0 ? {} : { signal }
				});
			} catch (error) {
				return {
					ok: false,
					error: `连不上保存通道（${EDIT_ROUTE}）：${error instanceof Error ? error.message : String(error)}`
				};
			}
			if (!response.ok) return {
				ok: false,
				error: `保存通道返回 HTTP ${response.status}`
			};
			try {
				return await response.json();
			} catch {
				return {
					ok: false,
					error: "保存通道返回的不是合法 JSON"
				};
			}
		}
		//#endregion
		//#region src/client/unsaved.ts
		/**
		* "还有没保存的人工改动"这个状态，需要在**两个模块之间**传递：
		* 工作台（浮层里的组件）知道有没有改动，而**关掉浮层的按钮在另一个模块**
		* （`client/index.tsx` 的侧栏/标题栏入口）。
		*
		* 所以放一个模块级的小开关，而不是把状态提上去：浮层关掉时组件会卸载，
		* 用模块级变量最直接，也和本插件已有的 `open` 小 store 是一个路数。
		*
		* ⚠️ 只用来**拦一下确认**，不存草稿内容 —— 草稿归工作台自己管。
		*/
		let dirty = false;
		/** 工作台告诉外面："现在有没有没保存的改动"。 */
		function setUnsaved(next) {
			dirty = next;
		}
		/** 外面问："现在能安全地关掉工作台吗？" */
		function hasUnsaved() {
			return dirty;
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
		* 剧本批注工作台（设计文档 `docs/执行设计-v2.md`）。
		*
		* 三栏：小说原文 / 第 N 集剧本 / 批注。
		*
		* 这一版**不判断剧情内容**：剧本按"剧本段落"渲染，段落是角色、对白、动作还是转场，
		* 程序一概不管；对应关系完全照清单里的 `sourceRanges` 用。
		*
		* 交互：
		*   · 悬停/点击剧本段落 → 左侧原文高亮这一段对应的原文行；
		*   · 在段落里划词 → 右侧批注栏出现"写问题"的框（一次只能选一段内的连续文字）；
		*   · 点批注卡上的「定位」→ 跳到那一段；
		*   · 清单与剧本对不上 / 文件缺失 → 顶部醒目地说出来，不猜。
		*/
		/** 毫秒 → `14:20:44`（历史/提示里给人看的时间）。 */
		function clockOf(ms) {
			return new Date(ms).toTimeString().slice(0, 8);
		}
		/** 光标偏移 → 第几行（1 基）。 */
		function lineOfOffset(text, offset) {
			const clamped = Math.max(0, Math.min(offset, text.length));
			return text.slice(0, clamped).split("\n").length;
		}
		/** 列宽约束：两侧最小 180，中间至少留 260。 */
		const MIN_SIDE = 180;
		const MIN_MID = 260;
		/** 浮动批注框的尺寸（用来把它夹进视口，免得贴边被切）。 */
		const POPUP_W = 320;
		const POPUP_H = 210;
		/** 一处区域的显示名：`第 6 段` / `第 3–7 段`（实现挪到 `shared/instruction.ts`，那里有用例）。 */
		/** 把几处区域摊平成段落号（去重、升序）—— 高亮和跳转都用它。 */
		function paragraphsOfRegions(regions) {
			const out = /* @__PURE__ */ new Set();
			for (const region of regions) {
				const to = region.endParagraph ?? region.paragraph;
				for (let index = region.paragraph; index <= to; index += 1) out.add(index);
			}
			return [...out].sort((a, b) => a - b);
		}
		/**
		* 未登记时给主人复制的那句话。
		*
		* 写得具体是因为 agent 需要知道**完整流程**：建目录、准备原文、一集一集调工具、
		* 先跑第 1 集。
		*
		* ⚠️ 第 2 步分两种情形（2026-09-15 加的）：原文是**整份拷**还是**按这一季的剧本
		*    节选一段**。为什么允许节选：原文动辄几十万字，整份放进工作台会让原文栏
		*    要渲染几万个 DOM 节点（还有工具每次都要把整份读一遍数行数），卡得没法用。
		*    但节选有一个硬前提：**范围要覆盖这一季的全部集数**，否则后面几集登记时
		*    原文里没有对应行，会静默变成"新增"、界面上只是高亮不出来，不报错。
		*    所以要求 agent **先报范围、等用户确认**再拷。
		*/
		const REGISTER_PROMPT = [
			"请把这个工作区建成「剧本批注工作台」。步骤：",
			"",
			"1. 在工作区根目录下建 `剧本工作台/` 文件夹。",
			"2. 把小说原文**准备**成 `剧本工作台/小说原文.txt`：",
			"   · **原文不长**（比如几千行以内）：直接整份拷过来（用 Copy-Item，字节复制，",
			"     不要用 Get-Content/Set-Content）。用户原始的稿子一个字都不要动。",
			"   · **原文很长**：不要整份拷，**按章截**（长篇小说都是按章走的）：",
			"     先判断我给你的这份剧本（一季）覆盖原文的哪几章（例如\"第 12 章—第 20 章\"），",
			"     然后**从第 12 章的开头截到第 20 章的结尾**（整章保留，不要切在半章中间），",
			"     再拷进 `小说原文.txt`。",
			"     拷之前**把章的范围和依据报给我、等我确认**；原文没有分章标记、或者判断不出",
			"     边界，就**直接问我**，不要猜、也不要先拷一整份。",
			"   · 节选之后，原文行号**从 1 重新算**：后面登记的 sourceRanges 都以节选后的",
			"     行号为准。以后要做这一季之外的集，得按同样的办法扩范围（也按章扩），",
			"     并把受影响集数的 sourceRanges 跟着重算。",
			"3. 逐集登记：把剧本正文按\"段落\"切开，每段判断它来自原文哪几行，",
			"   然后用 novel_script_write_episode 工具提交（一次一集）。",
			"   · 段落 = 可独立高亮和批注的一段文字，内部可以多行，但**不能有空白行**；",
			"   · 原文里没有对应的段落，sourceRanges 写 null（比如 FADE IN:、场景标题、新增动作）；",
			"   · 只保留纯剧情正文，去掉来源依据、附录、表格、SOURCE_BLOCK 标记、章节标记。",
			"4. **先只做第 1 集**，让我在工作台看一眼，确认没问题再继续第 2 集，然后才是剩下的。",
			"",
			"注意：不要自己手写剧本文件和清单文件 —— 行号、段落编号、文件生成都由工具负责。"
		].join("\n");
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
			const effTag = episode?.effective.tag ?? null;
			const ep = useEpisode(files, sessionId, version?.dir, episode?.episode, effTag);
			const novel = useNovel(files, sessionId, scan.phase === "ready" || scan.phase === "empty");
			const anno = useAnnotations(sessionId, version?.dir, episode?.episode, effTag);
			const [editMode, setEditMode] = (0, react.useState)(false);
			const [drafts, setDrafts] = (0, react.useState)({});
			const [savingDraft, setSavingDraft] = (0, react.useState)(false);
			const [caretLine, setCaretLine] = (0, react.useState)(1);
			const taRef = (0, react.useRef)(null);
			const gutRef = (0, react.useRef)(null);
			const latestVersionDir = scan.versions[scan.versions.length - 1]?.dir ?? null;
			const structureOk = ep.phase === "ready" && !ep.issues.some((issue) => issue.level === "error");
			const canEdit = version !== null && version.dir === latestVersionDir && structureOk;
			const draftKey = `${version?.dir ?? ""}#${episode?.episode ?? 0}`;
			/**
			* 该集"这一版的正文"。
			*
			* 为什么是"把清单切出来的段落拼回去"：正文文件本来就是"段落之间一个空白行"
			* 拼成的（`buildScriptText`），所以拼回去 == 文件本身。一旦清单与正文对不上
			* （`ep.issues` 里有 error），拼回去可能丢内容 —— 那种情况**不允许编辑**。
			*/
			const baseDraft = (0, react.useMemo)(() => {
				if (ep.phase !== "ready" || !structureOk) return null;
				const text = ep.paragraphs.map((p) => p.text).join("\n\n");
				return {
					text,
					baseText: text,
					baseMinor: effTag,
					snap: initialSnapshotState(text)
				};
			}, [
				ep,
				effTag,
				structureOk
			]);
			const draft = drafts[draftKey] ?? baseDraft;
			const draftDirty = draft !== null && draft.text !== draft.baseText;
			/** 编辑面上每一行的行号（**编辑模式下左边只显示行号**，不显示段号）。 */
			const draftLines = (0, react.useMemo)(() => draft === null ? [] : draft.text.split("\n"), [draft]);
			/** 改草稿的唯一入口（顺带把快照状态机推进一步）。 */
			const mutateDraft = (0, react.useCallback)((updater) => {
				setDrafts((prev) => {
					const cur = prev[draftKey] ?? baseDraft;
					if (cur === null) return prev;
					return {
						...prev,
						[draftKey]: updater(cur)
					};
				});
			}, [draftKey, baseDraft]);
			/**
			* 光标移动 → 记下在第几行（底栏据此显示"光标所在段 → 原文哪几行"）。
			*
			* ⚠️ 从 ref 上取值，**不要用事件对象**：React 在事件派发结束后会把合成事件的
			*    `currentTarget` 置成 null，而这个回调可能稍后才跑（见 textarea 上的注释，
			*    2026-09-15 因此在输入法组合期间崩过一次）。
			*/
			const updateCaretFromRef = (0, react.useCallback)(() => {
				const ta = taRef.current;
				if (ta === null) return;
				setCaretLine(lineOfOffset(ta.value, ta.selectionStart));
			}, []);
			/**
			* 编辑期间的"对照预览"（纯机械算一遍，不落盘）：
			* 拿当前草稿跟这一版的正文按内容对齐，就知道**光标所在那一段**对应原文哪几行。
			* 段号与对应关系只有保存后才写进新清单；这里只是让改的时候有个参照。
			*
			* ⚠️ 用**停手 250ms 后的那份文本**算（`previewText`）：每敲一个字都重算一遍
			*    对齐没必要，还会让打字手感变钝。行号槽不受影响 —— 那个只是数行数。
			*/
			const [previewText, setPreviewText] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!editMode || draft === null) {
					setPreviewText(null);
					return;
				}
				const timer = window.setTimeout(() => setPreviewText(draft.text), 250);
				return () => {
					window.clearTimeout(timer);
				};
			}, [editMode, draft]);
			const livePreview = (0, react.useMemo)(() => {
				if (!editMode || previewText === null || ep.phase !== "ready" || !structureOk) return null;
				return deriveParagraphs(ep.paragraphs.flatMap((p, index) => index === 0 ? p.lines : ["", ...p.lines]), previewText.split("\n"), ep.paragraphs.map((p) => ({
					scriptLines: p.scriptLines,
					sourceRanges: p.sourceRanges
				})));
			}, [
				editMode,
				previewText,
				ep,
				structureOk
			]);
			/** 光标所在那一段（光标落在两段之间时取前面最近的一段）。 */
			const caretParagraph = (0, react.useMemo)(() => {
				if (livePreview === null) return null;
				const inside = livePreview.paragraphs.find((p) => caretLine >= p.span.start && caretLine <= p.span.end);
				if (inside !== void 0) return inside;
				let before = null;
				for (const p of livePreview.paragraphs) if (p.span.start <= caretLine) before = p;
				return before;
			}, [livePreview, caretLine]);
			/** "有没有没保存的改动"要告诉外面：关浮层的按钮在另一个模块里。 */
			const anyDirty = (0, react.useMemo)(() => Object.values(drafts).some((d) => d.text !== d.baseText), [drafts]);
			(0, react.useEffect)(() => {
				setUnsaved(editMode && anyDirty);
				return () => {
					setUnsaved(false);
				};
			}, [editMode, anyDirty]);
			/** 刷新 / 关标签页也拦一下。 */
			(0, react.useEffect)(() => {
				if (!editMode || !anyDirty) return;
				const onUnload = (e) => {
					e.preventDefault();
					e.returnValue = "";
				};
				window.addEventListener("beforeunload", onUnload);
				return () => {
					window.removeEventListener("beforeunload", onUnload);
				};
			}, [editMode, anyDirty]);
			/** 每秒推进一次快照状态机（停手 3 秒拍一张；组合期间它自己不拍）。 */
			(0, react.useEffect)(() => {
				if (!editMode) return;
				const timer = window.setInterval(() => {
					const now = Date.now();
					setDrafts((prev) => {
						const cur = prev[draftKey];
						if (cur === void 0) return prev;
						const next = snapshotReducer(cur.snap, {
							kind: "tick",
							at: clockOf(now),
							nowMs: now
						});
						if (next === cur.snap) return prev;
						return {
							...prev,
							[draftKey]: {
								...cur,
								snap: next
							}
						};
					});
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [editMode, draftKey]);
			/** 切走之前先问一句（有未保存改动时）。 */
			const leaveGuard = (0, react.useCallback)(() => {
				if (!draftDirty) return true;
				return window.confirm("这一集还有没保存的人工改动，切走就丢了。确定切走吗？");
			}, [draftDirty]);
			const pickEpisodeGuarded = (0, react.useCallback)((episodeNo) => {
				if (leaveGuard()) setPickEpisode(episodeNo);
			}, [leaveGuard]);
			const pickVersionGuarded = (0, react.useCallback)((dir) => {
				if (!leaveGuard()) return;
				setEditMode(false);
				setPickVersion(dir);
				setPickEpisode(null);
			}, [leaveGuard]);
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
					const result = await loadAnnotations(sessionId, dir, item.episode, item.effective.tag);
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
			const [hoverParagraph, setHoverParagraph] = (0, react.useState)(null);
			const [pinnedParagraphs, setPinnedParagraphs] = (0, react.useState)([]);
			const isPinned = (0, react.useCallback)((index) => pinnedParagraphs.includes(index), [pinnedParagraphs]);
			/** 当前要高亮的段落：钉住优先，否则看悬停的那一段。 */
			const activeParagraphs = (0, react.useMemo)(() => {
				if (pinnedParagraphs.length > 0) return ep.paragraphs.filter((p) => pinnedParagraphs.includes(p.index));
				if (hoverParagraph === null) return [];
				return ep.paragraphs.filter((p) => p.index === hoverParagraph);
			}, [
				ep.paragraphs,
				pinnedParagraphs,
				hoverParagraph
			]);
			/** 当前要高亮的原文行（钉住多段时取并集；**编辑模式下跟着光标走**）。 */
			const highlightLines = (0, react.useMemo)(() => {
				const out = /* @__PURE__ */ new Set();
				if (editMode && caretParagraph !== null) {
					for (const [a, b] of caretParagraph.sourceRanges ?? []) for (let ln = a; ln <= b; ln += 1) out.add(ln);
					return out;
				}
				for (const paragraph of activeParagraphs) for (const [a, b] of paragraph.sourceRanges ?? []) for (let ln = a; ln <= b; ln += 1) out.add(ln);
				return out;
			}, [
				activeParagraphs,
				editMode,
				caretParagraph
			]);
			/**
			* 本集覆盖范围那根**竖条**的位置。
			*
			* 主人 2026-09-14：整集覆盖要用**一根连续的竖条**表示。
			* 如果按"每行一道 inset 阴影"来画，行的圆角 + 行距会把它切成一截截
			* （看起来像一串括号）。所以这里量出第一条与最后一条被覆盖的行，
			* 单独画一根绝对定位的竖条。
			*/
			const [coverBar, setCoverBar] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const box = novelRef.current;
				const range = ep.novelRange;
				if (box === null || range === null || novel.phase !== "ready") {
					setCoverBar(null);
					return;
				}
				const first = box.querySelector(`[data-ln="${range[0]}"]`);
				const last = box.querySelector(`[data-ln="${range[1]}"]`);
				if (first === null || last === null) {
					setCoverBar(null);
					return;
				}
				setCoverBar({
					top: first.offsetTop,
					height: last.offsetTop + last.offsetHeight - first.offsetTop
				});
			}, [
				ep.novelRange,
				novel.phase,
				novel.lines.length
			]);
			const scriptRef = (0, react.useRef)(null);
			const novelRef = (0, react.useRef)(null);
			/** 批注框（跟着选区浮出来的那个）的 DOM，用来判断"点框外"。 */
			const popRef = (0, react.useRef)(null);
			/** 待写的批注：已经选了哪几处（Ctrl 累积）、批注框浮在哪儿、框是否已经弹出来。 */
			const [pending, setPending] = (0, react.useState)(null);
			const [problem, setProblem] = (0, react.useState)("");
			const [toast, setToast] = (0, react.useState)("");
			/** 开/关编辑模式。退出时若有未保存改动先问一句。 */
			const toggleEditMode = (0, react.useCallback)(() => {
				if (editMode) {
					if (draftDirty && !window.confirm("还有没保存的改动，退出编辑就丢了。确定退出吗？")) return;
					setEditMode(false);
					return;
				}
				if (!canEdit) return;
				setEditMode(true);
				setCaretLine(1);
			}, [
				editMode,
				draftDirty,
				canEdit
			]);
			/** 放弃这次改动（什么都不写）。 */
			const discardDraft = (0, react.useCallback)(() => {
				if (!draftDirty) return;
				if (!window.confirm("放弃这次改动？改的内容不会写进任何文件。")) return;
				setDrafts((prev) => {
					const next = { ...prev };
					delete next[draftKey];
					return next;
				});
			}, [draftDirty, draftKey]);
			/**
			* 保存：交给宿主写成**新小版本**（正文 + 清单 + 批注 + 历史）。
			*
			* ⚠️ 失败时**草稿原样留着**，把宿主的话原样显示出来 —— 不假装保存成功，
			*    也不因为失败就把用户改的内容丢掉。
			*/
			const saveDraft = (0, react.useCallback)(async () => {
				if (draft === null || version === null || episode === null) return;
				if (sessionId === void 0 || sessionId === "") {
					setToast("还没有可用的会话，存不了");
					return;
				}
				const now = Date.now();
				const snap = snapshotReducer(draft.snap, {
					kind: "flush",
					text: draft.text,
					at: clockOf(now),
					nowMs: now
				});
				const submitted = snapshotsForSubmit(snap);
				setSavingDraft(true);
				const result = await submitEdit({
					sessionId,
					version: version.dir,
					episode: episode.episode,
					baseMinor: draft.baseMinor,
					baseText: draft.baseText,
					text: draft.text,
					snapshots: submitted.frames
				});
				setSavingDraft(false);
				if (!result.ok) {
					mutateDraft((cur) => ({
						...cur,
						snap
					}));
					setToast(`没保存成功：${result.error}`);
					return;
				}
				setToast(`已保存为 ${result.minor}（+${result.summary.added} 行 / -${result.summary.removed} 行；清单已同步${result.annotations.stale.length === 0 ? "" : `，${result.annotations.stale.length} 条批注锚点失效`}）`);
				setDrafts((prev) => {
					const next = { ...prev };
					delete next[draftKey];
					return next;
				});
				wb.reload();
				ep.reload();
				anno.reload();
			}, [
				draft,
				version,
				episode,
				sessionId,
				mutateDraft,
				draftKey,
				wb,
				ep,
				anno
			]);
			(0, react.useEffect)(() => {
				if (toast === "") return;
				const timer = window.setTimeout(() => setToast(""), 2600);
				return () => window.clearTimeout(timer);
			}, [toast]);
			/**
			* 松手后读选区。
			*
			* 三条规则（主人 2026-09-14 定）：
			*   · **不按 Ctrl**：这一划就是新的全部选择（替换掉之前选的），**立刻弹输入框**；
			*   · **按住 Ctrl/Cmd**：把这一处**并进去** —— 这就是"多选不连续的几个地方"；
			*   · 按住 Ctrl 连选期间**不弹输入框**（主人指出："选完第一处就弹卡片"是错的），
			*     这段时间屏幕上**只有一个反馈**：被选中的段落带一层更深的底色
			*     （.ns-para-pending），**松开 Ctrl 之后再弹框**（见下面的 keyup 效果）。
			*     ⚠️ 不要在选区旁边飘提示文字 —— 主人 2026-09-14 否掉了：它就压在剧本上，
			*        会把接下来要划的那几行挡住。
			* 每一处都记成"段落范围"（连续跨段算一处），因为剧本段落是"一行一段"
			* 还是"多行一段"由 agent 决定。
			*/
			const onScriptMouseUp = (0, react.useCallback)((e) => {
				if (editMode) return;
				const multi = e.ctrlKey || e.metaKey;
				const releaseX = e.clientX;
				const releaseY = e.clientY;
				window.setTimeout(() => {
					const selection = window.getSelection();
					if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
					const range = selection.getRangeAt(0);
					const container = scriptRef.current;
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
			}, [editMode]);
			/**
			* Ctrl 连选期间那几处覆盖的段号。
			*
			* 为什么需要它：连选时输入框是**不弹**的，而选区又被 removeAllRanges 清掉了 ——
			* 屏幕上就没有任何"我到底选了哪几处"的反馈。所以给这些段落单独加一层底色，
			* 这也是连选期间**唯一**的反馈（不再飘提示文字，见 onScriptMouseUp 的说明）。
			*/
			const pendingParagraphs = (0, react.useMemo)(() => {
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
					if (e.target instanceof Element && e.target.closest(".ns-col-script") !== null) return;
					closePending();
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("mousedown", onDown);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("mousedown", onDown);
				};
			}, [pending, closePending]);
			/** 跨集跳转：先切集，等这一集读出来再滚过去。 */
			const [pendingJump, setPendingJump] = (0, react.useState)(null);
			/** 点批注卡 → 跳到它挂的那几处（剧本滚过去 + 原文高亮）；跨集也能跳。 */
			const jumpToParagraph = (0, react.useCallback)((episodeNo, regions) => {
				const targets = paragraphsOfRegions(regions);
				const first = targets[0];
				if (first === void 0) return;
				if (episode?.episode === episodeNo) {
					setPinnedParagraphs(targets);
					requestAnimationFrame(() => {
						scriptRef.current?.querySelector(`[data-paragraph="${first}"]`)?.scrollIntoView({
							block: "center",
							behavior: "smooth"
						});
					});
					return;
				}
				setPickEpisode(episodeNo);
				setPendingJump(targets);
			}, [episode]);
			(0, react.useEffect)(() => {
				const first = pendingJump?.[0];
				if (pendingJump === null || first === void 0 || ep.phase !== "ready") return;
				setPinnedParagraphs(pendingJump);
				setPendingJump(null);
				requestAnimationFrame(() => {
					scriptRef.current?.querySelector(`[data-paragraph="${first}"]`)?.scrollIntoView({
						block: "center",
						behavior: "smooth"
					});
				});
			}, [pendingJump, ep.phase]);
			/**
			* 选中剧本某几段 → 左侧原文**自动滚到对应位置**。
			*
			* 主人 2026-09-14 反馈："选择剧本后原文会高亮，但不会自动跳转原文对应位置"。
			* 只在**点选 / 定位**（`pinnedParagraphs`）时滚；悬停不滚 ——
			* 鼠标扫过段落时原文跟着乱跳会很难读。
			*/
			(0, react.useEffect)(() => {
				if (pinnedParagraphs.length === 0) return;
				let first = Number.POSITIVE_INFINITY;
				for (const paragraph of ep.paragraphs) {
					if (!pinnedParagraphs.includes(paragraph.index)) continue;
					for (const [a] of paragraph.sourceRanges ?? []) first = Math.min(first, a);
				}
				if (!Number.isFinite(first)) return;
				requestAnimationFrame(() => {
					novelRef.current?.querySelector(`[data-ln="${first}"]`)?.scrollIntoView({
						block: "center",
						behavior: "smooth"
					});
				});
			}, [pinnedParagraphs, ep.paragraphs]);
			/**
			* 编辑模式下：**光标走到哪一段，左边原文就滚到对应位置**。
			*
			* 上面那条是"点选/定位"触发的，编辑时没有点选，所以原文栏一直不动 ——
			* 主人 2026-09-15 反馈："编辑模式下原文不会自动跳到光标所在的那一行"。
			*
			* ⚠️ 只在**目标行当前看不见**时才滚：否则光标每换一行都滚一次，
			*    正打着字屏幕一直跟着动，很难读。滚的时候**上方留两行**上下文
			*    （和提示词对照那边同一个口径）。`sourceRanges` 为空的段（新增内容）
			*    没有可滚的目标 —— 底栏会写"原文里没有对应（新增）"，这里什么也不做。
			*/
			(0, react.useEffect)(() => {
				if (!editMode || caretParagraph === null) return;
				const ranges = caretParagraph.sourceRanges;
				if (ranges === null || ranges.length === 0) return;
				const box = novelRef.current;
				if (box === null) return;
				const first = Math.min(...ranges.map((range) => range[0]));
				const last = Math.max(...ranges.map((range) => range[1]));
				const firstEl = box.querySelector(`[data-ln="${first}"]`);
				if (firstEl === null) return;
				const lastEl = box.querySelector(`[data-ln="${last}"]`) ?? firstEl;
				const boxTop = box.getBoundingClientRect().top;
				const top = firstEl.getBoundingClientRect().top - boxTop + box.scrollTop;
				const bottom = lastEl.getBoundingClientRect().bottom - boxTop + box.scrollTop;
				if (top >= box.scrollTop && bottom <= box.scrollTop + box.clientHeight) return;
				const lineHeight = firstEl.offsetHeight > 0 ? firstEl.offsetHeight : 20;
				box.scrollTo({
					top: Math.max(0, top - lineHeight * 2),
					behavior: "smooth"
				});
			}, [editMode, caretParagraph]);
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
				const list = (allAnnotations[episodeNo] ?? []).filter((a) => a.id !== id);
				saveAnnotations(sessionId, dir, episodeNo, version?.episodes.find((item) => item.episode === episodeNo)?.effective.tag ?? null, list).then((result) => {
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
			/**
			* 这条批注挂的某一处还成不成立（设计文档 §7.3：**锚点失效是正常状态，不是错误**）。
			*
			* 判据只有一条：那一处引文还能不能在对应段落的正文里找到。找不到就标出来，
			* **不偷偷挪到同名文字上**。
			* 别的集的批注（"全部"模式）这里返回 `null`（不判）：没读它们的正文。
			*
			* ⚠️ 定义放在这里（而不是批注卡旁边）：组装下发指令时也要用它，
			*    而 `sendBatch` 比批注卡靠前 —— 放在后面会被"先用后声明"卡住。
			*/
			const regionIsValid = (0, react.useCallback)((region, episodeNo) => {
				if (episode === null || episodeNo !== episode.episode || ep.phase !== "ready") return null;
				const from = ep.paragraphs[region.paragraph - 1];
				if (from === void 0 || from.broken) return false;
				const end = region.endParagraph === void 0 ? region.paragraph : region.endParagraph;
				return containsQuote(ep.paragraphs.slice(region.paragraph - 1, end).map((p) => p.text).join("\n"), region.quote);
			}, [episode, ep]);
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
			/** 这一版里"有人工改动"的集（有效版本是小版本的那些）。 */
			const manualEpisodes = (0, react.useMemo)(() => (version?.episodes ?? []).filter((entry) => entry.effective.tag !== null).map((entry) => entry.episode), [version]);
			/** 当前"按集/全部"范围里，有几集带人工改动。 */
			const manualInScope = annoScope === "all" ? manualEpisodes.length : manualEpisodes.filter((no) => no === episode?.episode).length;
			/**
			* 组装"交给 agent"的那份指令（实施计划 §10）。
			*
			* ⚠️ 一份指令**同时**包含两件事：**人工已经改过的地方**（含历史记录文件路径）
			*    与**批注**（含"锚点已失效"的提醒），并显式写明"以最新版本为基线、
			*    旧版本只作参考"。为什么必须一起给：人工改过之后，批注的引文可能已经
			*    对不上正文了 —— agent 只看批注会改错地方，只看人工改动又会漏掉批注。
			*
			* 这里只负责"把这一轮牵涉到的集与批注凑齐"；**文案本身在
			* `shared/instruction.ts`**（纯函数 + 回归用例），免得这段最关键的话没人测。
			*/
			const buildInstruction$1 = (0, react.useCallback)((items) => {
				if (version === null) return "";
				const grouped = /* @__PURE__ */ new Map();
				for (const item of items) {
					const list = grouped.get(item.episode) ?? [];
					list.push(item.a);
					grouped.set(item.episode, list);
				}
				const inScope = new Set(grouped.keys());
				for (const no of manualEpisodes) if (annoScope === "all" || no === episode?.episode) inScope.add(no);
				if ([...inScope].sort((a, b) => a - b).length === 0) return "";
				const episodes = [...inScope].sort((a, b) => a - b).map((no) => {
					const entry = version.episodes.find((e) => e.episode === no);
					const list = grouped.get(no) ?? [];
					return {
						episode: no,
						tag: entry?.effective.tag ?? null,
						annotations: list,
						staleIds: list.filter((a) => (a.regions ?? []).some((r) => regionIsValid(r, no) === false)).map((a) => a.id)
					};
				});
				return buildInstruction({
					bookLine: novel.lines[0] ?? "",
					versionDir: version.dir,
					scope: annoScope,
					episodes,
					novelFile: novelPath()
				});
			}, [
				version,
				episode,
				annoScope,
				novel.lines,
				manualEpisodes,
				regionIsValid
			]);
			/**
			* 下发这一批（批注 + 人工改动）。
			*
			* ⚠️ 为什么是"复制到剪贴板"而不是直接写官方输入框：`shell.overlay` 这个席位
			* 拿不到 `inputActions`（只有 `conversation.*` 那些席位有），所以浮层里
			* 没法定向写官方输入框。主人粘一下即可（这是流程的下一步）。
			*/
			const sendBatch = (0, react.useCallback)(() => {
				const text = buildInstruction$1(sendItems);
				if (text === "") return;
				navigator.clipboard?.writeText(text).then(() => setToast(`已复制指令（${sendCount} 条批注${manualInScope === 0 ? "" : ` + ${manualInScope} 集人工改动`}） —— 粘到对话里发给 AI 即可`), () => setToast("复制失败（浏览器拒绝剪贴板）"));
			}, [
				buildInstruction$1,
				sendItems,
				sendCount,
				manualInScope
			]);
			const geo = useWorkbenchGeometry();
			const wbRef = geo.ref;
			const minBtnRef = (0, react.useRef)(null);
			const isMin = geo.mode === "min";
			/** 收起成胶囊时的高度：原来 24 太小，找不到也点不着（主人反馈）。
			36 = 样式里圆角 18 的两倍，正好是一枚完整的胶囊。 */
			const PILL_H = 36;
			(0, react.useEffect)(() => {
				if (isMin || editMode) return;
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
				isMin,
				editMode
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
			if (wb.error !== "") notices.push(`扫描出错：${wb.error}`);
			notices.push(...scan.issues);
			if (ep.error !== "") notices.push(ep.error);
			notices.push(...ep.issues.map((i) => `${i.where}：${i.message}`));
			if (anno.error !== "") notices.push(`批注：${anno.error}`);
			if (novel.error !== "") notices.push(novel.error);
			if (sessionSource === "fallback") notices.push("当前没有选中会话，借用的是工作区里的另一个会话；想更准请切到剧本所在工作区的会话。");
			const episodeLabel = episode === null ? "—" : `${episode.episode}`;
			const versionLabel = version === null ? "—" : `v${version.version}`;
			/** 这一集自己的版本标签（`v2.2（人工）` / `v2`）；没选中集时是空串。 */
			const episodeVersionLabel = episode === null || version === null ? "" : effectiveLabel(episode, version.version);
			/** 选集下拉里每一项的文案：基线显示 `第 3 集 · v2`，人工版显示 `第 1 集 · v2.2（人工）`。 */
			const episodeOptionLabel = (entry) => version === null ? `第 ${entry.episode} 集` : `第 ${entry.episode} 集 · ${effectiveLabel(entry, version.version)}`;
			/**
			* 一张批注卡。
			*
			* @param a - 批注内容（段落范围从 `a.paragraph` / `a.endParagraph` 取）。
			* @param episodeNo - 给了就显示"第 N 集"（"全部"模式用），并据此定位 / 删除。
			*/
			const annotationCard = (a, episodeNo) => {
				const episodeOfCard = episodeNo ?? episode?.episode ?? 0;
				const regions = a.regions ?? [];
				const first = regions[0];
				const staleCount = regions.filter((r) => regionIsValid(r, episodeOfCard) === false).length;
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
								staleCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "ns-tag ns-tag-stale",
									children: ["锚点已失效 ×", staleCount]
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
									onClick: () => jumpToParagraph(episodeOfCard, a.regions),
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
						regions.map((region, index) => {
							const valid = regionIsValid(region, episodeOfCard);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `ns-acard-q${valid === false ? " ns-acard-q-stale" : ""}`,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "ns-acard-ln",
										children: [regionLabel(region), valid === false ? "（旧版段号）" : ""]
									}),
									valid === false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ns-tag-stale",
										children: "引文已找不到"
									}) : null,
									"“",
									region.quote.length > 60 ? `${region.quote.slice(0, 60)}…` : region.quote,
									"”"
								]
							}, `${region.paragraph}-${index}`);
						}),
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
								children: "剧本批注"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ns-meta",
								children: scan.phase === "missing" ? "这个工作区还没登记" : `${versionLabel} · 第 ${episodeLabel} 集${effTag === null ? "" : ` · ${episodeVersionLabel}`}`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
							!isMin && scan.versions.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-x",
									title: "上一集（←）",
									disabled: episodeNav.prev === void 0,
									onClick: () => {
										if (episodeNav.prev !== void 0) pickEpisodeGuarded(episodeNav.prev.episode);
									},
									children: "◀"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ns-x",
									title: "下一集（→）",
									disabled: episodeNav.next === void 0,
									onClick: () => {
										if (episodeNav.next !== void 0) pickEpisodeGuarded(episodeNav.next.episode);
									},
									children: "▶"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "ns-sel",
									title: "选版本",
									value: version?.version ?? "",
									onChange: (e) => pickVersionGuarded(e.target.value),
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
									onChange: (e) => pickEpisodeGuarded(Number(e.target.value)),
									disabled: (version?.episodes.length ?? 0) === 0,
									children: (version?.episodes ?? []).map((x) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: String(x.episode),
										children: episodeOptionLabel(x)
									}, x.episode))
								})
							] }) : null,
							!isMin ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ns-x",
								title: "刷新",
								onClick: () => {
									wb.reload();
									ep.reload();
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: "剧本工作台/" }),
									" 这个固定目录，它自己不认识文件、也不解析剧本格式。 把下面这段话发给对话里的 AI，它建好目录、拷好原文、一集一集登记完，这里就会出现原文与剧本对照。"
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
								children: "剧本工作台里还没有版本"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-page-d",
								children: [
									"目录建好了，但里面还没有 ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: "v1/" }),
									"。让 AI 把第 1 集登记进来（它要用 novel_script_write_episode 工具）。"
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
						onMouseUp: onScriptMouseUp,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-col ns-col-src",
								style: { width: srcW },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ns-col-hd",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "小说原文" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "ns-sub",
											children: [novel.phase === "ready" ? `${novel.lines.length} 行` : novel.phase === "loading" ? "读取中…" : "—", ep.novelRange === null ? "" : ` · 本集 L${ep.novelRange[0]}—L${ep.novelRange[1]}`]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ns-col-bd",
									ref: novelRef,
									children: [coverBar === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "ns-coverbar",
										style: {
											top: coverBar.top,
											height: coverBar.height
										},
										"aria-hidden": true
									}), novel.phase !== "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "ns-empty",
										children: novel.phase === "loading" ? "正在读取原文…" : novel.error || "没有原文"
									}) : novel.lines.map((text, index) => {
										const ln = index + 1;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											"data-ln": ln,
											className: `ns-sline${highlightLines.has(ln) ? " ns-hl" : ""}`,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-ln",
												children: ln
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-stx",
												children: text
											})]
										}, ln);
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ns-split",
								onMouseDown: (e) => startColDrag(e, "src"),
								title: "拖动调整宽度"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ns-col ns-col-script",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ns-col-hd",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											"第 ",
											episodeLabel,
											" 集剧本 · ",
											versionLabel
										] }),
										effTag === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "ns-tag",
											children: [effTag, "（人工）"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ns-sub",
											children: editMode ? draftDirty ? "编辑中 · 有未保存改动" : "编辑中" : ep.phase === "ready" ? `${ep.totalLines} 行 · ${ep.paragraphs.length} 段` : ep.phase === "loading" ? "读取中…" : "—"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: `ns-toggle${editMode ? " ns-toggle-on" : ""}`,
											disabled: !editMode && !canEdit,
											title: editMode ? "退出编辑模式（回到标注）" : canEdit ? "直接编辑这一集：保存会写成新小版本，老版本一个字节都不动" : structureOk ? "只有最新的大版本才能直接编辑（老版本只读）" : "清单与正文对不上，先让 agent 修好再编辑",
											"aria-pressed": editMode,
											onClick: toggleEditMode,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "ns-toggle-dot" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: editMode ? "编辑中" : "直接编辑" })]
										})
									]
								}), editMode && draft !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ns-edit",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "ns-edit-body",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "ns-edit-gut",
											ref: gutRef,
											"aria-hidden": true,
											children: draftLines.map((_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "ns-edit-ln",
												children: index + 1
											}, index))
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											ref: taRef,
											className: "ns-edit-ta",
											value: draft.text,
											spellCheck: false,
											wrap: "off",
											"aria-label": "这一集剧本正文",
											onChange: (e) => {
												const text = e.target.value;
												const now = Date.now();
												mutateDraft((cur) => ({
													...cur,
													text,
													snap: snapshotReducer(cur.snap, {
														kind: "input",
														text,
														nowMs: now
													})
												}));
											},
											onCompositionStart: () => {
												const text = taRef.current?.value ?? "";
												const now = Date.now();
												mutateDraft((cur) => ({
													...cur,
													snap: snapshotReducer(cur.snap, {
														kind: "compositionStart",
														text,
														nowMs: now
													})
												}));
											},
											onCompositionEnd: () => {
												const text = taRef.current?.value ?? "";
												const now = Date.now();
												mutateDraft((cur) => ({
													...cur,
													text,
													snap: snapshotReducer(cur.snap, {
														kind: "compositionEnd",
														text,
														at: clockOf(now),
														nowMs: now
													})
												}));
											},
											onBlur: () => {
												const text = taRef.current?.value ?? "";
												const now = Date.now();
												mutateDraft((cur) => ({
													...cur,
													text,
													snap: snapshotReducer(cur.snap, {
														kind: "blur",
														text,
														at: clockOf(now),
														nowMs: now
													})
												}));
											},
											onScroll: () => {
												const ta = taRef.current;
												const gut = gutRef.current;
												if (ta !== null && gut !== null) gut.scrollTop = ta.scrollTop;
											},
											onSelect: updateCaretFromRef,
											onClick: updateCaretFromRef,
											onKeyUp: updateCaretFromRef
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "ns-edit-bar",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-edit-where",
												children: caretParagraph === null ? "光标不在正文里" : `第 ${caretParagraph.index} 段 · ${caretParagraph.sourceRanges === null ? "原文里没有对应（新增）" : `→ 原文 ${caretParagraph.sourceRanges.map((r) => `L${r[0]}—L${r[1]}`).join("、")}`}${caretParagraph.needsReview ? " · 待复核" : ""}`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ns-spacer" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "ns-btn",
												disabled: !draftDirty || savingDraft,
												onClick: discardDraft,
												children: "放弃"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "ns-btn ns-btn-primary",
												disabled: !draftDirty || savingDraft,
												onClick: () => {
													saveDraft();
												},
												children: savingDraft ? "保存中…" : "保存"
											})
										]
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ns-col-bd",
									ref: scriptRef,
									children: ep.phase !== "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "ns-empty",
										children: ep.phase === "loading" ? "正在读取这一集…" : ep.error || "读不到这一集"
									}) : ep.paragraphs.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										"data-paragraph": p.index,
										className: `ns-para${isPinned(p.index) ? " ns-para-pinned" : ""}${pendingParagraphs.has(p.index) ? " ns-para-pending" : ""}${p.broken ? " ns-para-broken" : ""}`,
										onMouseEnter: () => setHoverParagraph(p.index),
										onMouseLeave: () => setHoverParagraph((prev) => prev === p.index ? null : prev),
										onClick: () => setPinnedParagraphs((prev) => prev.length === 1 && prev[0] === p.index ? [] : [p.index]),
										title: p.sourceRanges === null ? "原文里没有对应（新增）" : `对应原文 ${p.sourceRanges.map((r) => `L${r[0]}—L${r[1]}`).join("、")}`,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-para-no",
												children: p.index
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "ns-para-tx",
												children: p.broken ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "ns-para-bad",
													children: "（这一段清单坏了，画不出来）"
												}) : p.lines.map((line, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "ns-para-line",
													children: line
												}, i))
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `ns-para-src${p.sourceRanges === null ? " ns-para-new" : ""}`,
												children: p.broken ? "—" : p.sourceRanges === null ? "新增" : `L${p.sourceRanges[0]?.[0] ?? "?"}`
											})
										]
									}, p.index))
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
											children: "在剧本里划选一段文字（一次只能选一段里的）， 批注框会在选区下方浮出来。"
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
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "ns-btn ns-btn-primary",
											disabled: sendCount === 0 && manualInScope === 0,
											title: sendCount === 0 && manualInScope === 0 ? "还没有批注，也没有人工改动" : "把批注与人工改动整理成一份指令，复制到剪贴板",
											onClick: sendBatch,
											children: manualInScope === 0 ? `下发 ${sendCount} 条批注` : `下发 ${sendCount} 条批注 + ${manualInScope} 集人工改动`
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "ns-foot-hint",
											children: annoScope === "all" ? "这一版所有集一起下发" : "复制成指令 → 粘到对话里发给 AI"
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
		* @param within - 剧本栏容器（防止把别处的选区算进来）。
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
		* 结构：根层 → 通用小件 → 工作台窗口 → 三栏 → 原文行 → 剧本块 →
		*       批注区 → 划词弹卡 → 缩放手柄 → 提示条 → 滚动条
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

/* 批注类型颜色 + 标签 */
.ns-t-tone { color: var(--dsw-alias-state-business-primary); }
.ns-t-act  { color: var(--dsw-alias-state-success-primary); }
.ns-t-pace { color: var(--dsw-alias-state-warn-primary); }
.ns-t-cut  { color: var(--dsw-alias-state-error-primary); }
.ns-t-other{ color: var(--dsw-alias-label-tertiary); }
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
/* 划词时**用插件自己的选中样式**，不用浏览器默认那套（主人 2026-09-14：
   "选择是系统默认样式，可以设置独立样式"）。
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
   颜色用**主题色**（主人 2026-09-14 明确要的）：官方主按钮那一对 token ——
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

/* 显式开关（这个工作区要不要剧本批注）：状态一眼可见、一点可改 */
.ns-toggle {
  flex: none;
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 9px;
  font: inherit; font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2);
  border: none; border-radius: 999px; cursor: pointer;
  white-space: nowrap;
}
.ns-toggle:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ns-toggle:disabled { opacity: .5; cursor: not-allowed; }
.ns-toggle-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--dsw-alias-label-caption);
}
.ns-toggle-on { color: var(--dsw-alias-state-business-primary); }
.ns-toggle-on .ns-toggle-dot { background: var(--dsw-alias-state-business-primary); }

/* 上手引导卡：没有工作区/会话时占据主区，把 DSH 的实际流程讲清楚 */
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
.ns-col-script { flex: 1; }
.ns-col-anno { flex: none; background: var(--dsw-alias-bg-layer-1); }
.ns-col-hd {
  flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 10.5px; font-weight: 600; letter-spacing: .05em;
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.ns-sub { font-weight: 400; letter-spacing: 0; }
.ns-col-bd { flex: 1; overflow-y: auto; padding: 11px 14px 30px; }
/* 原文栏要当 coverBar 的定位祖先（offsetTop 以它为参照） */
.ns-col-src .ns-col-bd { position: relative; }

/* 批注栏收起：只剩一条 36px 窄轨，正文因此变宽 */
.ns-col-anno.ns-railed { display: flex; width: 36px; align-items: flex-start; }
.ns-rail-toggle {
  display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;
  padding: 10px 0; background: none; border: none; cursor: pointer; color: inherit;
}
.ns-rail-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-rail-n {
  min-width: 18px; height: 18px; border-radius: 999px; display: grid; place-items: center;
  font-size: 10px; background: var(--dsw-alias-state-error-primary); color: #fff;
}
.ns-rail-v { writing-mode: vertical-rl; font-size: 11px; letter-spacing: .12em; color: var(--dsw-alias-label-tertiary); }

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

/* ── 本集信息卡 ─────────────────────────────────────────────────────── */
.ns-infocard {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  background: var(--dsw-alias-bg-base); padding: 9px 11px; margin-bottom: 12px;
}
.ns-infocard-t { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: var(--dsw-alias-label-caption); margin-bottom: 7px; }
.ns-info-row { display: flex; gap: 8px; font-size: 11.5px; padding: 1.5px 0; }
.ns-info-k { flex: none; width: 58px; color: var(--dsw-alias-label-tertiary); }
.ns-info-v { flex: 1; color: var(--dsw-alias-label-secondary); }

/* ── 原文行 ─────────────────────────────────────────────────────────── */
.ns-sline { display: flex; gap: 8px; border-radius: 4px; padding: 1px 0; }
/* **本集覆盖范围**用一根连续竖条表示 —— 它由 Workbench 单独画一根绝对定位的
   .ns-coverbar（量出首尾两行的高度），不是每行一道 inset 阴影：
   那样会被行的圆角和行距切成一截截，看着像一串括号（主人 2026-09-14 反馈）。 */
.ns-coverbar {
  position: absolute; left: 2px; width: 3px; border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, transparent);
  pointer-events: none;
}
/* **单句/单段对应**用底色块表示（主人 2026-09-14：一句还是用之前的方式）。 */
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

/* ── 剧本块 ─────────────────────────────────────────────────────────── */
.ns-gap { height: 9px; }
.ns-sb { display: flex; gap: 7px; border-radius: 4px; padding: 1.5px 0; }
.ns-sb:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-sb.ns-pinned {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary);
}
.ns-srcno {
  flex: none; width: 38px; text-align: right; font-size: 9.5px; line-height: 2.05;
  color: var(--dsw-alias-label-caption); user-select: none;
  font-family: ui-monospace, Consolas, monospace;
}
.ns-srcno.ns-on { color: var(--dsw-alias-state-business-primary); }
.ns-sbtx { flex: 1; min-width: 0; font-size: 13px; line-height: 1.8; white-space: pre-wrap; }
.ns-b-slug .ns-sbtx { font-weight: 700; letter-spacing: .05em; }
.ns-b-transition .ns-sbtx { font-weight: 700; letter-spacing: .1em; color: var(--dsw-alias-label-secondary); }
.ns-b-meta .ns-sbtx { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.ns-b-character .ns-sbtx { color: var(--dsw-alias-state-business-primary); font-weight: 600; }
.ns-b-hint .ns-sbtx { color: var(--dsw-alias-label-tertiary); }
.ns-b-line .ns-sbtx { padding-left: 12px; }
.ns-inline-hint { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.ns-new { color: var(--dsw-alias-label-caption); font-size: 10px; }

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
   划词弹卡与胶囊：**固定在工作台底部中间**，绝不压正文
   （跟着选区走的话卡片会盖住正文，多选时第二处就选不到了）
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

/* 卡片（写理由） */
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

/* ══ 设置 →「插件」→「小说转剧本」页 ═══════════════════════════════════
   注意：这个页面渲染在**官方设置弹窗**里，不在 .ns-workbench 内部，
   所以颜色/字体要自己声明，不能依赖工作台的样式继承。
   这些类名也刻意不放在 .ns-workbench 作用域下。
   （提醒自己：这个文件是模板字符串，注释里不能出现反引号。） */
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

/* ══ 对话标题栏上的「剧本批注」按钮 ═══════════════════════════════════
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

/* ══ 「插件配置」列表里的那张卡片（settings.plugin.item）════════════════
   结构照官方 PluginCard：li > 头部按钮（名称+描述+箭头）> 展开的 body。
   这些类名渲染在官方设置弹窗里，不在 .ns-workbench 内部，
   所以颜色/字体自己声明，不依赖工作台样式继承。 */
.ns-card {
  list-style: none;
  border-radius: 12px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  color: var(--dsw-alias-label-primary);
}
.ns-card-hd {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 12px 14px; border: none; background: transparent;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
}
.ns-card-hd:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ns-card-name { font-weight: 500; }
.ns-card-desc { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.ns-card-badge {
  flex: none; font-size: 10px; padding: 1px 7px; border-radius: 999px;
  color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 0 0 1px currentColor;
}
.ns-card-chev { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform .15s; }
.ns-card-chev-open { transform: rotate(180deg); }
.ns-card-bd {
  display: flex; flex-direction: column; gap: 8px;
  padding: 0 14px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 10px;
}
.ns-card-note, .ns-card-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.ns-card-list { display: flex; flex-direction: column; gap: 3px; }
.ns-card-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px; border-radius: 9px; cursor: pointer; font-size: 12.5px;
  border: 1px solid var(--dsw-alias-border-l1);
}
.ns-card-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-card-item-on { border-color: var(--dsw-alias-state-business-primary); }
.ns-card-item input { flex: none; cursor: pointer; }
.ns-card-w { flex: none; font-weight: 500; }
.ns-card-path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace; font-size: 11px;
  color: var(--dsw-alias-label-caption);
}
.ns-card-cur {
  flex: none; font-size: 10px; padding: 0 6px; border-radius: 999px;
  color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 0 0 1px currentColor;
}
.ns-card-err { font-size: 11.5px; color: var(--dsw-alias-state-error-primary); }
.ns-card-foot { font-size: 11px; color: var(--dsw-alias-label-caption); }

/* 未启用时：隐藏三栏与缩放手柄，只留说明卡（卡片由 .ns-onboard 画） */
.ns-workbench.ns-notfull .ns-wb-cols,
.ns-workbench.ns-notfull .ns-rs,
.ns-workbench.ns-notfull .ns-scanbar { display: none; }

/* 有工作区但**没登记清单**：三栏之间没有任何对应关系，画出来只会让人以为
   「高亮坏了」。这里只藏三栏，扫描诊断条保留（主人要看扫到了多少、能重扫）。 */
.ns-workbench.ns-nocols .ns-wb-cols,
.ns-workbench.ns-nocols .ns-rs { display: none; }

/* 未登记时给主人复制的指令块 */
.ns-copy {
  margin: 0; padding: 10px 12px; max-height: 220px; overflow: auto;
  font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.7;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  white-space: pre-wrap; word-break: break-word;
}
/* 上手引导 / 未启用说明卡上的按钮排 */
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

/* ══ 剧本段落（v2：按段落渲染，程序不判断段落类型）════════════════════ */
.ns-para {
  display: flex; gap: 8px; align-items: flex-start;
  border-radius: 6px; padding: 4px 6px; margin-bottom: 2px;
  cursor: default;
}
.ns-para:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* 当前正在看的那几段（点选/定位）：**底色块**，和左侧原文对应行同一种表示法。
   ⚠️ 竖条只留给"原文的本集覆盖范围"（那根由 .ns-coverbar 单独画）。
      这里之前被一起改成竖条了，主人 2026-09-14 指出剧本侧也该是色块。 */
.ns-para-pinned {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
}
/* Ctrl 连选期间被选中的段落：比"当前在看"的色块更深一档。
   这段时间输入框是**不弹**的（见 Workbench 的 onScriptMouseUp），
   屏幕上就靠这层底色告诉用户"我选了哪几处"。 */
.ns-para-pending {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent);
}
.ns-para-broken { opacity: .7; }
.ns-para-no {
  flex: none; width: 26px; text-align: right; font-size: 12px; line-height: 1.9;
  color: var(--dsw-alias-label-tertiary); user-select: none;
  font-family: ui-monospace, Consolas, monospace;
}
.ns-para-tx { flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.9; color: var(--dsw-alias-label-primary); }
.ns-para-line { display: block; white-space: pre-wrap; }
.ns-para-bad { color: var(--dsw-alias-state-error-primary); }
/* 右侧那个「L7 / 新增」小标也不能被划进选区（主人 2026-09-14：序号会被选上） */
.ns-para-src {
  flex: none; font-size: 11.5px; line-height: 1.9; padding: 0 5px; border-radius: 999px;
  color: var(--dsw-alias-label-tertiary); user-select: none;
  font-family: ui-monospace, Consolas, monospace;
}
.ns-para-new { color: var(--dsw-alias-state-warn-primary); }

/* ══ 人工编辑模式（整集一个编辑面 + 左边行号槽）══════════════════════════
   外观刻意跟 .ns-col-bd / .ns-para-tx 对齐（字号 13.5、行高 1.9、内边距
   11px 14px 30px）：主人要求"打开编辑模式中间栏样式不变，只是能改"。
   ⚠️ 行号槽与文本框必须**同字号同 line-height**，否则行号会和正文错开半行。 */
.ns-edit { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ns-edit-body { flex: 1; min-height: 0; display: flex; align-items: stretch; overflow: hidden; }
.ns-edit-gut {
  flex: none; width: 40px; overflow: hidden; padding: 11px 6px 30px 0;
  text-align: right; user-select: none;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 13.5px; line-height: 1.9;
  color: var(--dsw-alias-label-tertiary);
}
.ns-edit-ln { white-space: nowrap; }
.ns-edit-ta {
  flex: 1; min-width: 0; margin: 0; padding: 11px 14px 30px 0;
  border: 0; outline: none; resize: none; background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 13.5px; line-height: 1.9;
  white-space: pre; overflow: auto; tab-size: 2;
}
.ns-edit-ta::selection { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent); }
.ns-edit-bar {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.ns-edit-where {
  font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 批注锚点已失效（设计文档 §7.3：正常状态，标出来就行，不是错误） */
.ns-tag-stale { color: var(--dsw-alias-state-error-primary); }
.ns-acard-q-stale { opacity: .75; }

/* ══ 写批注的小框（跟着选区浮出来的那个）═════════════════════════════
   position: fixed —— 它挂在浮层根下（不在工作台面板里），所以不会被面板裁剪；
   left/top 由 JS 按选区矩形算好并夹进视口。 */
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
   曾经在选区旁边飘过一条"已选 N 处"的提示条，主人 2026-09-14 否掉了：
   它就压在剧本文字上，把接下来要划的那几行挡住了。反馈只用 .ns-para-pending 底色。 */
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
/* 卡片上每一处引文前面的段落标签 */
.ns-acard-ln {
  flex: none; margin-right: 4px; font-size: 10.5px;
  color: var(--dsw-alias-label-caption);
  font-family: ui-monospace, Consolas, monospace;
}

/* ══ 写批注的小框 ═════════════════════════════════════════════════════ */
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

/* ══ 批注卡（v2）══════════════════════════════════════════════════════ */
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

/* ══ 会话标题栏按钮 ═══════════════════════════════════════════════════ */
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

/* ══ 会话标题栏上的「剧本批注」═══════════════════════════════════════ */
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
		* @dsh-external/dsh-novel-script —— 浏览器半边。
		*
		* 三个挂点，都是"加在旁边"而不是"替换"：
		*   1. `sidebar.footer.action`     —— 侧栏底部、和「设置」同排的常驻入口（任何状态都在）；
		*   2. `shell.overlay`             —— 全屏浮层（工作台住在这里）；
		*   3. `conversation.session.header.actions` —— 会话标题栏上的「剧本批注」（会话开始后出现）。
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
		* `/api/novel-script/annotations`（见 src/index.ts）。
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
		/**
		* 开关工作台。
		*
		* ⚠️ 关之前要问一句：人工编辑模式里可能有**没保存的改动**，而浮层一关，
		*    工作台组件就卸载了，草稿跟着没（草稿只在内存里，磁盘上一个字都没写）。
		*    有没有改动由工作台通过 `unsaved.ts` 那个小开关告诉这里。
		*/
		function toggleOpen(next) {
			if (!next && hasUnsaved() && !window.confirm("工作台里还有没保存的人工改动，关掉就丢了。确定关掉吗？")) return;
			setOpen(next);
		}
		function apply(ctx) {
			console.info("[novel-script] client apply: start");
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
				tag.setAttribute("data-novel-script", "workbench");
				tag.textContent = overlayCss;
				document.head.append(tag);
				return () => {
					tag.remove();
				};
			}, "novel-script: styles");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "novel-script-open",
				order: 10,
				label: "剧本批注"
			}, FooterAction));
			ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
				name: OVERLAY_SLOT,
				id: PANEL_ID,
				order: 50,
				label: "剧本批注"
			}, NovelScriptOverlay));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "novel-script-open",
				order: 80,
				label: "剧本批注"
			}, OpenWorkbenchButton));
			console.info("[novel-script] client apply: slots registered");
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
				title: isOpen ? "收起剧本批注工作台" : "打开剧本批注工作台",
				"aria-label": "剧本批注",
				"aria-pressed": isOpen,
				onClick: () => toggleOpen(!isOpen),
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
					children: "剧本批注"
				}) : null]
			});
		}
		/**
		* 输入框工具条上的「剧本批注」按钮。
		*
		* 它自报状态（不靠 hover 猜）：打开着就高亮。点开看到的是工作台，
		* 没登记的工作区里是一张"还没登记 + 可复制的指令"的卡，不会点了没反应。
		*/
		function OpenWorkbenchButton() {
			const isOpen = useOpen();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `ns-chip${isOpen ? " ns-chip-on" : ""}`,
				title: isOpen ? "收起剧本批注工作台" : "打开剧本批注工作台",
				"aria-pressed": isOpen,
				onClick: () => toggleOpen(!isOpen),
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
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "剧本批注" })]
			});
		}
		/** 全屏浮层。 */
		function NovelScriptOverlay() {
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
								children: "剧本批注"
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