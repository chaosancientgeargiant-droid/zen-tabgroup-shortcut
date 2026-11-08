function groupSelected() {
    const tabs = targetTabs().filter((t) => !t.pinned);
    if (!tabs.length) return;

    // ★重要: ショートカットのキーイベントがOS/ブラウザ側で「完全に終了」するのを待つため、
    // 全体の処理を setTimeout で次のフレーム以降に遅延（非同期化）させます。
    setTimeout(() => {
      if (DEBUG) dlog(T(), "実行前のフォーカス:", describeFocus());
      
      // clearFocus は Mac の IME コンテキストを完全に破壊することがあるため、
      // 一旦コメントアウトするか、パネルが開いた後に明示的に input に当てるアプローチに変えます。
      // try { Services.focus.clearFocus(window); } catch (e) { dlog("clearFocus失敗:", String(e)); }

      // 1) 右クリックメニューの関数を呼び出し
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

      // 2) 自前で作る場合
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

      // 3) パネルの展開
      whenLaidOut(group, () => {
        try {
          const m = gBrowser.tabGroupMenu;
          if (!m) return;
          if (!m.isConnected) document.getElementById("mainPopupSet").appendChild(m);
          if (DEBUG) { hookPanelEvents(m); dlog(T(), "パネル確認 state =", m.panel && m.panel.state); }
          
          if (!isOpen(m)) {
            m.openCreateModal(group);
          }

          // ★重要: パネルが開いた（要素が画面にマウントされた）直後、
          // さらに一瞬だけ待ってから内部の input 要素に強制的にフォーカスとIMEをアタッチさせる
          setTimeout(() => {
            try {
              const panelInput = m.panel && m.panel.querySelector("input, moz-input-text");
              if (panelInput) {
                if (DEBUG) dlog(T(), "input 要素に遅延フォーカスを要求します");
                panelInput.focus();
                // 必要に応じて、完全に選択状態にする
                if (typeof panelInput.select === "function") panelInput.select();
              }
            } catch (innerErr) {
              if (DEBUG) dlog("遅延フォーカス失敗:", String(innerErr));
            }
          }, 100); // 100ms程度のウェイトを入れるとMacのIMEが追随しやすくなります

          if (DEBUG) debugPanel(m);
        } catch (e) {
          console.error("[NativeGroupShortcut] パネルを開けませんでした:", e);
        }
      });
    }, 50); // キーイベント完了を待つための 50ms ディレイ
  }
