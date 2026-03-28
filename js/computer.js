// ==========================================
// 電腦 AI 邏輯大腦 - computer.js
// ==========================================
const COMPUTER_AI = {
    // 1. 決定要喊什麼牌
    getBid(hand, currentBid) {
        let suitCounts = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
        hand.forEach(card => suitCounts[card.s]++);
        
        let bestSuit = '♣', maxCount = 0;
        for (let s in suitCounts) { if (suitCounts[s] > maxCount) { maxCount = suitCounts[s]; bestSuit = s; } }

        let targetLevel = 1;

        if (currentBid) {
            let curLevel = currentBid.level;
            let curSuitRank = BRIDGE_RULES.suitRanks[currentBid.suit];
            let mySuitRank = BRIDGE_RULES.suitRanks[bestSuit];

            if (curLevel >= 2 && (curLevel > 2 || mySuitRank <= curSuitRank)) return 'Pass'; 
            else if (curLevel === 1) targetLevel = (mySuitRank > curSuitRank) ? 1 : 2;
            else if (curLevel === 2) { if (mySuitRank > curSuitRank) targetLevel = 2; else return 'Pass'; }
        }

        return { level: targetLevel, suit: bestSuit };
    },

    // 2. 決定要打哪張牌
    getPlayCard(hand, tableCards) {
        let tableCardsArray = Object.values(tableCards);
        // 呼叫大腦取得合法牌
        let validCards = BRIDGE_RULES.getValidCards(hand, tableCardsArray);
        
        // 目前策略：隨機挑選一張合法牌
        return validCards[Math.floor(Math.random() * validCards.length)];
    }
};