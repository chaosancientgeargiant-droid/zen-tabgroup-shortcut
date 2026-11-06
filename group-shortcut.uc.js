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

  // 要素が画面に配置されるまで待つ（固定の待ち時間は使わない。最大 約1秒）
  function whenLaidOut(el, cb, tries = 60) {
    const check = () => {
      if (el.isConnected && el.getBoundingClientRect().height > 0) return cb();
      if (--tries <= 0) return cb();
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  function groupSelected() {
    const tabs = targetTabs().filter((t) => !t.pinned);
    if (!tabs.length) return;
    // ZenのaddTabGroupは insertBefore が必須
    const group = gBrowser.addTabGroup(tabs, {
      insertBefore: tabs[0],
      isUserTriggered: true,
      telemetryUserCreateSource: "shortcut",
    });
    whenLaidOut(group, () => {
      try {
        const m = gBrowser.tabGroupMenu;
        if (!m) return;
        if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
        m.openCreateModal(group);
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
