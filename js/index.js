// 檔案路徑：js/index.js

function goToGame(num) {
    // 請求全螢幕提升遊戲感
    const doc = window.document.documentElement;
    if (doc.requestFullscreen) {
        doc.requestFullscreen().catch(() => {}); 
    }

    // 跳轉至大廳，並透過 URL 參數傳遞人數模式
    window.location.href = "lobby.html?mode=" + num;
}