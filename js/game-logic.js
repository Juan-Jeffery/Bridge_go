// 檔案路徑：js/game-logic.js

const urlParams = new URLSearchParams(window.location.search);
const myLocalName = urlParams.get('pname'); 
const roomId = urlParams.get('rid') || "Room_Alpha";

// database 變數由 firebase-config.js 提供
const playersRef = database.ref('players/' + roomId);
const gameRef = database.ref('games/' + roomId);

let myRole = ""; 
let currentPlayersData = {}; 
let isRendering = false;

window.onbeforeunload = function() { if (myRole) { playersRef.child(myRole).remove(); } };

function initializeGame() {
    if (!myLocalName) { window.location.href = "lobby.html"; return; }
    database.ref().on('value', (snap) => {
        const all = snap.val() || {};
        const pList = (all.players && all.players[roomId]) ? all.players[roomId] : {};
        const gStatus = (all.games && all.games[roomId]) ? all.games[roomId] : {};
        if (gStatus.gameStarted !== true || Object.keys(pList).length === 0) return; 
        myRole = Object.keys(pList).find(k => pList[k] && pList[k].name === myLocalName);
        if (myRole) {
            database.ref().off('value'); 
            document.getElementById('loading').style.display = 'none';
            document.getElementById('my-name-display').innerText = myLocalName;
            startListening(roomId);
            if (myRole === "south") { gameRef.child('hands').get().then(h => { if (!h.exists()) setupNewDeck(); }); }
        }
    });
}

function startListening(rid) {
    playersRef.get().then(snap => { currentPlayersData = snap.val() || {}; updateScoreboardUI({ ns: 0, ew: 0 }); });
    playersRef.on('value', snap => {
        currentPlayersData = snap.val() || {}; updatePlayerLabels(currentPlayersData);
    });
    gameRef.child('scores').on('value', snap => { updateScoreboardUI(snap.val() || { ns: 0, ew: 0 }); });
    gameRef.child('personalScores').on('value', snap => { updatePersonalTrickPiles(snap.val() || {}); });
    gameRef.child('hands/' + myRole).on('value', snap => { if (snap.val()) renderHand(snap.val()); });
    
    gameRef.child('turn').on('value', snap => {
        const t = snap.val();
        if (t && currentPlayersData[t]) {
            document.getElementById('turn-name-display').innerText = (t === myRole) ? `⭐ ${currentPlayersData[t].name}` : currentPlayersData[t].name;
            updateFlameEffect(t);
        }
    });

    gameRef.child('table').on('value', async (snap) => {
        const center = document.getElementById('table-center'); const tableCards = snap.val();
        
        const hSnap = await gameRef.child('hands/' + myRole).get();
        if (hSnap.exists()) {
            renderHand(hSnap.val());
        }

        if (!tableCards) { center.innerHTML = ""; return; }
        center.innerHTML = ""; const cardsArray = Object.values(tableCards);
        const leadSuit = cardsArray[0].s; const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
        let bestCard = cardsArray[0]; cardsArray.forEach(c => { if (c.s === leadSuit && vals[c.v] > vals[bestCard.v]) bestCard = c; });
        
        Object.entries(tableCards).forEach(([id, data]) => {
            const cardDiv = document.createElement('div');
            const isBest = (data.v === bestCard.v && data.s === bestCard.s);
            cardDiv.className = `card table-card ${(data.s === '♥' || data.s === '♦') ? 'red' : ''} ${isBest ? 'best-card' : ''}`;
            cardDiv.setAttribute('data-playername', data.playerName); cardDiv.innerHTML = `${data.v}<span>${data.s}</span>`;
            center.appendChild(cardDiv);
        });
        if (Object.keys(tableCards).length === 4) { checkTrickWinner(tableCards); }
    });
}

function updateFlameEffect(currentTurnRole) {
    const roles = ['south', 'west', 'north', 'east'];
    const myIdx = roles.indexOf(myRole);
    const posNames = ['bottom', 'left', 'top', 'right'];
    
    posNames.forEach(pos => document.getElementById(`label-${pos}`).classList.remove('active-turn'));
    
    const turnIdx = (roles.indexOf(currentTurnRole) - myIdx + 4) % 4;
    document.getElementById(`label-${posNames[turnIdx]}`).classList.add('active-turn');
}

function updateScoreboardUI(scores = { ns: 0, ew: 0 }) {
    const getN = (r) => currentPlayersData[r] ? currentPlayersData[r].name : r;
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
    const cardsArray = Object.values(tableCards); const leadSuit = cardsArray[0].s; const vals = {'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
    let winner = cardsArray[0]; cardsArray.forEach(c => { if (c.s === leadSuit && vals[c.v] > vals[winner.v]) winner = c; });
    setTimeout(() => { playTrickAnimation(winner.from); }, 1200);
}

function playTrickAnimation(winnerRole) {
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const posMap = ['bottom', 'left', 'top', 'right'];
    const winnerPos = posMap[(roles.indexOf(winnerRole) - myIdx + 4) % 4];
    const targetEl = document.getElementById(`label-${winnerPos}`); const rect = targetEl.getBoundingClientRect();
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
            gameRef.child('table').remove(); gameRef.child('turn').set(winnerRole);
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
        const isDisabled = (leadSuit && hasLeadSuit && card.s !== leadSuit);
        
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
    const roles = ['south', 'west', 'north', 'east']; const myIdx = roles.indexOf(myRole); const getP = (r) => (players[r] ? players[r].name : "離線中...");
    document.getElementById('label-bottom').innerText = getP(myRole) + " (你)";
    document.getElementById('label-left').innerText = getP(roles[(myIdx+1)%4]);
    document.getElementById('label-top').innerText = getP(roles[(myIdx+2)%4]);
    document.getElementById('label-right').innerText = getP(roles[(myIdx+3)%4]);
}

function setupNewDeck() {
    const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = []; suits.forEach(s => values.forEach(v => deck.push({s, v})));
    deck.sort(() => Math.random() - 0.5);
    gameRef.child('hands').set({ south: deck.slice(0, 13), west: deck.slice(13, 26), north: deck.slice(26, 39), east: deck.slice(39, 52) });
    gameRef.child('turn').set("south"); gameRef.child('scores').set({ ns: 0, ew: 0 });
    gameRef.child('personalScores').set({ south: 0, west: 0, north: 0, east: 0 });
}

// 啟動遊戲引擎
initializeGame();