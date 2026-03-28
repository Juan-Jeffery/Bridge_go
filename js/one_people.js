// ==========================================
// 單機模式控制器 (View & Controller) - one_people.js
// ==========================================

// --- 1. 全域變數與遊戲狀態 ---
const myRole = "south"; 
const roles = ["south", "west", "north", "east"];
const currentPlayersData = {
    south: { name: "你" }, west: { name: "電腦 (西)" }, north: { name: "電腦 (北)" }, east: { name: "電腦 (東)" }
};

let trickHistory = []; 
let hands = { south: [], west: [], north: [], east: [] };
let tableCards = {}; 
let currentBiddingState = null; 
let currentTurnGlobally = "south"; 
let scores = { ns: 0, ew: 0 };
let personalScores = { south: 0, west: 0, north: 0, east: 0 };
let selectedCardIndex = -1;
let isRendering = false;
let gameFinished = false;
let turnTimerInterval = null; 
let isGamePaused = false; 

// --- 2. 遊戲初始化 ---
function initializeGame() {
    document.getElementById('loading').style.display = 'none';
    updatePlayerLabels();
    setupNewDeck();
}

function setupNewDeck() {
    gameFinished = false;
    document.getElementById('victory-overlay').classList.remove('show');
    
    // 呼叫 BRIDGE_RULES 幫忙洗牌與排序
    let deck = BRIDGE_RULES.generateDeck();
    hands = { 
        south: BRIDGE_RULES.sortHand(deck.slice(0, 13)), 
        west: BRIDGE_RULES.sortHand(deck.slice(13, 26)), 
        north: BRIDGE_RULES.sortHand(deck.slice(26, 39)), 
        east: BRIDGE_RULES.sortHand(deck.slice(39, 52)) 
    };
    
    scores = { ns: 0, ew: 0 };
    personalScores = { south: 0, west: 0, north: 0, east: 0 };
    tableCards = {}; trickHistory = [];
    updateScoreboardUI(); updatePersonalTrickPiles();
    
    currentBiddingState = {
        status: "active", turn: "south", currentBid: null, passCount: 0, history: [], contract: null, botHasBidded: { west: false, north: false, east: false } 
    };
    
    setTurn("south");
    renderTable(); updateContractUI(null);
}

// --- 3. 輪次引擎 ---
function setTurn(nextRole) {
    currentTurnGlobally = nextRole;
    if (currentBiddingState.status === "active") { currentBiddingState.turn = nextRole; renderBiddingUI(); }
    updateTurnUI(); renderHand(); 

    if (nextRole !== myRole && nextRole !== "waiting" && !gameFinished) {
        if (currentBiddingState.status === "active") setTimeout(() => botBid(nextRole), 1500);
        else if (currentBiddingState.status === "finished") setTimeout(() => botPlay(nextRole), 1500);
    }
}

// --- 4. 委託 COMPUTER_AI 代打 ---
function botBid(botRole) {
    if (currentBiddingState.botHasBidded[botRole]) { submitBid('Pass', null, botRole); return; }
    
    let bidResult = COMPUTER_AI.getBid(hands[botRole], currentBiddingState.currentBid);
    
    if (bidResult === 'Pass') submitBid('Pass', null, botRole);
    else { currentBiddingState.botHasBidded[botRole] = true; submitBid(bidResult.level, bidResult.suit, botRole); }
}

function botPlay(botRole) {
    let botHand = hands[botRole];
    if (botHand.length === 0) return;

    let chosenCard = COMPUTER_AI.getPlayCard(botHand, tableCards);
    let cardIndex = botHand.indexOf(chosenCard);

    hands[botRole].splice(cardIndex, 1);
    tableCards[botRole] = { from: botRole, playerName: currentPlayersData[botRole].name, ...chosenCard };
    
    renderTable(); checkTableFull();
}

// --- 5. UI 渲染 (已移除色碼，改用 CSS 變數) ---
function renderBiddingUI() {
    if (currentBiddingState.status !== "finished") updateContractUI(null);
    const modal = document.getElementById('bidding-modal');
    
    if (currentBiddingState.status === "finished") {
        modal.classList.add('fly-to-top-left'); updateContractUI(currentBiddingState.contract);
        setTimeout(() => { modal.style.display = "none"; }, 800); return;
    }
    modal.style.display = "block"; modal.classList.remove('fly-to-top-left');

    const historyDiv = document.getElementById('bidding-history');
    
    // 改用 CSS 變數設定顏色
    const getPlayerColor = (name) => {
        if (name.includes("你") || name.includes("南")) return "var(--team-blue)"; 
        if (name.includes("西")) return "var(--team-yellow)"; 
        if (name.includes("北")) return "var(--team-red)"; 
        if (name.includes("東")) return "var(--team-green)"; 
        return "white";
    };

    const bidColorsMap = {};
    currentBiddingState.history.forEach(item => {
        let parts = item.split(': ');
        if (parts.length >= 2 && parts[1] !== "Pass") bidColorsMap[parts[1]] = getPlayerColor(parts[0]);
    });

    let historyHtmlItems = currentBiddingState.history.slice(-3).map(item => {
        let parts = item.split(': '); let color = getPlayerColor(parts[0]);
        return `<span style="color: ${color}; font-size: 1.3rem; font-weight: bold; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 8px;">${parts[1]}</span>`;
    });

    historyDiv.innerHTML = historyHtmlItems.length > 0 ? historyHtmlItems.join(' <span style="color: #95a5a6; font-size: 1.2rem;">➔</span> ') : "請開始喊牌";
    historyDiv.style.marginBottom = "25px";

    const contractDisplay = document.getElementById('contract-display');
    if (currentBiddingState.currentBid) {
        let maxColor = getPlayerColor(currentBiddingState.currentBid.name); 
        let level = currentBiddingState.currentBid.level, suit = currentBiddingState.currentBid.suit;
        contractDisplay.innerHTML = `喊牌中... <span style="color: #ccc; margin: 0 10px; font-weight: 300;">|<span style="color: ${maxColor}; font-weight: bold; font-size: 1.3rem; margin-left: 5px;">${level}${suit}</span>`;
    } else contractDisplay.innerHTML = "喊牌中...";
    
    const isMyTurn = (currentBiddingState.turn === myRole);    
    const container = document.getElementById('bid-buttons-container'); container.innerHTML = "";
    const suits = ['♣', '♦', '♥', '♠', 'NT'];
    
    for (let level = 1; level <= 7; level++) {
        suits.forEach(suit => {
            const btn = document.createElement('button'); btn.className = 'bid-btn';
            const bidStr = `${level}${suit}`; 
            btn.innerHTML = `${level}<span style="color:${(suit==='♥'||suit==='♦')?'#e74c3c':'white'}">${suit}</span>`;
            
            let isDisabled = !isMyTurn;
            if (currentBiddingState.currentBid) {
                const curLevel = currentBiddingState.currentBid.level, curRank = BRIDGE_RULES.suitRanks[currentBiddingState.currentBid.suit];
                if (level < curLevel || (level === curLevel && BRIDGE_RULES.suitRanks[suit] <= curRank)) isDisabled = true;
            }
            btn.disabled = isDisabled; 

            if (bidColorsMap[bidStr]) {
                let playerColor = bidColorsMap[bidStr];
                btn.style.backgroundColor = playerColor; btn.style.filter = "none";
                btn.style.opacity = "0.85"; btn.style.border = "none";
                btn.style.color = (playerColor === "var(--team-yellow)") ? "black" : "white"; 
                btn.innerHTML = `${level}<span style="color:${(playerColor === 'var(--team-yellow)') ? 'black' : 'white'}">${suit}</span>`;
            }

            btn.onclick = () => submitBid(level, suit, myRole); 
            container.appendChild(btn);
        });
    }
    document.getElementById('btn-pass').disabled = !isMyTurn;
}

function submitBid(level, suit, actorRole = myRole) {
    if (currentBiddingState.turn !== actorRole) return;
    let actorName = currentPlayersData[actorRole].name, nextRole = roles[(roles.indexOf(actorRole) + 1) % 4];

    if (level === 'Pass') {
        currentBiddingState.history.push(`${actorName}: Pass`); currentBiddingState.passCount++;
        if (currentBiddingState.currentBid && currentBiddingState.passCount === 3) finishBidding(currentBiddingState.currentBid);
        else if (!currentBiddingState.currentBid && currentBiddingState.passCount === 4) { alert("四家 Pass，重新發牌！"); setupNewDeck(); } 
        else setTurn(nextRole);
    } else {
        currentBiddingState.history.push(`${actorName}: ${level}${suit}`);
        currentBiddingState.passCount = 0;
        currentBiddingState.currentBid = { level, suit, player: actorRole, name: actorName };
        setTurn(nextRole);
    }
}

function finishBidding(winningBid) {
    currentBiddingState.contract = {
        level: winningBid.level, suit: winningBid.suit, declarer: winningBid.player,
        declarerName: winningBid.name, team: (winningBid.player === 'south' || winningBid.player === 'north') ? 'NS' : 'EW', targetTricks: winningBid.level + 6
    };
    currentBiddingState.status = "finished";
    updateScoreboardUI(); updatePersonalTrickPiles(); renderBiddingUI(); 
    setTurn(roles[(roles.indexOf(winningBid.player) + 1) % 4]);
}

// --- 6. 桌面渲染與出牌邏輯 ---
function renderHand() {
    if (isRendering) return; isRendering = true;
    const container = document.getElementById('my-hand'); container.innerHTML = "";
    
    let myHand = hands[myRole], cardsOnTable = Object.values(tableCards);
    const leadSuit = cardsOnTable.length > 0 ? cardsOnTable[0].s : null;
    const hasLeadSuit = leadSuit ? myHand.some(c => c.s === leadSuit) : false;
    
    let factor = Math.max(0.2, myHand.length / 13);
    container.style.setProperty('--card-count-factor', factor);

    let previousSuit = null; 

    myHand.forEach((card, index) => {
        const div = document.createElement('div');
        let isBidding = (!currentBiddingState || currentBiddingState.status !== "finished");
        let isWrongSuit = (leadSuit && hasLeadSuit && card.s !== leadSuit);
        let isVisuallyDisabled = (!isBidding && isWrongSuit), isClickDisabled = isBidding || isWrongSuit;
        let isSuitChange = (previousSuit && previousSuit !== card.s);
        previousSuit = card.s; 
        
        div.className = `card ${(card.s === '♥' || card.s === '♦') ? 'red' : ''} ${isVisuallyDisabled ? 'disabled' : ''} ${index === selectedCardIndex ? 'selected' : ''} ${isSuitChange ? 'suit-gap' : ''}`;
        div.style.zIndex = index; div.innerHTML = `${card.v}<span>${card.s}</span>`;
        
        div.onclick = (e) => {
            e.stopPropagation();
            if (currentTurnGlobally !== myRole || isClickDisabled) return;
            
            if (selectedCardIndex === index) { 
                selectedCardIndex = -1; 
                let playedCard = hands[myRole].splice(index, 1)[0]; 
                tableCards[myRole] = { from: myRole, playerName: "你", ...playedCard };
                isRendering = false; renderHand(); renderTable(); checkTableFull(); 
            } else { selectedCardIndex = index; isRendering = false; renderHand(); }
        };
        container.appendChild(div);
    });
    isRendering = false;
}

function renderTable() {
    const slots = { north: document.getElementById('slot-north'), south: document.getElementById('slot-south'), west: document.getElementById('slot-west'), east: document.getElementById('slot-east') };
    if (Object.keys(tableCards).length === 0) { Object.values(slots).forEach(slot => { if (slot) slot.innerHTML = ""; }); return; }

    const cardsArray = Object.values(tableCards);
    const trumpSuit = (currentBiddingState && currentBiddingState.contract && currentBiddingState.contract.suit !== 'NT') ? currentBiddingState.contract.suit : null;
    
    // 呼叫 BRIDGE_RULES 幫忙找最大的牌
    let bestCard = BRIDGE_RULES.getTrickWinner(cardsArray, trumpSuit);

    Object.entries(tableCards).forEach(([role, data]) => {
        const targetSlot = slots[role]; if (!targetSlot) return;
        const isBest = (data.v === bestCard.v && data.s === bestCard.s);
        let existingCard = targetSlot.querySelector('.table-card');

        if (!existingCard) {
            const cardDiv = document.createElement('div');
            cardDiv.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
            cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`; targetSlot.appendChild(cardDiv);
        } else existingCard.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
    });
}

function checkTableFull() {
    if (Object.keys(tableCards).length === 4) { setTurn("waiting"); setTimeout(resolveTrick, 2000); } 
    else setTurn(roles[(roles.indexOf(currentTurnGlobally) + 1) % 4]);
}

function resolveTrick() {
    const cardsArray = Object.values(tableCards);
    const trumpSuit = currentBiddingState.contract.suit !== 'NT' ? currentBiddingState.contract.suit : null;
    
    // 呼叫 BRIDGE_RULES 幫忙找贏家
    let winner = BRIDGE_RULES.getTrickWinner(cardsArray, trumpSuit);

    trickHistory.push({
        winnerRole: winner.from,
        cards: cardsArray.map(c => ({ role: c.from, suit: c.s, val: c.v }))
    });
    
    playTrickAnimation(winner.from);
}

function playTrickAnimation(winnerRole) {
    const phantomCards = [], myIdx = roles.indexOf(myRole), posMap = ['bottom', 'left', 'top', 'right'];
    const winnerPos = posMap[(roles.indexOf(winnerRole) - myIdx + 4) % 4];
    const winnerLabel = document.getElementById(`label-${winnerPos}`); 
    if (!winnerLabel) return;
    const destRect = winnerLabel.getBoundingClientRect();

    roles.forEach(role => {
        const slot = document.getElementById(`slot-${role}`), cardEl = slot ? slot.querySelector('.table-card') : null;
        if (cardEl) {
            const startRect = cardEl.getBoundingClientRect(), flyingCard = cardEl.cloneNode(true);
            flyingCard.classList.remove('table-card', 'best-card'); flyingCard.classList.add('flying');
            flyingCard.style.left = startRect.left + 'px'; flyingCard.style.top = startRect.top + 'px';
            flyingCard.style.width = startRect.width + 'px'; flyingCard.style.height = startRect.height + 'px';
            flyingCard.style.margin = '0';
            flyingCard.style.setProperty('z-index', (role === winnerRole) ? '10000' : '9998', 'important');
            cardEl.style.visibility = 'hidden'; phantomCards.push({ role: role, el: flyingCard, startRect: startRect });
        }
    });

    phantomCards.forEach(pc => { if (pc.role !== winnerRole) document.body.appendChild(pc.el); });
    phantomCards.forEach(pc => { if (pc.role === winnerRole) document.body.appendChild(pc.el); });

    const cx = window.innerWidth / 2 - phantomCards[0].startRect.width / 2;
    const cy = window.innerHeight / 2 - phantomCards[0].startRect.height / 2;

    phantomCards.forEach(pc => {
        if (pc.role === winnerRole) requestAnimationFrame(() => {
            pc.el.style.left = cx + 'px'; pc.el.style.top = cy + 'px';
            pc.el.style.transform = 'scale(1.5)'; pc.el.style.boxShadow = '0 20px 50px rgba(212, 175, 55, 0.6)';
        });
    });

    setTimeout(() => {
        phantomCards.forEach(pc => {
            if (pc.role !== winnerRole) { pc.el.style.left = cx + 'px'; pc.el.style.top = cy + 'px'; pc.el.style.transform = 'scale(1)'; }
        });
    }, 300); 

    setTimeout(() => {
        phantomCards.forEach(pc => {
            pc.el.style.left = (destRect.left + destRect.width/2 - phantomCards[0].startRect.width/2) + 'px';
            pc.el.style.top = (destRect.top + destRect.height/2 - phantomCards[0].startRect.height/2) + 'px';
            pc.el.style.transform = 'scale(0.2) rotate(15deg)'; pc.el.style.opacity = '0'; pc.el.style.boxShadow = 'none';
        });
    }, 800); 

    setTimeout(() => {
        phantomCards.forEach(pc => pc.el.remove()); 
        const team = (winnerRole === 'south' || winnerRole === 'north') ? 'ns' : 'ew';
        scores[team]++; personalScores[winnerRole]++;
        tableCards = {}; renderTable(); updateScoreboardUI(); updatePersonalTrickPiles(); checkGameEnd();
        if (!gameFinished) setTurn(winnerRole); 
    }, 1400); 
}

// --- 7. UI 更新與輔助工具 ---
function updateTurnUI() {
    let activeRole = (currentBiddingState && currentBiddingState.status !== "finished") ? currentBiddingState.turn : currentTurnGlobally;
    ['south', 'north', 'west', 'east'].forEach(role => {
        let dot = document.getElementById(`dot-${role}`);
        if(dot) dot.classList.remove('dot-active');
    });

    if (activeRole && roles.includes(activeRole)) {
        let activeDot = document.getElementById(`dot-${activeRole}`);
        if(activeDot) activeDot.classList.add('dot-active');
        updateFlameEffect(activeRole); 
        startBurnLine(activeRole);
    } else { startBurnLine('waiting'); }
}

let timeElapsed = 0; const TURN_DURATION = 20000; 

function startBurnLine(role) {
    clearInterval(turnTimerInterval);
    document.querySelectorAll('.dot').forEach(d => { d.style.removeProperty('--burn-pct'); d.classList.remove('burning'); });

    if (role === 'waiting' || gameFinished) return;
    let dot = document.getElementById(`dot-${role}`); if (!dot) return;
    
    dot.classList.add('burning'); timeElapsed = 0;

    turnTimerInterval = setInterval(() => {
        if (isGamePaused) return; 
        timeElapsed += 50; let pct = (timeElapsed / TURN_DURATION) * 100;
        dot.style.setProperty('--burn-pct', `${pct}%`);

        if (timeElapsed >= TURN_DURATION) {
            clearInterval(turnTimerInterval);
            dot.style.removeProperty('--burn-pct'); dot.classList.remove('burning');
            if (role === myRole && currentTurnGlobally === myRole) handlePlayerTimeout();
        }
    }, 50); 
}

function handlePlayerTimeout() {
    if (currentBiddingState.status === "active") submitBid('Pass', null, myRole);
    else if (currentBiddingState.status === "finished") {
        let myHand = hands[myRole];
        if (myHand.length === 0) return;
        
        let chosenCard = COMPUTER_AI.getPlayCard(myHand, tableCards);
        let cardIndex = myHand.indexOf(chosenCard);
        selectedCardIndex = -1; 
        let playedCard = hands[myRole].splice(cardIndex, 1)[0]; 
        tableCards[myRole] = { from: myRole, playerName: "你", ...playedCard };
        
        isRendering = false; renderHand(); renderTable(); checkTableFull();  
    }
}

function updateScoreboardUI() {
    let nsT = "?", ewT = "?";
    if (currentBiddingState && currentBiddingState.status === "finished" && currentBiddingState.contract) {
        const c = currentBiddingState.contract;
        nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
        ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
    }
    const nsEl = document.getElementById('score-ns-text'), ewEl = document.getElementById('score-ew-text');
    if (nsEl) nsEl.innerHTML = ` ${scores.ns || 0}/${nsT}`;
    if (ewEl) ewEl.innerHTML = ` ${scores.ew || 0}/${ewT}`;
}

function updateContractUI(contract) {
    const displayEl = document.getElementById('contract-display');
    if (!contract) return; 
    const colorHexMap = { 'south': 'var(--team-blue)', 'west': 'var(--team-yellow)', 'north': 'var(--team-red)', 'east': 'var(--team-green)' };
    const cColor = colorHexMap[contract.declarer] || '#333';
    displayEl.innerHTML = `<span style="color: ${cColor}; font-size: 1.3rem; font-weight: 900; text-shadow: 1px 1px 0px rgba(255,255,255,0.5); margin-left: 5px;">${contract.level}${contract.suit}</span>`;
}

function updatePersonalTrickPiles() {
    const pos = ['bottom', 'left', 'top', 'right'];
    roles.forEach((r, i) => { 
        const el = document.getElementById(`pile-${pos[(i-roles.indexOf(myRole)+4)%4]}`); 
        if (el) {
            if (currentBiddingState && currentBiddingState.status === "finished") { el.style.display = 'flex'; el.innerText = personalScores[r] || 0; } 
            else el.style.display = 'none'; 
        }
    });
}

function updatePlayerLabels() {
    document.getElementById('label-bottom').innerText = "你 (南)"; document.getElementById('label-left').innerText = "電腦 (西)";
    document.getElementById('label-top').innerText = "電腦 (北)"; document.getElementById('label-right').innerText = "電腦 (東)";
}

function updateFlameEffect(t) {
    const pos = ['bottom', 'left', 'top', 'right'], myIdx = roles.indexOf(myRole);
    pos.forEach(p => document.getElementById(`label-${p}`).classList.remove('active-turn'));
    if(t && roles.includes(t)) document.getElementById(`label-${pos[(roles.indexOf(t)-myIdx+4)%4]}`).classList.add('active-turn');
}

// --- 8. 結算畫面 ---
function checkGameEnd() {
    if (!currentBiddingState || !currentBiddingState.contract) return;
    const c = currentBiddingState.contract; let isGameOver = false;
    
    if (c.team === 'NS') { if (scores.ns >= c.targetTricks || scores.ew >= (14 - c.targetTricks)) isGameOver = true; }
    else { if (scores.ew >= c.targetTricks || scores.ns >= (14 - c.targetTricks)) isGameOver = true; }

    if (scores.ns + scores.ew === 13 || isGameOver) {
        gameFinished = true; setTimeout(() => { showVictoryScreen(); }, 1500); 
    }
}

function showVictoryScreen() {
    const c = currentBiddingState.contract;
    let winTeam = (c.team === 'NS') ? (scores.ns >= c.targetTricks ? "NS" : "EW") : (scores.ew >= c.targetTricks ? "EW" : "NS");
    
    let titleEl = document.getElementById('victory-title');
    titleEl.innerText = (winTeam === 'NS') ? "Victory" : "Defeat";
    titleEl.style.color = (winTeam === 'NS') ? "#fbd347" : "#95a5a6"; 
    
    let nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
    let ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
    
    document.getElementById('v-score-ns-text').innerText = `${scores.ns || 0}/${nsT}`;
    document.getElementById('v-score-ew-text').innerText = `${scores.ew || 0}/${ewT}`;
    
    const btnAgain = document.getElementById('btn-again');
    if (btnAgain) { btnAgain.onclick = setupNewDeck; btnAgain.innerText = "再來一場"; }
    renderTrickReview(); 
    document.getElementById('victory-overlay').classList.add('show');
}

function renderTrickReview() {
    const container = document.getElementById('review-scrollarea');
    if (!container) return; container.innerHTML = ""; 

    trickHistory.forEach((trick, index) => {
        const row = document.createElement('div'); row.className = 'v-trick-row';
        row.innerHTML = `<span class="v-trick-label">T${index + 1}</span>`;
        
        const cardsDiv = document.createElement('div'); cardsDiv.className = 'v-trick-cards';
        trick.cards.forEach(c => {
            const isWinner = (c.role === trick.winnerRole) ? 'winner-card' : '';
            const colorClass = (c.suit === '♥' || c.suit === '♦') ? 'red' : '';
            cardsDiv.innerHTML += `<div class="mini-card border-${c.role} ${isWinner}">${c.val}<span class="${colorClass}">${c.suit}</span></div>`;
        });
        row.appendChild(cardsDiv); container.appendChild(row);
    });
}

// --- 9. 事件監聽與啟動 ---
document.addEventListener('click', () => { if (selectedCardIndex !== -1) { selectedCardIndex = -1; renderHand(); } });

const btnRules = document.getElementById('btn-rules'), rulesModal = document.getElementById('rules-overlay');
const showRules = (e) => { e.preventDefault(); isGamePaused = true; rulesModal.style.display = 'block'; };
const hideRules = (e) => { e.preventDefault(); isGamePaused = false; rulesModal.style.display = 'none'; };

if (btnRules) {
    btnRules.addEventListener('mouseenter', showRules); btnRules.addEventListener('mouseleave', hideRules);
    btnRules.addEventListener('touchstart', showRules, { passive: false });
    btnRules.addEventListener('touchend', hideRules); btnRules.addEventListener('touchcancel', hideRules);
}

// 🚀 啟動單機版遊戲
initializeGame();