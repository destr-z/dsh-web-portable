window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-persona-switcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/PersonaCard.tsx
		/**
		* PersonaCard：设置页"人设"卡片——完全复刻官方插件卡片（PluginCard）视觉：
		* 12px 圆角、层次底色、头部 button 可点击折叠、旋转 chevron 图标、hover/展开
		* 变色，保存/删除按钮与官方 save/discard 一致。
		*/
		/** 与官方 IconChevronDownOutline14 同款线条箭头（14px）。 */
		function ChevronDown$1(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				style: {
					flex: "none",
					color: "var(--dsw-alias-label-tertiary)",
					transform: props.open ? "rotate(180deg)" : "none",
					transition: "transform .16s"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.5 5.25 7 8.75l3.5-3.5",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function PersonaCard(props) {
			const { scope } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const snap = (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot());
			const templates = snap?.value?.templates ?? [];
			const [sel, setSel] = (0, react.useState)("");
			const selected = templates.find((t) => t.id === sel) ?? templates[0];
			const [draftName, setDraftName] = (0, react.useState)("");
			const [draftText, setDraftText] = (0, react.useState)("");
			const [saved, setSaved] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				setDraftName(selected?.name ?? "");
				setDraftText(selected?.text ?? "");
				setSaved("");
				setError("");
			}, [selected?.id, snap]);
			const save = async () => {
				setError("");
				if (selected === void 0) return setError("请先新增一个模板。");
				const name = draftName.trim();
				const text = draftText.trim();
				if (name === "") return setError("模板名称不能为空。");
				if (text === "") return setError("模板文字不能为空。");
				const next = templates.map((t) => t.id === selected.id ? {
					...t,
					name,
					text
				} : t);
				await scope.set("templates", next);
				setSaved("已保存");
			};
			const addNew = async () => {
				setError("");
				setSaved("");
				try {
					const id = "tpl-" + Date.now().toString(36);
					await scope.set("templates", [...templates, {
						id,
						name: "新模板",
						text: ""
					}]);
					setSel(id);
					setSaved("");
				} catch (err) {
					setError(String(err));
				}
			};
			const remove = async () => {
				setError("");
				setSaved("");
				try {
					if (selected === void 0) return;
					const next = templates.filter((t) => t.id !== selected.id);
					await scope.set("templates", next);
					setSel("");
				} catch (err) {
					setError(String(err));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: {
					listStyle: "none",
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: "12px",
					background: open ? "var(--dsw-alias-bg-layer-2)" : "var(--dsw-alias-bg-layer-3)",
					transition: "border-color .16s, background .16s",
					margin: "0"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => setOpen((v) => !v),
					style: {
						appearance: "none",
						border: 0,
						background: "none",
						font: "inherit",
						color: "inherit",
						textAlign: "left",
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						gap: "12px",
						padding: "14px 16px",
						borderRadius: "12px",
						width: "100%"
					},
					"aria-expanded": open,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							flex: 1,
							minWidth: 0,
							display: "flex",
							flexDirection: "column",
							gap: "4px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: "15px",
								fontWeight: 600,
								lineHeight: "1.4",
								color: "var(--dsw-alias-label-primary)"
							},
							children: "人设"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: "13px",
								lineHeight: "1.5",
								color: "var(--dsw-alias-label-tertiary)"
							},
							children: "对话的人设模板库，可增删改；在对话输入框工具行选择使用。"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronDown$1, { open })]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						borderTop: "1px solid var(--dsw-alias-border-l2)",
						margin: "0 16px",
						paddingBottom: "8px"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: "6px",
							flexWrap: "wrap",
							margin: "12px 0 12px"
						},
						children: [templates.map((t) => {
							const active = selected?.id === t.id;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setSel(t.id),
								style: {
									appearance: "none",
									font: "inherit",
									fontSize: "13px",
									lineHeight: "1.5",
									padding: "3px 10px",
									borderRadius: "8px",
									cursor: "pointer",
									border: `1px solid ${active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-border-l2)"}`,
									color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
									background: active ? "var(--dsw-alias-bg-layer-2)" : "none"
								},
								children: t.name
							}, t.id);
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => void addNew(),
							style: {
								appearance: "none",
								font: "inherit",
								fontSize: "13px",
								lineHeight: "1.5",
								padding: "3px 10px",
								borderRadius: "8px",
								cursor: "pointer",
								color: "var(--dsw-alias-label-secondary)",
								background: "none",
								border: "1px solid var(--dsw-alias-border-l2)"
							},
							children: "＋ 新增"
						})]
					}), selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "13px",
							lineHeight: "1.5",
							color: "var(--dsw-alias-label-tertiary)"
						},
						children: "还没有模板——点\"＋ 新增\"创建一个。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "10px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: "12px",
									lineHeight: "1.5",
									color: "var(--dsw-alias-label-tertiary)",
									marginBottom: "4px"
								},
								children: "名称"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: draftName,
								onChange: (e) => setDraftName(e.target.value),
								placeholder: "例如：梦境精灵",
								style: {
									font: "inherit",
									fontSize: "14px",
									lineHeight: "1.6",
									color: "var(--dsw-alias-label-primary)",
									backgroundColor: "var(--dsw-alias-bg-layer-3)",
									border: "1px solid var(--dsw-alias-border-l2)",
									borderRadius: "8px",
									padding: "6px 10px",
									outline: "none",
									width: "100%",
									boxSizing: "border-box"
								},
								onFocus: (e) => {
									e.currentTarget.style.borderColor = "var(--dsw-alias-label-dimmed)";
								},
								onBlur: (e) => {
									e.currentTarget.style.borderColor = "var(--dsw-alias-border-l2)";
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: "12px",
									lineHeight: "1.5",
									color: "var(--dsw-alias-label-tertiary)",
									marginBottom: "4px"
								},
								children: "人设内容"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: draftText,
								onChange: (e) => setDraftText(e.target.value),
								placeholder: "人设内容，支持 {{model}}、{{cwd}} 占位符；保存后用于新选择",
								rows: 4,
								style: {
									font: "inherit",
									fontSize: "14px",
									lineHeight: "1.6",
									color: "var(--dsw-alias-label-primary)",
									backgroundColor: "var(--dsw-alias-bg-layer-3)",
									border: "1px solid var(--dsw-alias-border-l2)",
									borderRadius: "8px",
									padding: "6px 10px",
									outline: "none",
									width: "100%",
									boxSizing: "border-box",
									resize: "vertical"
								},
								onFocus: (e) => {
									e.currentTarget.style.borderColor = "var(--dsw-alias-label-dimmed)";
								},
								onBlur: (e) => {
									e.currentTarget.style.borderColor = "var(--dsw-alias-border-l2)";
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									justifyContent: "flex-end",
									gap: "8px",
									padding: "12px 0 4px",
									borderTop: "1px solid var(--dsw-alias-border-l2)",
									marginTop: "2px"
								},
								children: [
									saved !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "12px",
											lineHeight: "1.5",
											color: "var(--dsw-alias-state-success-primary)",
											marginRight: "auto"
										},
										children: saved
									}),
									error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "12px",
											lineHeight: "1.5",
											color: "var(--dsw-alias-state-error-primary)",
											marginRight: "auto"
										},
										children: error
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void remove(),
										style: {
											appearance: "none",
											font: "inherit",
											fontSize: "13px",
											lineHeight: "1.5",
											border: "1px solid var(--dsw-alias-border-l2)",
											borderRadius: "8px",
											padding: "5px 14px",
											cursor: "pointer",
											background: "none",
											color: "var(--dsw-alias-label-secondary)"
										},
										children: "删除"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void save(),
										style: {
											appearance: "none",
											font: "inherit",
											fontSize: "13px",
											lineHeight: "1.5",
											border: "1px solid transparent",
											borderRadius: "8px",
											padding: "5px 14px",
											cursor: "pointer",
											background: "var(--dsw-alias-label-primary)",
											color: "var(--dsw-alias-bg-layer-3)"
										},
										children: "保存"
									})
								]
							})
						]
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/PersonaSelect.tsx
		/**
		* PersonaSelect：输入框工具行的人设选择器——按官方权限/模型触发器与
		* Menu 组件的样式逐值复刻：28px 高 24px 胶囊触发器（默认透明、hover 浮现
		* 浅灰、chevron 120ms 旋转过渡）、29 号菜单卡片（12px 圆角、specific-menu
		* 底、40px 项/10px 圆角、hover 浅灰、选中仅打勾、向上弹出）。
		*/
		function ChevronDown(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": true,
				style: {
					display: "inline-flex",
					flex: "0 0 auto",
					color: "var(--dsw-alias-label-caption)",
					transform: props.open ? "rotate(180deg)" : "none",
					transition: "transform 120ms ease"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: "14",
					height: "14",
					viewBox: "0 0 14 14",
					fill: "none",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M3.5 5.25 7 8.75l3.5-3.5",
						stroke: "currentColor",
						strokeWidth: "1.5",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					})
				})
			});
		}
		function CheckIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": true,
				style: {
					display: "inline-flex",
					flex: "none",
					color: "var(--dsw-alias-label-primary)"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: "16",
					height: "16",
					viewBox: "0 0 16 16",
					fill: "none",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M3.5 8.3 6.8 11.6 12.5 5",
						stroke: "currentColor",
						strokeWidth: "1.6",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					})
				})
			});
		}
		function PersonaSelect(props) {
			const { sessionId, scope } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const value = (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot())?.value;
			const templates = value?.templates ?? [];
			const sessions = value?.sessions ?? {};
			const current = sessions[sessionId];
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDown = (event) => {
					if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("mousedown", onDown);
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("mousedown", onDown);
					window.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const choose = async (id) => {
				setOpen(false);
				const next = { ...sessions };
				if (id === "") delete next[sessionId];
				else {
					const tpl = templates.find((t) => t.id === id);
					if (tpl === void 0) return;
					next[sessionId] = {
						id: tpl.id,
						name: tpl.name,
						text: tpl.text
					};
				}
				await scope.set("sessions", next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				style: {
					position: "relative",
					display: "inline-flex",
					alignItems: "center"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => setOpen((v) => !v),
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					title: "为本对话选择人设模板（开始对话前也可选）",
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "4px",
						maxWidth: "220px",
						height: "28px",
						padding: "0 4px 0 8px",
						border: "none",
						borderRadius: "24px",
						outline: "none",
						background: "transparent",
						color: "var(--dsw-alias-label-secondary)",
						fontSize: "13px",
						lineHeight: "20px",
						fontWeight: 500,
						cursor: "pointer",
						transition: "background-color 120ms ease"
					},
					onMouseEnter: (e) => {
						e.currentTarget.style.backgroundColor = "var(--dsw-alias-interactive-bg-hover)";
					},
					onMouseLeave: (e) => {
						e.currentTarget.style.backgroundColor = "transparent";
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						},
						children: current ? `人设：${current.name}` : "人设"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronDown, { open })]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "listbox",
					style: {
						position: "absolute",
						left: "0",
						bottom: "calc(100% + 4px)",
						zIndex: 100,
						boxSizing: "border-box",
						minWidth: "218px",
						maxWidth: "360px",
						padding: "4px",
						display: "flex",
						flexDirection: "column",
						border: "1px solid var(--dsw-alias-border-inverted)",
						borderRadius: "12px",
						background: "var(--dsw-specific-menu)",
						boxShadow: "var(--dsw-shadow-lv3)"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						role: "option",
						"aria-selected": !current,
						onClick: () => void choose(""),
						style: {
							display: "flex",
							alignItems: "center",
							gap: "8px",
							width: "100%",
							minHeight: "40px",
							padding: "8px 10px",
							border: "none",
							borderRadius: "10px",
							background: "transparent",
							cursor: "pointer",
							fontSize: "14px",
							lineHeight: "22px",
							color: "var(--dsw-alias-label-primary)",
							textAlign: "left"
						},
						onMouseEnter: (e) => {
							e.currentTarget.style.backgroundColor = "var(--dsw-alias-interactive-bg-hover)";
						},
						onMouseLeave: (e) => {
							e.currentTarget.style.backgroundColor = "transparent";
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: "未设置"
						}), !current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {})]
					}), templates.map((t) => {
						const active = current?.id === t.id;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": active,
							onClick: () => void choose(t.id),
							style: {
								display: "flex",
								alignItems: "center",
								gap: "8px",
								width: "100%",
								minHeight: "40px",
								padding: "8px 10px",
								border: "none",
								borderRadius: "10px",
								background: "transparent",
								cursor: "pointer",
								fontSize: "14px",
								lineHeight: "22px",
								color: "var(--dsw-alias-label-primary)",
								textAlign: "left"
							},
							onMouseEnter: (e) => {
								e.currentTarget.style.backgroundColor = "var(--dsw-alias-interactive-bg-hover)";
							},
							onMouseLeave: (e) => {
								e.currentTarget.style.backgroundColor = "transparent";
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									flex: 1,
									minWidth: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: t.name
							}), active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {})]
						}, t.id);
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Settings namespace（必须与 host 端一致）。 */
		const NS = "persona-switcher";
		const inject = ["slots", "configForms"];
		function apply(ctx) {
			console.info("[persona-switcher] client apply: start");
			try {
				const scope = ctx.configForms.get(NS);
				ctx.slots.inject("settings.plugins.tab", function* () {
					yield ctx.slots.register({
						name: "settings.plugins.tab",
						id: NS,
						order: 40,
						label: () => "人设",
						inject: () => ({ scope })
					}, PersonaCard);
				});
				ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
					name: "conversation.input.left",
					id: "persona-switcher-select",
					order: 30,
					inject: (sessionId) => ({
						sessionId,
						scope
					})
				}, PersonaSelect));
				console.info("[persona-switcher] client apply: slots registered");
			} catch (error) {
				console.error("[persona-switcher] client apply FAILED:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map