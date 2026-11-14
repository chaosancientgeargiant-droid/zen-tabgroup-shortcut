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

  // 入力できない原因の調査用ログ（解決したら false に）
  const DEBUG = true;
  const dlog = (...a) => console.log("[NativeGroupShortcut]", ...a);
  const XHTML = "http://www.w3.org/1999/xhtml";
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

  // 標準の名前・色パネルを開く版（ui = "panel" のとき）
  function groupSelectedWithPanel() {
    const tabs = targetTabs().filter((t) => !t.pinned);
    if (!tabs.length) return;
    // パネルを開く前に、Webページ（別プロセス）に残っているフォーカスを外す（仮説：文字入力がページ側に流れるのを防ぐ）
    if (DEBUG) dlog(T(), "実行前のフォーカス:", describeFocus());
    try { Services.focus.clearFocus(window); } catch (e) { dlog("clearFocus失敗:", String(e)); }
    if (DEBUG && gBrowser.tabGroupMenu) hookPanelEvents(gBrowser.tabGroupMenu);

    // 1) 右クリックメニューの「新しいグループにタブを追加」と同じ関数を呼ぶ。
    //    （Firefox本体では addTabGroup のあと selectedTab の設定などもここで行う）
    //    この関数は contextTab / contextTabs を参照するので、先に入れておく。
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

    // 2) 上で作れなかった場合だけ、自分で作る（ZenのaddTabGroupは insertBefore が必須）
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

    // 3) パネルがまだ開いていなければ開く（本体や Zen が開く場合は二重に開かない）
    whenLaidOut(group, () => {
      try {
        const m = gBrowser.tabGroupMenu;
        if (!m) return;
        if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
        if (DEBUG) { hookPanelEvents(m); dlog(T(), "パネル確認 state =", m.panel && m.panel.state); }
        if (!isOpen(m)) m.openCreateModal(group);
        if (DEBUG) debugPanel(m);
      } catch (e) {
        console.error("[NativeGroupShortcut] パネルを開けませんでした:", e);
      }
    });
  }

  // ---------- 名前と色を選ぶ画面（ウィンドウ内に出す通常の部品。ポップアップは使わない） ----------
  // 標準パネルは、macOSで文字入力が通らないことがあった。サイドバー内の入力欄（ATG式のリネーム）は
  // 入力できたため、同じ「ウィンドウ内の入力欄」で、名前と色を同時に選べる画面を作る。

  // 左から「青 → 赤」へ、色相を30°ずつ等間隔に並べた9色（彩度100%・明度50%の純色）。
  // Firefox本体のグループ色は固定の9コードなので、次の順に割り当てる（コード名と見た目は一致しない）。
  const GROUP_COLORS = [
    ["blue", "青"], ["purple", "空色"], ["cyan", "シアン"], ["pink", "青緑"], ["green", "緑"],
    ["gray", "黄緑"], ["yellow", "黄"], ["orange", "オレンジ"], ["red", "赤"],
  ];
  const hslToHex = (h) => {
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  const lumOf = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  // PALETTE[コード] = { color: 背景色, text: 文字色（白か黒の、コントラストが高い方） }
  const PALETTE = {};
  GROUP_COLORS.forEach(([code], i) => {
    const color = hslToHex(240 - i * 30); // 240°(青) → 0°(赤)
    const L = lumOf(color);
    PALETTE[code] = { color, text: (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#000000" };
  });
  let dialog = null; // { root, group, input, edit, orig }

  const uiMode = () => {
    try { return Services.prefs.getStringPref(PREF + "ui", "dialog"); } catch (_) { return "dialog"; }
  };

  function onDialogOutsidePointerDown(e) {
    if (dialog && !dialog.root.contains(e.target)) closeGroupDialog("outside");
  }

  // result: "ok"（完了） / "outside"（外をクリック: 入力済みの名前を保存して閉じる） / "cancel"（作成をやめる。編集なら、色を元に戻す）
  function closeGroupDialog(result) {
    const d = dialog;
    if (!d) return;
    dialog = null;
    document.removeEventListener("pointerdown", onDialogOutsidePointerDown, true);
    const name = d.input.value.trim();
    try { d.input.blur(); } catch (_) {} // フォーカスを外してから消す
    d.root.remove();
    try {
      if (result === "cancel") {
        if (d.edit) {
          if (d.orig.color) d.group.color = d.orig.color; // 編集のキャンセルは、色を元に戻すだけ
        } else if (typeof d.group.ungroupTabs === "function") {
          d.group.ungroupTabs(); // 作成のキャンセルは、標準パネルと同じく、グループを解除する
        }
      } else if (name) {
        d.group.label = name;
      }
    } catch (e) {
      console.error("[NativeGroupShortcut] グループへの反映に失敗:", e);
    }
  }

  function showGroupDialog(group, opts = {}) {
    closeGroupDialog("outside");
    const edit = !!opts.edit;
    const orig = { label: group.label || "", color: group.color };
    const h = (tag, props, css) => {
      const el = document.createElementNS(XHTML, tag);
      if (props) Object.assign(el, props);
      if (css) el.style.cssText = css;
      return el;
    };

    const root = h("div", { id: "ngs-group-dialog" },
      "position:fixed;z-index:2147483000;width:264px;box-sizing:border-box;padding:12px;border-radius:8px;" +
      "background:var(--arrowpanel-background,Canvas);color:var(--arrowpanel-color,CanvasText);" +
      "border:1px solid var(--arrowpanel-border-color,GrayText);box-shadow:0 4px 16px rgba(0,0,0,.4);font:message-box;");
    const title = h("div", { textContent: edit ? "タブグループを編集" : "タブグループを作成" }, "font-weight:600;margin-bottom:8px;");
    const input = h("input", { type: "text", placeholder: "例: ショッピング" },
      "width:100%;box-sizing:border-box;padding:6px 8px;border-radius:4px;" +
      "border:1px solid var(--arrowpanel-border-color,GrayText);background:transparent;color:inherit;font:inherit;");
    input.setAttribute("autocomplete", "off");
    input.value = group.label || "";

    const swatches = h("div", null, "display:flex;gap:8px;margin:10px 0 12px;");
    const refresh = () => {
      for (const b of swatches.children) b.style.outline = b.dataset.code === group.color ? "2px solid currentColor" : "none";
    };
    // 丸いボタンの色は、グループ名と同じ色。
    const colorOf = (code) => PALETTE[code].color;
    for (const [code, name] of GROUP_COLORS) {
      const b = h("button", { type: "button", title: name },
        "width:20px;height:20px;padding:0;border-radius:50%;border:1px solid rgba(128,128,128,.6);" +
        "outline-offset:2px;cursor:pointer;background:" + colorOf(code) + ";");
      b.dataset.code = code;
      b.addEventListener("click", () => {
        try { group.color = code; } catch (e) { console.error("[NativeGroupShortcut] 色を設定できません:", e); }
        refresh();
      });
      swatches.appendChild(b);
    }

    const buttons = h("div", null, "display:flex;justify-content:flex-end;gap:8px;");
    const mkBtn = (text, onClick) => {
      const b = h("button", { type: "button", textContent: text }, "padding:4px 12px;border-radius:4px;cursor:pointer;");
      b.addEventListener("click", onClick);
      return b;
    };
    buttons.append(mkBtn("キャンセル", () => closeGroupDialog("cancel")), mkBtn("完了", () => closeGroupDialog("ok")));

    root.append(title, input, swatches, buttons);
    root.addEventListener("keydown", (e) => {
      e.stopPropagation(); // 入力中のキーを、他のショートカットに渡さない
      if (e.key === "Enter" && e.target === input) {
        if (e.isComposing || e.keyCode === 229) return; // 日本語の変換確定のEnterでは閉じない
        e.preventDefault();
        // キー入力の処理が終わってから閉じる（処理の途中で、フォーカス中の入力欄を消さないため）
        setTimeout(() => closeGroupDialog("ok"), 0);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setTimeout(() => closeGroupDialog("cancel"), 0);
      }
    });

    // グループ名の近くに置く（画面からはみ出さないように調整）
    const W = 264;
    let top = 80, left = 16;
    try {
      const r = anchorOf(group).getBoundingClientRect();
      top = Math.min(Math.max(r.bottom + 6, 8), Math.max(8, window.innerHeight - 220));
      left = r.left > window.innerWidth / 2 ? r.right - W : r.left;
      left = Math.min(Math.max(left, 8), Math.max(8, window.innerWidth - W - 8));
    } catch (_) {}
    root.style.top = top + "px";
    root.style.left = left + "px";

    document.documentElement.appendChild(root);
    dialog = { root, group, input, edit, orig };
    refresh();
    document.addEventListener("pointerdown", onDialogOutsidePointerDown, true); // 外をクリックすれば、必ず閉じられる
    input.focus();
    input.select();
    if (DEBUG) {
      for (const t of ["keydown", "keypress", "beforeinput", "compositionstart", "input"]) {
        input.addEventListener(t, (e) => dlog("名前入力:", t, e.key || e.inputType || "", t === "input" ? "value=" + input.value : ""));
      }
      setTimeout(() => dlog("名前入力欄にフォーカスあり:", document.activeElement === input), 300);
    }
  }

  // グループを作って、名前と色の画面を出す（既定）。ui = "panel" なら、標準パネルを開く
  function groupSelected() {
    if (uiMode() === "panel") return groupSelectedWithPanel();
    const tabs = targetTabs().filter((t) => !t.pinned);
    if (!tabs.length) return;
    let group = null;
    try {
      // isUserTriggered を付けない: 付けると、本体が標準パネルを自動で開いてしまう
      group = gBrowser.addTabGroup(tabs, {
        insertBefore: tabs[0], // ZenのaddTabGroupは insertBefore が必須
        telemetryUserCreateSource: "shortcut",
      });
    } catch (e) {
      dlog("addTabGroup でエラー:", String(e));
      return;
    }
    if (!group) return;
    whenLaidOut(group, () => {
      // ATGが名前入力を始めている場合は、重ねて出さない
      if (document.documentElement.hasAttribute("zen-renaming-group")) return;
      showGroupDialog(group);
    });
  }

  // ---------- 折りたたみの表示と、グループ名のクリック ----------
  // Firefox本体の折りたたみは「グループ直下のタブ」を隠すCSSで動くが、Zenはタブを
  // .tab-group-container という入れ物に入れているため、そのCSSが当たらない（ATGは別のCSSを持っている）。
  // CSSの強さに左右されないよう、①高い優先度のCSSと、②中のタブへ直接書き込むスタイル、の両方で隠す。
  const COLLAPSE_CSS = `
    #tabbrowser-tabs tab-group .tab-group-container tab { transition: max-height .15s ease, opacity .15s ease, margin .15s ease; }
    #tabbrowser-tabs tab-group[collapsed] .tab-group-container tab:not([selected]) {
      max-height: 0 !important; min-height: 0 !important; opacity: 0 !important;
      margin-block: 0 !important; pointer-events: none !important; overflow: hidden !important;
    }`;
  const HIDE_MARK = "ngs-collapse-hidden";

  // Firefox本体は、折りたたんだグループ名の色を入れ替える（ダークでは、明るい色→濃い色。枠線も付く）。
  // 展開時と同じ見た目のままにするため、展開時の色の指定（tabs.cssの .tab-group-label）をそのまま当てる。
  const SAME_LABEL_CSS = `
    #tabbrowser-tabs tab-group[collapsed] .tab-group-label {
      background-color: var(--tab-group-color) !important;
      color: light-dark(var(--tab-group-color-pale), var(--tab-group-label-text-dark)) !important;
      outline: none !important;
    }`;

  // 本体の色の定義（--tab-group-○○、-invert、-pale、-text など）を、青→赤の9色で上書きする。
  // さらに、グループごとにも（<tab-group>のstyle属性が var(--tab-group-○○) を指すことを手がかりに）
  // 背景・文字・縦線の色を固定し、展開/折りたたみ・ライト/ダークで色が変わらないようにする。
  const VIVID_CSS = ':root, tab-group {' + Object.entries(PALETTE).map(([c, p]) =>
      '--tab-group-' + c + ':' + p.color + ' !important;' +
      '--tab-group-' + c + '-invert:' + p.color + ' !important;' +
      '--tab-group-' + c + '-pale:' + p.text + ' !important;' +
      '--tab-group-' + c + '-text:' + p.text + ' !important;' +
      '--tab-group-' + c + '-text-invert:' + p.text + ' !important;' +
      '--tab-group-' + c + '-hover:color-mix(in srgb,' + p.color + ' 85%,black) !important;').join('') + '}' +
    Object.entries(PALETTE).map(([c, p]) => {
      const g = '#tabbrowser-tabs tab-group[style*=\"var(--tab-group-' + c + ')\"]';
      return g + '{--tab-group-color:' + p.color + ' !important;--tab-group-color-invert:' + p.color + ' !important;' +
        '--tab-group-color-pale:' + p.text + ' !important;--ngs-accent:' + p.color + ' !important;}' +
        g + ' .tab-group-label,' + g + '[collapsed] .tab-group-label{background-color:' + p.color + ' !important;color:' + p.text + ' !important;' +
        'opacity:1 !important;filter:none !important;outline:none !important;}';
    }).join('');

  // グループの範囲が分かるようにする見た目。グループの色（--tab-group-color）で、
  // タブの並びの左に縦線を通し、うすい背景を敷く。（<tab-group> 自体は表示上の大きさが0なので、中の要素に付ける）
  const LOOK_CSS = `
    #tabbrowser-tabs tab-group { --ngs-accent: var(--tab-group-color); }
    #tabbrowser-tabs tab-group .tab-group-container {
      box-shadow: inset 4px 0 0 0 var(--ngs-accent) !important;
      background: color-mix(in srgb, var(--ngs-accent) 14%, transparent) !important;
      border-radius: 6px !important;
      padding-inline-start: 6px !important;
    }
    #tabbrowser-tabs tab-group[collapsed]:not(:has(tab[selected])) .tab-group-container {
      box-shadow: none !important; background: none !important; padding: 0 !important;
    }`;

  const prefBool = (name, def) => {
    try { return Services.prefs.getBoolPref(PREF + name, def); } catch (_) { return def; }
  };
  const lookEnabled = () => prefBool("group-look", true);

  function injectCollapseCss() {
    const old = document.getElementById("ngs-collapse-style");
    if (old) old.remove();
    const st = document.createElementNS(XHTML, "style");
    st.id = "ngs-collapse-style";
    st.textContent = COLLAPSE_CSS + SAME_LABEL_CSS + (lookEnabled() ? LOOK_CSS : "") + VIVID_CSS;
    document.documentElement.appendChild(st);
  }

  // 折りたたまれたグループの、選択中でないタブを隠す（それ以外は元に戻す）。自分が隠したタブだけを触る。
  function syncGroupCollapse(group) {
    const collapsed = group.hasAttribute("collapsed");
    for (const tab of group.querySelectorAll("tab")) {
      if (tab.closest("tab-group") !== group) continue; // 入れ子のグループの分は、そちらで処理する
      const hide = collapsed && !tab.hasAttribute("selected");
      if (hide) {
        // 隠す前の display の値を、目印の値として覚えておく（戻すときに使う）
        if (!tab.hasAttribute(HIDE_MARK)) tab.setAttribute(HIDE_MARK, tab.style.getPropertyValue("display") || "");
        tab.style.setProperty("display", "none", "important");
      } else if (tab.hasAttribute(HIDE_MARK)) {
        const orig = tab.getAttribute(HIDE_MARK);
        tab.style.removeProperty("display");
        if (orig) tab.style.setProperty("display", orig);
        tab.removeAttribute(HIDE_MARK);
      }
    }
  }

  function syncAllGroups() {
    for (const g of document.querySelectorAll("tab-group")) {
      try { syncGroupCollapse(g); } catch (e) { console.error("[NativeGroupShortcut] 折りたたみ表示の更新に失敗:", e); }
    }
  }

  let syncQueued = false;
  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => { syncQueued = false; syncAllGroups(); });
  }

  function watchCollapse() {
    const target = document.getElementById("tabbrowser-tabs") || document.documentElement;
    new MutationObserver(queueSync).observe(target, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["collapsed", "selected"],
    });
    syncAllGroups();
  }

  // グループ名（グループの見出し部分）をクリックしたら、折りたたむ／広げる。
  // 本体の処理がすでに切り替えた場合は、二重に切り替えない（クリック後に状態を見て、変わっていなければ切り替える）。
  function onGroupLabelClick(e) {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.documentElement.hasAttribute("zen-renaming-group")) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const has = (n, c) => n && n.classList && n.classList.contains(c);
    // ボタンや入力欄のクリックは対象外
    if (path.some((n) => n && (n.localName === "input" || n.localName === "button" || n.localName === "toolbarbutton"))) return;
    const group = path.find((n) => n && n.localName === "tab-group");
    if (!group) return;
    const onTab = path.some((n) => n && n.localName === "tab");
    const inContainer = path.some((n) => has(n, "tab-group-container"));
    const onLabel = path.some((n) => has(n, "tab-group-label") || has(n, "tab-group-label-container"));
    // 見出し部分（ラベル、またはタブの並びの外）のクリックだけを対象にする
    if (!(onLabel || (!onTab && !inContainer))) return;
    const before = group.collapsed;
    setTimeout(() => {
      if (group.collapsed === before) {
        try { group.collapsed = !before; } catch (err) { console.error("[NativeGroupShortcut] 折りたたみに失敗:", err); }
      }
      syncGroupCollapse(group);
    }, 0);
  }

  // 現在のタブが入っているグループを、折りたたむ／広げる
  function toggleGroupCollapse() {
    const group = gBrowser.selectedTab && gBrowser.selectedTab.group;
    if (!group) {
      dlog("現在のタブはグループに入っていません");
      return;
    }
    try {
      group.collapsed = !group.collapsed;
      syncGroupCollapse(group);
    } catch (e) {
      console.error("[NativeGroupShortcut] 折りたたみに失敗:", e);
    }
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

  // ---------- グループの編集（名前と色）: 名前と色の画面を、現在のグループ用に開く ----------
  // 以前は、Zenのグループ名の表示に入力欄を差し込んでいた。Enterで落ちたため、Zenの表示には触れない作りにした。

  // 旧版が残した状態の片付け（Sineがスクリプトを読み込み直した場合に備える）
  function cleanupStaleRename() {
    try {
      document.documentElement.removeAttribute("zen-renaming-group");
      const stale = document.getElementById("ngs-group-rename-input");
      if (stale) {
        const l = stale.previousElementSibling;
        if (l && l.classList) { l.classList.remove("tab-group-label-editing"); l.style.display = ""; }
        stale.remove();
      }
    } catch (_) {}
  }

  function renameCurrentGroup() {
    const group = gBrowser.selectedTab && gBrowser.selectedTab.group;
    if (!group) {
      dlog("現在のタブはグループに入っていません");
      return;
    }
    showGroupDialog(group, { edit: true });
  }

  const ACTIONS = [
    { id: "group", label: "グループ化", run: groupSelected },
    { id: "ungroup", label: "グループから外す", run: ungroupSelected },
    { id: "rename", label: "グループの名前と色を変更", run: renameCurrentGroup },
    { id: "collapse", label: "グループを折りたたむ／広げる", run: toggleGroupCollapse },
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
  const DEFAULTS = { group: "Alt+G", ungroup: "Cmd+Shift+R", rename: "Alt+R", collapse: "Alt+C" };
  const stored = (id) => {
    try { return parse(Services.prefs.getStringPref(PREF + id, DEFAULTS[id])); }
    catch (_) { return parse(DEFAULTS[id]); }
  };

  // ---------- ブラウザウィンドウ: キーを受け取る ----------

  function initBrowser() {
    cleanupStaleRename(); // Sineがスクリプトを読み込み直した場合に、前回の状態が残らないようにする
    if (window.__ngsActive) return;
    window.__ngsActive = true;
    injectCollapseCss();
    try {
      const obs = { observe: () => injectCollapseCss() };
      Services.prefs.addObserver(PREF, obs); // このmodの設定のどれかが変わったら、スタイルを入れ直す
      window.addEventListener("unload", () => {
        try { Services.prefs.removeObserver(PREF, obs); } catch (_) {}
      }, { once: true });
    } catch (_) {}
    watchCollapse();
    document.addEventListener("click", onGroupLabelClick, true);
    if (DEBUG) {
      const log = (...a) => console.log("[NativeGroupShortcut]", ...a);
      log("loaded v0.7.0");
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
            if (e.repeat) return; // 長押しでの連続発火を防ぐ
            const run = () => {
              try { a.run(); } catch (err) { console.error("[NativeGroupShortcut]", a.id, err); }
            };
            run();
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
