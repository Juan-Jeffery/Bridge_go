// 檔案路徑：js/lobby-logic.js

const roomId = "Room_Alpha"; 
const playersRef = database.ref('players/' + roomId);
const gamesRef = database.ref('games/' + roomId);

let myRole = ""; // 一開始不給座位，必須自己點
let isReady = false;
let myConfirmedName = ""; 
const nameInput = document.getElementById('name-input');
nameInput.value = localStorage.getItem('bridge_name') || "";

let currentPlayersData = {};
let currentGameData = {};

// 即時監聽名字修改
nameInput.addEventListener('input', (e) => {
    let newName = e.target.value.trim();
    if (myRole && !isReady) {
        const displayName = newName || "無名玩家"; 
        myConfirmedName = displayName;
        localStorage.setItem('bridge_name', displayName);
        playersRef.child(myRole).update({ name: displayName });
    }
});

function listenLobby() {
    database.ref().on('value', (snap) => {
        const all = snap.val() || {};
        currentPlayersData = all.players ? all.players[roomId] : {};
        currentGameData = all.games ? all.games[roomId] : {};
        
        updateLobbyUI();
    });
}

function updateLobbyUI() {
    const players = currentPlayersData || {};
    const game = currentGameData || {};
    
    const roles = ['north', 'south', 'west', 'east'];
    let readyCount = 0;

    roles.forEach(role => {
        const p = players[role];
        const btn = document.getElementById(`seat-${role}`);
        
        btn.className = "seat-btn";
        btn.disabled = false;

        if (p) {
            const statusTxt = p.ready ? "(已準備)" : "(入座)";
            // 如果是自己的座位，提示可以點擊離開
            if (role === myRole && !isReady) {
                btn.innerText = `${getRoleName(role)}: ${p.name} (點擊離開)`;
            } else {
                btn.innerText = `${getRoleName(role)}: ${p.name} ${statusTxt}`;
            }
            
            if (role === myRole) {
                btn.classList.add("my-seat");
                if (p.ready) btn.classList.add("ready");
            } else {
                btn.classList.add("occupied");
                btn.disabled = true; 
            }

            if (p.ready) readyCount++;
        } else {
            btn.innerText = `${getRoleName(role)}: 虛位以待`;
            if (isReady) btn.disabled = true; 
        }
    });

    document.getElementById('status-text').innerText = `目前已準備人數: ${readyCount} / 4`;

    if (readyCount === 4) {
        if (myRole === "south" && game.gameStarted !== true) {
            gamesRef.update({ gameStarted: true });
        }
        if (game.gameStarted === true && isReady) {
            playersRef.child(myRole).onDisconnect().cancel();
            setTimeout(() => {
                window.location.href = `four_people.html?pname=${encodeURIComponent(myConfirmedName)}&rid=${roomId}`;
            }, 100);
        }
    }
    
    updateReadyButton();
}

// 【重點修改】：座位選擇與取消邏輯
function claimSeat(targetRole) {
    const name = nameInput.value.trim();
    if (!name) { alert("請先在左方輸入名字！"); nameInput.focus(); return; }
    if (isReady) { alert("已準備狀態無法更換或取消座位。"); return; }

    myConfirmedName = name;
    localStorage.setItem('bridge_name', name);

    // --- 1. 取消入座邏輯 (點擊自己的座位) ---
    if (myRole === targetRole) {
        playersRef.transaction((players) => {
            // 清除自己的資料
            if (players && players[myRole] && players[myRole].name === myConfirmedName) {
                players[myRole] = null; 
            }
            // 如果房間空了，重置遊戲狀態
            if (!players || Object.keys(players).length === 0) {
                gamesRef.set({ gameStarted: false });
            }
            return players;
        }, (err, committed) => {
            if (committed) {
                if (myRole) playersRef.child(myRole).onDisconnect().cancel(); 
                myRole = ""; // 將自己設為無座位狀態
                updateLobbyUI(); // 刷新畫面
            }
        });
        return; // 取消完畢就結束，不執行下方的搶位邏輯
    }

    // --- 2. 搶位與換位邏輯 (點擊別的空位) ---
    playersRef.transaction((players) => {
        if (!players) players = {};
        if (players[targetRole]) return; // 被搶走了 

        if (myRole && players[myRole] && players[myRole].name === myConfirmedName) {
            players[myRole] = null; // 換位子，把舊的清空
        }

        players[targetRole] = { name: myConfirmedName, ready: false };
        
        if (Object.keys(players).length === 1) {
            gamesRef.set({ gameStarted: false });
        }

        return players;
    }, (err, committed, snap) => {
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

function toggleReady() {
    if (!myRole) return; 
    
    const currentName = nameInput.value.trim();
    if (!currentName) {
        alert("準備前請確保您的名字不是空白！");
        nameInput.focus();
        return;
    }
    
    isReady = !isReady;
    playersRef.child(myRole).update({ ready: isReady, name: currentName });
}

function updateReadyButton() {
    const btn = document.getElementById('ready-btn');
    if (!myRole) {
        btn.innerText = "請先選擇右方座位";
        btn.disabled = true;
        btn.style.background = "#555";
        nameInput.disabled = false; 
    } else {
        btn.disabled = false;
        btn.innerText = isReady ? "取消準備" : "確認準備";
        btn.style.background = isReady ? "#e74c3c" : "#f1c40f";
        btn.style.color = isReady ? "white" : "#1a3c14";
        nameInput.disabled = isReady; 
    }
}

function getRoleName(role) {
    const map = { north: "北", south: "南", west: "西", east: "東" };
    return map[role];
}

listenLobby();