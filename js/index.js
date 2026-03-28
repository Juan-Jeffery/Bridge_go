// 檔案路徑：js/index.js

function goToGame(num) {
    const doc = window.document.documentElement;
    if (doc.requestFullscreen) {
        doc.requestFullscreen().catch(() => {}); 
    }
    window.location.href = "lobby.html?mode=" + num;
}

// ==========================================
// 🌟 背景撲克牌流動特效產生器
// ==========================================
function createCardStream() {
    const container = document.getElementById('card-stream-container');
    if (!container) return;

    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    
    const streamCount = 20; // 畫面上同時要有幾條跑動

    for (let i = 0; i < streamCount; i++) {
        const stream = document.createElement('div');
        stream.className = 'floating-card-stream';
        
        // 1. 隨機生成一串牌 (例如: "A♠ K♥ Q♦ 10♣")
        let cardString = '';
        let cardLength = Math.floor(Math.random() * 4) + 4; // 每條隨機 4~7 張牌
        for (let j = 0; j < cardLength; j++) {
            let s = suits[Math.floor(Math.random() * suits.length)];
            let v = values[Math.floor(Math.random() * values.length)];
            cardString += `${v}${s} `;
        }
        stream.innerText = cardString;

        // 2. 一半機率走斜線，一半機率走橫線
        const isDiagonal = Math.random() > 0.5;
        
        // 3. 隨機設定大小、透明度、動畫速度
        const fontSize = Math.random() * 1.5 + 1.2; // 字體大小 1.2rem ~ 2.7rem
        const opacity = Math.random() * 0.1 + 0.03; // 透明度 0.03 ~ 0.13 (若隱若現)
        const duration = Math.random() * 5 + 15;   // 跑一趟花 15秒 ~ 30秒 (慢慢飄比較有質感)
        const delay = Math.random() * -30;          // 負數延遲，讓網頁一打開畫面上就已經有牌在跑了

        stream.style.fontSize = `${fontSize}rem`;
        stream.style.color = `rgba(255, 255, 255, ${opacity})`;
        
        // 4. 根據方向套用不同的 CSS 動畫與隨機起點
        if (isDiagonal) {
            stream.style.animation = `flow-diagonal ${duration}s linear infinite`;
            stream.style.animationDelay = `${delay}s`;
            stream.style.left = `${Math.random() * 80 - 20}%`; // 隨機 X 軸
            stream.style.top = `${Math.random() * 80 - 20}%`;  // 隨機 Y 軸
        } else {
            stream.style.animation = `flow-horizontal ${duration}s linear infinite`;
            stream.style.animationDelay = `${delay}s`;
            stream.style.left = `-20%`; 
            stream.style.top = `${Math.random() * 90}%`; // 隨機 Y 軸高度
        }

        container.appendChild(stream);
    }
}

// 當網頁載入完成後，啟動特效
window.onload = () => {
    createCardStream();
};