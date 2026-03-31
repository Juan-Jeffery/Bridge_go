// ==========================================
// 多人連線模式控制器 (View & Controller) - four_people.js
// 橋牌四人對戰邏輯 (修正：選顏色綁定視角、徹底消滅鬼影、嚴格時間軸與AI喚醒)
// ==========================================

// --- 1. 全域變數與 Firebase 設定 ---
const urlParams = new URLSearchParams(window.location.search);
const myLocalName = urlParams.get('pname') || localStorage.getItem('bridge_name'); 
const roomId = urlParams.get('rid') || "Room_Alpha";

const playersRef = firebase.database().ref(`players/${roomId}`);
const gameRef = firebase.database().ref(`games/${roomId}`);

// 常數設定 (邏輯絕對方位 vs 螢幕相對方位)
const ROLES = ['south', 'west', 'north', 'east'];
const POSITIONS = ['bottom', 'left', 'top', 'right'];
const FLOW = { south: "west", west: "north", north: "east", east: "south" };

// 顏色對應邏輯
const TEAM_COLORS = { south: 'var(--team-blue)', north: 'var(--team-red)', west: 'var(--team-yellow)', east: 'var(--team-green)' };
const TEXT_COLORS = { south: 'white', north: 'white', west: '#222', east: 'white' };
const ROLE_NAMES = { south: "藍隊 (南)", west: "黃隊 (西)", north: "紅隊 (北)", east: "綠隊 (東)" };

const CARD_VALS = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
const SUIT_RANKS = { '♣': 1, '♦': 2, '♥': 3, '♠': 4, 'NT': 5 };
const TURN_DURATION = 20000; 

// 狀態變數
let myRole = ""; 
let currentPlayersData = {}; 
let isRendering = false;
let currentBiddingState = null; 
let selectedCardIndex = -1; 
let myCurrentHand = [];       
let currentTurnGlobally = ""; 
let currentScoresGlobally = { ns: 0, ew: 0 }; 
let globalTableCards = {}; 
let trickHistory = []; 
let turnTimerInterval = null; 
let timeElapsed = 0; 
let isGamePaused = false;
let aiActionTimeout = null; 

document.head.insertAdjacentHTML("beforeend", `<style>
    .active-turn::after { border-color: var(--active-border-color, white) !important; }
</style>`);

window.onbeforeunload = () => { if (myRole) playersRef.child(myRole).remove(); };

// --- 2. 視角旋轉與共用輔助函數 ---
const getMyIdx = () => ROLES.indexOf(myRole);
const getRelativePos = (logicalRole) => POSITIONS[(ROLES.indexOf(logicalRole) - getMyIdx() + 4) % 4];
const getRoleByPosOffset = (offset) => ROLES[(getMyIdx() + offset) % 4];

// 將相對位置轉回 HTML 寫死的 Slot ID
const VISUAL_CSS_MAP = { bottom: 'south', left: 'west', top: 'north', right: 'east' };
const getVisualSlotId = (logicalRole) => `slot-${VISUAL_CSS_MAP[getRelativePos(logicalRole)]}`;

const isRedSuit = (suit) => suit === '♥' || suit === '♦';

const getBestCard = (cardsArray, leadSuit, trumpSuit) => {
    return cardsArray.reduce((best, current) => {
        let isCurrentTrump = (current.s === trumpSuit);
        let isBestTrump = (best.s === trumpSuit);
        if (isCurrentTrump && !isBestTrump) return current;
        if (isCurrentTrump && isBestTrump && CARD_VALS[current.v] > CARD_VALS[best.v]) return current;
        if (!isCurrentTrump && !isBestTrump && current.s === leadSuit && best.s === leadSuit && CARD_VALS[current.v] > CARD_VALS[best.v]) return current;
        return best;
    }, cardsArray[0]);
};

// 全場排序第一的真人負責幫 AI 出牌/喊牌
function getAiDriver() {
    return ROLES.find(r => currentPlayersData[r] && !currentPlayersData[r].isAI) || myRole; 
}

// --- 3. 遊戲初始化與發牌 ---
function initializeGame() {
    if (!myLocalName) { window.location.href = "lobby.html"; return; }
    
    const btnRules = document.getElementById('btn-rules');
    const rulesModal = document.getElementById('rules-overlay');
    const toggleRules = (show, e) => { e.preventDefault(); isGamePaused = show; rulesModal.style.display = show ? 'block' : 'none'; };
    
    if (btnRules) {
        btnRules.addEventListener('mouseenter', (e) => toggleRules(true, e));
        btnRules.addEventListener('mouseleave', (e) => toggleRules(false, e));
        btnRules.addEventListener('touchstart', (e) => toggleRules(true, e), { passive: false });
        btnRules.addEventListener('touchend', (e) => toggleRules(false, e)); 
        btnRules.addEventListener('touchcancel', (e) => toggleRules(false, e));
    }
    
    document.addEventListener('click', () => { 
        if (selectedCardIndex !== -1) { selectedCardIndex = -1; renderHand(myCurrentHand); } 
    });

    firebase.database().ref().on('value', (snap) => {
        const all = snap.val() || {};
        const pList = all.players?.[roomId] || {};
        
        myRole = Object.keys(pList).find(k => pList[k]?.name === myLocalName && !pList[k].isAI);
        
        if (myRole) {
            firebase.database().ref().off('value'); 
            document.getElementById('loading').style.display = 'none';
            playersRef.child(myRole).onDisconnect().remove();
            startListening();
            
            if (myRole === getAiDriver()) { 
                gameRef.child('hands').get().then(h => { if (!h.exists()) setupNewDeck(); }); 
            }
        } else {
            alert("找不到您的座位資訊，即將返回大廳。");
            window.location.href = "lobby.html";
        }
    });
}

function setupNewDeck() {
    const suits = ['♠', '♥', '♦', '♣'], values = Object.keys(CARD_VALS);
    let deck = suits.flatMap(s => values.map(v => ({s, v}))).sort(() => Math.random() - 0.5);
    
    gameRef.update({
        hands: { south: sortHand(deck.slice(0, 13)), west: sortHand(deck.slice(13, 26)), north: sortHand(deck.slice(26, 39)), east: sortHand(deck.slice(39, 52)) },
        scores: { ns: 0, ew: 0 },
        personalScores: { south: 0, west: 0, north: 0, east: 0 },
        table: null, vote: null, review: null, 
        
        // 🌟 核心修改 1：出牌回合直接設定為發牌的玩家 (自己)
        turn: myRole, 
        
        bidding: { 
            status: "active", 
            // 🌟 核心修改 2：喊牌起始回合也直接設定為發牌的玩家 (自己)
            turn: myRole, 
            dealer: myRole,
            currentBid: null, 
            passCount: 0, 
            history: [], 
            contract: null 
        }
    });
    trickHistory = []; 
}

// --- 4. Firebase 狀態監聽 (核心連線邏輯) ---
function startListening() {
    playersRef.on('value', snap => {
        const players = snap.val() || {};
        if (ROLES.some(role => !players[role]) && Object.keys(currentPlayersData).length >= 4) {
            alert(`偵測到有人離開遊戲，牌局強制結束！`);
            gameRef.remove().then(() => window.location.href = "lobby.html"); return; 
        }
        currentPlayersData = players; 
        updatePlayerLabels(); 
        updateTurnUI(); 

        // 玩家資料一進來，立刻檢查是否需要幫 AI 喊牌 (解決黃色進場時藍色卡住的問題)
        if (currentBiddingState?.status === "active") triggerAiBiddingIfNeeded();
    });
    
    gameRef.child('scores').on('value', snap => { 
        currentScoresGlobally = snap.val() || { ns: 0, ew: 0 };
        updateScoreboardUI(); checkGameEnd(currentScoresGlobally); 
    });

    gameRef.child('personalScores').on('value', snap => updatePersonalTrickPiles(snap.val() || { south: 0, west: 0, north: 0, east: 0 }));

    gameRef.child('vote').on('value', snap => {
        const votes = snap.val() || {};
        if (currentBiddingState?.status === "finished") {
            let readyCount = 0;
            const statusHtml = ROLES.map(r => {
                const isReady = votes[r] === 'play_again' || currentPlayersData[r]?.isAI;
                if (isReady) readyCount++;
                return `<span>${currentPlayersData[r]?.name || "玩家"}: ${isReady ? '<b style="color:#2ecc71;">已準備</b>' : '⏳'}</span>`;
            }).join('');
            
            const voteDisplay = document.getElementById('vote-status-display');
            if(voteDisplay) voteDisplay.innerHTML = statusHtml;
            if (readyCount === 4 && myRole === getAiDriver()) setupNewDeck();
        }
    });

    gameRef.child(`hands/${myRole}`).on('value', snap => { 
        let serverHand = snap.val();
        // 🌟 核心修正：加上 serverHand.length === 13，讓新局剛發的 13 張牌可以直接通過！
        if (serverHand && (serverHand.length === 13 || serverHand.length <= myCurrentHand.length || myCurrentHand.length === 0)) {
            myCurrentHand = serverHand; 
            renderHand(myCurrentHand); 
        }
    });

    gameRef.child('bidding').on('value', snap => {
        const biddingData = snap.val();
        if (!biddingData) return;
        
        const previousStatus = currentBiddingState?.status || "active";
        currentBiddingState = biddingData;

        if (biddingData.status === "active") {
            document.getElementById('victory-overlay').classList.remove('show');
            window.victoryTriggered = false; 
            updateContractUI(null);
            const btnAgain = document.getElementById('btn-again');
            if (btnAgain) { btnAgain.disabled = false; btnAgain.innerText = "再來一場"; }
            updateScoreboardUI(); 
        }

        renderBiddingUI(biddingData); 
        updateTurnUI(); 
        triggerAiBiddingIfNeeded();

        if (biddingData.status === "finished") {
            updateScoreboardUI(); updateContractUI(biddingData.contract);
            if (previousStatus !== "finished") {
                gameRef.child(`hands/${myRole}`).get().then(s => { if (s.exists()) { myCurrentHand = s.val(); renderHand(myCurrentHand); }});
                gameRef.child('personalScores').get().then(s => updatePersonalTrickPiles(s.val() || { south: 0, west: 0, north: 0, east: 0 }));
            }
        }
    });

    gameRef.child('turn').on('value', snap => {
        currentTurnGlobally = snap.val();
        updateTurnUI();
        if (myCurrentHand.length > 0) renderHand(myCurrentHand);
        
        if (aiActionTimeout) clearTimeout(aiActionTimeout);

        if (currentTurnGlobally && !['waiting', 'resolving'].includes(currentTurnGlobally) && myRole === getAiDriver() && currentBiddingState?.status === "finished") {
            let currentPlayer = currentPlayersData[currentTurnGlobally];
            if (currentPlayer?.isAI) {
                aiActionTimeout = setTimeout(async () => {
                    const currentTurnCheck = (await gameRef.child('turn').get()).val();
                    if (currentTurnCheck !== currentTurnGlobally) return;

                    let aiHand = (await gameRef.child(`hands/${currentTurnGlobally}`).get()).val() || [];
                    if (aiHand.length === 0) return;

                    let currentTable = (await gameRef.child('table').get()).val() || {};
                    let aiCard = COMPUTER_AI.getPlayCard(aiHand, currentTable);
                    if (aiCard) submitAICard(currentTurnGlobally, aiCard, aiHand, currentPlayer.name, currentTable);
                }, 1500);
            }
        }
    });

    gameRef.child('review').on('value', snap => { trickHistory = snap.val() ? Object.values(snap.val()) : []; });

    gameRef.child('table').on('value', snap => {
        globalTableCards = snap.val() || {}; 
        const cardsArray = Object.keys(globalTableCards).sort().map(k => globalTableCards[k]);
        
        // 🌟 核心修正：如果桌面上沒半張牌 (新回合)，才清空所有人的槽位
        if (cardsArray.length === 0) {
            ROLES.forEach(r => { 
                const slot = document.getElementById(getVisualSlotId(r)); 
                if(slot) slot.innerHTML = ""; 
            });
            return;
        }

        if (myCurrentHand.length > 0) renderHand(myCurrentHand);
        
        const leadSuit = cardsArray[0].s; 
        const trumpSuit = currentBiddingState?.contract?.suit !== 'NT' ? currentBiddingState?.contract?.suit : null;
        let bestCard = getBestCard(cardsArray, leadSuit, trumpSuit);
        
        cardsArray.forEach(data => {
            const slotId = getVisualSlotId(data.from);
            const slot = document.getElementById(slotId);
            if (!slot) return;

            const isBest = (data.v === bestCard.v && data.s === bestCard.s);
            
            // 🌟 核心修正：檢查這個位置是不是已經有牌了
            let existingCard = slot.querySelector('.table-card');

            if (!existingCard) {
                // 如果沒有牌，才「新增卡牌」，這會觸發 CSS 的掉落動畫 (只有最新出的一張會動)
                const cardDiv = document.createElement('div');
                cardDiv.className = `card table-card ${isRedSuit(data.s) ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
                cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`;
                slot.appendChild(cardDiv);
            } else {
                // 如果牌已經在桌上了，只要「更新 Class」就好！不會觸發重新掉落，只會改變跳動發光的狀態
                existingCard.className = `card table-card ${isRedSuit(data.s) ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
            }
        });

        // 滿四張牌準備結算
        if (cardsArray.length === 4) { 
            setTimeout(() => checkTrickWinner(cardsArray, leadSuit, trumpSuit), 2000); 
        }
    });
}

function triggerAiBiddingIfNeeded() {
    if (aiActionTimeout) clearTimeout(aiActionTimeout);
    
    const turn = currentBiddingState?.turn;
    if (currentBiddingState?.status === "active" && turn && currentPlayersData[turn]?.isAI && myRole === getAiDriver()) {
        aiActionTimeout = setTimeout(async () => {
            const freshBidding = (await gameRef.child('bidding').get()).val();
            if (freshBidding?.turn !== turn || freshBidding?.status !== "active") return;

            let aiHand = (await gameRef.child(`hands/${turn}`).get()).val() || [];
            let aiBid = COMPUTER_AI.getBid(aiHand, freshBidding.currentBid);
            submitAIBid(turn, aiBid && aiBid !== 'Pass' ? aiBid.level : 'Pass', aiBid?.suit || null);
        }, 1500);
    }
}
// --- 5. UI 更新與回合控制 ---
function updatePlayerLabels() {
    const roleMap = { south: '南', north: '北', west: '西', east: '東' };

    POSITIONS.forEach((pos, i) => {
        const r = getRoleByPosOffset(i);
        const player = currentPlayersData[r];
        const name = player?.name || "連線中...";
        const labelEl = document.getElementById(`label-${pos}`);
        const pileEl = document.getElementById(`pile-${pos}`);
        
        if (labelEl) {
            let displayName = "";

            if (player?.isAI || name === "電腦") {
                displayName = `電腦 (${roleMap[r]})`;
            } else {
                displayName = name; 
            }

            labelEl.innerText = displayName;
            labelEl.style.backgroundColor = TEAM_COLORS[r];
            labelEl.style.color = TEXT_COLORS[r];
        }
        if (pileEl) {
            pileEl.style.backgroundColor = TEAM_COLORS[r];
            pileEl.style.color = TEXT_COLORS[r];
        }
    });
}

function updateTurnUI() {
    let activeRole = currentBiddingState?.status !== "finished" ? currentBiddingState?.turn : currentTurnGlobally;
    
    POSITIONS.forEach((p, i) => {
        const el = document.getElementById(`label-${p}`);
        if(el) { el.classList.remove('active-turn'); el.style.removeProperty('--active-border-color'); }
        let dot = document.getElementById(`dot-${getRoleByPosOffset(i)}`);
        if(dot) dot.classList.remove('dot-active');
    });
    
    if(activeRole && ROLES.includes(activeRole)){
        const activeEl = document.getElementById(`label-${getRelativePos(activeRole)}`);
        if(activeEl) {
            activeEl.style.setProperty('--active-border-color', TEAM_COLORS[activeRole]);
            activeEl.classList.add('active-turn');
        }
        let activeDot = document.getElementById(`dot-${activeRole}`);
        if(activeDot) activeDot.classList.add('dot-active');
        startBurnLine(activeRole);
    } else {
        startBurnLine('waiting');
    }
}

function startBurnLine(role) {
    clearInterval(turnTimerInterval);
    document.querySelectorAll('.dot').forEach(d => { d.style.removeProperty('--burn-pct'); d.classList.remove('burning'); });

    if (role === 'waiting' || role === 'resolving') return;
    let dot = document.getElementById(`dot-${role}`); if (!dot) return;
    
    dot.classList.add('burning'); timeElapsed = 0;

    turnTimerInterval = setInterval(() => {
        if (isGamePaused) return; 
        timeElapsed += 50; 
        dot.style.setProperty('--burn-pct', `${(timeElapsed / TURN_DURATION) * 100}%`);

        if (timeElapsed >= TURN_DURATION) {
            clearInterval(turnTimerInterval);
            dot.style.removeProperty('--burn-pct'); dot.classList.remove('burning');
            if (role === myRole && currentTurnGlobally === myRole) handlePlayerTimeout();
        }
    }, 50); 
}

function handlePlayerTimeout() {
    if (currentBiddingState.status === "active") submitBid('Pass', null);
    else if (currentBiddingState.status === "finished" && myCurrentHand.length > 0) {
        let availableCards = myCurrentHand.filter(c => !Object.values(globalTableCards).some(tc => tc.s === c.s && tc.v === c.v && tc.from === myRole));
        if (availableCards.length === 0) return;

        let chosenCard = COMPUTER_AI.getPlayCard(availableCards, globalTableCards);
        let cardIndex = myCurrentHand.findIndex(c => c.s === chosenCard.s && c.v === chosenCard.v);
        selectedCardIndex = -1; 
        startPlayAnimation(null, chosenCard, cardIndex, myCurrentHand); 
    }
}

// --- 6. 喊牌邏輯與介面 ---
function updateContractUI(contract) {
    const displayEl = document.getElementById('contract-display');
    if (!contract) { displayEl.innerHTML = "喊牌中..."; return; }
    displayEl.innerHTML = `最終喊牌: <span style="color: ${TEAM_COLORS[contract.declarer] || 'white'}; font-size: 1.3rem; font-weight: 900; margin-left: 5px;">${contract.level}${contract.suit}</span>`;
}

function renderBiddingUI(biddingData) {
    if (biddingData.status !== "finished") updateContractUI(null);
    const modal = document.getElementById('bidding-modal');
    
    if (biddingData.status === "finished") {
        modal.classList.add('fly-to-top-left'); updateContractUI(biddingData.contract);
        setTimeout(() => { modal.style.display = "none"; }, 800); return;
    }
    modal.style.display = "block"; modal.classList.remove('fly-to-top-left');

    const historyDiv = document.getElementById('bidding-history');
    const bidColorsMap = {};
    
    // 🌟 核心修正：拋棄名字比對，直接用「順序 (Index)」推算顏色！
    // 取得第一棒 (發牌人) 在 ROLES 陣列中的位置。
    // (需確保 setupNewDeck 有存入 bidding.dealer，若無則預設從 south 開始)
    let dealerIdx = ROLES.indexOf(biddingData.dealer || 'south');
    
    // 建立已經喊過的牌與顏色的對應表
    if (biddingData.history) {
        biddingData.history.forEach((item, index) => {
            let [pName, bid] = item.split(': ');
            
            // 魔法公式：(第一棒的位置 + 這是第幾次喊牌) % 4 = 當前喊牌者的實際邏輯方位
            let currentRole = ROLES[(dealerIdx + index) % 4];
            
            if (bid !== "Pass") bidColorsMap[bid] = TEAM_COLORS[currentRole];
        });
        
        // 渲染上方的歷史軌跡 (彩色字體 + 黑色半透明底)
        // 因為我們只切出最後 3 筆 (slice(-3))，所以要先算出這 3 筆在原本陣列中的「絕對起始位置」
        let startIndex = Math.max(0, biddingData.history.length - 3); 
        
        historyDiv.innerHTML = biddingData.history.slice(-3).map((item, localIndex) => {
            let [pName, bid] = item.split(': '); 
            
            // 絕對 Index = 起始 Index + 區域 Index
            let absoluteIndex = startIndex + localIndex;
            let currentRole = ROLES[(dealerIdx + absoluteIndex) % 4];
            let color = TEAM_COLORS[currentRole];
            
            return `<span style="color: ${color}; font-size: 1.3rem; font-weight: bold; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 8px;">${bid}</span>`;
        }).join(' <span style="color: #95a5a6; font-size: 1.2rem;">➔</span> ') || "請開始喊牌";
    } else {
        historyDiv.innerHTML = "請開始喊牌";
    }
    
    historyDiv.style.marginBottom = "25px";

    // 渲染目前的最高喊牌
    const contractDisplay = document.getElementById('contract-display');
    if (biddingData.currentBid) {
        // 這裡資料庫本來就有存真實的 player 方位，直接取用最準
        let maxColor = TEAM_COLORS[biddingData.currentBid.player] || "white";
        let { level, suit } = biddingData.currentBid;
        contractDisplay.innerHTML = `喊牌中... <span style="color: #ccc; margin: 0 10px; font-weight: 300;">|<span style="color: ${maxColor}; font-weight: bold; font-size: 1.3rem; margin-left: 5px;">${level}${suit}</span>`;
    } else {
        contractDisplay.innerHTML = "喊牌中...";
    }
    
    const isMyTurn = (biddingData.turn === myRole);    
    const container = document.getElementById('bid-buttons-container'); container.innerHTML = "";
    
    // 渲染 1♣ 到 7NT 的按鈕
    for (let level = 1; level <= 7; level++) {
        Object.keys(SUIT_RANKS).forEach(suit => {
            const btn = document.createElement('button'); btn.className = 'bid-btn';
            const bidStr = `${level}${suit}`; 
            
            // 預設按鈕外觀 (紅心與菱形給紅色字體)
            btn.innerHTML = `${level}<span style="color:${isRedSuit(suit) ? '#e74c3c' : 'white'}">${suit}</span>`;
            
            // 判斷是否可用
            let isDisabled = !isMyTurn;
            if (biddingData.currentBid) {
                const { level: curLevel, suit: curSuit } = biddingData.currentBid;
                if (level < curLevel || (level === curLevel && SUIT_RANKS[suit] <= SUIT_RANKS[curSuit])) isDisabled = true;
            }
            btn.disabled = isDisabled; 

            // 🌟 完美套用推算出來的顏色
            if (bidColorsMap[bidStr]) {
                let pColor = bidColorsMap[bidStr];
                btn.style.backgroundColor = pColor; 
                btn.style.filter = "none"; 
                btn.style.opacity = "0.85"; 
                btn.style.border = "none"; 
                // 黃色底配黑字，其餘配白字
                btn.style.color = (pColor === "var(--team-yellow)") ? "black" : "white";
                btn.innerHTML = `${level}<span style="color:${(pColor === 'var(--team-yellow)') ? 'black' : 'white'}">${suit}</span>`;
            }

            btn.onclick = () => submitBid(level, suit); 
            container.appendChild(btn);
        });
    }
    document.getElementById('btn-pass').disabled = !isMyTurn;
}

function submitBid(level, suit) { if (currentBiddingState.turn === myRole) _processBid(myRole, level, suit); }
function submitAIBid(aiRole, level, suit) { _processBid(aiRole, level, suit); }

function _processBid(role, level, suit) {
    let newHistory = currentBiddingState.history || [];
    let actorName = currentPlayersData[role].name;
    
    if (level === 'Pass') {
        newHistory.push(`${actorName}: Pass`); 
        let newPassCount = currentBiddingState.passCount + 1;
        if (currentBiddingState.currentBid && newPassCount === 3) finishBidding(currentBiddingState.currentBid);
        else if (!currentBiddingState.currentBid && newPassCount === 4) { if (myRole === getAiDriver()) setupNewDeck(); }
        else gameRef.child('bidding').update({ turn: FLOW[role], passCount: newPassCount, history: newHistory });
    } else {
        newHistory.push(`${actorName}: ${level}${suit}`);
        gameRef.child('bidding').update({ turn: FLOW[role], passCount: 0, currentBid: { level, suit, player: role, name: actorName }, history: newHistory });
    }
}

function finishBidding(winningBid) {
    if (myRole !== getAiDriver()) return; 
    const declarer = winningBid.player;
    gameRef.child('bidding').update({
        status: "finished",
        contract: { level: winningBid.level, suit: winningBid.suit, declarer, declarerName: winningBid.name, team: ['south', 'north'].includes(declarer) ? 'NS' : 'EW', targetTricks: winningBid.level + 6 }
    });
    gameRef.child('turn').set(FLOW[declarer]); 
}

// --- 7. 桌面渲染與出牌邏輯 ---
function updateScoreboardUI() {
    let nsT = "?", ewT = "?";
    if (currentBiddingState?.status === "finished" && currentBiddingState.contract) {
        const c = currentBiddingState.contract;
        nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
        ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
    }
    document.getElementById('score-ns-text').innerHTML = ` ${currentScoresGlobally.ns || 0}/${nsT}`;
    document.getElementById('score-ew-text').innerHTML = ` ${currentScoresGlobally.ew || 0}/${ewT}`;
}

async function renderHand(hand) {
    if (isRendering) return; isRendering = true;
    const container = document.getElementById('my-hand'); container.innerHTML = "";
    
    let cardsOnTable = Object.values(globalTableCards);
    let visibleHand = hand.filter(c => !cardsOnTable.some(tc => tc.s === c.s && tc.v === c.v && tc.from === myRole));
    const leadSuit = cardsOnTable.length > 0 ? cardsOnTable[0].s : null;
    const hasLeadSuit = leadSuit ? visibleHand.some(c => c.s === leadSuit) : false;
    const sorted = sortHand(visibleHand);
    
    container.style.setProperty('--card-count-factor', Math.max(0.2, sorted.length / 13));

    let prevSuit = null; 
    sorted.forEach((card, index) => {
        let isBidding = currentBiddingState?.status !== "finished";
        let isWrongSuit = leadSuit && hasLeadSuit && card.s !== leadSuit;
        
        const div = document.createElement('div');
        div.className = `card ${isRedSuit(card.s) ? 'red' : ''} ${(!isBidding && isWrongSuit) ? 'disabled' : ''} ${index === selectedCardIndex ? 'selected' : ''} ${(prevSuit && prevSuit !== card.s) ? 'suit-gap' : ''}`;
        div.style.zIndex = index; div.innerHTML = `${card.v}<span>${card.s}</span>`;
        prevSuit = card.s;
        
        div.onclick = (e) => {
            e.stopPropagation();
            if (currentTurnGlobally !== myRole || isBidding || isWrongSuit) return;
            
            if (selectedCardIndex === index) { 
                selectedCardIndex = -1; 
                let cardIdx = myCurrentHand.findIndex(c => c.s === card.s && c.v === card.v);
                if(cardIdx !== -1) myCurrentHand.splice(cardIdx, 1);
                renderHand(myCurrentHand);
                startPlayAnimation(e.currentTarget, card, index, myCurrentHand); 
            } else { selectedCardIndex = index; isRendering = false; renderHand(visibleHand); }
        };
        container.appendChild(div);
    });
    isRendering = false;
}

function startPlayAnimation(cardEl, cardData, index, hand) {
    if(cardEl) cardEl.style.opacity = '0';
    gameRef.child('turn').get().then(snap => {
        if (snap.val() !== myRole) return; 
        
        let isFourthCard = Object.keys(globalTableCards).length === 3; 
        gameRef.child(`hands/${myRole}`).set(hand);
        gameRef.child('table').push({ from: myRole, playerName: myLocalName, ...cardData });
        gameRef.child('turn').set(isFourthCard ? "resolving" : FLOW[myRole]);
    });
}

function submitAICard(aiRole, cardData, hand, aiName, currentTableState) {
    let cardIndex = hand.findIndex(c => c.s === cardData.s && c.v === cardData.v);
    if(cardIndex !== -1) hand.splice(cardIndex, 1);
    
    let isFourthCard = Object.keys(currentTableState).length === 3; 
    gameRef.child(`hands/${aiRole}`).set(hand);
    gameRef.child('table').push({ from: aiRole, playerName: aiName, ...cardData });
    gameRef.child('turn').set(isFourthCard ? "resolving" : FLOW[aiRole]);
}

function checkTrickWinner(cardsArray, leadSuit, trumpSuit) {
    let winner = getBestCard(cardsArray, leadSuit, trumpSuit);
    
    playTrickAnimation(winner.from, () => {
        if (myRole === getAiDriver()) {
            const team = ['south', 'north'].includes(winner.from) ? 'ns' : 'ew';
            
            // 執行分數增加
            gameRef.child(`scores/${team}`).transaction(s => (s || 0) + 1, () => {
                gameRef.child(`personalScores/${winner.from}`).transaction(s => (s || 0) + 1);
                gameRef.child('review').push({ winner: winner.from, cards: cardsArray });
                
                gameRef.child('table').remove().then(() => {
                    
                    // 🌟 核心修正：避免分數非同步造成的「提早一墩判定」殭屍問題
                    // 直接從資料庫抓取「剛剛更新完」的最新分數，保證絕對精準，不再手動 +1！
                    gameRef.child('scores').once('value', snap => {
                        const latestScores = snap.val() || { ns: 0, ew: 0 };
                        const currentNS = latestScores.ns || 0;
                        const currentEW = latestScores.ew || 0;
                        
                        const c = currentBiddingState.contract;
                        const nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
                        const ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;

                        // 用最真實的分數判斷，如果真的達標了，才鎖死輪次
                        if (currentNS >= nsT || currentEW >= ewT || (currentNS + currentEW === 13)) {
                            gameRef.child('turn').set("game_over"); 
                        } else {
                            gameRef.child('turn').set(winner.from); // 沒達標，交給贏家出下一張
                        }
                    });
                    
                });
            });
        }
    });
}

function updatePersonalTrickPiles(pScores) {
    ROLES.forEach(r => { 
        const el = document.getElementById(`pile-${getRelativePos(r)}`); 
        if (el) {
            el.style.display = currentBiddingState?.status === "finished" ? 'flex' : 'none';
            el.innerText = pScores[r] || 0; 
        }
    });
}

// --- 8. 動畫與特效 ---
function playTrickAnimation(winnerRole, callback) {
    const phantomCards = [];
    const destRect = document.getElementById(`label-${getRelativePos(winnerRole)}`)?.getBoundingClientRect();
    if (!destRect) { if(callback) callback(); return; }

    ROLES.forEach(role => {
        const cardEl = document.getElementById(getVisualSlotId(role))?.querySelector('.table-card');
        if (cardEl) {
            const startRect = cardEl.getBoundingClientRect();
            const flyingCard = cardEl.cloneNode(true);
            flyingCard.classList.remove('table-card', 'best-card');
            flyingCard.classList.add('flying');
            Object.assign(flyingCard.style, {
                left: `${startRect.left}px`, top: `${startRect.top}px`, width: `${startRect.width}px`, height: `${startRect.height}px`,
                margin: '0', zIndex: role === winnerRole ? '10000' : '9998'
            });
            cardEl.style.visibility = 'hidden'; 
            phantomCards.push({ role, el: flyingCard, startRect });
        }
    });

    phantomCards.sort((a, b) => a.role === winnerRole ? 1 : -1).forEach(pc => document.body.appendChild(pc.el));

    const cx = window.innerWidth / 2 - phantomCards[0].startRect.width / 2;
    const cy = window.innerHeight / 2 - phantomCards[0].startRect.height / 2;

    requestAnimationFrame(() => {
        phantomCards.forEach(pc => {
            Object.assign(pc.el.style, { left: `${cx}px`, top: `${cy}px` });
            if (pc.role === winnerRole) { pc.el.style.transform = 'scale(1.5)'; pc.el.style.boxShadow = '0 20px 50px rgba(212, 175, 55, 0.6)'; }
        });
    });

    setTimeout(() => phantomCards.forEach(pc => { if (pc.role !== winnerRole) pc.el.style.transform = 'scale(1)'; }), 300); 
    setTimeout(() => phantomCards.forEach(pc => Object.assign(pc.el.style, {
        left: `${destRect.left + destRect.width/2 - phantomCards[0].startRect.width/2}px`,
        top: `${destRect.top + destRect.height/2 - phantomCards[0].startRect.height/2}px`,
        transform: 'scale(0.2) rotate(15deg)', opacity: '0', boxShadow: 'none'
    })), 800); 

    setTimeout(() => { phantomCards.forEach(pc => pc.el.remove()); if(callback) callback(); }, 1400); 
}

// --- 9. 遊戲結束與大廳操作 ---
function checkGameEnd(scores) {
    if (!currentBiddingState?.contract || window.victoryTriggered) return;
    
    const c = currentBiddingState.contract;
    const currentNS = scores.ns || 0;
    const currentEW = scores.ew || 0;
    
    // 計算雙方的目標墩數
    // 如果莊家是 NS，NS 目標就是合約墩數，EW 防守目標就是 14 - 合約墩數
    const nsTarget = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
    const ewTarget = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;

    // 提早結束條件：只要任何一方達到目標，或是真的打滿 13 墩 (防呆機制)
    if (currentNS >= nsTarget || currentEW >= ewTarget || (currentNS + currentEW === 13)) {
        window.victoryTriggered = true;
        setTimeout(showVictoryScreen, 1500); 
    }
}

function showVictoryScreen() {
    const c = currentBiddingState.contract;
    let winTeam = (c.team === 'NS') ? (currentScoresGlobally.ns >= c.targetTricks ? "NS" : "EW") : (currentScoresGlobally.ew >= c.targetTricks ? "EW" : "NS");
    const myTeam = ['north', 'south'].includes(myRole) ? 'NS' : 'EW';
    
    const titleEl = document.getElementById('victory-title');
    titleEl.innerText = (myTeam === winTeam) ? "Victory" : "Defeat";
    titleEl.style.color = (myTeam === winTeam) ? "#fbd347" : "#95a5a6"; 
    
    document.getElementById('v-score-ns-text').innerText = `${currentScoresGlobally.ns || 0}/${c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks}`;
    document.getElementById('v-score-ew-text').innerText = `${currentScoresGlobally.ew || 0}/${c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks}`;

    renderTrickReview();
    document.getElementById('victory-overlay').classList.add('show');
}

function renderTrickReview() {
    const container = document.getElementById('review-scrollarea');
    if (!container) return; container.innerHTML = ""; 

    trickHistory.forEach((trick, index) => {
        const row = document.createElement('div'); row.className = 'v-trick-row';
        row.innerHTML = `<span class="v-trick-label">T${index + 1}</span><div class="v-trick-cards">` + 
            trick.cards.map(c => `<div class="mini-card border-${c.from} ${c.from === trick.winner ? 'winner-card' : ''}">${c.v}<span class="${isRedSuit(c.s) ? 'red' : ''}">${c.s}</span></div>`).join('') + `</div>`;
        container.appendChild(row);
    });
}

window.votePlayAgain = () => {
    gameRef.child(`vote/${myRole}`).set('play_again');
    const btn = document.getElementById('btn-again'); btn.disabled = true; btn.innerText = "等待其他人...";
};

window.voteReturnLobby = () => { playersRef.child(myRole).remove().then(() => window.location.href = "lobby.html"); };

function sortHand(hand) {
    const suitOrder = {'♠': 4, '♥': 3, '♦': 2, '♣': 1}; 
    return hand.sort((a, b) => suitOrder[a.s] !== suitOrder[b.s] ? suitOrder[b.s] - suitOrder[a.s] : CARD_VALS[b.v] - CARD_VALS[a.v]).reverse();
}

// 啟動遊戲
initializeGame();