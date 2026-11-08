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

 const anchorOf = (g) =>
 g.querySelector(".tab-group-label-container") || g.labelElement || (g.tabs && g.tabs) || g;

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

 function groupSelected() {
 const tabs = targetTabs().filter((t) => !t.pinned);
 if (!tabs.length) return;

 // 1) 右クリックメニューの「新しいグループにタブを追加」と同じ関数を呼ぶ
 const ctxMenu = typeof TabContextMenu !== "undefined" ? TabContextMenu : null;
 if (ctxMenu && typeof ctxMenu.moveTabsToNewGroup === "function") {
 try {
   ctxMenu.contextTab = tabs.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : tabs;
   ctxMenu.contextTabs = tabs;
   ctxMenu.moveTabsToNewGroup();
 } catch (e) { if (DEBUG) dlog("moveTabsToNewGroup エラー:", String(e)); }
 }

 // 2) 上で作れなかった場合だけ、自分で作る
 let group = tabs.group;
 if (!group) {
 group = gBrowser.addTabGroup(tabs, {
 insertBefore: tabs,
 isUserTriggered: true,
 telemetryUserCreateSource: "shortcut",
 });
 }
 if (!group) return;

    // 3) パネルがまだ開いていなければ開く（Macのキーボード切断バグを完全回避）
    whenLaidOut(group, () => {
      try {
        const m = gBrowser.tabGroupMenu;
        if (!m) return;
        if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
        if (DEBUG) { hookPanelEvents(m); dlog(T(), "パネル確認 state =", m.panel && m.panel.state); }
        
        if (!isOpen(m)) {
          // ★バグを潰す核心：openCreateModal（モーダル）を使うのをやめ、
          // 通常のポップアップとしてターゲット要素（グループのラベル部分）の真下に展開します。
          // これによりMacのキーボード電波が完全に維持され、アルファベットも日本語も最初から打てるようになります。
          const anchor = anchorOf(group);
          
          if (m.panel && typeof m.panel.openPopup === "function") {
            // パネル要素を直接ポップアップとして開く
            m.panel.openPopup(anchor, "bottomcenter", 0, 0, false, false);
          } else if (typeof m.open === "function") {
            m.open(anchor);
          } else {
            // 万が一のフォールバック
            m.openCreateModal(group);
          }
          
          // 開いた直後にフォーカスを当てる
          setTimeout(() => {
            const panelInput = m.panel && m.panel.querySelector("input, moz-input-text");
            if (panelInput) {
              panelInput.focus();
              if (typeof panelInput.select === "function") panelInput.select();
            }
          }, 50);
        }
        
        if (DEBUG) debugPanel(m);
      } catch (e) {
        console.error("[NativeGroupShortcut] パネルを開けませんでした:", e);
      }
    });


 function ungroupSelected() {
 const tabs = targetTabs().filter((t) => t.group);
 if (!tabs.length) return;
 if (typeof gBrowser.ungroupTab !== "function") {
 console.error("[NativeGroupShortcut] gBrowser.ungroupTab がありません");
 return;
 }
 for (const t of tabs) gBrowser.ungroupTab(t);
 }

 const ACTIONS = [
 { id: "group", label: "グループ化", run: groupSelected },
 { id: "ungroup", label: "グループから外す", run: ungroupSelected },
 ];

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

 const stored = (id) => {
 try { return parse(Services.prefs.getStringPref(PREF + id, "Alt+G")); }
 catch (_) { return parse("Alt+G"); }
 };

  function handleKeyDown(e) {
    const pressed = fromEvent(e);
    
    if (same(pressed, stored("group"))) {
      e.preventDefault();
      e.stopPropagation();
      
      setTimeout(() => {
        groupSelected();
      }, 20);
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
    window.addEventListener("keydown", handleKeyDown, true);
  }

  if (location.href === "chrome://browser/content/browser.xhtml") {
    if (document.readyState === "complete") {
      initBrowser();
    } else {
      window.addEventListener("DOMContentLoaded", initBrowser, { once: true });
    }
  }
})();
