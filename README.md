# Bridge_go 🃏

一款基於網頁的即時多人連線橋牌遊戲 (Online Multiplayer Bridge Game)。
採用高級深色香檳金 UI 設計，並具備流暢的出牌動畫與嚴謹的橋牌邏輯，讓玩家在電腦與手機上都能享受最極致的打牌體驗。

👉 **[點此立即遊玩 Live Demo](https://juan-jeffery.github.io/Bridge_go/)**

---

## ✨ 遊戲特色 (Features)

* **⚡ 即時多人連線 (Realtime Multiplayer)**
  * 基於 Firebase Realtime Database，支援 4 人同房連線對戰。
  * 具備斷線防護與動態座位大廳系統。
* **🧠 完整的橋牌邏輯 (Core Bridge Mechanics)**
  * **喊牌階段**：支援 1~7 線位及無王 (NT) 競標，具備自動判斷最高出價與 3 次 Pass 結標機制。
  * **打牌階段**：嚴格的「跟隨首引花色 (Follow Suit)」防呆機制。不符合規則的牌會自動變暗並鎖定點擊，防止玩家出錯牌。
  * **勝負結算**：自動計算莊家/防守方目標墩數，打滿 13 墩自動跳出精美勝利結算面板。
* **📱 全端完美適應 (Ultimate Responsive Design)**
  * 針對不同設備量身打造專屬版面配置。
  * **電腦版**：寬闊的桌面視野。
  * **手機直向 (Portrait)**：重新排列玩家位置與手牌比例，確保左右玩家資訊不被截斷。
  * **手機橫向 (Landscape)**：極致壓縮上下邊距，最大化中央戰場空間。
* **🎨 頂級視覺回饋 (Premium Visual Effects)**
  * **輪次提示**：當前出牌玩家的大頭貼會燃燒「火焰特效」，讓你一秒知道輪到誰。
  * **出牌動畫**：卡片從手牌飛上桌面的 Q 彈落下效果，以及吃墩時的卡片縮放飛行動畫。
  * **最強牌指示**：桌面當前最大的牌會持續閃爍「黃金呼吸燈」，戰況一目了然。

---

## 🛠️ 技術棧 (Tech Stack)

* **前端 (Frontend)**: Vanilla JavaScript, HTML5, CSS3
* **後端與資料庫 (Backend & DB)**: Firebase Realtime Database
* **部署 (Deployment)**: GitHub Pages

---
