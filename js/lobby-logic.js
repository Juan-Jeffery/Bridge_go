// 檔案路徑：js/lobby-logic.js

const roomId = "Room_Alpha"; 

// 這裡的 database 變數來自於我們稍後會在 HTML 中引入的 firebase-config.js
const playersRef = database.ref('players/' + roomId);
const gamesRef = database.ref('games/' + roomId);

let myRole = "";
let isReady = false;
let myConfirmedName = ""; 
const nameInput = document.getElementById('name-input');
nameInput.value = localStorage.getItem('bridge_name') || "";

function listenLobby() {
    database.ref().on('value', (snap) => {
        const all = snap.val() || {};
        const players = all.players ? all.players[roomId] : {};
        const game = all.games ? all.games[roomId] : {};
        
        const listEl = document.getElementById('player-list');
        listEl.innerHTML = "";
        const roles = ['south', 'west', 'north', 'east'];
        let readyCount = 0;

        roles.forEach(r => {
            const p = players ? players[r] : null;
            const nameTxt = p ? p.name : "等待加入...";
            const statusClass = (p && p.ready) ? "ready" : "waiting";
            listEl.innerHTML += `<div class="player-item"><span>${nameTxt}</span><span class="status-tag ${statusClass}">${(p && p.ready) ? '已準備' : '-'}</span></div>`;
            if (p && p.ready) readyCount++;
        });

        document.getElementById('status-text').innerText = `已準備: ${readyCount}/4`;

        if (readyCount === 4) {
            if (myRole === "south" && game.gameStarted !== true) {
                gamesRef.update({ gameStarted: true });
            }
            if (game.gameStarted === true && isReady) {
                window.location.href = `four_people.html?pname=${encodeURIComponent(myConfirmedName)}&rid=${roomId}`;
            }
        }
    });
}

function toggleReady() {
    const name = nameInput.value.trim();
    if (!name) { alert("請先輸入名字"); return; }
    
    if (!isReady) {
        playersRef.transaction((p) => {
            if (!p) {
                p = {};
                gamesRef.set({ gameStarted: false });
            }
            const roles = ['south', 'west', 'north', 'east'];
            for (let r of roles) {
                if (!p[r]) {
                    myRole = r;
                    p[r] = { name: name, ready: true };
                    return p;
                }
            }
            return; 
        }, (err, committed) => {
            if (committed && myRole) {
                isReady = true;
                myConfirmedName = name;
                localStorage.setItem('bridge_name', name);
                updateUI(true);
            }
        });
    } else {
        playersRef.child(myRole).remove();
        isReady = false;
        myRole = "";
        updateUI(false);
    }
}

function updateUI(ready) {
    const btn = document.getElementById('ready-btn');
    btn.innerText = ready ? "取消準備" : "確認準備";
    btn.style.background = ready ? "#e74c3c" : "#f1c40f";
    nameInput.disabled = ready;
}

// 啟動監聽
listenLobby();