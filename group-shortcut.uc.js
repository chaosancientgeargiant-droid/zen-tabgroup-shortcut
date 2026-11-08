  function groupSelected() {
    const tabs = targetTabs().filter((t) => !t.pinned);
    if (!tabs.length) return;

    // 1. まずダイアログを出して、ユーザーにグループ名を入力してもらう（MacのIMEが確実に動く）
    const input = { value: "" };
    const check = { value: false };
    const ok = Services.prompt.input(
      window,
      "新規タブグループ",
      "グループ名を入力してください（日本語可）:",
      input,
      null,
      check
    );

    // キャンセルされたらグループ化しない
    if (!ok) return;
    const groupName = input.value.trim();

    // 2. 右クリックメニューの標準の仕組みでグループを作成
    const ctxMenu = typeof TabContextMenu !== "undefined" ? TabContextMenu : null;
    if (ctxMenu && typeof ctxMenu.moveTabsToNewGroup === "function") {
      try {
        ctxMenu.contextTab = tabs.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : tabs[0];
        ctxMenu.contextTabs = tabs;
        ctxMenu.moveTabsToNewGroup();
      } catch (e) { dlog("moveTabsToNewGroupエラー:", String(e)); }
    }

    // 3. 自前で作られた場合のフォールバック
    let group = tabs[0].group;
    if (!group) {
      group = gBrowser.addTabGroup(tabs, {
        insertBefore: tabs[0],
        isUserTriggered: true,
        telemetryUserCreateSource: "shortcut",
      });
    }
    
    // 4. 入力された名前をグループにセットする
    if (group && groupName) {
      group.setTitle(groupName);
    }
  }
