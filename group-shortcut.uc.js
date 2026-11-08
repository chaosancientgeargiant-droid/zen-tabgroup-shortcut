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
 const T = () => Math.round(performance.now()) % 100000;

 function isOpen(m) { return !!(m && m.panel && (m.panel.state === "showing" || m.panel.state === "open")); }

 function groupSelected() {
 const tabs = targetTabs().filter((t) => !t.pinned);
 if (!tabs.length) return;

 // ★対策1: パネルを開く前に、ウィンドウ全体のキーボード・グラブ（独占状態）を強制解放する
 try {
   if (typeof window.setKeyboardGrab === "function") {
     window.setKeyboardGrab(false);
   }
 } catch (e) { if (DEBUG) dlog("Grab解放失敗:", String(e)); }

 const ctxMenu = typeof TabContextMenu !== "undefined" ? TabContextMenu : null;
 if (ctxMenu && typeof ctxMenu.moveTabsToNewGroup === "function") {
 try {
   ctxMenu.contextTab = tabs.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : tabs;
   ctxMenu.contextTabs = tabs;
   ctxMenu.moveTabsToNewGroup();
 } catch (e) { dlog("moveTabsToNewGroup エラー:", String(e)); }
 }

 let group = tabs.group;
 if (!group) {
 group = gBrowser.addTabGroup(tabs, {
 insertBefore: tabs,
 isUserTriggered: true,
 telemetryUserCreateSource: "shortcut",
 });
 }
 if (!group) return;

    whenLaidOut(group, () => {
      try {
        const m = gBrowser.tabGroupMenu;
        if (!m) return;
        if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
        
        if (!isOpen(m)) {
          m.openCreateModal(group);
          
          setTimeout(() => {
            try {
              const panelInput = m.panel && m.panel.querySelector("input, moz-input-text");
              if (panelInput) {
                // ★対策2: 特権レイヤーからフォーカスを当て、さらにOS側にアクティブ状態を再通知
                panelInput.focus();
                Services.focus.focusedElement = panelInput;
                
                // 選択状態にする
                if (typeof panelInput.select === "function") panelInput.select();
                
                // ★対策3: マカロン（IME）コンテキストのロック解除のためにウインドウにダミーの活性化シグナルを送る
                if (m.panel && typeof m.panel.suppressblur !== "undefined") {
                  m.panel.suppressblur = false;
                }
              }
            } catch (err) { if (DEBUG) dlog("特権フォーカス失敗:", String(err)); }
          }, 80);
        }
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

 const ACTIONS = [
 { id: "group", label: "グループ化", run: groupSelected },
 { id: "ungroup", label: "グループから外す", run: ungroupSelected },
 ];

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
      // ショートカットの既定処理を完全に殺す
      e.preventDefault();
      e.stopPropagation();
      
      // 次のマイクロタスクに処理を完全に逃がす
      setTimeout(() => {
        groupSelected();
      }, 0);
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
