// ==========================================
// 橋牌核心規則庫 (Pure Logic) - bridge_rule.js
// ==========================================
const BRIDGE_RULES = {
    suitRanks: { '♣': 1, '♦': 2, '♥': 3, '♠': 4, 'NT': 5 },
    valOrder: { 'A':14, 'K':13, 'Q':12, 'J':11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2 },

    // 1. 生成並洗好一副全新的牌
    generateDeck() {
        const suits = ['♠', '♥', '♦', '♣'], values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        let deck = []; 
        suits.forEach(s => values.forEach(v => deck.push({s, v})));
        return deck.sort(() => Math.random() - 0.5);
    },

    // 2. 將手牌依照花色與大小排序
    sortHand(hand) {
        const suitOrder = {'♠': 4, '♥': 3, '♦': 2, '♣': 1};
        return hand.sort((a, b) => suitOrder[a.s] !== suitOrder[b.s] ? suitOrder[b.s] - suitOrder[a.s] : this.valOrder[b.v] - this.valOrder[a.v]).reverse();
    },

    // 3. 取得目前可以合法打出的牌 (跟隨引牌花色)
    getValidCards(hand, tableCardsArray) {
        if (hand.length === 0) return [];
        let leadSuit = tableCardsArray.length > 0 ? tableCardsArray[0].s : null;
        if (leadSuit && hand.some(c => c.s === leadSuit)) {
            return hand.filter(c => c.s === leadSuit);
        }
        return hand; // 沒限制，全部都能打
    },

    // 4. 判斷桌面上哪張牌最大 (吃墩贏家)
    getTrickWinner(tableCardsArray, trumpSuit) {
        if (tableCardsArray.length === 0) return null;
        let leadSuit = tableCardsArray[0].s; 
        let winner = tableCardsArray[0]; 
        
        tableCardsArray.forEach(c => { 
            let isCT = (c.s === trumpSuit), isBT = (winner.s === trumpSuit);
            if (isCT && !isBT) winner = c;
            else if (isCT && isBT) { if (this.valOrder[c.v] > this.valOrder[winner.v]) winner = c; }
            else if (!isCT && !isBT && c.s === leadSuit && winner.s === leadSuit) { if (this.valOrder[c.v] > this.valOrder[winner.v]) winner = c; }
        });
        return winner;
    }
};