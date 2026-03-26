// 檔案路徑：js/single-logic.js

// --- 單機版全域變數 ---
const myRole = "south"; 
const roles = ["south", "west", "north", "east"];
const currentPlayersData = {
    south: { name: "你" },
    west: { name: "電腦 (西)" },
    north: { name: "電腦 (北)" },
    east: { name: "電腦 (東)" }
};

let hands = { south: [], west: [], north: [], east: [] };
let tableCards = {}; 
let currentBiddingState = null; 
let currentTurnGlobally = "south"; 
let scores = { ns: 0, ew: 0 };
let personalScores = { south: 0, west: 0, north: 0, east: 0 };
let selectedCardIndex = -1;
let isRendering = false;
let gameFinished = false;

// --- 初始化遊戲 ---
function initializeGame() {
    document.getElementById('loading').style.display = 'none';
    updatePlayerLabels();
    setupNewDeck();
}

function setupNewDeck() {
    gameFinished = false;
    document.getElementById('victory-overlay').classList.remove('show');
    
    const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = []; suits.forEach(s => values.forEach(v => deck.push({s, v})));
    deck.sort(() => Math.random() - 0.5);
    
    hands = { 
        south: sortHand(deck.slice(0, 13)), 
        west: sortHand(deck.slice(13, 26)), 
        north: sortHand(deck.slice(26, 39)), 
        east: sortHand(deck.slice(39, 52)) 
    };
    
    scores = { ns: 0, ew: 0 };
    personalScores = { south: 0, west: 0, north: 0, east: 0 };
    tableCards = {};
    updateScoreboardUI();
    updatePersonalTrickPiles();
    
    currentBiddingState = {
        status: "active", turn: "south", currentBid: null, passCount: 0, history: [], contract: null,
        botHasBidded: { west: false, north: false, east: false } // 記錄電腦是否已經喊過牌
    };
    
    setTurn("south");
    renderTable();
    updateContractUI(null);
}

// --- 輪次控制引擎 ---
function setTurn(nextRole) {
    currentTurnGlobally = nextRole;
    if (currentBiddingState.status === "active") {
        currentBiddingState.turn = nextRole;
        renderBiddingUI();
    }
    
    updateTurnUI();
    renderHand(); 

    if (nextRole !== myRole && nextRole !== "waiting" && !gameFinished) {
        if (currentBiddingState.status === "active") {
            setTimeout(() => botBid(nextRole), 1500);
        } else if (currentBiddingState.status === "finished") {
            setTimeout(() => botPlay(nextRole), 1500);
        }
    }
}

// ==========================================
// 🤖 電腦 AI 邏輯 (喊牌與打牌)
// ==========================================
const suitRanks = { '♣': 1, '♦': 2, '♥': 3, '♠': 4, 'NT': 5 };

function botBid(botRole) {
    // 條件一：如果這局電腦已經喊過牌了，之後一律 Pass
    if (currentBiddingState.botHasBidded[botRole]) {
        submitBid('Pass', null, botRole);
        return;
    }

    let botHand = hands[botRole];
    
    // 計算手牌中最多的花色
    let suitCounts = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
    botHand.forEach(card => suitCounts[card.s]++);
    
    let bestSuit = '♣';
    let maxCount = 0;
    for (let s in suitCounts) {
        if (suitCounts[s] > maxCount) { maxCount = suitCounts[s]; bestSuit = s; }
    }

    let targetLevel = 1;
    let canBid = true;

    // 判斷目前最高出價
    if (currentBiddingState.currentBid) {
        let curLevel = currentBiddingState.currentBid.level;
        let curSuitRank = suitRanks[currentBiddingState.currentBid.suit];
        let mySuitRank = suitRanks[bestSuit];

        if (curLevel >= 2 && (curLevel > 2 || mySuitRank <= curSuitRank)) {
            // 條件二：如果目前合約已經大於等於 2 線位且壓不過，或超過 2 線位，一律 Pass
            canBid = false;
        } else if (curLevel === 1) {
            if (mySuitRank > curSuitRank) { targetLevel = 1; } 
            else { targetLevel = 2; }
        } else if (curLevel === 2) {
            if (mySuitRank > curSuitRank) { targetLevel = 2; }
            else { canBid = false; }
        }
    }

    if (canBid) {
        currentBiddingState.botHasBidded[botRole] = true; // 標記這局喊過牌了
        submitBid(targetLevel, bestSuit, botRole);
    } else {
        submitBid('Pass', null, botRole);
    }
}

function botPlay(botRole) {
    let botHand = hands[botRole];
    if (botHand.length === 0) return;

    let leadSuit = Object.keys(tableCards).length > 0 ? Object.values(tableCards)[0].s : null;
    let validCards = botHand;

    if (leadSuit && botHand.some(c => c.s === leadSuit)) {
        validCards = botHand.filter(c => c.s === leadSuit);
    }

    let chosenCard = validCards[Math.floor(Math.random() * validCards.length)];
    let cardIndex = botHand.indexOf(chosenCard);

    hands[botRole].splice(cardIndex, 1);
    tableCards[botRole] = { from: botRole, playerName: currentPlayersData[botRole].name, ...chosenCard };
    
    renderTable();
    checkTableFull();
}

// ==========================================
// 喊牌邏輯
// ==========================================
function renderBiddingUI() {
    if (currentBiddingState.status !== "finished") updateContractUI(null);
    const modal = document.getElementById('bidding-modal');
    if (currentBiddingState.status === "finished") {
        modal.classList.add('fly-to-top-left'); updateContractUI(currentBiddingState.contract);
        setTimeout(() => { modal.style.display = "none"; }, 800); return;
    }
    modal.style.display = "block"; modal.classList.remove('fly-to-top-left');

    const historyDiv = document.getElementById('bidding-history');
    
    // --- 🌟 新增：玩家名字轉隊伍顏色的工具 ---
    const getPlayerColor = (name) => {
        if (name.includes("你") || name.includes("南")) return "#5470c6"; // 南家：藍色
        if (name.includes("西")) return "#fbd347"; // 西家：黃色
        if (name.includes("北")) return "#b32e2e"; // 北家：紅色
        if (name.includes("東")) return "#628e46"; // 東家：綠色
        return "white";
    };

    // --- 🌟 新增：把歷史紀錄變成彩色標籤 ---
    let historyHtmlItems = currentBiddingState.history.slice(-4).map(item => {
        // 將 "你: 1♣" 切割成 ["你", "1♣"]
        let parts = item.split(': ');
        let name = parts[0];
        let bid = parts[1];
        let color = getPlayerColor(name);
        
        // 加上顏色與微透黑底框，看起來像小圓角標籤
        return `<span style="color: ${color}; font-size: 1.3rem; font-weight: bold; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 8px;">${bid}</span>`;
    });

    // 組合彩色標籤與箭頭
    let historyText = historyHtmlItems.length > 0 ? historyHtmlItems.join(' <span style="color: #95a5a6; font-size: 1.2rem;">➔</span> ') : "請開始喊牌";
    
    // --- 🌟 新增：目前最高出價也換成彩色標籤 ---
    if (currentBiddingState.currentBid) {
        let maxColor = getPlayerColor(currentBiddingState.currentBid.name);
    }
    historyDiv.innerHTML = historyText;
    historyDiv.style.marginBottom = "25px";

    const isMyTurn = (currentBiddingState.turn === myRole);    
    const container = document.getElementById('bid-buttons-container'); container.innerHTML = "";
    const suits = ['♣', '♦', '♥', '♠', 'NT'];
    
    for (let level = 1; level <= 7; level++) {
        suits.forEach(suit => {
            const btn = document.createElement('button'); btn.className = 'bid-btn';
            btn.innerHTML = `${level}<span style="color:${(suit==='♥'||suit==='♦')?'#e74c3c':'white'}">${suit}</span>`;
            let isDisabled = !isMyTurn;
            if (currentBiddingState.currentBid) {
                const currentLevel = currentBiddingState.currentBid.level;
                const currentSuitRank = suitRanks[currentBiddingState.currentBid.suit];
                if (level < currentLevel || (level === currentLevel && suitRanks[suit] <= currentSuitRank)) isDisabled = true;
            }
            btn.disabled = isDisabled; 
            btn.onclick = () => submitBid(level, suit, myRole); 
            container.appendChild(btn);
        });
    }
    document.getElementById('btn-pass').disabled = !isMyTurn;
}

function submitBid(level, suit, actorRole = myRole) {
    if (currentBiddingState.turn !== actorRole) return;
    
    let actorName = currentPlayersData[actorRole].name;
    let nextRole = roles[(roles.indexOf(actorRole) + 1) % 4];

    if (level === 'Pass') {
        currentBiddingState.history.push(`${actorName}: Pass`);
        currentBiddingState.passCount++;
        
        if (currentBiddingState.currentBid && currentBiddingState.passCount === 3) {
            finishBidding(currentBiddingState.currentBid);
        } else if (!currentBiddingState.currentBid && currentBiddingState.passCount === 4) {
            alert("四家 Pass，重新發牌！"); setupNewDeck();
        } else {
            setTurn(nextRole);
        }
    } else {
        currentBiddingState.history.push(`${actorName}: ${level}${suit}`);
        currentBiddingState.passCount = 0;
        currentBiddingState.currentBid = { level, suit, player: actorRole, name: actorName };
        setTurn(nextRole);
    }
}

function finishBidding(winningBid) {
    const declarer = winningBid.player;
    currentBiddingState.contract = {
        level: winningBid.level, suit: winningBid.suit, declarer: declarer,
        declarerName: winningBid.name, team: (declarer === 'south' || declarer === 'north') ? 'NS' : 'EW',
        targetTricks: winningBid.level + 6
    };
    currentBiddingState.status = "finished";
    
    updateScoreboardUI();
    updatePersonalTrickPiles();
    renderBiddingUI(); 
    
    let firstLead = roles[(roles.indexOf(declarer) + 1) % 4];
    setTurn(firstLead);
}

// ==========================================
// 桌面與打牌邏輯
// ==========================================
function renderTable() {
    // 1. 定義四個方位的容器
    const slots = {
        north: document.getElementById('slot-north'),
        south: document.getElementById('slot-south'),
        west: document.getElementById('slot-west'),
        east: document.getElementById('slot-east')
    };

    // 2. 先清空這四個容器
    Object.values(slots).forEach(slot => {
        if (slot) slot.innerHTML = "";
    });

    if (Object.keys(tableCards).length === 0) return;

    // 3. 找出目前最強的牌 (為了發光特效)
    const cardsArray = Object.values(tableCards);
    const leadSuit = cardsArray[0].s;
    const trumpSuit = (currentBiddingState && currentBiddingState.contract && currentBiddingState.contract.suit !== 'NT') ? currentBiddingState.contract.suit : null;
    const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    
    let bestCard = cardsArray[0];
    cardsArray.forEach(c => {
        let isCurrentTrump = (c.s === trumpSuit);
        let isBestTrump = (bestCard.s === trumpSuit);
        if (isCurrentTrump && !isBestTrump) bestCard = c;
        else if (isCurrentTrump && isBestTrump) { if(vals[c.v] > vals[bestCard.v]) bestCard = c; }
        else if (!isCurrentTrump && !isBestTrump && c.s === leadSuit && bestCard.s === leadSuit) {
            if(vals[c.v] > vals[bestCard.v]) bestCard = c;
        }
    });

    // 4. 將牌渲染到對應的方位槽位
    Object.entries(tableCards).forEach(([role, data]) => {
        const targetSlot = slots[role]; // 這裡會根據 role (north, south...) 找到對應容器
        if (!targetSlot) return;

        const cardDiv = document.createElement('div');
        const isBest = (data.v === bestCard.v && data.s === bestCard.s);
        
        // 使用你的 CSS class
        cardDiv.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
        cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`;
        
        // 🌟 關鍵：把牌加進對應方位的 Slot 裡
        targetSlot.appendChild(cardDiv);
    });
}

function checkTableFull() {
    if (Object.keys(tableCards).length === 4) { 
        setTurn("waiting"); 
        setTimeout(resolveTrick, 2000); 
    } else {
        let nextRole = roles[(roles.indexOf(currentTurnGlobally) + 1) % 4];
        setTurn(nextRole);
    }
}

function resolveTrick() {
    const cardsArray = Object.values(tableCards);
    const leadSuit = cardsArray[0].s; 
    const trumpSuit = currentBiddingState.contract.suit !== 'NT' ? currentBiddingState.contract.suit : null;
    const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    
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
    const myIdx = roles.indexOf(myRole); const posMap = ['bottom', 'left', 'top', 'right'];
    const winnerPos = posMap[(roles.indexOf(winnerRole) - myIdx + 4) % 4];
    const targetRect = document.getElementById(`label-${winnerPos}`).getBoundingClientRect();
    
    document.querySelectorAll('.table-card').forEach(card => {
        card.classList.add('flying'); const r = card.getBoundingClientRect();
        card.style.left = r.left + 'px'; card.style.top = r.top + 'px';
        setTimeout(() => { 
            card.style.left = (targetRect.left + 20) + 'px'; card.style.top = targetRect.top + 'px'; 
            card.style.transform = 'scale(0.1)'; card.style.opacity = '0'; 
        }, 50);
    });
    
    setTimeout(() => {
        const team = (winnerRole === 'south' || winnerRole === 'north') ? 'ns' : 'ew';
        scores[team]++;
        personalScores[winnerRole]++;
        
        tableCards = {}; 
        renderTable();
        updateScoreboardUI();
        updatePersonalTrickPiles();
        checkGameEnd();
        
        if (!gameFinished) setTurn(winnerRole); 
    }, 700);
}

// ==========================================
// 玩家(南家)出牌與渲染
// ==========================================
function renderHand() {
    if (isRendering) return; isRendering = true;
    const container = document.getElementById('my-hand'); container.innerHTML = "";
    
    let myHand = hands[myRole];
    let cardsOnTable = Object.values(tableCards);
    const leadSuit = cardsOnTable.length > 0 ? cardsOnTable[0].s : null;
    const hasLeadSuit = leadSuit ? myHand.some(c => c.s === leadSuit) : false;
    
    myHand.forEach((card, index) => {
        const div = document.createElement('div');
        let isBidding = (!currentBiddingState || currentBiddingState.status !== "finished");
        
        let isWrongSuit = (leadSuit && hasLeadSuit && card.s !== leadSuit);
        let isVisuallyDisabled = (!isBidding && isWrongSuit);
        let isClickDisabled = isBidding || isWrongSuit;
        
        div.className = `card ${(card.s === '♥' || card.s === '♦') ? 'red' : ''} ${isVisuallyDisabled ? 'disabled' : ''} ${index === selectedCardIndex ? 'selected' : ''}`;
        div.style.zIndex = index; div.innerHTML = `${card.v}<span>${card.s}</span>`;
        
        div.onclick = (e) => {
            if (currentTurnGlobally !== myRole || isClickDisabled) return;
            
            if (selectedCardIndex === index) { 
                selectedCardIndex = -1; 
                cardEl = e.currentTarget;
                cardEl.style.opacity = '0';
                hands[myRole].splice(index, 1);
                tableCards[myRole] = { from: myRole, playerName: "你", ...card };
                renderTable();
                checkTableFull();
            } else { 
                selectedCardIndex = index; 
                isRendering = false;
                renderHand(); 
            }
        };
        container.appendChild(div);
    });
    isRendering = false;
}

// ==========================================
// UI 更新與結算
// ==========================================
function updateTurnUI() {
    // 取得現在輪到誰 (防呆檢查)
    let activeRole = (currentBiddingState && currentBiddingState.status !== "finished") ? currentBiddingState.turn : currentTurnGlobally;

    // 1. 先把所有圓點的閃爍狀態拔掉
    ['south', 'north', 'west', 'east'].forEach(role => {
        let dot = document.getElementById(`dot-${role}`);
        if(dot) dot.classList.remove('dot-active');
    });

    // 2. 幫當前輪到的玩家圓點，加上閃爍狀態
    if (activeRole && roles.includes(activeRole)) {
        let activeDot = document.getElementById(`dot-${activeRole}`);
        if(activeDot) activeDot.classList.add('dot-active');
        
        // 桌面上的名字框框一樣保留發光特效
        updateFlameEffect(activeRole); 
    }
}

function updateScoreboardUI() {
    let nsT = "?"; let ewT = "?";
    
    // 如果喊牌結束，計算雙方目標墩數
    if (currentBiddingState && currentBiddingState.status === "finished" && currentBiddingState.contract) {
        const c = currentBiddingState.contract;
        nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
        ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
    }

    // 抓取上方導覽列的兩個文字區塊
    const nsEl = document.getElementById('score-ns-text');
    const ewEl = document.getElementById('score-ew-text');
    
    // 將當前吃到的分數 (scores.ns) 與目標分數 (nsT) 寫入畫面
    if (nsEl) nsEl.innerHTML = `team ${scores.ns || 0}/${nsT}`;
    if (ewEl) ewEl.innerHTML = `team ${scores.ew || 0}/${ewT}`;
}

function updateContractUI(contract) {
    const displayEl = document.getElementById('contract-display');
    
    if (!contract) { 
        displayEl.innerHTML = `喊牌中...`; 
        return; 
    }
    
    // 建立角色與對應的顏色色碼
    const colorHexMap = { 'south': '#5470c6', 'west': '#fbd347', 'north': '#b32e2e', 'east': '#628e46' };
    const cColor = colorHexMap[contract.declarer] || '#333';
    
    // 套用 Final: 加上喊到合約那家的顏色
    displayEl.innerHTML = `Final: <span style="color: ${cColor}; font-size: 1.3rem; font-weight: 900; text-shadow: 1px 1px 0px rgba(255,255,255,0.5); margin-left: 5px;">${contract.level}${contract.suit}</span>`;
}

function updatePersonalTrickPiles() {
    const pos = ['bottom', 'left', 'top', 'right'];
    roles.forEach((r, i) => { 
        const el = document.getElementById(`pile-${pos[(i-roles.indexOf(myRole)+4)%4]}`); 
        if (el) {
            if (currentBiddingState && currentBiddingState.status === "finished") {
                el.style.display = 'flex'; el.innerText = personalScores[r] || 0; 
            } else { el.style.display = 'none'; }
        }
    });
}

function checkGameEnd() {
    if (!currentBiddingState || !currentBiddingState.contract) return;
    const c = currentBiddingState.contract;
    let isGameOver = false;
    
    if (c.team === 'NS') { if (scores.ns >= c.targetTricks || scores.ew >= (14 - c.targetTricks)) isGameOver = true; }
    else { if (scores.ew >= c.targetTricks || scores.ns >= (14 - c.targetTricks)) isGameOver = true; }

    if (scores.ns + scores.ew === 13 || isGameOver) {
        gameFinished = true;
        setTimeout(() => { showVictoryScreen(); }, 1500); 
    }
}

function showVictoryScreen() {
    const c = currentBiddingState.contract;
    let winTeam = (c.team === 'NS') ? (scores.ns >= c.targetTricks ? "NS" : "EW") : (scores.ew >= c.targetTricks ? "EW" : "NS");
    
    document.getElementById('victory-title').innerText = (winTeam === 'NS') ? "🏆 勝利！！" : "💀 失敗";
    document.getElementById('victory-title').style.color = (winTeam === 'NS') ? "var(--premium-gold)" : "#95a5a6";
    document.getElementById('v-ns-line').innerHTML = `南北家(你): <b style="color:white; font-size:1.4rem;">${scores.ns}</b> 墩${c.team==='NS'?' (目標 '+c.targetTricks+' 墩)':''}`;
    document.getElementById('v-ew-line').innerHTML = `東西家(電腦): <b style="color:white; font-size:1.4rem;">${scores.ew}</b> 墩${c.team==='EW'?' (目標 '+c.targetTricks+' 墩)':''}`;
    document.getElementById('victory-team-names').innerText = (winTeam === 'NS') ? "南北家" : "東西家";
    document.getElementById('v-contract').innerText = `${c.level}${c.suit}`;
    
    // 【修改點】隱藏返回大廳按鈕，並置中再來一局
    const btnLobby = document.getElementById('btn-lobby');
    if (btnLobby) btnLobby.style.display = 'none';
    
    const btnAgain = document.getElementById('btn-again');
    if (btnAgain) {
        btnAgain.onclick = setupNewDeck;
        btnAgain.innerText = "再來一局";
        btnAgain.style.width = "100%"; // 讓它填滿寬度看起來更大氣
    }
    
    document.getElementById('victory-overlay').classList.add('show');
}

// --- 工具函式 ---
function sortHand(hand) {
    const suitOrder = {'♠': 4, '♥': 3, '♦': 2, '♣': 1}; const valOrder = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    return hand.sort((a, b) => suitOrder[a.s] !== suitOrder[b.s] ? suitOrder[b.s] - suitOrder[a.s] : valOrder[b.v] - valOrder[a.v]).reverse();
}

function updatePlayerLabels() {
    document.getElementById('label-bottom').innerText = "你 (南)";
    document.getElementById('label-left').innerText = "電腦 (西)";
    document.getElementById('label-top').innerText = "電腦 (北)";
    document.getElementById('label-right').innerText = "電腦 (東)";
}

function updateFlameEffect(t) {
    const pos = ['bottom', 'left', 'top', 'right']; const myIdx = roles.indexOf(myRole);
    pos.forEach(p => document.getElementById(`label-${p}`).classList.remove('active-turn'));
    if(t && roles.includes(t)){
        document.getElementById(`label-${pos[(roles.indexOf(t)-myIdx+4)%4]}`).classList.add('active-turn');
    }
}

// 啟動單機版遊戲
initializeGame();