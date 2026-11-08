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
          
          // ★2回目以降の対策：すでに開いていて閉じられた後のパネルの状態を完全にクリーンにする
          const p = m.panel;
          if (p) {
            // 前回の入力フォーカスが内部に残っていると2回目にIMEがバグるため、一度ボカす（外す）
            const oldInput = p.querySelector("input, moz-input-text");
            if (oldInput && document.activeElement === oldInput) {
              oldInput.blur();
            }
            
            // MacのOS側に「ウインドウとパネルのアクティブ状態」を強制再認識させる
            if (typeof p.moveTo === "function" && p.state === "open") {
              // すでに開いているバグ防止
              p.hidePopup();
            }
          }

          if (!isOpen(m)) {
            m.openCreateModal(group);
          }

          // ★重要: 2回目以降はさらに描画タイミングがシビアになるため、
          // requestAnimationFrame を挟んでブラウザの描画ツリーが更新された後にフォーカスを当てます
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                const panelInput = m.panel && m.panel.querySelector("input, moz-input-text");
                if (panelInput) {
                  if (DEBUG) dlog(T(), "input 要素に強制再フォーカスを要求します");
                  
                  // 一度確実にフォーカスを奪うため、ウインドウ自体のフォーカスを確定させてから input へ
                  window.focus(); 
                  
                  panelInput.focus();
                  if (typeof panelInput.select === "function") panelInput.select();
                }
              } catch (innerErr) {
                if (DEBUG) dlog("遅延フォーカス失敗:", String(innerErr));
              }
            }, 150); // 2回目以降のIME追随を安定させるため少し長めの150ms
          });

          if (DEBUG) debugPanel(m);
        } catch (e) {
          console.error("[NativeGroupShortcut] パネルを開けませんでした:", e);
        }
      });
