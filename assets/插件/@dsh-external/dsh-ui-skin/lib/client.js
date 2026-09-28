window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-ui-skin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region src/client/assets.ts
		/**
		* 皮肤素材（图片）的客户端侧：URL 组装 + 可用性清单。
		*
		* ## 素材从哪来
		*
		* 插件仓库里**一张图都不带**——那几张识别标记（Codex 云、Claude Code 蟹、
		* deepseek娘 头像/全身）是个人素材，不适合再分发。图放在**用户自己机器上的目录**里
		* （默认 `%LOCALAPPDATA%\DSH-Web\skins\`，可在设置里改），由宿主半边把目录内容
		* 通过 `/dsh-ui-skin/assets/<名字>` 喂给浏览器。
		*
		* ## 为什么先问 manifest
		*
		* 目录里可能一张图都没有（比如别人刚装插件）。若直接 `img.src = ...`，每张都会
		* 先 404 再回退——界面能用，但控制台会多一串噪声，图也会闪一下。所以先取一次
		* `manifest.json` 拿到"实际存在哪几张"，再决定哪些位图值得请求；不在清单里的
		* **直接渲染矢量标记**，一个失败请求都不发。
		*/
		/** 宿主半边挂载的素材路由前缀（必须与 asset-serve.ts 一致）。 */
		const ASSETS_URL_PREFIX = "/dsh-ui-skin/assets";
		/** 组装一张素材的完整 URL。 */
		function assetUrl(name) {
			return `${ASSETS_URL_PREFIX}/${name}`;
		}
		/**
		* 拉一次素材清单。失败不抛错——素材是可选增强，拿不到就该安静地退回矢量标记。
		* @param signal - 可选中止信号（组件卸载时取消）。
		* @returns 清单或错误说明。
		*/
		async function fetchAssetManifest(signal) {
			try {
				const response = await fetch(assetUrl("manifest.json"), {
					signal,
					headers: { accept: "application/json" }
				});
				if (!response.ok) return {
					status: "error",
					reason: `manifest ${response.status}`
				};
				const data = await response.json();
				return {
					status: "ready",
					manifest: {
						dir: typeof data.dir === "string" ? data.dir : "",
						assets: Array.isArray(data.assets) ? data.assets.filter((x) => typeof x === "string") : []
					}
				};
			} catch (error) {
				return {
					status: "error",
					reason: error instanceof Error ? error.message : String(error)
				};
			}
		}
		/**
		* 素材清单是否包含某张图。
		* @param state - 当前清单状态。
		* @param name - 素材文件名。
		* @returns 有就 true（loading 与 error 都算没有 → 直接用矢量标记）。
		*/
		function hasAsset(state, name) {
			return state.status === "ready" && state.manifest.assets.includes(name);
		}
		//#endregion
		//#region src/client/marks/RasterIcon.tsx
		/**
		* 渲染位图或回退元素。
		* @param props - 素材名、原始尺寸、显示尺寸、可用性与回退节点。
		* @returns img 或回退节点。
		*/
		function RasterIcon({ name, width, height, size, available, fallback, style }) {
			const [failed, setFailed] = (0, react.useState)(false);
			if (!available || failed) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: fallback });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				src: assetUrl(name),
				alt: "",
				width: size * width / height,
				height: size,
				style,
				draggable: false,
				onError: () => {
					setFailed(true);
				}
			});
		}
		//#endregion
		//#region src/client/marks/WhaleGirlMark.tsx
		/** 全身像素材名，以及它的原始比例（563×700）。 */
		const MASCOT_ASSET = "deepseek-mascot.png";
		const MASCOT_VIEWBOX = {
			width: 563,
			height: 700
		};
		/** 矢量鲸鱼（内置回退）的原生 viewBox。 */
		const FISH_VIEWBOX = {
			width: 23.16,
			height: 17.04
		};
		/** 鲸鱼剪影路径（自带一份，省掉对 ui-primitives 这条非基线依赖）。 */
		const FISH_PATH = "M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z";
		/**
		* 渲染鲸鱼娘标记：素材目录里有图就用图，没有就用内置矢量鲸鱼。
		*
		* `size` 是**高度**，宽度按矢量鲸鱼自己的 viewBox 比例算出 —— 这样三张卡里的兜底
		* 鲸鱼大小完全一致（当初按宽度算，在 Codex/Claude 那两张卡上会显示得偏小）。
		* @param props - 高度、素材清单与"强制矢量"开关。
		* @returns 位图 img 或矢量鲸鱼 svg。
		*/
		function WhaleGirlMark({ size = 38, className, assets, forceVector = false }) {
			const [failed, setFailed] = (0, react.useState)(false);
			if (!(!forceVector && hasAsset(assets, MASCOT_ASSET) && !failed)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size * FISH_VIEWBOX.width / FISH_VIEWBOX.height,
				height: size,
				className,
				viewBox: `0 0 ${FISH_VIEWBOX.width} ${FISH_VIEWBOX.height}`,
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: FISH_PATH,
					fill: "currentColor"
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				src: assetUrl(MASCOT_ASSET),
				alt: "",
				width: Math.round(size * MASCOT_VIEWBOX.width / MASCOT_VIEWBOX.height),
				height: size,
				className,
				draggable: false,
				"data-whale-girl-mark": "",
				onError: () => {
					setFailed(true);
				}
			});
		}
		//#endregion
		//#region src/client/SkinRow.tsx
		/**
		* 皮肤设置行：注册进「设置 ▸ 通用」的项目槽，紧跟「外观」行下面。
		*
		* 三块内容：
		*   1. 三张皮肤卡（DeepSeek / Codex / Claude Code），各带自己的识别标记；
		*   2. **素材目录**表单 —— 输入框 + 「用默认」按钮 + 当前生效目录；
		*   3. 缺图提示 —— 当前目录里哪几张没有，一眼知道该往哪儿放。
		*
		* 输入框刻意**照抄官方 Input 的 token**（`bg-layer-1` 底 + `border-l4` 0.5px 边 +
		* 32px 高 + 聚焦时换 brand-primary）。之前用透明底 + 细边，在设置页里几乎看不见，
		* 会被当成一行说明文字而不是可以填的地方。
		*
		* 标记的可用性由素材清单决定（见 assets.ts）：目录里没图 → 每张卡渲染矢量标记，
		* 一个失败请求都不发。
		*/
		/** 卡片顺序、文案键与识别标记（DeepSeek 在首位：默认皮肤）。 */
		const CARDS = [
			{
				id: "deepseek",
				labelKey: "skin.deepseek",
				mark: "whaleGirl"
			},
			{
				id: "codex",
				labelKey: "skin.codex",
				mark: "codex"
			},
			{
				id: "claude-code",
				labelKey: "skin.claudeCode",
				mark: "claude"
			}
		];
		/**
		* 本插件需要用户放进素材目录的图 —— **就三张，一张不多**（与宿主半边的白名单一致）。
		* 缺哪张就在设置行里提示哪张；缺的卡显示内置矢量标记。
		*/
		const TRACKED_ASSETS = [
			"deepseek-mascot.png",
			"codex-icon.png",
			"claude-icon.png"
		];
		const S = {
			group: {
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "16px 0",
				borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
			},
			title: {
				fontSize: "14px",
				fontWeight: 400,
				lineHeight: "22px",
				color: "var(--dsw-alias-label-primary)"
			},
			cardRow: {
				display: "flex",
				alignItems: "stretch",
				gap: "8px",
				flexWrap: "wrap"
			},
			card: {
				boxSizing: "border-box",
				flex: "1 1 140px",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: "4px",
				padding: "12px 16px",
				border: "0.5px solid var(--dsw-alias-border-l4)",
				borderRadius: "16px",
				background: "transparent",
				font: "inherit",
				fontSize: "14px",
				lineHeight: "22px",
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer"
			},
			cardSelected: {
				background: "var(--dsw-alias-bg-module-platform)",
				borderColor: "var(--dsw-static-neutral-bluish-400)"
			},
			mark: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				height: "38px"
			},
			label: {
				fontWeight: 500,
				whiteSpace: "nowrap"
			},
			fieldBlock: {
				display: "flex",
				flexDirection: "column",
				gap: "6px",
				marginTop: "4px",
				paddingTop: "12px",
				borderTop: "0.5px solid var(--dsw-alias-border-l1)"
			},
			fieldLabel: {
				fontSize: "13px",
				fontWeight: 500,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-primary)"
			},
			fieldRow: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			inputWrap: {
				flex: 1,
				minWidth: 0,
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				height: "32px",
				padding: "0 10px",
				boxSizing: "border-box",
				border: "0.5px solid var(--dsw-alias-border-l4)",
				borderRadius: "8px",
				background: "var(--dsw-alias-bg-layer-1)"
			},
			input: {
				flex: 1,
				minWidth: 0,
				border: "none",
				outline: "none",
				background: "transparent",
				font: "inherit",
				fontSize: "13px",
				lineHeight: "22px",
				color: "var(--dsw-alias-label-primary)"
			},
			button: {
				flex: "0 0 auto",
				height: "32px",
				padding: "0 12px",
				boxSizing: "border-box",
				border: "0.5px solid var(--dsw-alias-border-l4)",
				borderRadius: "8px",
				background: "transparent",
				font: "inherit",
				fontSize: "13px",
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer"
			},
			buttonDisabled: {
				color: "var(--dsw-alias-label-dimmed)",
				cursor: "default"
			},
			hint: {
				fontSize: "12px",
				lineHeight: "18px",
				color: "var(--dsw-alias-label-secondary)"
			},
			hintStrong: { color: "var(--dsw-alias-label-primary)" }
		};
		/**
		* 渲染一张卡的识别标记：缺图时**三张卡统一回退到同一个线条鲸鱼**。
		*
		* 为什么不用各自的专属矢量（原来 Codex 用云、Claude 用蟹）：那两个是从旧素材描摹的，
		* 观感不理想；而眼下没有更合适的图标，与其显示三个半成品，不如统一成同一个干净的
		* 鲸鱼 —— 观感一致、也不会有"这张卡怎么长得像那张卡"的困惑。
		*
		* 等有了正式图标（放进素材目录即可）再看要不要恢复各自的专属矢量。
		*/
		function CardMark({ mark, assets }) {
			if (mark === "codex") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RasterIcon, {
				name: "codex-icon.png",
				width: 64,
				height: 64,
				size: 26,
				available: hasAsset(assets, "codex-icon.png"),
				fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WhaleGirlMark, {
					forceVector: true,
					size: 38,
					assets
				})
			});
			if (mark === "claude") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RasterIcon, {
				name: "claude-icon.png",
				width: 58,
				height: 64,
				size: 26,
				available: hasAsset(assets, "claude-icon.png"),
				fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WhaleGirlMark, {
					forceVector: true,
					size: 38,
					assets
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WhaleGirlMark, {
				size: 38,
				assets
			});
		}
		/**
		* 渲染皮肤设置行。
		* @param props - 组合后的槽位 props。
		* @returns 行元素树。
		*/
		function SkinRow({ t, setSkin, getAssetsDir, setAssetsDir, isDefaultAssetsDir, useStore }) {
			const skin = useStore((s) => s.skin);
			const assets = useStore((s) => s.assets);
			const configuredDir = useStore((s) => s.assetsDir);
			const [draft, setDraft] = (0, react.useState)(configuredDir);
			const [focused, setFocused] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setDraft(configuredDir);
			}, [configuredDir]);
			const effectiveDir = assets.status === "ready" ? assets.manifest.dir : getAssetsDir();
			const missing = assets.status === "ready" ? TRACKED_ASSETS.filter((name) => !assets.manifest.assets.includes(name)) : [];
			const isDefault = isDefaultAssetsDir();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: S.group,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: S.title,
						children: t("skin.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: S.cardRow,
						children: CARDS.map(({ id, labelKey, mark }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: skin === id ? {
								...S.card,
								...S.cardSelected
							} : S.card,
							"aria-pressed": skin === id,
							onClick: () => {
								setSkin(id);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: S.mark,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardMark, {
									mark,
									assets
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: S.label,
								children: t(labelKey)
							})]
						}, id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: S.fieldBlock,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: S.fieldLabel,
								children: t("skin.assetsDirLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: S.fieldRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: focused ? {
										...S.inputWrap,
										borderColor: "var(--dsw-alias-brand-primary)"
									} : S.inputWrap,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										style: S.input,
										type: "text",
										value: draft,
										spellCheck: false,
										"aria-label": t("skin.assetsDirLabel"),
										placeholder: t("skin.assetsDirPlaceholder"),
										onFocus: () => {
											setFocused(true);
										},
										onBlur: () => {
											setFocused(false);
											setAssetsDir(draft.trim());
										},
										onChange: (event) => {
											setDraft(event.target.value);
										},
										onKeyDown: (event) => {
											if (event.key === "Enter") setAssetsDir(draft.trim());
										}
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: isDefault ? {
										...S.button,
										...S.buttonDisabled
									} : S.button,
									disabled: isDefault,
									onClick: () => {
										setDraft("");
										setAssetsDir("");
									},
									children: t("skin.assetsDirReset")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: S.hint,
								children: [
									t("skin.assetsDirNow"),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: S.hintStrong,
										children: effectiveDir
									}),
									isDefault ? t("skin.assetsDirIsDefault") : ""
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: S.hint,
								children: t("skin.assetsHint")
							}),
							assets.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: S.hint,
								children: t("skin.assetsError")
							}) : null,
							missing.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: S.hint,
								children: [t("skin.assetsMissing"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: S.hintStrong,
									children: missing.join("、")
								})]
							}) : null
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* 皮肤设置行的状态容器，以及给组件用的 React 选择器钩子。
		*
		* ## 引擎用官方的 `@deepseek-ai/dsh-client-store`
		*
		* 0.1.5 时代这个包**不在装载器的基线模块表里**：用它就得额外声明 `dsh.client.external`
		* 并指望有供给方，为几行状态代码引入装配风险不划算，所以当时用了本地 40 行容器。
		*
		* **0.1.7 它已经在基线表里**（`packages/client/web/src/seed.ts`），而且 `dsh.client.external`
		* 对静态表名不产生图边（`packages/client/modules/src/index.ts`：external 要么是包行、
		* 要么是静态表名）—— 装配风险为零。所以现在直接用官方 `createSnapshotStore`：
		*   · 顺带拿到 **`persist`**（localStorage 持久化，皮肤 id 的首屏镜像要用它）；
		*   · 状态引擎（zustand + immer）与官方插件一致，不再是"另一套"。
		*
		* 本地只保留官方没有的两点便利：`set(patch)` 的**浅比较短路**（无变化不发通知）与
		* `makeUseStoreHook`（把 store 变成组件渲染期可调用的选择器钩子）。组件只依赖
		* `get` / `subscribe`，所以换引擎对它们透明。
		*/
		/**
		* 创建一个 store（官方引擎 + 本地便利层）。
		* @param initial - 初始状态。
		* @param options - 给了 `persist` 就用它作 localStorage 键持久化整个快照。
		* @returns store 句柄。
		*/
		function createStore(initial, options) {
			const store = options?.persist === void 0 ? (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(initial) : (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(initial, { persist: { name: options.persist } });
			return {
				get: () => store.getSnapshot(),
				subscribe: store.subscribe,
				set: (patch) => {
					const current = store.getSnapshot();
					if (!Object.keys(patch).some((key) => patch[key] !== current[key])) return;
					store.update((draft) => {
						Object.assign(draft, patch);
					});
				}
			};
		}
		/**
		* 造一个"跟着组件渲染走"的选择器钩子。
		*
		* 两条纪律：
		*   1. **返回的必须是普通函数**，由**组件**在渲染期调用 —— 不能在插件 `apply()`
		*      里就把 `useState` 调掉（那不是 React 上下文，会直接报 Invalid hook call）。
		*      所以这里用闭包惰性持有真正的钩子，首次调用时才创建。
		*   2. 测试环境没有 React 渲染器：给一个惰性 `useState` 替身（首次取值后不再变），
		*      这样 bundle 能在 Node 里被完整执行以验证"加载不抛错"。
		* @param store - 目标容器。
		* @returns 选择器钩子（普通函数）。
		*/
		function makeUseStoreHook(store) {
			let hook;
			return (selector) => {
				if (hook === void 0) hook = typeof __DEV__ !== "undefined" && __DEV__ === true ? ((sel) => {
					return require("react").useState(() => sel(store.get()))[0];
				}) : (() => {
					const React = require("react");
					return (sel) => React.useSyncExternalStore(store.subscribe, () => sel(store.get()));
				})();
				return hook(selector);
			};
		}
		//#endregion
		//#region src/skin-settings.ts
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
		const SKIN_IDS = [
			"deepseek",
			"codex",
			"claude-code"
		];
		/**
		* 设置定位 id = 本插件在 profile 里的条目 id。**必须与 `cordis.patch.yml` 的行 id 一致**：
		* 它同时就是 0.1.7 的设置命名空间，写错的表现是设置读不出来（`status: 'unavailable'`）。
		*
		* ⚠️ 刻意用 `external-ui-skin` 而不是 `ui-skin`：树内曾有条目叫 `ui-skin`，同 id 会让
		* loader 报 `duplicate loader entry id` 并使整个界面起不来（实测踩过）。0.1.7 虽已移除
		* 树内皮肤，仍保留前缀，避免将来重新引入时再次撞车。
		*/
		const SKIN_ENTRY_ID = "external-ui-skin";
		/** 设置字段名：皮肤 id。 */
		const SKIN_FIELD = "skin";
		/** 设置字段名：素材目录。 */
		const ASSETS_DIR_FIELD = "assetsDir";
		/** 没有任何持久化时的默认皮肤。 */
		const DEFAULT_SKIN = "deepseek";
		/** 皮肤 id 的 localStorage 镜像键（只为首屏不闪，不是权威值）。 */
		const SKIN_STORAGE_KEY = "dsh.dshUiSkin.skin";
		/** 承载当前皮肤品牌面的 body 属性。 */
		const SKIN_ATTRIBUTE = "data-dsh-ui-skin";
		/**
		* 把一个值收窄成合法皮肤 id。
		* @param value - 跨存储边界的值。
		* @returns 是否是内置皮肤 id。
		*/
		function isSkinId(value) {
			return SKIN_IDS.some((id) => id === value);
		}
		//#endregion
		//#region src/client/skin-row-store.ts
		/**
		* 皮肤设置行的槽位 store：皮肤服务快照 + 素材清单的浏览器镜像。
		* 写入方只有插件的 `skin/change` 监听与素材拉取；行组件通过 props.useStore 读。
		*/
		/**
		* 建一个皮肤设置行的 store。
		* @returns store 句柄。
		*/
		function createSkinRowStore() {
			return createStore({
				skin: DEFAULT_SKIN,
				revision: -1,
				assets: { status: "loading" },
				assetsDir: ""
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `settings.skin` 命名空间的文案（皮肤设置行的所有可见字符串）。 */
		/** 简体中文（键集的真相源）。 */
		const zh = {
			"skin.title": "皮肤",
			"skin.deepseek": "DeepSeek",
			"skin.codex": "Codex",
			"skin.claudeCode": "Claude Code",
			"skin.assetsDirLabel": "图片素材目录",
			"skin.assetsDirPlaceholder": "留空 = 使用默认目录",
			"skin.assetsDirReset": "用默认",
			"skin.assetsDirNow": "当前读取：",
			"skin.assetsDirIsDefault": "（默认）",
			"skin.assetsMissing": "该目录里没有：",
			"skin.assetsError": "读不到素材清单，标记已退回内置矢量版。",
			"skin.assetsHint": "把 deepseek-mascot.png / codex-icon.png / claude-icon.png 放进该目录即可显示位图；缺哪张，哪张卡就用内置矢量标记。"
		};
		/** 英文词典，按 zh 的键集校验完整性。 */
		const en = {
			"skin.title": "Skin",
			"skin.deepseek": "DeepSeek",
			"skin.codex": "Codex",
			"skin.claudeCode": "Claude Code",
			"skin.assetsDirLabel": "Image assets directory",
			"skin.assetsDirPlaceholder": "Leave empty for the default directory",
			"skin.assetsDirReset": "Use default",
			"skin.assetsDirNow": "Reading from: ",
			"skin.assetsDirIsDefault": " (default)",
			"skin.assetsMissing": "Not found in that directory: ",
			"skin.assetsError": "Could not read the assets manifest; marks fall back to the built-in vector art.",
			"skin.assetsHint": "Drop deepseek-mascot.png / codex-icon.png / claude-icon.png in that directory to show the bitmaps; a missing file falls back to the built-in vector mark."
		};
		/** Built-in skins in registry order. */
		const SKINS = Object.freeze([
			Object.freeze({
				id: "deepseek",
				tokens: {
					"--dsw-alias-brand-primary": {
						light: "rgb(77, 107, 254)",
						dark: "rgb(107, 135, 255)"
					},
					"--dsw-alias-brand-text": {
						light: "rgb(77, 107, 254)",
						dark: "rgb(107, 135, 255)"
					},
					"--dsw-alias-brand-primary-invert": {
						light: "rgb(255, 255, 255)",
						dark: "rgb(33, 35, 39)"
					},
					"--dsw-alias-button-primary-fill": {
						light: "rgb(77, 107, 254)",
						dark: "rgb(77, 107, 254)"
					},
					"--dsw-alias-button-primary-hover": {
						light: "rgb(107, 135, 255)",
						dark: "rgb(107, 135, 255)"
					},
					"--dsw-alias-button-primary-dimmed": {
						light: "rgb(237, 244, 255)",
						dark: "rgb(49, 52, 58)"
					},
					"--dsw-alias-button-info-fill": {
						light: "rgb(77, 107, 254)",
						dark: "rgb(77, 107, 254)"
					},
					"--dsw-alias-button-info-hover": {
						light: "rgb(107, 135, 255)",
						dark: "rgb(107, 135, 255)"
					},
					"--dsw-alias-button-ghost-active-fill": {
						light: "rgb(237, 244, 255)",
						dark: "rgb(49, 52, 58)"
					},
					"--dsw-alias-button-ghost-active-hover": {
						light: "rgb(228, 236, 255)",
						dark: "rgb(55, 59, 66)"
					},
					"--dsw-alias-button-ghost-active-border": {
						light: "rgb(77, 107, 254)",
						dark: "rgb(107, 135, 255)"
					},
					"--dsw-alias-state-business-primary": {
						light: "rgb(77, 107, 254)",
						dark: "rgb(107, 135, 255)"
					},
					"--dsw-alias-state-business-tertiary": {
						light: "rgb(237, 244, 255)",
						dark: "rgb(46, 52, 64)"
					},
					"--dsw-alias-interactive-bg-hover-accent": {
						light: "rgba(77, 107, 254, 0.12)",
						dark: "rgba(107, 135, 255, 0.24)"
					}
				}
			}),
			Object.freeze({
				id: "codex",
				tokens: {
					"--dsw-alias-bg-base": {
						light: "rgb(255,255,255)",
						dark: "rgb(14,15,18)"
					},
					"--dsw-alias-bg-layer-1": {
						light: "rgb(247,247,248)",
						dark: "rgb(32,33,35)"
					},
					"--dsw-alias-bg-layer-2": {
						light: "rgb(255,255,255)",
						dark: "rgb(38,39,41)"
					},
					"--dsw-alias-bg-layer-3": {
						light: "rgb(242,242,243)",
						dark: "rgb(45,46,49)"
					},
					"--dsw-alias-bg-overlay": {
						light: "rgb(255,255,255)",
						dark: "rgb(36,37,40)"
					},
					"--dsw-alias-bg-module-platform": {
						light: "rgb(245,247,250)",
						dark: "rgb(38,39,41)"
					},
					"--dsw-alias-bg-multi-select": {
						light: "rgb(245,247,250)",
						dark: "rgb(38,39,41)"
					},
					"--dsw-alias-border-l1": {
						light: "rgba(13,13,13,0.06)",
						dark: "rgba(255,255,255,0.08)"
					},
					"--dsw-alias-border-l2": {
						light: "rgba(13,13,13,0.12)",
						dark: "rgba(255,255,255,0.14)"
					},
					"--dsw-alias-border-l3": {
						light: "rgba(13,13,13,0.16)",
						dark: "rgba(255,255,255,0.20)"
					},
					"--dsw-alias-brand-primary": {
						light: "rgb(83,181,89)",
						dark: "rgb(95,194,107)"
					},
					"--dsw-alias-brand-text": {
						light: "rgb(83,181,89)",
						dark: "rgb(95,194,107)"
					},
					"--dsw-alias-brand-primary-invert": {
						light: "rgb(255,255,255)",
						dark: "rgb(14,15,18)"
					},
					"--dsw-alias-button-primary-fill": {
						light: "rgb(83,181,89)",
						dark: "rgb(83,181,89)"
					},
					"--dsw-alias-button-primary-hover": {
						light: "rgb(71,158,77)",
						dark: "rgb(115,205,126)"
					},
					"--dsw-alias-button-primary-dimmed": {
						light: "rgb(233,246,234)",
						dark: "rgb(38,45,39)"
					},
					"--dsw-alias-button-contrast-fill": {
						light: "rgb(38,38,38)",
						dark: "rgb(227,227,227)"
					},
					"--dsw-alias-button-info-fill": {
						light: "rgb(83,181,89)",
						dark: "rgb(83,181,89)"
					},
					"--dsw-alias-button-info-hover": {
						light: "rgb(71,158,77)",
						dark: "rgb(115,205,126)"
					},
					"--dsw-alias-button-elevated-fill": {
						light: "rgb(255,255,255)",
						dark: "rgb(35,35,35)"
					},
					"--dsw-alias-button-floating-fill": {
						light: "rgb(255,255,255)",
						dark: "rgb(42,42,42)"
					},
					"--dsw-alias-button-floating-hover": {
						light: "rgb(242,242,243)",
						dark: "rgb(48,48,48)"
					},
					"--dsw-alias-button-ghost-active-fill": {
						light: "rgb(233,246,234)",
						dark: "rgb(42,49,43)"
					},
					"--dsw-alias-button-ghost-active-hover": {
						light: "rgb(224,242,226)",
						dark: "rgb(48,55,49)"
					},
					"--dsw-alias-button-ghost-active-border": {
						light: "rgb(83,181,89)",
						dark: "rgb(95,194,107)"
					},
					"--dsw-alias-label-primary": {
						light: "rgb(13,13,13)",
						dark: "rgb(245,247,250)"
					},
					"--dsw-alias-label-secondary": {
						light: "rgb(95,95,95)",
						dark: "rgb(158,161,170)"
					},
					"--dsw-alias-label-tertiary": {
						light: "rgb(110,110,115)",
						dark: "rgb(128,132,140)"
					},
					"--dsw-alias-label-caption": {
						light: "rgb(158,161,170)",
						dark: "rgb(110,113,120)"
					},
					"--dsw-alias-state-business-primary": {
						light: "rgb(83,181,89)",
						dark: "rgb(95,194,107)"
					},
					"--dsw-alias-state-business-tertiary": {
						light: "rgb(233,246,234)",
						dark: "rgb(36,44,38)"
					},
					"--dsw-specific-sidebar-fill": {
						light: "rgb(247,247,248)",
						dark: "rgb(19,20,22)"
					},
					"--dsw-specific-sidebar-nav-item-active": {
						light: "rgb(237,237,238)",
						dark: "rgb(45,46,49)"
					},
					"--dsw-specific-sidebar-nav-item-hover": {
						light: "rgb(242,242,243)",
						dark: "rgb(38,39,41)"
					},
					"--dsw-specific-sidebar-nav-item-active-accent": {
						light: "rgb(231,231,232)",
						dark: "rgb(51,52,56)"
					},
					"--dsw-specific-bubble": {
						light: "rgb(247,247,248)",
						dark: "rgb(32,33,35)"
					},
					"--dsw-specific-bubble-highlight": {
						light: "rgb(237,237,238)",
						dark: "rgb(45,46,49)"
					},
					"--dsw-alias-markdown-code-block": {
						light: "rgb(245,245,246)",
						dark: "rgb(32,32,32)"
					},
					"--dsw-alias-markdown-code-block-banner": {
						light: "rgb(250,250,250)",
						dark: "rgb(28,28,28)"
					},
					"--dsw-alias-markdown-inline-code": {
						light: "rgb(242,242,243)",
						dark: "rgb(42,42,42)"
					},
					"--dsw-alias-markdown-citation": {
						light: "rgb(237,237,238)",
						dark: "rgb(38,38,38)"
					},
					"--dsw-alias-markdown-tag": {
						light: "rgb(242,242,243)",
						dark: "rgb(42,42,42)"
					},
					"--dsw-alias-interactive-bg-hover": {
						light: "rgba(13,13,13,0.05)",
						dark: "rgba(255,255,255,0.07)"
					},
					"--dsw-alias-interactive-bg-active": {
						light: "rgba(13,13,13,0.08)",
						dark: "rgba(255,255,255,0.12)"
					},
					"--dsw-alias-interactive-bg-hover-solid": {
						light: "rgb(242,242,243)",
						dark: "rgb(42,42,42)"
					},
					"--dsw-alias-interactive-bg-hover-accent": {
						light: "rgba(83,181,89,0.16)",
						dark: "rgba(95,194,107,0.24)"
					},
					"--dsw-alias-toast-bg": {
						light: "rgb(38,38,38)",
						dark: "rgb(51,51,51)"
					},
					"--dsw-alias-tooltip-bg": {
						light: "rgb(38,38,38)",
						dark: "rgb(51,51,51)"
					},
					"--dsw-alias-scrollbar-bg-l1": {
						light: "rgb(228,228,229)",
						dark: "rgb(51,51,54)"
					},
					"--dsw-alias-scrollbar-bg-l2": {
						light: "rgb(228,228,229)",
						dark: "rgb(51,51,54)"
					},
					"--dsw-alias-scrollbar-hover-l1": {
						light: "rgb(212,212,213)",
						dark: "rgb(72,72,76)"
					},
					"--dsw-alias-scrollbar-hover-l2": {
						light: "rgb(212,212,213)",
						dark: "rgb(72,72,76)"
					}
				}
			}),
			Object.freeze({
				id: "claude-code",
				tokens: {
					"--dsw-alias-bg-base": {
						light: "rgb(250,249,245)",
						dark: "rgb(38,38,36)"
					},
					"--dsw-alias-bg-layer-1": {
						light: "rgb(255,255,255)",
						dark: "rgb(48,48,46)"
					},
					"--dsw-alias-bg-layer-2": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-bg-layer-3": {
						light: "rgb(240,238,230)",
						dark: "rgb(64,64,61)"
					},
					"--dsw-alias-bg-overlay": {
						light: "rgb(245,242,234)",
						dark: "rgb(46,46,44)"
					},
					"--dsw-alias-bg-module-platform": {
						light: "rgb(244,241,233)",
						dark: "rgb(51,51,48)"
					},
					"--dsw-alias-bg-multi-select": {
						light: "rgb(244,241,233)",
						dark: "rgb(51,51,48)"
					},
					"--dsw-alias-border-l1": {
						light: "rgba(25,25,25,0.07)",
						dark: "rgba(255,255,255,0.07)"
					},
					"--dsw-alias-border-l2": {
						light: "rgba(25,25,25,0.14)",
						dark: "rgba(255,255,255,0.13)"
					},
					"--dsw-alias-border-l3": {
						light: "rgba(25,25,25,0.20)",
						dark: "rgba(255,255,255,0.19)"
					},
					"--dsw-alias-brand-primary": {
						light: "rgb(217,119,87)",
						dark: "rgb(217,119,87)"
					},
					"--dsw-alias-brand-text": {
						light: "rgb(25,25,25)",
						dark: "rgb(237,237,237)"
					},
					"--dsw-alias-brand-primary-invert": {
						light: "rgb(250,249,245)",
						dark: "rgb(38,38,36)"
					},
					"--dsw-alias-button-primary-fill": {
						light: "rgb(204,120,92)",
						dark: "rgb(204,120,92)"
					},
					"--dsw-alias-button-primary-hover": {
						light: "rgb(217,130,102)",
						dark: "rgb(217,130,102)"
					},
					"--dsw-alias-button-primary-dimmed": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-button-contrast-fill": {
						light: "rgb(38,38,36)",
						dark: "rgb(240,238,230)"
					},
					"--dsw-alias-button-info-fill": {
						light: "rgb(217,119,87)",
						dark: "rgb(217,119,87)"
					},
					"--dsw-alias-button-info-hover": {
						light: "rgb(193,95,60)",
						dark: "rgb(193,95,60)"
					},
					"--dsw-alias-button-elevated-fill": {
						light: "rgb(255,255,255)",
						dark: "rgb(48,48,46)"
					},
					"--dsw-alias-button-floating-fill": {
						light: "rgb(255,255,255)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-button-floating-hover": {
						light: "rgb(240,238,230)",
						dark: "rgb(64,64,61)"
					},
					"--dsw-alias-button-ghost-active-fill": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-button-ghost-active-hover": {
						light: "rgb(232,228,216)",
						dark: "rgb(64,64,61)"
					},
					"--dsw-alias-button-ghost-active-border": {
						light: "rgb(110,109,107)",
						dark: "rgb(164,163,161)"
					},
					"--dsw-alias-label-primary": {
						light: "rgb(25,25,25)",
						dark: "rgb(237,237,237)"
					},
					"--dsw-alias-label-secondary": {
						light: "rgb(110,109,107)",
						dark: "rgb(164,163,161)"
					},
					"--dsw-alias-label-tertiary": {
						light: "rgb(131,129,125)",
						dark: "rgb(131,129,125)"
					},
					"--dsw-alias-label-caption": {
						light: "rgb(164,163,161)",
						dark: "rgb(110,109,107)"
					},
					"--dsw-alias-state-business-primary": {
						light: "rgb(217,119,87)",
						dark: "rgb(217,119,87)"
					},
					"--dsw-alias-state-business-tertiary": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-specific-sidebar-fill": {
						light: "rgb(240,238,230)",
						dark: "rgb(31,31,30)"
					},
					"--dsw-specific-sidebar-nav-item-active": {
						light: "rgb(232,228,216)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-specific-sidebar-nav-item-hover": {
						light: "rgb(245,242,234)",
						dark: "rgb(48,48,46)"
					},
					"--dsw-specific-sidebar-nav-item-active-accent": {
						light: "rgb(224,218,204)",
						dark: "rgb(64,64,61)"
					},
					"--dsw-specific-bubble": {
						light: "rgb(240,238,230)",
						dark: "rgb(48,48,46)"
					},
					"--dsw-specific-bubble-highlight": {
						light: "rgb(232,228,216)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-markdown-code-block": {
						light: "rgb(245,242,235)",
						dark: "rgb(51,51,48)"
					},
					"--dsw-alias-markdown-code-block-banner": {
						light: "rgb(250,248,242)",
						dark: "rgb(46,46,44)"
					},
					"--dsw-alias-markdown-inline-code": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-markdown-citation": {
						light: "rgb(237,234,224)",
						dark: "rgb(51,51,48)"
					},
					"--dsw-alias-markdown-tag": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-interactive-bg-hover": {
						light: "rgba(25,25,25,0.05)",
						dark: "rgba(255,255,255,0.07)"
					},
					"--dsw-alias-interactive-bg-active": {
						light: "rgba(25,25,25,0.09)",
						dark: "rgba(255,255,255,0.12)"
					},
					"--dsw-alias-interactive-bg-hover-solid": {
						light: "rgb(240,238,230)",
						dark: "rgb(58,57,54)"
					},
					"--dsw-alias-interactive-bg-hover-accent": {
						light: "rgba(217,119,87,0.16)",
						dark: "rgba(217,119,87,0.28)"
					},
					"--dsw-alias-toast-bg": {
						light: "rgb(38,38,36)",
						dark: "rgb(31,31,30)"
					},
					"--dsw-alias-tooltip-bg": {
						light: "rgb(38,38,36)",
						dark: "rgb(31,31,30)"
					},
					"--dsw-alias-scrollbar-bg-l1": {
						light: "rgb(221,216,202)",
						dark: "rgb(74,73,69)"
					},
					"--dsw-alias-scrollbar-bg-l2": {
						light: "rgb(221,216,202)",
						dark: "rgb(74,73,69)"
					},
					"--dsw-alias-scrollbar-hover-l1": {
						light: "rgb(207,201,184)",
						dark: "rgb(90,89,84)"
					},
					"--dsw-alias-scrollbar-hover-l2": {
						light: "rgb(207,201,184)",
						dark: "rgb(90,89,84)"
					}
				}
			})
		]);
		/**
		* Look up a built-in skin by id.
		* @param id - skin id.
		* @returns the skin definition (built-ins always resolve).
		*/
		function skinById(id) {
			const skin = SKINS.find((entry) => entry.id === id);
			/* v8 ignore next 2 -- SKINS covers every SKIN_IDS member */
			if (skin === void 0) return skinById(DEFAULT_SKIN);
			return skin;
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* 本特性设置行文案的命名空间。
		*
		* 用 `settings.dshUiSkin` 而不是树内的 `settings.skin` —— locale 注册表同样按
		* 命名空间唯一，两个皮肤插件都注册 `settings.skin` 会撞（与 `provide` 同一类问题）。
		*/
		const SETTINGS_NS = "settings.dshUiSkin";
		/**
		* 把一个跨边界的值收窄成合法皮肤 id。
		* @param value - 来自设置快照或本地镜像的值。
		* @returns 合法 id；否则 undefined（由调用方决定回落什么）。
		*/
		function narrowSkin(value) {
			return isSkinId(value) ? value : void 0;
		}
		/** 把皮肤 id 发布到 body 上（品牌面 CSS 的选举依据）。 */
		function applyBodyAttribute(id) {
			if (typeof document === "undefined") return;
			document.body.setAttribute(SKIN_ATTRIBUTE, id);
		}
		/** 皮肤服务：注册表与偏好的拥有者。 */
		var SkinRuntime = class {
			ctx;
			theme;
			store;
			persist;
			id;
			revision = 0;
			snapshot;
			disposer;
			/**
			* @param ctx - 所属上下文（change 事件在它上面发出）。
			* @param theme - 承载皮肤覆盖层的主题服务。
			* @param store - 设置行的 store（记录素材清单状态）。
			* @param options - 初始 id（来自本地镜像）与写入持久化的回调。
			*/
			constructor(ctx, theme, store, options) {
				this.ctx = ctx;
				this.theme = theme;
				this.store = store;
				this.persist = options.persist;
				this.id = options.initial;
				this.snapshot = Object.freeze({
					id: this.id,
					revision: this.revision
				});
				this.applyLayer(this.id);
			}
			/**
			* 读当前不可变快照。
			* @returns 当前快照（下次变更前引用稳定）。
			*/
			getSkin() {
				return this.snapshot;
			}
			/**
			* 切换皮肤 —— 用户偏好的唯一写入入口。
			* @param id - 内置皮肤 id；未知值抛错。
			*/
			setSkin(id) {
				if (!isSkinId(id)) throw new Error(`skin "${String(id)}" is not a built-in skin`);
				if (this.id === id) return;
				this.persist(id);
				this.adopt(id);
			}
			/**
			* 采纳设置里的权威值（**不写回**，避免与设置形成写回环）。
			* 其他标签页改了皮肤时，设置镜像会把新值推到这里，跨标签页同步即由此完成。
			* @param id - 设置快照里的皮肤 id。
			*/
			adoptFromSettings(id) {
				if (this.id !== id) this.adopt(id);
			}
			/** 采纳一个已持久化的 id，不写回。 */
			adopt(id) {
				this.id = id;
				this.applyLayer(id);
				this.publish();
			}
			/** 重新叠加覆盖层，并刷新 body 属性。
			*
			* 顺序：**先叠新层，再撤旧层**。反过来（先 dispose 再 apply）会有一瞬没有任何
			* 皮肤 token，整屏闪一下 —— 切换皮肤时肉眼可见。
			*
			* 这样写是安全的，因为 `ThemeRuntime.overrideTokens` 按 source 记账（一个 source
			* 只有一层，重复调用即替换），并且**被替换后旧 disposer 自动变成 no-op**
			* （见 ui-theme 的 `overrideTokens` 文档）；所以既没有空档，也不会留下旧层。
			*/
			applyLayer(id) {
				const previous = this.disposer;
				this.disposer = this.theme.overrideTokens("dsh-ui-skin", skinById(id).tokens);
				previous?.();
				applyBodyAttribute(id);
			}
			publish() {
				this.revision += 1;
				this.snapshot = Object.freeze({
					id: this.id,
					revision: this.revision
				});
				this.ctx.emit("uiSkin/change", this.snapshot);
			}
		};
		/**
		* 必需服务：主题运行时（覆盖层的宿主）、槽位与文案（设置行）、设置面
		* （素材目录的读写通道）。
		*/
		const inject = [
			"slots",
			"locale",
			"theme",
			"configForms"
		];
		/**
		* 客户端插件主体。
		* @param ctx - 客户端 cordis 上下文。
		*/
		function apply(ctx) {
			const store = createSkinRowStore();
			let scope;
			const mirror = createStore({ skin: DEFAULT_SKIN }, { persist: SKIN_STORAGE_KEY });
			const skin = new SkinRuntime(ctx, ctx.theme, store, {
				initial: narrowSkin(mirror.get().skin) ?? "deepseek",
				persist: (id) => {
					mirror.set({ skin: id });
					scope?.set(SKIN_FIELD, id);
				}
			});
			ctx.provide?.("uiSkin", skin);
			ctx.effect?.(() => {
				ctx.locale?.register(SETTINGS_NS, {
					zh,
					en
				});
			}, "ui-skin: settings row dictionaries");
			/** 从 scope 快照里取出 assetsDir（去空白；非字符串一律当空）。 */
			const dirFromSnapshot = (snapshot) => {
				const section = snapshot?.value;
				const raw = section !== null && typeof section === "object" ? section[ASSETS_DIR_FIELD] : void 0;
				return typeof raw === "string" ? raw.trim() : "";
			};
			/** 设置里**用户显式写过**的皮肤 id（区别于 schema 默认值）。 */
			const userSkin = (snapshot) => {
				const user = snapshot?.user;
				if (user === null || typeof user !== "object") return void 0;
				return narrowSkin(user[SKIN_FIELD]);
			};
			const syncDir = () => {
				const dir = dirFromSnapshot(scope?.getSnapshot());
				store.set({ assetsDir: dir });
				return dir;
			};
			const syncSkin = () => {
				const id = userSkin(scope?.getSnapshot());
				if (id !== void 0) skin.adoptFromSettings(id);
			};
			ctx.effect?.(() => {
				scope = ctx.configForms?.get(SKIN_ENTRY_ID);
				if (scope === void 0) return () => {};
				const stop = scope.subscribe(() => {
					syncDir();
					syncSkin();
				});
				syncDir();
				syncSkin();
				return () => {
					stop();
					scope = void 0;
				};
			}, "ui-skin: settings scope");
			/** 写入素材目录：空串 = 清掉字段（回到默认目录）。 */
			const writeDir = (dir) => {
				try {
					if (dir === "") scope?.unset(ASSETS_DIR_FIELD);
					else scope?.set(ASSETS_DIR_FIELD, dir);
				} catch {}
			};
			const loadManifest = () => {
				console.info("[dsh-ui-skin] loadManifest 开始");
				fetchAssetManifest().then((state) => {
					store.set({ assets: state });
					if (state.status === "ready") console.info(`[dsh-ui-skin] 素材清单：${state.manifest.assets.length} 张，目录 ${state.manifest.dir}`);
					else if (state.status === "error") console.warn(`[dsh-ui-skin] 素材清单读取失败：${state.reason}（标记将用内置矢量版）`);
				});
			};
			ctx.effect?.(() => {
				loadManifest();
			}, "ui-skin: asset manifest");
			let lastFetchedDir = store.get().assetsDir;
			let timer;
			const unsubscribe = store.subscribe(() => {
				const dir = store.get().assetsDir;
				if (dir === lastFetchedDir) return;
				lastFetchedDir = dir;
				if (timer !== void 0) clearTimeout(timer);
				timer = setTimeout(loadManifest, 250);
			});
			ctx.effect?.(() => () => {
				unsubscribe();
				if (timer !== void 0) clearTimeout(timer);
			}, "ui-skin: assetsDir watcher");
			const useStore = makeUseStoreHook(store);
			const syncStore = (snapshot) => {
				store.set({
					skin: snapshot.id,
					revision: snapshot.revision
				});
			};
			ctx.on("uiSkin/change", syncStore);
			const injected = () => ({
				setSkin: (id) => {
					skin.setSkin(id);
				},
				getAssetsDir: () => store.get().assetsDir,
				setAssetsDir: (dir) => {
					store.set({ assetsDir: dir });
					writeDir(dir);
					lastFetchedDir = dir;
					loadManifest();
				},
				isDefaultAssetsDir: () => store.get().assetsDir === "",
				useStore
			});
			ctx.slots?.inject("settings.general.item", () => ctx.slots?.register({
				name: "settings.general.item",
				id: "dsh-ui-skin",
				order: 11,
				locale: SETTINGS_NS,
				inject: injected
			}, SkinRow));
		}
		//#endregion
		exports.ASSETS_URL_PREFIX = ASSETS_URL_PREFIX;
		exports.DEFAULT_SKIN = DEFAULT_SKIN;
		exports.SETTINGS_NS = SETTINGS_NS;
		exports.SKINS = SKINS;
		exports.SKIN_ATTRIBUTE = SKIN_ATTRIBUTE;
		exports.SKIN_ENTRY_ID = SKIN_ENTRY_ID;
		exports.SKIN_FIELD = SKIN_FIELD;
		exports.SKIN_IDS = SKIN_IDS;
		exports.SKIN_STORAGE_KEY = SKIN_STORAGE_KEY;
		exports.SkinRuntime = SkinRuntime;
		exports.apply = apply;
		exports.assetUrl = assetUrl;
		exports.inject = inject;
		exports.isSkinId = isSkinId;
		exports.skinById = skinById;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map