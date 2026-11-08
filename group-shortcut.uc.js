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
 // <tab-group> 自体は表示上の大きさが0なので、判定には使えない(実測で確認済み)。
 // 配置されなくても、最大12フレーム(約0.2秒)で待つのをやめる。
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

 // 入力できない原因の調査用ログ(解決したら false に)
 const DEBUG = true;
 const dlog = (...a) => console.log("[NativeGroupShortcut]", ...a);
 const T = () => Math.round(performance.now()) % 100000; // 経過ミリ秒(同士を比べる用)

 // popupshown/popuphidden が何回起きるか(開き直しが起きていないか)を記録
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

 // 今どこにフォーカスがあるかの記録用
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
 // パネルを開く前に、Webページ(別プロセス)に残っているフォーカスを外す(仮説:文字入力がページ側に流れるのを防ぐ)
 if (DEBUG) dlog(T(), "実行前のフォーカス:", describeFocus());
 try { Services.focus.clearFocus(window); } catch (e) { dlog("clearFocus失敗:", String(e)); }
 if (DEBUG && gBrowser.tabGroupMenu) hookPanelEvents(gBrowser.tabGroupMenu);

 // 1) 右クリックメニューの「新しいグループにタブを追加」と同じ関数を呼ぶ。
 // (Firefox本体では addTabGroup のあと selectedTab の設定などもここで行う)
 // この関数は contextTab / contextTabs を参照するので、先に入れておく。
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

 // 2) 上で作れなかった場合だけ、自分で作る(ZenのaddTabGroupは insertBefore が必須)
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
          // モーダルが生成され、MacのOSがウィンドウのアクティブ状態を切り替え終えるのを
          // サブスレッド（setTimeout）側で一瞬だけ待ちます。
          m.openCreateModal(group);
          
          setTimeout(() => {
            try {
              const panelInput = m.panel && m.panel.querySelector("input, moz-input-text");
              if (panelInput) {
                // MacのIMEに新しいモーダル上の入力欄であることを正しく認識させるため、
                // 一度フォーカスを外してから、再度ターゲットにフォーカスを当て直します。
                panelInput.blur();
                panelInput.focus();
                if (typeof panelInput.select === "function") panelInput.select();
              }
            } catch (_) {}
          }, 60); // 60ms（約4フレーム）のウェイトがMac環境では最も安定します
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

 function format(s) {
 const p = [];
 if (s.ctrl) p.push("Ctrl");
 if (s.alt) p.push("Alt");
 if (s.shift) p.push("Shift");
 if (s.meta) p.push(IS_MAC ? "Cmd" : "Super");
 if (s.key) p.push(s.key);
 return p.join("+");
 }

 // Macの Option+G は e.key が「©」になるため、英数字は e.code から取る
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
 const complete = (s) => !!s.key && (s.ctrl || s.alt || s.meta);
 const same = (a, b) =>
 a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta && a.key === b.key;

 // Sineは設定画面を開いたときにしか既定値を保存しないため、未保存なら既定値を使う
 // (ユーザーが明示的に解除した場合は空文字が保存されるので、そのまま無効になる)
 const DEFAULTS = { group: "Alt+G", ungroup: "Cmd+Shift+R" };
 const stored = (id) => {
 try { return parse(Services.prefs.getStringPref(PREF + id, DEFAULTS[id])); }
 catch (_) { return parse(DEFAULTS[id]); }
 };

 // ---------- ブラウザウィンドウ: キーを受け取る ----------

 function initBrowser() {
 if (window.__ngsActive) return;
 window.__ngsActive = true;
 if (DEBUG) {
 const log = (...a) => console.log("[NativeGroupShortcut]", ...a);
 log("loaded v0.2.6");
 // パネル内のキー入力が、途中で止められていないかを見る(captureとbubbleで defaultPr
