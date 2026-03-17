// 檔案路徑：js/game-logic.js

const urlParams = new URLSearchParams(window.location.search);
const myLocalName = urlParams.get('pname') || localStorage.getItem('bridge_name'); 
const roomId = urlParams.get('rid') || "Room_Alpha";

const playersRef = database.ref('players/' + roomId);
const gameRef = database.ref('games/' + roomId);

// --- 全域變數 ---
let myRole = ""; 
let currentPlayersData = {}; 
let isRendering = false;
let currentBiddingState = null; 
let selectedCardIndex = -1; 
let myCurrentHand = [];       
let currentTurnGlobally = ""; 

// 斷線防護
window.onbeforeunload = function() { 
    if (myRole) { playersRef.child(myRole).remove(); } 
};

// --- 初始化遊戲 ---
function initializeGame() {
    if (!myLocalName) { window.location.href = "lobby.html"; return; }
    
    database.ref().on('value', (snap) => {
        const all = snap.val() || {};
        const pList = (all.players && all.players[roomId]) ? all.players[roomId] : {};
        
        myRole = Object.keys(pList).find(k => pList[k] && pList[k].name === myLocalName);
        
        if (myRole) {
            database.ref().off('value'); 
            document.getElementById('loading').style.display = 'none';
            
            playersRef.child(myRole).onDisconnect().remove();
            startListening(roomId);
            
            if (myRole === "south") { 
                gameRef.child('hands').get().then(h => { 
                    if (!h.exists()) setupNewDeck(); 
                }); 
            }
        }
    });
}

// 洗牌與發牌設定
function setupNewDeck() {
    const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = []; suits.forEach(s => values.forEach(v => deck.push({s, v})));
    deck.sort(() => Math.random() - 0.5);
    
    gameRef.child('hands').set({ 
        south: deck.slice(0, 13), west: deck.slice(13, 26), 
        north: deck.slice(26, 39), east: deck.slice(39, 52) 
    });
    
    gameRef.child('scores').set({ ns: 0, ew: 0 });
    gameRef.child('personalScores').set({ south: 0, west: 0, north: 0, east: 0 });
    gameRef.child('table').remove();
    gameRef.child('vote').remove();
    gameRef.child('turn').set("south"); 
    gameRef.child('bidding').set({
        status: "active", turn: "south", currentBid: null, passCount: 0, history: [], contract: null
    });
}

// --- Firebase 監聽引擎 ---
function startListening(rid) {
    playersRef.on('value', snap => {
        const players = snap.val() || {};
        const currentRoles = Object.keys(players);
        const missingRole = ['south', 'west', 'north', 'east'].find(role => !currentRoles.includes(role));
        
        if (missingRole && Object.keys(currentPlayersData).length >= 4) {
            alert(`偵測到有人離開遊戲，牌局強制結束！`);
            gameRef.remove(); playersRef.remove();
            window.location.href = "lobby.html";
            return; 
        }
        currentPlayersData = players; 
        updatePlayerLabels(currentPlayersData);
    });
    
    gameRef.child('scores').on('value', snap => { 
        const scores = snap.val() || { ns: 0, ew: 0 };
        updateScoreboardUI(scores); 
        checkGameEnd(scores); 
    });

    gameRef.child('personalScores').on('value', snap => {
        updatePersonalTrickPiles(snap.val() || { south: 0, west: 0, north: 0, east: 0 });
    });

    gameRef.child('vote').on('value', snap => {
        const votes = snap.val() || {};
        if (currentBiddingState && currentBiddingState.status === "finished") {
            let readyCount = 0; let statusHtml = "";
            const roles = ['north', 'south', 'west', 'east'];
            roles.forEach(r => {
                const pName = currentPlayersData[r] ? currentPlayersData[r].name : "玩家";
                const isReady = votes[r] === 'play_again';
                if (isReady) readyCount++;
                statusHtml += `<span>${pName}: ${isReady ? '<b style="color:#2ecc71;">已準備</b>' : '⏳'}</span>`;
            });
            const voteDisplay = document.getElementById('vote-status-display');
            if(voteDisplay) voteDisplay.innerHTML = statusHtml;
            if (readyCount === 4 && myRole === 'south') { setupNewDeck(); }
        }
    });

    // 監聽自己的手牌
    gameRef.child('hands/' + myRole).on('value', snap => { 
        if (snap.val()) {
            myCurrentHand = snap.val();
            renderHand(myCurrentHand); 
        }
    });

    gameRef.child('bidding').on('value', async snap => {
        const biddingData = snap.val();
        if (biddingData) {
            const previousStatus = currentBiddingState ? currentBiddingState.status : "active";
            currentBiddingState = biddingData;

            if (biddingData.status === "active") {
                document.getElementById('victory-overlay').classList.remove('show');
                window.victoryTriggered = false;
                updateContractUI(null);
                const btnAgain = document.getElementById('btn-again');
                if (btnAgain) { btnAgain.disabled = false; btnAgain.innerText = "再來一場"; }
            }

            renderBiddingUI(biddingData);
            
            // 【修復核心】：只要現在是打牌階段 (finished)，就強制刷新計分板顯示目標墩數！
            if (biddingData.status === "finished") {
                gameRef.child('scores').get().then(snap => {
                    updateScoreboardUI(snap.val() || { ns: 0, ew: 0 });
                });
            }

            if (previousStatus !== "finished" && biddingData.status === "finished") {
                const hSnap = await gameRef.child('hands/' + myRole).get();
                if (hSnap.exists()) renderHand(hSnap.val());
                
                gameRef.child('personalScores').get().then(snap => {
                    updatePersonalTrickPiles(snap.val() || { south: 0, west: 0, north: 0, east: 0 });
                });
            }
        }
    });

    // 監聽輪次
    gameRef.child('turn').on('value', snap => {
        currentTurnGlobally = snap.val();
        const turnDisplay = document.getElementById('turn-name-display');
        if (currentTurnGlobally && currentPlayersData[currentTurnGlobally] && (!currentBiddingState || currentBiddingState.status === "finished")) {
            turnDisplay.innerText = (currentTurnGlobally === myRole) ? `⭐ ${currentPlayersData[currentTurnGlobally].name} (你)` : currentPlayersData[currentTurnGlobally].name;
            updateFlameEffect(currentTurnGlobally);
        } else {
            turnDisplay.innerText = "喊牌中...";
        }
        
        if (myCurrentHand.length > 0) renderHand(myCurrentHand);
    });

    // 監聽桌面卡片
    gameRef.child('table').on('value', async (snap) => {
        const center = document.getElementById('table-center'); 
        const tableCardsObj = snap.val();
        if (!tableCardsObj) { center.innerHTML = ""; return; }
        
        center.innerHTML = ""; 
        
        const cardsArray = Object.keys(tableCardsObj).sort().map(k => tableCardsObj[k]);
        const leadSuit = cardsArray[0].s; 
        const trumpSuit = (currentBiddingState && currentBiddingState.contract && currentBiddingState.contract.suit !== 'NT') ? currentBiddingState.contract.suit : null;
        const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
        
        let bestCard = cardsArray[0]; 
        
        cardsArray.forEach(c => { 
            let isCurrentTrump = (c.s === trumpSuit);
            let isBestTrump = (bestCard.s === trumpSuit);
            
            if (isCurrentTrump && !isBestTrump) { bestCard = c; }
            else if (isCurrentTrump && isBestTrump) { if (vals[c.v] > vals[bestCard.v]) bestCard = c; }
            else if (!isCurrentTrump && !isBestTrump && c.s === leadSuit && bestCard.s === leadSuit) { 
                if (vals[c.v] > vals[bestCard.v]) bestCard = c; 
            }
        });
        
        Object.entries(tableCardsObj).forEach(([id, data]) => {
            const cardDiv = document.createElement('div');
            const isBest = (data.v === bestCard.v && data.s === bestCard.s);
            cardDiv.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
            cardDiv.setAttribute('data-playername', data.playerName); 
            cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`;
            center.appendChild(cardDiv);
        });
        
        if (myCurrentHand.length > 0) renderHand(myCurrentHand);

        if (Object.keys(tableCardsObj).length === 4) { 
            gameRef.child('turn').set("waiting"); 
            setTimeout(() => { checkTrickWinner(cardsArray, leadSuit, trumpSuit, vals); }, 1500); 
        }
    });
}

// --- 喊牌邏輯 ---
const suitRanks = { '♣': 1, '♦': 2, '♥': 3, '♠': 4, 'NT': 5 };

function renderBiddingUI(biddingData) {
    if (biddingData.status !== "finished") updateContractUI(null);
    const modal = document.getElementById('bidding-modal');
    if (biddingData.status === "finished") {
        modal.classList.add('fly-to-top-left');
        updateContractUI(biddingData.contract);
        setTimeout(() => { modal.style.display = "none"; }, 800);
        return;
    }
    modal.style.display = "block"; modal.classList.remove('fly-to-top-left');

    const historyDiv = document.getElementById('bidding-history');
    let historyText = biddingData.history ? biddingData.history.slice(-4).join(' ➔ ') : "請開始喊牌";
    if (biddingData.currentBid) {
        historyText += `<br><span style="color:var(--premium-gold);font-size:1.1rem;">目前最高: ${biddingData.currentBid.level}${biddingData.currentBid.suit} (${biddingData.currentBid.name})</span>`;
    }
    historyDiv.innerHTML = historyText;

    const isMyTurn = (biddingData.turn === myRole);
    document.getElementById('bidding-title').innerText = isMyTurn ? "🌟 輪到你喊牌了！" : `等待喊牌...`;
    
    const container = document.getElementById('bid-buttons-container'); container.innerHTML = "";
    const suits = ['♣', '♦', '♥', '♠', 'NT'];
    for (let level = 1; level <= 7; level++) {
        suits.forEach(suit => {
            const btn = document.createElement('button'); btn.className = 'bid-btn';
            btn.innerHTML = `${level}<span style="color:${(suit==='♥'||suit==='♦')?'#e74c3c':'white'}">${suit}</span>`;
            let isDisabled = !isMyTurn;
            if (biddingData.currentBid) {
                const currentLevel = biddingData.currentBid.level;
                const currentSuitRank = suitRanks[biddingData.currentBid.suit];
                if (level < currentLevel || (level === currentLevel && suitRanks[suit] <= currentSuitRank)) isDisabled = true;
            }
            btn.disabled = isDisabled;
            btn.onclick = () => submitBid(level, suit);
            container.appendChild(btn);
        });
    }
    document.getElementById('btn-pass').disabled = !isMyTurn;
}

function submitBid(level, suit) {
    if (currentBiddingState.turn !== myRole) return;
    const flow = { south: "west", west: "north", north: "east", east: "south" };
    let newHistory = currentBiddingState.history || [];
    if (level === 'Pass') {
        newHistory.push(`${myLocalName}: Pass`);
        let newPassCount = currentBiddingState.passCount + 1;
        if (currentBiddingState.currentBid && newPassCount === 3) finishBidding(currentBiddingState.currentBid);
        else if (!currentBiddingState.currentBid && newPassCount === 4) { alert("四家 Pass 重新發牌！"); setupNewDeck(); }
        else gameRef.child('bidding').update({ turn: flow[myRole], passCount: newPassCount, history: newHistory });
    } else {
        newHistory.push(`${myLocalName}: ${level}${suit}`);
        gameRef.child('bidding').update({ turn: flow[myRole], passCount: 0, currentBid: { level, suit, player: myRole, name: myLocalName }, history: newHistory });
    }
}

function finishBidding(winningBid) {
    const declarer = winningBid.player;
    const contract = {
        level: winningBid.level, suit: winningBid.suit, declarer: declarer,
        declarerName: winningBid.name, team: (declarer === 'south' || declarer === 'north') ? 'NS' : 'EW',
        targetTricks: winningBid.level + 6
    };
    const flow = { south: "west", west: "north", north: "east", east: "south" };
    gameRef.child('bidding').update({ status: "finished", contract: contract });
    gameRef.child('turn').set(flow[declarer]); 
}

// --- 計分板 UI (極簡目標顯示) ---
function updateScoreboardUI(scores = { ns: 0, ew: 0 }) {
    const getN = (r) => currentPlayersData[r] ? currentPlayersData[r].name : "玩家";
    const container = document.getElementById('score-display-teams'); 
    if (!container) return;

    let nsTargetStr = "";
    let ewTargetStr = "";

    // 喊牌結束後，計算並顯示雙方的目標墩數
    if (currentBiddingState && currentBiddingState.status === "finished" && currentBiddingState.contract) {
        const c = currentBiddingState.contract;
        const nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
        const ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
        
        nsTargetStr = ` <span style="font-size:0.8rem; color:var(--text-muted);">(目標${nsT}墩)</span>`;
        ewTargetStr = ` <span style="font-size:0.8rem; color:var(--text-muted);">(目標${ewT}墩)</span>`;
    }

    container.innerHTML = 
        `${getN('north')} & ${getN('south')}: <span class="score-tag">${scores.ns||0}</span> 墩${nsTargetStr}<br>` + 
        `${getN('west')} & ${getN('east')}: <span class="score-tag">${scores.ew||0}</span> 墩${ewTargetStr}`;
}

function updateContractUI(contract) {
    const displayEl = document.getElementById('contract-display');
    if (!contract) { displayEl.innerHTML = `🏆 狀態: <span style="color:var(--text-muted);">競標中...</span>`; return; }
    displayEl.innerHTML = `🏆 最終喊牌: <span style="color:var(--premium-gold);">${contract.level}${contract.suit}</span>`;
}

// --- 手牌渲染與嚴格防呆邏輯 ---
async function renderHand(hand) {
    if (isRendering) return; isRendering = true;
    const container = document.getElementById('my-hand'); container.innerHTML = "";
    
    const tableSnap = await gameRef.child('table').get();
    const tableCardsObj = tableSnap.val();
    let tableCards = [];
    if (tableCardsObj) {
        tableCards = Object.keys(tableCardsObj).sort().map(k => tableCardsObj[k]);
    }
    
    const leadSuit = tableCards.length > 0 ? tableCards[0].s : null;
    const hasLeadSuit = leadSuit ? hand.some(c => c.s === leadSuit) : false;
    
    const sorted = sortHand(hand);
    
    sorted.forEach((card, index) => {
        const div = document.createElement('div');
        let isBidding = (!currentBiddingState || currentBiddingState.status !== "finished");
        
        let isWrongSuit = (leadSuit && hasLeadSuit && card.s !== leadSuit);
        let isVisuallyDisabled = isBidding || isWrongSuit;
        
        div.className = `card ${(card.s === '♥' || card.s === '♦') ? 'red' : ''} ${isVisuallyDisabled ? 'disabled' : ''} ${index === selectedCardIndex ? 'selected' : ''}`;
        div.style.zIndex = index; div.innerHTML = `${card.v}<span>${card.s}</span>`;
        
        div.onclick = (e) => {
            if (currentTurnGlobally !== myRole || isVisuallyDisabled) return;
            
            if (selectedCardIndex === index) { 
                selectedCardIndex = -1; 
                startPlayAnimation(e.currentTarget, card, index, sorted); 
            } else { 
                selectedCardIndex = index; 
                renderHand(hand); 
            }
        };
        container.appendChild(div);
    });
    isRendering = false;
}

// --- 出牌與吃墩動畫 ---
function startPlayAnimation(cardEl, cardData, index, hand) {
    cardEl.style.opacity = '0';
    tryPlayCard(cardData, index, hand);
}

function tryPlayCard(card, index, hand) {
    gameRef.child('turn').get().then(snap => {
        if (snap.val() !== myRole) return; 
        
        const sortedHand = sortHand(hand);
        sortedHand.splice(index, 1);
        gameRef.child('hands/' + myRole).set(sortedHand);
        
        gameRef.child('table').push({ from: myRole, playerName: myLocalName, ...card });
        
        const flow = { south: "west", west: "north", north: "east", east: "south" };
        gameRef.child('turn').set(flow[myRole]);
    });
}

function checkTrickWinner(cardsArray, leadSuit, trumpSuit, vals) {
    let winner = cardsArray[0]; 
    
    cardsArray.forEach(c => { 
        let isCurrentT = (c.s === trumpSuit); let isBestT = (winner.s === trumpSuit);
        if (isCurrentT && !isBestT) winner = c;
        else if (isCurrentT && isBestT) { if (vals[c.v] > vals[winner.v]) winner = c; }
        else if (!isCurrentT && !isBestT && c.s === leadSuit && winner.s === leadSuit) { 
            if (vals[c.v] > vals[winner.v]) winner = c; 
        }
    });
    
    playTrickAnimation(winner.from);
}

function playTrickAnimation(winnerRole) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const posMap = ['bottom', 'left', 'top', 'right'];
    const winnerPos = posMap[(roles.indexOf(winnerRole) - myIdx + 4) % 4];
    const targetRect = document.getElementById(`label-${winnerPos}`).getBoundingClientRect();
    
    document.querySelectorAll('.table-card').forEach(card => {
        card.classList.add('flying'); const r = card.getBoundingClientRect();
        card.style.left = r.left + 'px'; card.style.top = r.top + 'px';
        setTimeout(() => { 
            card.style.left = (targetRect.left + 20) + 'px'; 
            card.style.top = targetRect.top + 'px'; 
            card.style.transform = 'scale(0.1)'; 
            card.style.opacity = '0'; 
        }, 50);
    });
    
    setTimeout(() => {
        if (myRole === "south") {
            const team = (winnerRole === 'south' || winnerRole === 'north') ? 'ns' : 'ew';
            gameRef.child('scores/' + team).transaction(s => (s || 0) + 1);
            gameRef.child('personalScores/' + winnerRole).transaction(s => (s || 0) + 1);
            gameRef.child('table').remove(); 
            gameRef.child('turn').set(winnerRole);
        }
    }, 700);
}

// 個人吃墩數顯示
function updatePersonalTrickPiles(pScores) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const pos = ['bottom', 'left', 'top', 'right'];
    roles.forEach((r, i) => { 
        const el = document.getElementById(`pile-${pos[(i-myIdx+4)%4]}`); 
        if (el) {
            if (currentBiddingState && currentBiddingState.status === "finished") {
                el.style.display = 'flex'; 
                el.innerText = pScores[r] || 0; 
            } else {
                el.style.display = 'none'; 
            }
        }
    });
}

// --- 勝利結算系統 ---
function checkGameEnd(scores) {
    if (!currentBiddingState || !currentBiddingState.contract) return;
    const c = currentBiddingState.contract;
    const ns = scores.ns || 0; const ew = scores.ew || 0;
    let isGameOver = false;
    
    if (c.team === 'NS') { if (ns >= c.targetTricks || ew >= (14 - c.targetTricks)) isGameOver = true; }
    else { if (ew >= c.targetTricks || ns >= (14 - c.targetTricks)) isGameOver = true; }

    if ((ns + ew === 13 || isGameOver) && !window.victoryTriggered) {
        window.victoryTriggered = true;
        setTimeout(() => { showVictoryScreen(scores); }, 1500); 
    }
}

function showVictoryScreen(scores) {
    const c = currentBiddingState.contract;
    const getP = (r) => currentPlayersData[r] ? currentPlayersData[r].name : "玩家";
    const nsNames = `${getP('north')} & ${getP('south')}`;
    const ewNames = `${getP('west')} & ${getP('east')}`;
    
    let winTeam = (c.team === 'NS') ? (scores.ns >= c.targetTricks ? "NS" : "EW") : (scores.ew >= c.targetTricks ? "EW" : "NS");
    const myTeam = (myRole === 'north' || myRole === 'south') ? 'NS' : 'EW';
    
    document.getElementById('victory-title').innerText = (myTeam === winTeam) ? "🏆 勝利！！" : "💀 失敗";
    document.getElementById('victory-title').style.color = (myTeam === winTeam) ? "var(--premium-gold)" : "#95a5a6";

    document.getElementById('v-ns-line').innerHTML = `${nsNames}: <b style="color:white; font-size:1.4rem;">${scores.ns}</b> 墩${c.team==='NS'?' (目標 '+c.targetTricks+' 墩)':''}`;
    document.getElementById('v-ew-line').innerHTML = `${ewNames}: <b style="color:white; font-size:1.4rem;">${scores.ew}</b> 墩${c.team==='EW'?' (目標 '+c.targetTricks+' 墩)':''}`;
    
    document.getElementById('victory-team-names').innerText = (winTeam === 'NS') ? nsNames : ewNames;
    document.getElementById('v-contract').innerText = `${c.level}${c.suit}`;
    document.getElementById('victory-overlay').classList.add('show');
}

// --- 按鈕與工具邏輯 ---
window.votePlayAgain = function() {
    gameRef.child('vote/' + myRole).set('play_again');
    const btn = document.getElementById('btn-again'); btn.disabled = true; btn.innerText = "等待其他人...";
};

window.voteReturnLobby = function() {
    playersRef.child(myRole).remove().then(() => { window.location.href = "lobby.html"; });
};

function sortHand(hand) {
    const suitOrder = {'♠': 4, '♥': 3, '♦': 2, '♣': 1}; const valOrder = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    return hand.sort((a, b) => suitOrder[a.s] !== suitOrder[b.s] ? suitOrder[b.s] - suitOrder[a.s] : valOrder[b.v] - valOrder[a.v]).reverse();
}

function updatePlayerLabels(p) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const getP = (r) => (p[r] ? p[r].name : "連線中...");
    document.getElementById('label-bottom').innerText = getP(myRole) + " (你)";
    document.getElementById('label-left').innerText = getP(roles[(myIdx+1)%4]);
    document.getElementById('label-top').innerText = getP(roles[(myIdx+2)%4]);
    document.getElementById('label-right').innerText = getP(roles[(myIdx+3)%4]);
}

function updateFlameEffect(t) {
    const pos = ['bottom', 'left', 'top', 'right']; const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole);
    pos.forEach(p => document.getElementById(`label-${p}`).classList.remove('active-turn'));
    document.getElementById(`label-${pos[(roles.indexOf(t)-myIdx+4)%4]}`).classList.add('active-turn');
}

initializeGame();