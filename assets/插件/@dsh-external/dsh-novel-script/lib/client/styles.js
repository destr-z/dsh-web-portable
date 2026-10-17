/**
 * 工作台的样式（字符串，通过 styles.insert 注入）。
 *
 * 规则：
 *   · **只用 DSH 主题变量**（`--dsw-alias-*`），不写死任何颜色——
 *     写死的话切浅色主题就瞎了。
 *   · 变量名都是实测过的，不是猜的。
 *   · 类名统一 `ns-` 前缀，避免和官方样式撞车。
 */
export const overlayCss = `
/* ── 全屏浮层根：只做定位，不拦截鼠标（点空白处要能穿透到官方界面）── */
.ns-root { position: absolute; inset: 0; pointer-events: none; }

/* ── 工作台面板 ── */
.ns-workbench {
  position: absolute;
  left: 24px; top: 56px;
  width: 860px; height: 560px;
  max-width: calc(100vw - 48px); max-height: calc(100vh - 96px);
  display: flex; flex-direction: column; min-height: 0;
  border-radius: 14px; overflow: hidden;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 22px 60px rgba(0,0,0,.34), 0 6px 18px rgba(0,0,0,.18);
  color: var(--dsw-alias-label-primary);
  font: 13px/1.65 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  /* 关键：这一层自己 opt back into 鼠标事件 */
  pointer-events: auto;
}

.ns-wb-hd {
  flex: none; display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  cursor: move; user-select: none;
}
.ns-grip { color: var(--dsw-alias-label-caption); letter-spacing: -2px; font-size: 11px; }
.ns-t { font-size: 12px; font-weight: 600; white-space: nowrap; }
.ns-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ns-spacer { flex: 1; }
.ns-x {
  background: none; border: none; padding: 1px 6px; border-radius: 6px;
  font-size: 12px; color: var(--dsw-alias-label-caption); cursor: pointer;
}
.ns-x:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.ns-wb-bd { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 20px; }
.ns-p { margin: 0 0 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.ns-p b { color: var(--dsw-alias-label-primary); }
.ns-p code {
  font-family: ui-monospace, Consolas, monospace; font-size: 12px;
  background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 1px 5px;
}
.ns-row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.ns-btn {
  padding: 4px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: inherit;
}
.ns-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ns-note { font-size: 12px; color: var(--dsw-alias-state-business-primary); }
`;
//# sourceMappingURL=styles.js.map