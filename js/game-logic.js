// 檔案路徑：js/game-logic.js

const urlParams = new URLSearchParams(window.location.search);
const myLocalName = urlParams.get('pname') || localStorage.getItem('bridge_name'); 
const roomId = urlParams.get('rid') || "Room_Alpha";

const playersRef = database.ref('players/' + roomId);
const gameRef = database.ref('games/' + roomId);

let myRole = ""; 
let currentPlayersData = {}; 
let isRendering = false;
let currentBiddingState = null; // 儲存目前的喊牌狀態

// 斷線清理防護
window.onbeforeunload = function() { 
    if (myRole) { playersRef.child(myRole).remove(); } 
};

function initializeGame() {
    if (!myLocalName) { window.location.href = "lobby.html"; return; }
    
    database.ref().on('value', (snap) => {
        const all = snap.val() || {};
        const pList = (all.players && all.players[roomId]) ? all.players[roomId] : {};
        const gStatus = (all.games && all.games[roomId]) ? all.games[roomId] : {};
        
        myRole = Object.keys(pList).find(k => pList[k] && pList[k].name === myLocalName);
        
        if (myRole) {
            database.ref().off('value'); 
            document.getElementById('loading').style.display = 'none';
            document.getElementById('my-name-display').innerText = myLocalName;
            
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

// --- 初始化發牌與喊牌設定 ---
function setupNewDeck() {
    const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = []; suits.forEach(s => values.forEach(v => deck.push({s, v})));
    deck.sort(() => Math.random() - 0.5);
    gameRef.child('hands').set({ south: deck.slice(0, 13), west: deck.slice(13, 26), north: deck.slice(26, 39), east: deck.slice(39, 52) });
    
    // 初始化計分與喊牌引擎
    gameRef.child('scores').set({ ns: 0, ew: 0 });
    gameRef.child('personalScores').set({ south: 0, west: 0, north: 0, east: 0 });
    gameRef.child('bidding').set({
        status: "active",
        turn: "south",      // 發牌者(南家)先喊
        currentBid: null,   // 最高出價 { level: 1, suit: '♠', player: 'south', name: '玩家A' }
        passCount: 0,       // 連續 pass 次數
        history: [],        // 喊牌紀錄文字
        contract: null      // 最終合約
    });
}

function startListening(rid) {
    playersRef.get().then(snap => { 
        currentPlayersData = snap.val() || {}; 
        updateScoreboardUI(currentPlayersData); 
    });
    
    playersRef.on('value', snap => {
        const players = snap.val() || {};
        const currentRoles = Object.keys(players);
        const missingRole = ['south', 'west', 'north', 'east'].find(role => !currentRoles.includes(role));
        
        if (missingRole && Object.keys(currentPlayersData).length >= 4) {
            alert(`偵測到有人斷線，牌局強制結束！`);
            gameRef.remove(); playersRef.remove();
            window.location.href = "lobby.html";
            return; 
        }
        currentPlayersData = players; 
        updatePlayerLabels(currentPlayersData);
    });
    
    gameRef.child('scores').on('value', snap => { updateScoreboardUI(snap.val() || { ns: 0, ew: 0 }); });
    gameRef.child('personalScores').on('value', snap => { updatePersonalTrickPiles(snap.val() || {}); });
    gameRef.child('hands/' + myRole).on('value', snap => { if (snap.val()) renderHand(snap.val()); });
    
    // --- 監聽喊牌引擎 ---
    gameRef.child('bidding').on('value', snap => {
        const biddingData = snap.val();
        if (biddingData) {
            currentBiddingState = biddingData;
            renderBiddingUI(biddingData);
        }
    });

    // --- 監聽打牌輪次 ---
    gameRef.child('turn').on('value', snap => {
        const t = snap.val();
        // 只有在喊牌結束後，才顯示打牌輪次
        if (t && currentPlayersData[t] && (!currentBiddingState || currentBiddingState.status === "finished")) {
            document.getElementById('turn-name-display').innerText = (t === myRole) ? `⭐ ${currentPlayersData[t].name}` : currentPlayersData[t].name;
            updateFlameEffect(t);
        } else {
            document.getElementById('turn-name-display').innerText = "喊牌中...";
        }
    });

    // 監聽桌面出牌狀態 (打牌階段)
    gameRef.child('table').on('value', async (snap) => {
        const center = document.getElementById('table-center'); const tableCards = snap.val();
        const hSnap = await gameRef.child('hands/' + myRole).get();
        if (hSnap.exists()) renderHand(hSnap.val());

        if (!tableCards) { center.innerHTML = ""; return; }
        
        center.innerHTML = ""; 
        const cardsArray = Object.values(tableCards);
        const leadSuit = cardsArray[0].s; 
        // 判斷王牌 (如果有)
        const trumpSuit = (currentBiddingState && currentBiddingState.contract && currentBiddingState.contract.suit !== 'NT') ? currentBiddingState.contract.suit : null;
        
        const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
        
        // --- 修正橋牌吃墩判定邏輯 (含王牌) ---
        let bestCard = cardsArray[0]; 
        cardsArray.forEach(c => { 
            let isCurrentTrump = (c.s === trumpSuit);
            let isBestTrump = (bestCard.s === trumpSuit);
            
            if (isCurrentTrump && !isBestTrump) {
                bestCard = c; // 第一張王牌直接吃掉非王牌
            } else if (isCurrentTrump && isBestTrump) {
                if (vals[c.v] > vals[bestCard.v]) bestCard = c; // 都是王牌比大小
            } else if (!isCurrentTrump && !isBestTrump && c.s === leadSuit) {
                if (vals[c.v] > vals[bestCard.v]) bestCard = c; // 沒王牌時，比領頭花色大小
            }
        });
        
        Object.entries(tableCards).forEach(([id, data]) => {
            const cardDiv = document.createElement('div');
            const isBest = (data.v === bestCard.v && data.s === bestCard.s);
            cardDiv.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
            cardDiv.setAttribute('data-playername', data.playerName); 
            cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`;
            center.appendChild(cardDiv);
        });
        
        if (Object.keys(tableCards).length === 4) { checkTrickWinner(tableCards); }
    });
}

// ==========================================
// 喊牌引擎 (Bidding System)
// ==========================================

const suitRanks = { '♣': 1, '♦': 2, '♥': 3, '♠': 4, 'NT': 5 };

// 生成喊牌按鈕與控制介面
function renderBiddingUI(biddingData) {
    const modal = document.getElementById('bidding-modal');
    const historyDiv = document.getElementById('bidding-history');
    const container = document.getElementById('bid-buttons-container');
    const passBtn = document.getElementById('btn-pass');
    
    // 如果喊牌結束，觸發飛行動畫
    if (biddingData.status === "finished") {
        modal.classList.add('fly-to-top-left');
        document.getElementById('contract-display').style.display = "block";
        updateContractUI(biddingData.contract);
        
        // 動畫結束後徹底隱藏
        setTimeout(() => { modal.style.display = "none"; }, 800);
        return;
    }

    // 顯示喊牌區
    modal.style.display = "block";
    modal.classList.remove('fly-to-top-left');

    // 更新歷史紀錄
    let historyText = biddingData.history ? biddingData.history.slice(-4).join(' ➔ ') : "請開始出價";
    if (biddingData.currentBid) {
        historyText += `<br><span style="color:var(--premium-gold);font-size:1.1rem;">目前最高: ${biddingData.currentBid.level}${biddingData.currentBid.suit} (${biddingData.currentBid.name})</span>`;
    }
    historyDiv.innerHTML = historyText;

    // 判斷是否輪到自己
    const isMyTurn = (biddingData.turn === myRole);
    document.getElementById('bidding-title').innerText = isMyTurn ? "🌟 輪到你喊牌了！" : `等待 ${currentPlayersData[biddingData.turn].name} 喊牌...`;
    
    // 渲染 35 個喊牌按鈕
    container.innerHTML = "";
    const suits = ['♣', '♦', '♥', '♠', 'NT'];
    for (let level = 1; level <= 7; level++) {
        suits.forEach(suit => {
            const btn = document.createElement('button');
            btn.className = 'bid-btn';
            btn.innerHTML = `${level}<span style="color:${(suit==='♥'||suit==='♦')?'#e74c3c':'white'}">${suit}</span>`;
            
            // 規則檢查：出價必須比目前的更高
            let isDisabled = !isMyTurn;
            if (biddingData.currentBid) {
                const currentLevel = biddingData.currentBid.level;
                const currentSuitRank = suitRanks[biddingData.currentBid.suit];
                if (level < currentLevel || (level === currentLevel && suitRanks[suit] <= currentSuitRank)) {
                    isDisabled = true;
                }
            }
            btn.disabled = isDisabled;
            btn.onclick = () => submitBid(level, suit);
            container.appendChild(btn);
        });
    }
    
    // 處理 Pass 按鈕
    passBtn.disabled = !isMyTurn;
}

// 玩家送出喊牌或 Pass
function submitBid(level, suit) {
    if (currentBiddingState.turn !== myRole) return;
    
    const flow = { south: "west", west: "north", north: "east", east: "south" };
    const nextTurn = flow[myRole];
    let newHistory = currentBiddingState.history || [];
    
    if (level === 'Pass') {
        newHistory.push(`${myLocalName}: Pass`);
        let newPassCount = currentBiddingState.passCount + 1;
        
        // 判斷是否結標 (如果有喊過牌且連續3人Pass，或第一輪連續4人Pass重新發牌)
        if (currentBiddingState.currentBid && newPassCount === 3) {
            // 喊牌結束！計算合約
            finishBidding(currentBiddingState.currentBid);
        } else if (!currentBiddingState.currentBid && newPassCount === 4) {
            // 4家都Pass，重新洗牌
            alert("四家 Pass，重新洗牌發牌！");
            setupNewDeck();
        } else {
            // 繼續 Pass 給下一家
            gameRef.child('bidding').update({ turn: nextTurn, passCount: newPassCount, history: newHistory });
        }
    } else {
        // 出價
        const bidStr = `${level}${suit}`;
        newHistory.push(`${myLocalName}: ${bidStr}`);
        gameRef.child('bidding').update({
            turn: nextTurn,
            passCount: 0, // 只要有人出價，Pass 計數歸零
            currentBid: { level: level, suit: suit, player: myRole, name: myLocalName },
            history: newHistory
        });
    }
}

// 結束喊牌，設定莊家與目標
function finishBidding(winningBid) {
    const declarer = winningBid.player;
    const team = (declarer === 'south' || declarer === 'north') ? 'NS' : 'EW';
    const targetTricks = winningBid.level + 6;
    
    const contract = {
        level: winningBid.level,
        suit: winningBid.suit,
        declarer: declarer,
        declarerName: winningBid.name,
        team: team,
        targetTricks: targetTricks
    };
    
    // 設定打牌階段：莊家的左手邊先出牌
    const flow = { south: "west", west: "north", north: "east", east: "south" };
    const leadPlayer = flow[declarer];

    // 更新資料庫，觸發飛行動畫與開始打牌
    gameRef.child('bidding').update({ status: "finished", contract: contract });
    gameRef.child('turn').set(leadPlayer); 
}

// 更新左上角的合約計分板
function updateContractUI(contract) {
    if (!contract) return;
    const nsTarget = contract.team === 'NS' ? contract.targetTricks : 14 - contract.targetTricks;
    const ewTarget = contract.team === 'EW' ? contract.targetTricks : 14 - contract.targetTricks;
    
    document.getElementById('contract-display').innerHTML = 
        `🏆 最終合約: <span style="font-size:1.3rem;">${contract.level}${contract.suit}</span> (${contract.declarerName} 莊)<br>` +
        `<span style="font-size:0.85rem; color:var(--text-soft);">南北家目標: <b>${nsTarget}</b> 墩 | 東西家目標: <b>${ewTarget}</b> 墩</span>`;
}

// ==========================================
// 原有打牌邏輯 (微調部分防呆)
// ==========================================

function updateScoreboardUI(scores = { ns: 0, ew: 0 }) {
    const getN = (r) => currentPlayersData[r] ? currentPlayersData[r].name : "斷線中...";
    const container = document.getElementById('score-display-teams'); if (!container) return;
    container.innerHTML = `${getN('south')} & ${getN('north')}: <span class="score-tag">${scores.ns || 0}</span> 墩<br>${getN('west')} & ${getN('east')}: <span class="score-tag">${scores.ew || 0}</span> 墩`;
}

function updatePersonalTrickPiles(personalScores) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const posNames = ['bottom', 'left', 'top', 'right'];
    roles.forEach((role, idx) => {
        const relativePos = posNames[(idx - myIdx + 4) % 4]; const score = personalScores[role] || 0;
        const el = document.getElementById(`pile-${relativePos}`);
        if (score > 0) { el.style.display = 'flex'; el.innerText = score; } else { el.style.display = 'none'; }
    });
}

function checkTrickWinner(tableCards) {
    // 贏牌判定已移至 table 監聽器內以支援王牌計算，這裡只負責觸發動畫
    const cardsArray = Object.values(tableCards); const leadSuit = cardsArray[0].s; 
    const trumpSuit = (currentBiddingState && currentBiddingState.contract && currentBiddingState.contract.suit !== 'NT') ? currentBiddingState.contract.suit : null;
    const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    
    let winner = cardsArray[0]; 
    cardsArray.forEach(c => { 
        let isCurrentTrump = (c.s === trumpSuit);
        let isBestTrump = (winner.s === trumpSuit);
        if (isCurrentTrump && !isBestTrump) winner = c;
        else if (isCurrentTrump && isBestTrump && vals[c.v] > vals[winner.v]) winner = c;
        else if (!isCurrentTrump && !isBestTrump && c.s === leadSuit && vals[c.v] > vals[winner.v]) winner = c;
    });
    
    setTimeout(() => { playTrickAnimation(winner.from); }, 1200);
}

function playTrickAnimation(winnerRole) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const posMap = ['bottom', 'left', 'top', 'right'];
    const winnerPos = posMap[(roles.indexOf(winnerRole) - myIdx + 4) % 4];
    const targetEl = document.getElementById(`label-${winnerPos}`); 
    if(!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    
    document.querySelectorAll('.table-card').forEach(card => {
        const cardRect = card.getBoundingClientRect(); card.classList.add('flying');
        card.style.left = cardRect.left + 'px'; card.style.top = cardRect.top + 'px';
        setTimeout(() => {
            card.style.left = (rect.left + 20) + 'px'; card.style.top = (rect.top + 20) + 'px';
            card.style.transform = 'scale(0.1) rotate(180deg)'; card.style.opacity = '0';
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
    }, 850);
}

async function renderHand(hand) {
    if (isRendering) return; isRendering = true; const container = document.getElementById('my-hand');
    container.innerHTML = ""; const tableSnap = await gameRef.child('table').get();
    const tableCards = tableSnap.val() ? Object.values(tableSnap.val()) : [];
    const leadSuit = tableCards.length > 0 ? tableCards[0].s : null; 
    const hasLeadSuit = leadSuit ? hand.some(c => c.s === leadSuit) : false;
    
    const sorted = sortHand(hand);
    sorted.forEach((card, index) => {
        const div = document.createElement('div');
        
        // 喊牌還沒結束前，所有牌都不能出
        let isBidding = (!currentBiddingState || currentBiddingState.status !== "finished");
        let isDisabled = isBidding || (leadSuit && hasLeadSuit && card.s !== leadSuit);
        
        div.className = `card ${(card.s === '♥' || card.s === '♦') ? 'red' : ''} ${isDisabled ? 'disabled' : ''}`;
        div.style.zIndex = index; div.innerHTML = `${card.v}<span>${card.s}</span>`;
        div.onclick = (e) => { if (!isDisabled) startPlayAnimation(e.currentTarget, card, index, sorted); };
        container.appendChild(div);
    });
    isRendering = false;
}

function startPlayAnimation(cardEl, cardData, index, hand) {
    const rect = cardEl.getBoundingClientRect(); const clone = cardEl.cloneNode(true);
    clone.style.position = 'fixed'; clone.style.left = rect.left + 'px'; clone.style.top = rect.top + 'px';
    clone.style.zIndex = 1000; clone.style.transition = 'all 0.4s ease-out'; document.body.appendChild(clone);
    const targetCenter = document.getElementById('table-center').getBoundingClientRect();
    setTimeout(() => {
        clone.style.left = (targetCenter.left + targetCenter.width/2 - 30) + 'px';
        clone.style.top = (targetCenter.top + targetCenter.height/2 - 45) + 'px'; clone.style.transform = 'scale(1.1)';
    }, 10);
    setTimeout(() => { clone.remove(); tryPlayCard(cardData, index, hand); }, 400);
}

function sortHand(hand) {
    const suitOrder = {'♠': 4, '♥': 3, '♦': 2, '♣': 1}; const valOrder = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    const sorted = hand.sort((a, b) => { if (suitOrder[a.s] !== suitOrder[b.s]) return suitOrder[b.s] - suitOrder[a.s]; return valOrder[b.v] - valOrder[a.v]; });
    return sorted.reverse();
}

function tryPlayCard(card, index, hand) {
    gameRef.child('turn').get().then(snap => {
        if (snap.val() !== myRole) return; const originalHand = [...hand].reverse();
        originalHand.splice(originalHand.length - 1 - index, 1);
        gameRef.child('hands/' + myRole).set(originalHand);
        gameRef.child('table').push({ from: myRole, playerName: myLocalName, ...card });
        const flow = { south: "west", west: "north", north: "east", east: "south" };
        gameRef.child('turn').set(flow[myRole]);
    });
}

function updatePlayerLabels(players) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const getP = (r) => (players[r] ? players[r].name : "連線中...");
    document.getElementById('label-bottom').innerText = getP(myRole) + " (你)";
    document.getElementById('label-left').innerText = getP(roles[(myIdx+1)%4]);
    document.getElementById('label-top').innerText = getP(roles[(myIdx+2)%4]);
    document.getElementById('label-right').innerText = getP(roles[(myIdx+3)%4]);
}

function updateFlameEffect(currentTurnRole) {
    const roles = ['south', 'west', 'north', 'east'];
    const myIdx = roles.indexOf(myRole);
    const posNames = ['bottom', 'left', 'top', 'right'];
    
    posNames.forEach(pos => {
        const el = document.getElementById(`label-${pos}`);
        if(el) el.classList.remove('active-turn');
    });
    
    const turnIdx = (roles.indexOf(currentTurnRole) - myIdx + 4) % 4;
    const targetEl = document.getElementById(`label-${posNames[turnIdx]}`);
    if(targetEl) targetEl.classList.add('active-turn');
}

// 啟動遊戲引擎
initializeGame();