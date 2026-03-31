// 檔案路徑：js/lobby-logic.js

const roomId = "Room_Alpha"; 
const playersRef = database.ref('players/' + roomId);
const gamesRef = database.ref('games/' + roomId);

let myRole = ""; 
let isReady = false;
let myConfirmedName = localStorage.getItem('bridge_name') || ""; 
const nameInput = document.getElementById('name-input');
nameInput.value = myConfirmedName;

let currentPlayersData = {};
let currentGameData = {};

nameInput.addEventListener('input', (e) => {
    let newName = e.target.value.trim();
    if (myRole && !isReady) {
        myConfirmedName = newName || "無名玩家"; 
        localStorage.setItem('bridge_name', myConfirmedName);
        playersRef.child(myRole).update({ name: myConfirmedName });
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

// 🌟 核心修改：讓文字在圓圈內分層排版
function updateLobbyUI() {
    const players = currentPlayersData || {};
    const game = currentGameData || {};
    
    const roles = ['north', 'south', 'west', 'east'];
    let readyCount = 0;
    let occupiedCount = 0; 

    roles.forEach(role => {
        const p = players[role];
        const btn = document.getElementById(`seat-${role}`);
        const addAiBtn = document.getElementById(`add-ai-${role}`);
        
        btn.className = "circle-seat";
        btn.disabled = false;
        btn.onclick = () => claimSeat(role); 
        if (addAiBtn) addAiBtn.classList.remove("hide-ai-btn");

        // 建立 HTML 結構放入圓圈
        let roleHtml = `<div class="role-title">${getRoleName(role)}</div>`;
        let nameHtml = `<div class="player-name">虛位以待</div>`;
        let statusHtml = ``;

        if (p) {
            occupiedCount++;
            if (p.ready) readyCount++;
            if (addAiBtn) addAiBtn.classList.add("hide-ai-btn");
            
            nameHtml = `<div class="player-name">${p.name}</div>`;

            if (p.isAI) {
                statusHtml = `<div class="status-txt">點擊移除</div>`;
                btn.classList.add("occupied", "ready");
                btn.onclick = () => removeComputer(role); 
            } else if (role === myRole) {
                statusHtml = `<div class="status-txt">${p.ready ? '已準備' : '點擊離開'}</div>`;
                btn.classList.add("my-seat");
                if (p.ready) {
                    btn.classList.add("ready");
                    btn.disabled = true; 
                }
            } else {
                statusHtml = `<div class="status-txt">${p.ready ? '已準備' : '入座中'}</div>`;
                btn.classList.add("occupied");
                if (p.ready) btn.classList.add("ready");
                btn.disabled = true; 
                btn.onclick = null;
            }
        }

        // 將排版好的字塞入圓圈
        btn.innerHTML = roleHtml + nameHtml + statusHtml;
    });

    const statusTextEl = document.getElementById('status-text');
    statusTextEl.innerText = `目前已準備人數: ${readyCount} / 4`;

    if (readyCount === 4 && occupiedCount === 4) {
        if (game.gameStarted !== true && isReady) {
            gamesRef.update({ gameStarted: true });
        }
        
        if (game.gameStarted === true && isReady) {
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

    if (myRole === targetRole) {
        playersRef.transaction((players) => {
            if (players && players[myRole] && players[myRole].name === myConfirmedName) players[myRole] = null; 
            if (!players || Object.keys(players).length === 0) gamesRef.set({ gameStarted: false });
            return players;
        }, (err, committed) => {
            if (committed) {
                if (myRole) playersRef.child(myRole).onDisconnect().cancel(); 
                myRole = ""; updateLobbyUI(); 
            }
        });
        return; 
    }

    playersRef.transaction((players) => {
        if (!players) players = {};
        if (players[targetRole]) return; 
        if (myRole && players[myRole] && players[myRole].name === myConfirmedName) players[myRole] = null; 
        players[targetRole] = { name: myConfirmedName, ready: false, isAI: false };
        if (Object.keys(players).length === 1) gamesRef.set({ gameStarted: false });
        return players;
    }, (err, committed) => {
        if (committed) {
            if (myRole) playersRef.child(myRole).onDisconnect().cancel(); 
            myRole = targetRole; playersRef.child(myRole).onDisconnect().remove(); 
            updateLobbyUI();
        } else { alert("太慢囉！這個位置被搶走了。"); }
    });
}

function addComputer(role) {
    playersRef.child(role).set({ name: "電腦 (AI)", ready: true, isAI: true });
}

function removeComputer(role) {
    if(confirm(`確定要移除這家的電腦嗎？`)){
        playersRef.child(role).remove();
        if (currentPlayersData && Object.keys(currentPlayersData).length <= 1) gamesRef.update({ gameStarted: false });
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
        btn.innerText = "請先選擇桌面座位";
        btn.disabled = true;
        btn.style.background = "rgba(255,255,255,0.1)";
        btn.style.color = "#888";
        nameInput.disabled = false; 
    } else {
        btn.disabled = false;
        btn.innerText = isReady ? "取消準備" : "確認準備";
        btn.style.background = isReady ? "var(--team-red)" : "linear-gradient(135deg, #f2d780, var(--premium-gold))";
        btn.style.color = isReady ? "white" : "#222";
        nameInput.disabled = isReady; 
    }
}

function getRoleName(role) {
    const map = { north: "北", south: "南", west: "西", east: "東" };
    return map[role];
}

listenLobby();