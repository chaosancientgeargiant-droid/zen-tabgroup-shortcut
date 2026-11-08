// ==UserScript==
// @name Native Group Shortcut
// @description タブグループのショートカット(標準パネルを開く/グループから外す)。キーは設定画面で変更可
// @include chrome://browser/content/browser.xhtml
// @include about:preferences*
// @include about:settings*
// ==/UserScript==

(function () {
 "use strict";

 const PREF = "mod.native-group-shortcut.";
 const IS_MAC = Services.appinfo.OS === "Darwin";
 const MOD_WORDS = {
 ctrl: "ctrl", control: "ctrl",
 alt: "alt", option: "alt", opt: "alt",
 shift: "shift",
 cmd: "meta", command: "meta", meta: "meta", super: "meta", win: "meta",
 };
 const PURE_MODS = ["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"];
 const UNUSABLE = ["Dead", "Process", "Unidentified"];

 // ---------- 動作 ----------

 function targetTabs() {
 return gBrowser.selectedTabs && gBrowser.selectedTabs.length
 ? gBrowser.selectedTabs
 : [gBrowser.selectedTab];
 }

 // パネルの貼り付け先(グループのラベル部分)が画面に配置されるまで待つ。
 const anchorOf = (g) =>
 g.querySelector(".tab-group-label-container") || g.labelElement || (g.tabs && g.tabs[0]) || g;

 function whenLaidOut(group, cb, tries = 12) {
 const step = () => {
 const a = anchorOf(group);
 if ((a.isConnected && a.getBoundingClientRect().height > 0) || --tries <= 0) return cb();
 requestAnimationFrame(step);
 };
 requestAnimationFrame(step);
 }

 const DEBUG = true;
 const dlog = (...a) => console.log("[NativeGroupShortcut]", ...a);
 const T = () => Math.round(performance.now()) % 100000;

 function hookPanelEvents(menu) {
 const p = menu.panel;
 if (!p || p.__ngsHook) return;
 p.__ngsHook = true;
 p.addEventListener("popupshowing", () => dlog(T(), "popupshowing"));
 p.addEventListener("popupshown", () => dlog(T(), "popupshown"));
 p.addEventListener("popuphidden", () => dlog(T(), "popuphidden"));
 }

 function debugPanel(menu) {
 const log = dlog;
 setTimeout(() => {
 try {
 const p = menu.panel;
 const i = p && p.querySelector("input, moz-input-text");
 log("diag", JSON.stringify({
 state: p && p.state,
 activeInPanel: !!(p && p.contains(document.activeElement)),
 activeTag: document.activeElement && document.activeElement.localName,
 hasFocus: document.hasFocus(),
 focus: describeFocus(),
 }));
 if (i && !i.__ngsDbg) {
 i.__ngsDbg = true;
 i.addEventListener("keydown", (e) =>
 log("keydown in input:", e.key, "defaultPrevented:", e.defaultPrevented, "composing:", e.isComposing));
 i.addEventListener("keypress", (e) => log("keypress:", e.key, "prevented:", e.defaultPrevented));
 i.addEventListener("beforeinput", (e) => log("beforeinput:", e.inputType, "prevented:", e.defaultPrevented));
 i.addEventListener("compositionstart", () => log("compositionstart"));
 i.addEventListener("input", () => log("input event, value =", i.value));
 }
 } catch (e) { log("diag failed:", String(e)); }
 }, 500);
 }

 const isOpen = (m) => !!(m && m.panel && (m.panel.state === "showing" || m.panel.state === "open"));

 function describeFocus() {
 try {
 const fm = Services.focus;
 const el = fm.focusedElement;
 const w = fm.focusedWindow;
 let where = "?";
 try { where = w === window ? "本体ウィンドウ" : "コンテンツ(" + (w && w.location && w.location.protocol) + ")"; } catch (_) { where = "コンテンツ"; }
 return (el ? el.localName + (el.id ? "#" + el.id : "") : "(要素なし)") + " / " + where;
 } catch (e) { return "取得失敗: " + e; }
 }

 function groupSelected() {
 const tabs = targetTabs().filter((t) => !t.pinned);
 if (!tabs.length) return;
 if (DEBUG) dlog(T(), "実行前のフォーカス:", describeFocus());
 try { Services.focus.clearFocus(window); } catch (e) { dlog("clearFocus失敗:", String(e)); }
 if (DEBUG && gBrowser.tabGroupMenu) hookPanelEvents(gBrowser.tabGroupMenu);

 const ctxMenu = typeof TabContextMenu !== "undefined" ? TabContextMenu : null;
 if (ctxMenu && typeof ctxMenu.moveTabsToNewGroup === "function") {
 try {
 ctxMenu.contextTab = tabs.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : tabs[0];
 ctxMenu.contextTabs = tabs;
 ctxMenu.moveTabsToNewGroup();
 if (DEBUG) dlog(T(), "TabContextMenu.moveTabsToNewGroup を呼びました");
 } catch (e) {
 dlog(T(), "moveTabsToNewGroup でエラー:", String(e));
 }
 }

 let group = tabs[0].group;
 if (!group) {
 group = gBrowser.addTabGroup(tabs, {
 insertBefore: tabs[0],
 isUserTriggered: true,
 telemetryUserCreateSource: "shortcut",
 });
 if (DEBUG) dlog(T(), "自前で addTabGroup しました");
 }
 if (!group) return;

    // 3) パネルがまだ開いていなければ開く
    whenLaidOut(group, () => {
      try {
        const m = gBrowser.tabGroupMenu;
        if (!m) return;
        if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
        if (DEBUG) { hookPanelEvents(m); dlog(T(), "パネル確認 state =", m.panel && m.panel.state); }
        
        if (!isOpen(m)) {
          m.openCreateModal(group);
          
          setTimeout(() => {
            try {
              const panelInput = m.panel && m.panel.querySelector("input, moz-input-text");
              if (panelInput) {
                panelInput.blur();
                panelInput.focus();
                if (typeof panelInput.select === "function") panelInput.select();
              }
            } catch (_) {}
          }, 60);
        }
        
        if (DEBUG) debugPanel(m);
      } catch (e) {
        console.error("[NativeGroupShortcut] パネルを開けませんでした:", e);
      }
    });
 }

 function ungroupSelected() {
 const tabs = targetTabs().filter((t) => t.group);
 if (!tabs.length) return;
 if (typeof gBrowser.ungroupTab !== "function") {
 console.error("[NativeGroupShortcut] gBrowser.ungroupTab がありません");
 return;
 }
 for (const t of tabs) gBrowser.ungroupTab(t);
 }

 // ---------- ショートカットの解釈 ----------

 function parse(str) {
 const s = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
 for (const raw of (str || "").split("+")) {
 const t = raw.trim().toLowerCase();
 if (!t) continue;
 if (MOD_WORDS[t]) s[MOD_WORDS[t]] = true;
 else s.key = t.length === 1 ? t.toUpperCase() : raw.trim();
 }
 return s;
 }

 function keyOf(e) {
 if (PURE_MODS.includes(e.key)) return null;
 if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
 if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
 if (UNUSABLE.includes(e.key)) return null;
 return e.key.length === 1 ? e.key.toUpperCase() : e.key;
 }

 const fromEvent = (e) => ({
 ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key: keyOf(e),
 });
 const same = (a, b) =>
 a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta && a.key === b.key;

 const DEFAULTS = { group: "Alt+G", ungroup: "Cmd+Shift+R" };
 const stored = (id) => {
 try { return parse(Services.prefs.getStringPref(PREF + id, DEFAULTS[id])); }
 catch (_) { return parse(DEFAULTS[id]); }
 };

 // ---------- ブラウザウィンドウ: キーを受け取る ----------

  // 消えていたショートカット処理関数を復元
  function handleKeyUp(e) {
    const pressed = fromEvent(e);
    
    if (same(pressed, stored("group"))) {
      e.preventDefault();
      e.stopPropagation();
      groupSelected();
      return;
    }

    if (same(pressed, stored("ungroup"))) {
      e.preventDefault();
      e.stopPropagation();
      ungroupSelected();
    }
  }

  function initBrowser() {
    if (window.__ngsActive) return;
    window.__ngsActive = true;
    if (DEBUG) dlog("loaded v0.3.0 - Mac KeyUp Fix");

    // keyup（指を離した瞬間）にイベントを受け取る
    window.addEventListener("keyup", handleKeyUp, true);
  }

  // 初期化スクリプトの発火
  if (location.href === "chrome://browser/content/browser.xhtml") {
    if (document.readyState === "complete") {
      initBrowser();
    } else {
      window.addEventListener("DOMContentLoaded", initBrowser, { once: true });
    }
  }
})();
