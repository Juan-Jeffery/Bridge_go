// ==========================================
// 橋牌單人模式 - 核心邏輯腳本 (專業競技優化版)
// ==========================================

// --- 1. 全域變數與遊戲狀態 ---
const myRole = "south"; 
const roles = ["south", "west", "north", "east"];
const currentPlayersData = {
    south: { name: "你" },
    west: { name: "電腦 (西)" },
    north: { name: "電腦 (北)" },
    east: { name: "電腦 (東)" }
};

let hands = { south: [], west: [], north: [], east: [] };
let tableCards = {}; // 記錄桌面上打出的牌
let currentBiddingState = null; 
let currentTurnGlobally = "south"; 
let scores = { ns: 0, ew: 0 };
let personalScores = { south: 0, west: 0, north: 0, east: 0 };
let selectedCardIndex = -1;
let isRendering = false;
let gameFinished = false;

// --- 2. 遊戲初始化與洗牌 ---
function initializeGame() {
    document.getElementById('loading').style.display = 'none';
    updatePlayerLabels();
    setupNewDeck();
}

function setupNewDeck() {
    gameFinished = false;
    document.getElementById('victory-overlay').classList.remove('show');
    
    // 生成撲克牌並洗牌
    const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = []; 
    suits.forEach(s => values.forEach(v => deck.push({s, v})));
    deck.sort(() => Math.random() - 0.5);
    
    // 發牌並排序
    hands = { 
        south: sortHand(deck.slice(0, 13)), 
        west: sortHand(deck.slice(13, 26)), 
        north: sortHand(deck.slice(26, 39)), 
        east: sortHand(deck.slice(39, 52)) 
    };
    
    // 重置所有分數與狀態
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

// --- 3. 輪次控制引擎 ---
function setTurn(nextRole) {
    currentTurnGlobally = nextRole;
    
    if (currentBiddingState.status === "active") {
        currentBiddingState.turn = nextRole;
        renderBiddingUI();
    }
    
    updateTurnUI();
    renderHand(); 

    // 觸發電腦行動
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
    let suitCounts = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
    botHand.forEach(card => suitCounts[card.s]++);
    
    // 找出最多的花色
    let bestSuit = '♣', maxCount = 0;
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
            canBid = false; // 合約太大壓不過，Pass
        } else if (curLevel === 1) {
            targetLevel = (mySuitRank > curSuitRank) ? 1 : 2;
        } else if (curLevel === 2) {
            if (mySuitRank > curSuitRank) targetLevel = 2;
            else canBid = false;
        }
    }

    if (canBid) {
        currentBiddingState.botHasBidded[botRole] = true;
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

    // 必須跟隨引牌花色
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
// 📢 喊牌系統 UI 與邏輯
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
    
    // 玩家名字轉隊伍顏色
    const getPlayerColor = (name) => {
        if (name.includes("你") || name.includes("南")) return "#5470c6"; 
        if (name.includes("西")) return "#fbd347"; 
        if (name.includes("北")) return "#b32e2e"; 
        if (name.includes("東")) return "#628e46"; 
        return "white";
    };

    // 建立大富翁地盤顏色表
    const bidColorsMap = {};
    currentBiddingState.history.forEach(item => {
        let parts = item.split(': ');
        if (parts.length >= 2 && parts[1] !== "Pass") {
            bidColorsMap[parts[1]] = getPlayerColor(parts[0]);
        }
    });

    // 渲染上方歷史紀錄 (只取最後 3 個，超過自動消失)
    let historyHtmlItems = currentBiddingState.history.slice(-3).map(item => {
        let parts = item.split(': ');
        let color = getPlayerColor(parts[0]);
        return `<span style="color: ${color}; font-size: 1.3rem; font-weight: bold; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 8px;">${parts[1]}</span>`;
    });

    let historyText = historyHtmlItems.length > 0 ? historyHtmlItems.join(' <span style="color: #95a5a6; font-size: 1.2rem;">➔</span> ') : "請開始喊牌";
    historyDiv.innerHTML = historyText;
    historyDiv.style.marginBottom = "25px";

    // 更新左上角最高出價 (無框純文字 + 玩家專屬顏色)
    const contractDisplay = document.getElementById('contract-display');
    if (currentBiddingState.currentBid) {
        let maxColor = getPlayerColor(currentBiddingState.currentBid.name); 
        let level = currentBiddingState.currentBid.level;
        let suit = currentBiddingState.currentBid.suit;
        contractDisplay.innerHTML = `喊牌中... <span style="color: #ccc; margin: 0 10px; font-weight: 300;">|<span style="color: ${maxColor}; font-weight: bold; font-size: 1.3rem; margin-left: 5px;">${level}${suit}</span>`;
    } else {
        contractDisplay.innerHTML = "喊牌中...";
    }
    
    // 生成 35 顆喊牌按鈕
    const isMyTurn = (currentBiddingState.turn === myRole);    
    const container = document.getElementById('bid-buttons-container'); container.innerHTML = "";
    const suits = ['♣', '♦', '♥', '♠', 'NT'];
    
    for (let level = 1; level <= 7; level++) {
        suits.forEach(suit => {
            const btn = document.createElement('button'); btn.className = 'bid-btn';
            const bidStr = `${level}${suit}`; 
            
            btn.innerHTML = `${level}<span style="color:${(suit==='♥'||suit==='♦')?'#e74c3c':'white'}">${suit}</span>`;
            
            // 判斷是否鎖定
            let isDisabled = !isMyTurn;
            if (currentBiddingState.currentBid) {
                const currentLevel = currentBiddingState.currentBid.level;
                const currentSuitRank = suitRanks[currentBiddingState.currentBid.suit];
                if (level < currentLevel || (level === currentLevel && suitRanks[suit] <= currentSuitRank)) isDisabled = true;
            }
            btn.disabled = isDisabled; 

            // 如果被喊過，佔領地盤上色 (解除灰階濾鏡)
            if (bidColorsMap[bidStr]) {
                let playerColor = bidColorsMap[bidStr];
                btn.style.backgroundColor = playerColor;
                btn.style.filter = "none";
                btn.style.opacity = "0.85"; 
                btn.style.border = "none";
                btn.style.color = (playerColor === "#fbd347") ? "black" : "white"; 
                btn.innerHTML = `${level}<span style="color:${(playerColor === '#fbd347') ? 'black' : 'white'}">${suit}</span>`;
            }

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
// 🃏 出牌桌面與打牌邏輯 (新增：花色間隙與動態寬度)
// ==========================================
function renderHand() {
    if (isRendering) return; isRendering = true;
    const container = document.getElementById('my-hand'); container.innerHTML = "";
    
    let myHand = hands[myRole];
    let cardsOnTable = Object.values(tableCards);
    const leadSuit = cardsOnTable.length > 0 ? cardsOnTable[0].s : null;
    const hasLeadSuit = leadSuit ? myHand.some(c => c.s === leadSuit) : false;
    
    // 🌟 核心 1：計算手牌擁擠比例。13張=1.0，越少越鬆散，最寬鬆限制在 0.2
    let factor = Math.max(0.2, myHand.length / 13);
    container.style.setProperty('--card-count-factor', factor);

    let previousSuit = null; // 用來記錄上一張牌的花色

    myHand.forEach((card, index) => {
        const div = document.createElement('div');
        let isBidding = (!currentBiddingState || currentBiddingState.status !== "finished");
        let isWrongSuit = (leadSuit && hasLeadSuit && card.s !== leadSuit);
        let isVisuallyDisabled = (!isBidding && isWrongSuit);
        let isClickDisabled = isBidding || isWrongSuit;
        
        // 🌟 核心 2：判斷是否跟上一張牌花色不同 (換花色了)
        let isSuitChange = (previousSuit && previousSuit !== card.s);
        previousSuit = card.s; // 記錄當下這張牌的花色給下一張用
        
        // 加上 suit-gap 標籤
        div.className = `card ${(card.s === '♥' || card.s === '♦') ? 'red' : ''} ${isVisuallyDisabled ? 'disabled' : ''} ${index === selectedCardIndex ? 'selected' : ''} ${isSuitChange ? 'suit-gap' : ''}`;
        
        div.style.zIndex = index; 
        div.innerHTML = `${card.v}<span>${card.s}</span>`;
        
        div.onclick = (e) => {
            e.stopPropagation();
            
            if (currentTurnGlobally !== myRole || isClickDisabled) return;
            
            if (selectedCardIndex === index) { 
                selectedCardIndex = -1; 
                let playedCard = hands[myRole].splice(index, 1)[0]; 
                tableCards[myRole] = { from: myRole, playerName: "你", ...playedCard };
                isRendering = false;
                renderHand(); 
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

function renderTable() {
    // 取得四個專屬槽位
    const slots = {
        north: document.getElementById('slot-north'),
        south: document.getElementById('slot-south'),
        west: document.getElementById('slot-west'),
        east: document.getElementById('slot-east')
    };

    // 🌟 修改 1：只有在「桌上完全沒牌」時(例如收牌後)，才清空槽位
    if (Object.keys(tableCards).length === 0) {
        Object.values(slots).forEach(slot => { if (slot) slot.innerHTML = ""; });
        return;
    }

    // 找出最強的牌 (判斷發光)
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

    // 🌟 修改 2：智慧渲染卡片到對應槽位 (解決抖動的核心)
    Object.entries(tableCards).forEach(([role, data]) => {
        const targetSlot = slots[role]; 
        if (!targetSlot) return;

        const isBest = (data.v === bestCard.v && data.s === bestCard.s);
        
        // 檢查這個槽位是不是已經有牌了
        let existingCard = targetSlot.querySelector('.table-card');

        if (!existingCard) {
            // 👉 如果槽位是空的：這是一張「剛打出來的新牌」，建立它並觸發掉落動畫
            const cardDiv = document.createElement('div');
            cardDiv.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
            cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`;
            targetSlot.appendChild(cardDiv);
        } else {
            // 👉 如果槽位已經有牌了：它是一張「舊牌」，我們只更新 CSS 讓它發光或熄滅
            // 絕對不破壞它的 HTML 結構，這樣 CSS 動畫就不會重新觸發！
            existingCard.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
        }
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

// ==========================================
// 🚀 特效與動畫 (霸氣吃墩結算版)
// ==========================================
function playTrickAnimation(winnerRole) {
    const phantomCards = [];
    const myIdx = roles.indexOf(myRole);
    const posMap = ['bottom', 'left', 'top', 'right'];
    const winnerPos = posMap[(roles.indexOf(winnerRole) - myIdx + 4) % 4];
    
    // 目標：贏家的名字框 (計牌區)
    const winnerLabel = document.getElementById(`label-${winnerPos}`); 
    if (!winnerLabel) return;
    const destRect = winnerLabel.getBoundingClientRect();

    // 1. 收集四個方位的牌並製作「幻影牌」
    roles.forEach(role => {
        const slot = document.getElementById(`slot-${role}`);
        const cardEl = slot ? slot.querySelector('.table-card') : null;
        
        if (cardEl) {
            const startRect = cardEl.getBoundingClientRect();
            const flyingCard = cardEl.cloneNode(true);
            
            flyingCard.classList.remove('table-card', 'best-card');
            flyingCard.classList.add('flying');
            
            // 鎖定初始絕對座標
            flyingCard.style.left = startRect.left + 'px';
            flyingCard.style.top = startRect.top + 'px';
            flyingCard.style.width = startRect.width + 'px';
            flyingCard.style.height = startRect.height + 'px';
            flyingCard.style.margin = '0';
            
            // 🌟 關鍵修復 1：用 setProperty 強制掛上 !important，蓋過 CSS 的設定
            flyingCard.style.setProperty('z-index', (role === winnerRole) ? '10000' : '9998', 'important');

            cardEl.style.visibility = 'hidden'; // 隱藏原本桌上的牌
            phantomCards.push({ role: role, el: flyingCard, startRect: startRect });
        }
    });

    // 🌟 關鍵修復 2：調整加入網頁的順序，確保贏家的牌「最後」加入 (物理層面絕對在最上層)
    phantomCards.forEach(pc => { if (pc.role !== winnerRole) document.body.appendChild(pc.el); });
    phantomCards.forEach(pc => { if (pc.role === winnerRole) document.body.appendChild(pc.el); });

    // 計算螢幕正中央的座標
    const centerLeft = window.innerWidth / 2;
    const centerTop = window.innerHeight / 2;
    const cardWidth = phantomCards[0].startRect.width;
    const cardHeight = phantomCards[0].startRect.height;
    const exactCenterLeft = centerLeft - cardWidth / 2;
    const exactCenterTop = centerTop - cardHeight / 2;

    // 🎬 動畫第一階段 (0ms)：最大那張牌飛到正中央，並且放大「重擊」桌面！
    phantomCards.forEach(pc => {
        if (pc.role === winnerRole) {
            requestAnimationFrame(() => {
                pc.el.style.left = exactCenterLeft + 'px';
                pc.el.style.top = exactCenterTop + 'px';
                pc.el.style.transform = 'scale(1.5)'; // 放大 1.5 倍
                pc.el.style.boxShadow = '0 20px 50px rgba(212, 175, 55, 0.6)'; // 加上金色霸氣陰影
            });
        }
    });

    // 🎬 動畫第二階段 (300ms)：其他三張敗將的牌，乖乖收到最大那張牌的「底下」
    setTimeout(() => {
        phantomCards.forEach(pc => {
            if (pc.role !== winnerRole) {
                pc.el.style.left = exactCenterLeft + 'px';
                pc.el.style.top = exactCenterTop + 'px';
                pc.el.style.transform = 'scale(1)'; // 維持正常大小
            }
        });
    }, 300); 

    // 🎬 動畫第三階段 (800ms)：整疊牌一起縮小，飛向贏家的計牌器
    setTimeout(() => {
        phantomCards.forEach(pc => {
            pc.el.style.left = (destRect.left + destRect.width/2 - cardWidth/2) + 'px';
            pc.el.style.top = (destRect.top + destRect.height/2 - cardHeight/2) + 'px';
            pc.el.style.transform = 'scale(0.2) rotate(15deg)'; 
            pc.el.style.opacity = '0';
            pc.el.style.boxShadow = 'none';
        });
    }, 800); 

    // 🎬 動畫第四階段 (1400ms)：清理幻影牌、更新分數、換下一回合
    setTimeout(() => {
        phantomCards.forEach(pc => pc.el.remove()); // 刪除特效 DOM
        
        const team = (winnerRole === 'south' || winnerRole === 'north') ? 'ns' : 'ew';
        scores[team]++;
        personalScores[winnerRole]++;
        
        tableCards = {}; 
        renderTable();
        updateScoreboardUI();
        updatePersonalTrickPiles();
        checkGameEnd();
        
        if (!gameFinished) setTurn(winnerRole); 
    }, 1400); 
}

// ==========================================
// 🎨 UI 狀態更新器
// ==========================================
function updateTurnUI() {
    let activeRole = (currentBiddingState && currentBiddingState.status !== "finished") ? currentBiddingState.turn : currentTurnGlobally;

    // 清除所有閃爍
    ['south', 'north', 'west', 'east'].forEach(role => {
        let dot = document.getElementById(`dot-${role}`);
        if(dot) dot.classList.remove('dot-active');
    });

    // 為當前玩家加上閃爍
    if (activeRole && roles.includes(activeRole)) {
        let activeDot = document.getElementById(`dot-${activeRole}`);
        if(activeDot) activeDot.classList.add('dot-active');
        updateFlameEffect(activeRole); 
    }
}

function updateScoreboardUI() {
    let nsT = "?"; let ewT = "?";
    
    if (currentBiddingState && currentBiddingState.status === "finished" && currentBiddingState.contract) {
        const c = currentBiddingState.contract;
        nsT = c.team === 'NS' ? c.targetTricks : 14 - c.targetTricks;
        ewT = c.team === 'EW' ? c.targetTricks : 14 - c.targetTricks;
    }

    const nsEl = document.getElementById('score-ns-text');
    const ewEl = document.getElementById('score-ew-text');
    
    if (nsEl) nsEl.innerHTML = ` ${scores.ns || 0}/${nsT}`;
    if (ewEl) ewEl.innerHTML = ` ${scores.ew || 0}/${ewT}`;
}

function updateContractUI(contract) {
    const displayEl = document.getElementById('contract-display');
    if (!contract) return; 
    
    const colorHexMap = { 'south': '#5470c6', 'west': '#fbd347', 'north': '#b32e2e', 'east': '#628e46' };
    const cColor = colorHexMap[contract.declarer] || '#333';
    
    displayEl.innerHTML = `<span style="color: ${cColor}; font-size: 1.3rem; font-weight: 900; text-shadow: 1px 1px 0px rgba(255,255,255,0.5); margin-left: 5px;">${contract.level}${contract.suit}</span>`;
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

// ==========================================
// 🏆 遊戲結算與工具
// ==========================================
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
    
    const btnLobby = document.getElementById('btn-lobby');
    if (btnLobby) btnLobby.style.display = 'none';
    
    const btnAgain = document.getElementById('btn-again');
    if (btnAgain) {
        btnAgain.onclick = setupNewDeck;
        btnAgain.innerText = "再來一局";
        btnAgain.style.width = "100%"; 
    }
    
    document.getElementById('victory-overlay').classList.add('show');
}

function sortHand(hand) {
    const suitOrder = {'♠': 4, '♥': 3, '♦': 2, '♣': 1}; 
    const valOrder = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    return hand.sort((a, b) => suitOrder[a.s] !== suitOrder[b.s] ? suitOrder[b.s] - suitOrder[a.s] : valOrder[b.v] - valOrder[a.v]).reverse();
}

// ==========================================
// 🌟 玩家互動體驗優化：點擊背景取消選牌
// ==========================================
document.addEventListener('click', () => {
    // 如果目前有選取任何牌 (升起狀態)，就把選取狀態清空並重新渲染手牌
    if (selectedCardIndex !== -1) {
        selectedCardIndex = -1;
        renderHand();
    }
});

// 🚀 啟動單機版遊戲
initializeGame();