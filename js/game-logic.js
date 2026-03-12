// 檔案路徑：js/game-logic.js

const urlParams = new URLSearchParams(window.location.search);
const myLocalName = urlParams.get('pname') || localStorage.getItem('bridge_name'); 
const roomId = urlParams.get('rid') || "Room_Alpha";

const playersRef = database.ref('players/' + roomId);
const gameRef = database.ref('games/' + roomId);

let myRole = ""; 
let currentPlayersData = {}; 
let isRendering = false;
let currentBiddingState = null; 

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
            
            // 【修復 Bug】：因為 HTML 把 my-name-display 刪掉了，所以這裡拿掉避免報錯
            // document.getElementById('my-name-display').innerText = myLocalName; 
            
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

function setupNewDeck() {
    const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = []; suits.forEach(s => values.forEach(v => deck.push({s, v})));
    deck.sort(() => Math.random() - 0.5);
    gameRef.child('hands').set({ south: deck.slice(0, 13), west: deck.slice(13, 26), north: deck.slice(26, 39), east: deck.slice(39, 52) });
    
    gameRef.child('scores').set({ ns: 0, ew: 0 });
    gameRef.child('personalScores').set({ south: 0, west: 0, north: 0, east: 0 });
    gameRef.child('bidding').set({
        status: "active",
        turn: "south",
        currentBid: null,
        passCount: 0,
        history: [],
        contract: null
    });
}

function startListening(rid) {
    playersRef.get().then(snap => { 
        currentPlayersData = snap.val() || {}; 
        updateScoreboardUI({ ns: 0, ew: 0 }); 
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
    
    gameRef.child('scores').on('value', snap => { 
        const scores = snap.val() || { ns: 0, ew: 0 };
        updateScoreboardUI(scores); 
        checkGameEnd(scores); // 檢查提早結算
    });
    // --- 【新增】監聽結算畫面的「再來一場」投票狀態 ---
    gameRef.child('vote').on('value', snap => {
        const votes = snap.val() || {};
        
        // 只有在結算畫面時才處理這個邏輯
        if (currentBiddingState && currentBiddingState.status === "finished") {
            let readyCount = 0;
            let statusHtml = "";
            const roles = ['north', 'south', 'west', 'east'];
            
            roles.forEach(r => {
                const pName = currentPlayersData[r] ? currentPlayersData[r].name : "玩家";
                const isReady = votes[r] === 'play_again';
                if (isReady) readyCount++;
                statusHtml += `<span>${pName}: ${isReady ? '<b style="color:#2ecc71;">✅ 已準備</b>' : '⏳ 思考中...'}</span>`;
            });
            
            const voteDisplay = document.getElementById('vote-status-display');
            if(voteDisplay) voteDisplay.innerHTML = statusHtml;

            // 如果 4 個人都按下再來一局，由南家負責發起新牌局
            if (readyCount === 4 && myRole === 'south') {
                setupNewDeck();
                gameRef.child('vote').remove(); // 清空投票紀錄
            }
        }
    });
    
    gameRef.child('personalScores').on('value', snap => { updatePersonalTrickPiles(snap.val() || {}); });
    gameRef.child('hands/' + myRole).on('value', snap => { if (snap.val()) renderHand(snap.val()); });
    
    // --- 監聽喊牌引擎 ---
    gameRef.child('bidding').on('value', async snap => {
        const biddingData = snap.val();
        if (biddingData) {
            const previousStatus = currentBiddingState ? currentBiddingState.status : "active";
            currentBiddingState = biddingData;

            // 【關鍵位置】：當偵測到新的一局 (active) 時，立刻重置 UI 狀態
            if (biddingData.status === "active") {
                // 1. 隱藏勝利結算畫面
                const victoryOverlay = document.getElementById('victory-overlay');
                if (victoryOverlay) victoryOverlay.classList.remove('show');
                
                // 2. 重置判定旗標與計分板標題
                window.victoryTriggered = false;
                updateContractUI(null);
                
                // 3. 恢復「再來一場」按鈕的狀態
                const btnAgain = document.getElementById('btn-again');
                if (btnAgain) { 
                    btnAgain.disabled = false; 
                    btnAgain.innerText = "再來一場"; 
                }

                // 4. 重置投票狀態 (顯示思考中)
                const voteDisplay = document.getElementById('vote-status-display');
                if (voteDisplay) voteDisplay.innerHTML = "";
            }

            // 執行渲染喊牌面板
            renderBiddingUI(biddingData);

            // 如果狀態從「喊牌中」切換為「喊牌結束」
            if (previousStatus !== "finished" && biddingData.status === "finished") {
                // 解鎖手牌，解除灰色濾鏡
                const hSnap = await gameRef.child('hands/' + myRole).get();
                if (hSnap.exists()) renderHand(hSnap.val());
                
                // 刷新計分板以顯示目標墩數
                gameRef.child('scores').get().then(sSnap => {
                    updateScoreboardUI(sSnap.val() || { ns: 0, ew: 0 });
                });
            }
        }
    });

    gameRef.child('turn').on('value', snap => {
        const t = snap.val();
        const turnDisplay = document.getElementById('turn-name-display');
        
        if (t && currentPlayersData[t] && (!currentBiddingState || currentBiddingState.status === "finished")) {
            turnDisplay.innerText = (t === myRole) ? `⭐ ${currentPlayersData[t].name} (你)` : currentPlayersData[t].name;
            updateFlameEffect(t);
        } else {
            turnDisplay.innerText = "競標中...";
        }
    });

    gameRef.child('table').on('value', async (snap) => {
        const center = document.getElementById('table-center'); const tableCards = snap.val();
        const hSnap = await gameRef.child('hands/' + myRole).get();
        if (hSnap.exists()) renderHand(hSnap.val());

        if (!tableCards) { center.innerHTML = ""; return; }
        
        center.innerHTML = ""; 
        const cardsArray = Object.values(tableCards);
        const leadSuit = cardsArray[0].s; 
        const trumpSuit = (currentBiddingState && currentBiddingState.contract && currentBiddingState.contract.suit !== 'NT') ? currentBiddingState.contract.suit : null;
        const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
        
        let bestCard = cardsArray[0]; 
        cardsArray.forEach(c => { 
            let isCurrentTrump = (c.s === trumpSuit);
            let isBestTrump = (bestCard.s === trumpSuit);
            
            if (isCurrentTrump && !isBestTrump) {
                bestCard = c; 
            } else if (isCurrentTrump && isBestTrump) {
                if (vals[c.v] > vals[bestCard.v]) bestCard = c; 
            } else if (!isCurrentTrump && !isBestTrump && c.s === leadSuit) {
                if (vals[c.v] > vals[bestCard.v]) bestCard = c; 
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

const suitRanks = { '♣': 1, '♦': 2, '♥': 3, '♠': 4, 'NT': 5 };

function renderBiddingUI(biddingData) {
    if (biddingData.status !== "finished") updateContractUI(null);

    const modal = document.getElementById('bidding-modal');
    const historyDiv = document.getElementById('bidding-history');
    const container = document.getElementById('bid-buttons-container');
    const passBtn = document.getElementById('btn-pass');
    
    if (biddingData.status === "finished") {
        modal.classList.add('fly-to-top-left');
        updateContractUI(biddingData.contract);
        setTimeout(() => { modal.style.display = "none"; }, 800);
        return;
    }

    modal.style.display = "block";
    modal.classList.remove('fly-to-top-left');

    let historyText = biddingData.history ? biddingData.history.slice(-4).join(' ➔ ') : "請開始出價";
    if (biddingData.currentBid) {
        historyText += `<br><span style="color:var(--premium-gold);font-size:1.1rem;">目前最高: ${biddingData.currentBid.level}${biddingData.currentBid.suit} (${biddingData.currentBid.name})</span>`;
    }
    historyDiv.innerHTML = historyText;

    const isMyTurn = (biddingData.turn === myRole);
    document.getElementById('bidding-title').innerText = isMyTurn ? "🌟 輪到你喊牌了！" : `等待 ${currentPlayersData[biddingData.turn].name} 喊牌...`;
    
    container.innerHTML = "";
    const suits = ['♣', '♦', '♥', '♠', 'NT'];
    for (let level = 1; level <= 7; level++) {
        suits.forEach(suit => {
            const btn = document.createElement('button');
            btn.className = 'bid-btn';
            btn.innerHTML = `${level}<span style="color:${(suit==='♥'||suit==='♦')?'#e74c3c':'white'}">${suit}</span>`;
            
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
    passBtn.disabled = !isMyTurn;
}

function submitBid(level, suit) {
    if (currentBiddingState.turn !== myRole) return;
    
    const flow = { south: "west", west: "north", north: "east", east: "south" };
    const nextTurn = flow[myRole];
    let newHistory = currentBiddingState.history || [];
    
    if (level === 'Pass') {
        newHistory.push(`${myLocalName}: Pass`);
        let newPassCount = currentBiddingState.passCount + 1;
        
        if (currentBiddingState.currentBid && newPassCount === 3) {
            finishBidding(currentBiddingState.currentBid);
        } else if (!currentBiddingState.currentBid && newPassCount === 4) {
            alert("四家 Pass，重新洗牌發牌！");
            setupNewDeck();
        } else {
            gameRef.child('bidding').update({ turn: nextTurn, passCount: newPassCount, history: newHistory });
        }
    } else {
        const bidStr = `${level}${suit}`;
        newHistory.push(`${myLocalName}: ${bidStr}`);
        gameRef.child('bidding').update({
            turn: nextTurn,
            passCount: 0, 
            currentBid: { level: level, suit: suit, player: myRole, name: myLocalName },
            history: newHistory
        });
    }
}

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
    
    const flow = { south: "west", west: "north", north: "east", east: "south" };
    const leadPlayer = flow[declarer];

    gameRef.child('bidding').update({ status: "finished", contract: contract });
    gameRef.child('turn').set(leadPlayer); 
}

function updateContractUI(contract) {
    const displayEl = document.getElementById('contract-display');
    if (!contract) {
        displayEl.innerHTML = `🏆 狀態: <span style="color:var(--text-muted);">競標中...</span>`;
        return;
    }
    displayEl.innerHTML = 
        `🏆 最終喊牌: <span style="font-size:1.15rem; color:var(--premium-gold);">${contract.level}${contract.suit}</span> (${contract.declarerName} 莊)`;
}

function updateScoreboardUI(scores = { ns: 0, ew: 0 }) {
    const getN = (r) => currentPlayersData[r] ? currentPlayersData[r].name : "連線中...";
    const container = document.getElementById('score-display-teams'); if (!container) return;
    
    let nsTarget = ""; 
    let ewTarget = "";
    
    if (currentBiddingState && currentBiddingState.status === "finished" && currentBiddingState.contract) {
        const c = currentBiddingState.contract;
        const nsTricks = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
        const ewTricks = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
        nsTarget = ` <span style="font-size:0.85rem; color:var(--text-muted);">(目標 ${nsTricks} 墩)</span>`;
        ewTarget = ` <span style="font-size:0.85rem; color:var(--text-muted);">(目標 ${ewTricks} 墩)</span>`;
    }
    
    container.innerHTML = 
        `${getN('south')} & ${getN('north')}: <span class="score-tag">${scores.ns || 0}</span> 墩${nsTarget}<br>` + 
        `${getN('west')} & ${getN('east')}: <span class="score-tag">${scores.ew || 0}</span> 墩${ewTarget}`;
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
let selectedCardIndex = -1; // 記錄目前被點選(升起)的牌索引

async function renderHand(hand) {
    if (isRendering) return; 
    isRendering = true; 
    const container = document.getElementById('my-hand');
    container.innerHTML = ""; 
    
    const tableSnap = await gameRef.child('table').get();
    const tableCards = tableSnap.val() ? Object.values(tableSnap.val()) : [];
    const leadSuit = tableCards.length > 0 ? tableCards[0].s : null; 
    const hasLeadSuit = leadSuit ? hand.some(c => c.s === leadSuit) : false;
    
    const sorted = sortHand(hand);
    
    sorted.forEach((card, index) => {
        const div = document.createElement('div');
        
        let isBidding = (!currentBiddingState || currentBiddingState.status !== "finished");
        let isDisabled = isBidding || (leadSuit && hasLeadSuit && card.s !== leadSuit);
        
        // 加上顏色、禁用、以及「選中」的樣式
        div.className = `card ${(card.s === '♥' || card.s === '♦') ? 'red' : ''} ${isDisabled ? 'disabled' : ''}`;
        if (index === selectedCardIndex) div.classList.add('selected');
        
        div.style.zIndex = index; 
        div.innerHTML = `${card.v}<span>${card.s}</span>`;
        
        div.onclick = (e) => { 
            if (isDisabled) return;

            // --- 兩段式確認邏輯 ---
            if (selectedCardIndex === index) {
                // 第二次點擊：確認送出
                selectedCardIndex = -1; 
                startPlayAnimation(e.currentTarget, card, index, sorted);
            } else {
                // 第一次點擊：選中並升起
                selectedCardIndex = index;
                renderHand(hand); // 重新渲染手牌來更新視覺
            }
        };
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

// ==========================================
// 勝利結算系統
// ==========================================

function checkGameEnd(scores) {
    const totalTricks = (scores.ns || 0) + (scores.ew || 0);
    
    if (!currentBiddingState || !currentBiddingState.contract) return;

    const c = currentBiddingState.contract;
    const nsTricks = scores.ns || 0;
    const ewTricks = scores.ew || 0;

    let isGameOver = false;

    if (c.team === 'NS') {
        if (nsTricks >= c.targetTricks || ewTricks >= (14 - c.targetTricks)) {
            isGameOver = true;
        }
    } else {
        if (ewTricks >= c.targetTricks || nsTricks >= (14 - c.targetTricks)) {
            isGameOver = true;
        }
    }

    if (totalTricks === 13 || isGameOver) {
        if (!window.victoryTriggered) {
            window.victoryTriggered = true;
            setTimeout(() => {
                showVictoryScreen(scores);
            }, 1500);
        }
    }
}

function showVictoryScreen(scores) {
    const c = currentBiddingState.contract;
    
    // 1. 抓取雙方隊伍的名字
    const getP = (r) => currentPlayersData[r] ? currentPlayersData[r].name : "玩家";
    const nsNames = `${getP('north')} & ${getP('south')}`;
    const ewNames = `${getP('west')} & ${getP('east')}`;
    
    // 2. 判斷哪一隊是贏家
    let winningTeam = "";
    if (c.team === 'NS') {
        winningTeam = (scores.ns >= c.targetTricks) ? "NS" : "EW";
    } else {
        winningTeam = (scores.ew >= c.targetTricks) ? "EW" : "NS";
    }

    // 3. 判斷「我」是贏家還是輸家
    const myTeam = (myRole === 'north' || myRole === 'south') ? 'NS' : 'EW';
    const isMeWinner = (myTeam === winningTeam);

    // 4. 設定大標題
    const titleEl = document.getElementById('victory-title');
    if (isMeWinner) {
        titleEl.innerText = "🏆 勝利！！";
        titleEl.style.color = "var(--premium-gold)";
    } else {
        titleEl.innerText = "💀 失敗";
        titleEl.style.color = "#95a5a6";
    }

    // 5. 更新數據行 (玩家 & 玩家: N 墩)
    // 莊家隊伍後面會標註目標
    const nsGoal = (c.team === 'NS') ? ` (目標 ${c.targetTricks} 墩)` : "";
    const ewGoal = (c.team === 'EW') ? ` (目標 ${c.targetTricks} 墩)` : "";

    document.getElementById('v-ns-line').innerHTML = `${nsNames}: <b style="color:white; font-size:1.4rem;">${scores.ns}</b> 墩${nsGoal}`;
    document.getElementById('v-ew-line').innerHTML = `${ewNames}: <b style="color:white; font-size:1.4rem;">${scores.ew}</b> 墩${ewGoal}`;

    // 6. 隱藏原本的結果文字區 (因為已經整合進數據行了)
    document.getElementById('v-result').style.display = "none";
    
    // 7. 更新合約與贏家名稱顯示
    const winnerNames = (winningTeam === 'NS') ? nsNames : ewNames;
    document.getElementById('victory-team-names').innerText = winnerNames;
    document.getElementById('v-contract').innerText = `${c.level}${c.suit}`;

    // 顯示面板
    document.getElementById('victory-overlay').classList.add('show');
}

// --- 點擊再來一場 (投票制) ---
window.votePlayAgain = function() {
    // 寫入 Firebase 自己的投票狀態
    gameRef.child('vote/' + myRole).set('play_again');
    
    // 按鈕變灰，防止連點
    const btn = document.getElementById('btn-again');
    btn.disabled = true;
    btn.innerText = "等待其他人...";
};

// --- 點擊重新分隊 ---
window.voteReturnLobby = function() {
    // 只要有一個人主動移除自己的座位並離開
    // 我們原本寫好的 playersRef 監聽器就會發現少一個人，進而把其他三人也炸回大廳！
    playersRef.child(myRole).remove().then(() => {
        window.location.href = "lobby.html";
    });
};

// 啟動遊戲引擎
initializeGame();