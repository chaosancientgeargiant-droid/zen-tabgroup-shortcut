// ==UserScript==
// @name         Native Group Shortcut
// @description  タブグループのショートカット（標準パネルを開く／グループから外す）。キーは設定画面で変更可
// @include      chrome://browser/content/browser.xhtml
// @include      about:preferences*
// @include      about:settings*
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

  // パネルの貼り付け先（グループのラベル部分）が画面に配置されるまで待つ。
  // <tab-group> 自体は表示上の大きさが0なので、判定には使えない（実測で確認済み）。
  // 配置されなくても、最大12フレーム（約0.2秒）で待つのをやめる。
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

  // パネルが開いたら、名前の入力欄にフォーカスを渡す（最大10フレーム待つ）
  function focusNameField(menu, tries = 10) {
    const step = () => {
      const p = menu.panel;
      const input = p && p.querySelector("input, moz-input-text");
      if (p && input && (p.state === "open" || p.state === "showing")) {
        input.focus();
        if (typeof input.select === "function") input.select();
        return;
      }
      if (--tries > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // 入力できない原因の調査用ログ（解決したら false に）
  const DEBUG = true;
  const dlog = (...a) => console.log("[NativeGroupShortcut]", ...a);
  const T = () => Math.round(performance.now()) % 100000; // 経過ミリ秒（同士を比べる用）

  // popupshown/popuphidden が何回起きるか（開き直しが起きていないか）を記録
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

  function groupSelected() {
    const tabs = targetTabs().filter((t) => !t.pinned);
    if (!tabs.length) return;
    const menu0 = gBrowser.tabGroupMenu;
    if (DEBUG && menu0) hookPanelEvents(menu0);
    // ZenのaddTabGroupは insertBefore が必須
    const group = gBrowser.addTabGroup(tabs, {
      insertBefore: tabs[0],
      isUserTriggered: true,
      telemetryUserCreateSource: "shortcut",
    });
    // isUserTriggered により、Firefox本体の処理（TabGroupCreateByUser）が
    // 自動でパネルを開いている場合がある。その場合は二重に開かない。
    if (DEBUG) dlog(T(), "addTabGroup直後 panel.state =", menu0 && menu0.panel && menu0.panel.state);
    if (isOpen(menu0)) {
      if (DEBUG) { dlog(T(), "本体が開いたので openCreateModal は呼びません"); debugPanel(menu0); }
      return;
    }
    whenLaidOut(group, () => {
      try {
        const m = gBrowser.tabGroupMenu;
        if (!m) return;
        if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
        if (DEBUG) { hookPanelEvents(m); dlog(T(), "openCreateModal を呼ぶ直前 state =", m.panel && m.panel.state); }
        if (!isOpen(m)) m.openCreateModal(group);
        focusNameField(m);
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
  // （ユーザーが明示的に解除した場合は空文字が保存されるので、そのまま無効になる）
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
      log("loaded v0.2.2");
      // パネル内のキー入力が、途中で止められていないかを見る（captureとbubbleで defaultPrevented を比べる）
      const inMenu = (e) => e.composedPath().some((n) => n.localName === "tabgroup-menu" || n.id === "tab-group-editor");
      window.addEventListener("keydown", (e) => {
        if (inMenu(e)) log("keydown capture:", e.key, "target:", e.composedPath()[0].localName, "prevented:", e.defaultPrevented);
      }, true);
      window.addEventListener("keydown", (e) => {
        if (inMenu(e)) log("keydown bubble :", e.key, "prevented:", e.defaultPrevented);
      }, false);
    }
    document.addEventListener(
      "keydown",
      (e) => {
        const pressed = fromEvent(e);
        if (!pressed.key) return;
        for (const a of ACTIONS) {
          const s = stored(a.id);
          if (complete(s) && same(pressed, s)) {
            e.preventDefault();
            e.stopPropagation();
            try { a.run(); } catch (err) { console.error("[NativeGroupShortcut]", a.id, err); }
            return;
          }
        }
      },
      true
    );
  }

  // ---------- 設定画面: キー入力欄 ----------

  // 既存のブラウザのキーと重なっていれば、その名前（不明なら ""）を返す。重なりなしは null
  function browserConflict(s) {
    try {
      const doc = Services.wm.getMostRecentWindow("navigator:browser").document;
      for (const el of doc.querySelectorAll("key")) {
        if ((el.getAttribute("key") || "").toUpperCase() !== s.key.toUpperCase()) continue;
        const mods = (el.getAttribute("modifiers") || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
        const has = {
          ctrl: mods.includes("control") || (!IS_MAC && mods.includes("accel")),
          meta: mods.includes("meta") || mods.includes("os") || (IS_MAC && mods.includes("accel")),
          alt: mods.includes("alt"),
          shift: mods.includes("shift"),
        };
        if (has.ctrl === s.ctrl && has.meta === s.meta && has.alt === s.alt && has.shift === s.shift) {
          return el.getAttribute("label") || "";
        }
      }
    } catch (_) {}
    return null;
  }

  function wire(action) {
    const row = document.getElementById((PREF + action.id).replaceAll(".", "-"));
    if (!row || row.__ngsWired) return;
    const input = row.querySelector("input");
    if (!input) return;
    row.__ngsWired = true;

    input.readOnly = true;
    input.style.cursor = "pointer";

    const note = document.createXULElement("description");
    note.style.cssText = "margin:2px 0 6px;font-size:12px;";
    row.after(note);
    const say = (text, warn) => {
      note.textContent = text;
      note.style.color = warn ? "#e67e22" : "var(--text-color-deemphasized, #9e9ea0)";
      note.hidden = !text;
    };

    let committed = input.value;
    const save = (v) => {
      committed = v;
      input.value = v;
      input.dispatchEvent(new Event("change", { bubbles: true })); // Sineが保存する
    };
    const check = (s) => {
      for (const o of ACTIONS) {
        if (o.id === action.id) continue;
        const other = stored(o.id);
        if (complete(other) && same(other, s)) return say(`⚠ 「${o.label}」と同じキーです`, true);
      }
      const c = browserConflict(s);
      if (c !== null) return say(c ? `⚠ 「${c}」と重なっています（このModが優先されます）` : "⚠ 既存のキーと重なっています（このModが優先されます）", true);
      say("✓ 保存しました");
    };

    input.addEventListener("focus", () => say("キーを押してください（Delete で解除、Esc でキャンセル）"));
    input.addEventListener("blur", () => {
      input.value = committed;
      say(committed ? "" : "未設定");
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return input.blur();
      if (e.key === "Backspace" || e.key === "Delete") { save(""); return say("解除しました"); }
      const s = fromEvent(e);
      if (!s.key) { input.value = format(s) + (format(s) ? "+…" : "…"); return; }
      if (!complete(s)) { input.value = format(s); return say("⚠ Ctrl・Alt・Cmd のどれかと組み合わせてください", true); }
      save(format(s));
      check(s);
    });
    say(committed ? "" : "未設定");
  }

  function initSettings() {
    if (window.__ngsSettings) return;
    window.__ngsSettings = true;
    const all = () => ACTIONS.forEach(wire);
    all();
    const obs = new MutationObserver(all);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("unload", () => obs.disconnect(), { once: true });
  }

  const href = (document.location && document.location.href) || "";
  if (href.startsWith("about:preferences") || href.startsWith("about:settings")) initSettings();
  else initBrowser();
})();
