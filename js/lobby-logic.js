// 檔案路徑：js/lobby-logic.js

const roomId = "Room_Alpha"; 
const playersRef = database.ref(`players/${roomId}`);
const gamesRef = database.ref(`games/${roomId}`);

let myRole = ""; 
let isReady = false;
let myConfirmedName = localStorage.getItem('bridge_name') || ""; 
const nameInput = document.getElementById('name-input');
nameInput.value = myConfirmedName;

let currentPlayersData = {};
let currentGameData = {};

// 監聽名字輸入並即時更新
nameInput.addEventListener('input', (e) => {
    let newName = e.target.value.trim();
    if (myRole && !isReady) {
        myConfirmedName = newName || "無名玩家"; 
        localStorage.setItem('bridge_name', myConfirmedName);
        playersRef.child(myRole).update({ name: myConfirmedName });
    }
});

// 🌟 效能優化：精準監聽特定房間的玩家與遊戲狀態，不監聽整個資料庫
function listenLobby() {
    playersRef.on('value', (snap) => {
        currentPlayersData = snap.val() || {};
        updateLobbyUI();
    });
    
    gamesRef.on('value', (snap) => {
        currentGameData = snap.val() || {};
        updateLobbyUI();
    });
}

function updateLobbyUI() {
    const players = currentPlayersData;
    const game = currentGameData;
    const roles = ['north', 'south', 'west', 'east'];
    
    let readyCount = 0;
    let occupiedCount = 0; 

    roles.forEach(role => {
        const p = players[role];
        const btn = document.getElementById(`seat-${role}`);
        const addAiBtn = document.getElementById(`add-ai-${role}`);
        
        // 重置按鈕狀態
        btn.className = "circle-seat";
        btn.disabled = false;
        btn.onclick = () => claimSeat(role); 
        if (addAiBtn) addAiBtn.classList.remove("hide-ai-btn");

        let nameHtml = ``; 
        let statusHtml = ``;

        if (p) {
            occupiedCount++;
            if (p.ready) readyCount++;
            if (addAiBtn) addAiBtn.classList.add("hide-ai-btn");
            
            nameHtml = `<div class="player-name">${p.name}</div>`;

            if (p.isAI) {
                btn.classList.add("occupied", "ready");
                btn.onclick = () => removeComputer(role); 
            } else if (role === myRole) {
                btn.classList.add("my-seat");
                if (p.ready) {
                    statusHtml = `<div class="status-txt">已準備</div>`;
                    btn.classList.add("ready");
                    btn.disabled = true; 
                }
            } else {
                btn.classList.add("occupied");
                if (p.ready) {
                    statusHtml = `<div class="status-txt">已準備</div>`;
                    btn.classList.add("ready");
                }
                btn.disabled = true; 
                btn.onclick = null;
            }
        }

        btn.innerHTML = nameHtml + statusHtml;
    });

    // 更新狀態文字與啟動遊戲邏輯
    const statusTextEl = document.getElementById('status-text');
    statusTextEl.innerText = `目前已準備人數: ${readyCount} / 4`;

    if (readyCount === 4 && occupiedCount === 4) {
        if (!game.gameStarted && isReady) {
            gamesRef.update({ gameStarted: true });
        }
        
        if (game.gameStarted && isReady) {
            playersRef.child(myRole).onDisconnect().cancel();
            statusTextEl.innerText = "全部就緒，即將發牌...";
            statusTextEl.style.color = "var(--premium-gold)";
            
            setTimeout(() => {
                window.location.href = `four_people.html?myRole=${myRole}&pname=${encodeURIComponent(myConfirmedName)}&rid=${roomId}`;
            }, 800);
        }
    }
    updateReadyButton();
}

function claimSeat(targetRole) {
    const name = nameInput.value.trim();
    if (!name) { alert("請先在上方輸入名字！"); nameInput.focus(); return; }
    if (isReady) { alert("已準備狀態無法更換座位。"); return; }

    myConfirmedName = name;
    localStorage.setItem('bridge_name', name);

    // 如果點擊自己已經坐著的位置 (離開座位)
    if (myRole === targetRole) {
        playersRef.transaction((players) => {
            if (players?.[myRole]?.name === myConfirmedName) players[myRole] = null; 
            if (!players || Object.keys(players).length === 0) gamesRef.set({ gameStarted: false });
            return players;
        }, (err, committed) => {
            if (committed) {
                if (myRole) playersRef.child(myRole).onDisconnect().cancel(); 
                myRole = ""; 
                updateLobbyUI(); 
            }
        });
        return; 
    }

    // 搶空位
    playersRef.transaction((players) => {
        players = players || {};
        if (players[targetRole]) return; // 被別人搶走了
        if (myRole && players[myRole]?.name === myConfirmedName) players[myRole] = null; // 離開舊位子
        
        players[targetRole] = { name: myConfirmedName, ready: false, isAI: false };
        if (Object.keys(players).length === 1) gamesRef.set({ gameStarted: false });
        return players;
    }, (err, committed) => {
        if (committed) {
            if (myRole) playersRef.child(myRole).onDisconnect().cancel(); 
            myRole = targetRole; 
            playersRef.child(myRole).onDisconnect().remove(); 
            updateLobbyUI();
        } else { 
            alert("太慢囉！這個位置被搶走了。"); 
        }
    });
}

function addComputer(role) {
    playersRef.child(role).set({ name: "電腦", ready: true, isAI: true });
}

function removeComputer(role) {
    playersRef.child(role).remove();
    if (currentPlayersData && Object.keys(currentPlayersData).length <= 1) {
        gamesRef.update({ gameStarted: false });
    }
}

function toggleReady() {
    if (!myRole) return; 
    const currentName = nameInput.value.trim();
    if (!currentName) { alert("準備前請確保您的名字不是空白！"); nameInput.focus(); return; }
    
    isReady = !isReady;
    playersRef.child(myRole).update({ ready: isReady, name: currentName });
}

function updateReadyButton() {
    const btn = document.getElementById('ready-btn');
    if (!myRole) {
        btn.innerText = "請先選擇桌面隊伍";
        btn.disabled = true;
        Object.assign(btn.style, { background: "rgba(255,255,255,0.1)", color: "#888" });
        nameInput.disabled = false; 
    } else {
        btn.disabled = false;
        btn.innerText = isReady ? "取消準備" : "確認準備";
        Object.assign(btn.style, {
            background: isReady ? "var(--team-red)" : "linear-gradient(135deg, #f2d780, var(--premium-gold))",
            color: isReady ? "white" : "#222"
        });
        nameInput.disabled = isReady; 
    }
}

// ==========================================
// 🌟 產生大廳背景的撲克牌流動特效
// ==========================================
function startCardStreamEffect() {
    const container = document.getElementById('card-stream-container');
    if (!container) return; 

    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', 'K', 'Q', 'J', '10', '9', '8'];

    for (let i = 0; i < 6; i++) {
        let stream = document.createElement('div');
        stream.className = 'floating-card-stream';

        let cardString = "";
        for (let j = 0; j < 15; j++) {
            let s = suits[Math.floor(Math.random() * suits.length)];
            let v = values[Math.floor(Math.random() * values.length)];
            cardString += `${v}${s}  `;
        }
        
        stream.innerText = cardString;
        stream.style.top = `${Math.random() * 80}%`;
        stream.style.left = `${Math.random() * -50}%`; 
        
        let duration = 15 + Math.random() * 10;
        let delay = Math.random() * -20; 
        
        stream.style.animation = `flow-diagonal ${duration}s linear infinite`;
        stream.style.animationDelay = `${delay}s`;

        if (Math.random() > 0.5) stream.style.color = "rgba(231, 76, 60, 0.4)"; 

        container.appendChild(stream);
    }
}

// 啟動特效與資料庫監聽
startCardStreamEffect();
listenLobby();