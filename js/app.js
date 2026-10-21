
function inspectWebhookStatus() {
  const url = getGasWebhookUrl();
  const statusEl = document.getElementById('lb-cloud-status');
  const curStatus = statusEl ? statusEl.textContent : '未知';
  const lastSync = (typeof lastCloudSyncTime !== 'undefined' && lastCloudSyncTime) ? lastCloudSyncTime.toLocaleString() : '尚未成功連通';
  const msg = [
    '【雲端天梯連線診斷報告】',
    '',
    '1. 當前偵測到的 Webhook 網址:',
    url || '⚠️ (未讀取到，請確認 config.js 中的 GAS_WEBHOOK_URL 是否已填寫)',
    '',
    '2. 最新同步狀態:',
    curStatus,
    '',
    '3. 最後成功同步時間:',
    lastSync,
    '',
    '💡 常見故障排除排查指南：',
    '・若顯示連線失敗或超時：請確認 Apps Script 部署設定中的「誰可以存取」是否選為「任何人 (Anyone)」，若選成「只有我」會被 Google 權限阻擋。',
    '・若網址結尾為 /dev，請改為正式發布的 /exec 結尾網址。',
    '・若修改了 GitHub 的 config.js，GitHub Pages 通常需 1~2 分鐘編譯，請按 Ctrl+F5 強制重新整理。'
  ].join(String.fromCharCode(10));
  alert(msg);
}

function getGasWebhookUrl() {
  if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.GAS_WEBHOOK_URL && !window.CONFIG.GAS_WEBHOOK_URL.includes('YourDeploymentIdHere')) {
    return window.CONFIG.GAS_WEBHOOK_URL;
  }
  if (typeof CONFIG !== 'undefined' && CONFIG.GAS_WEBHOOK_URL && !CONFIG.GAS_WEBHOOK_URL.includes('YourDeploymentIdHere')) {
    return CONFIG.GAS_WEBHOOK_URL;
  }
  return '';
}

/**
 * =========================================================================
 * 🎮 APP.JS - 遊戲業務邏輯、UI 互動與跨電腦雲端同步核心
 * 🤖 AI 迭代維護指南：
 *    - 本模組包含完整遊戲狀態機 (三大討伐模式 + 極速手速賽)
 *    - 包含排行榜渲染 (renderLeaderboardTable, renderSpeedLeaderboardTable)
 *    - 包含 Webhook 雙向資料傳輸 (sendReliableWebhook, fetchCloudLeaderboard)
 * =========================================================================
 */

const SafeStorage = {
      _mem: {},
      getItem(key) {
        try {
          if (window.localStorage) {
            const v = window.localStorage.getItem(key);
            if (v !== null) return v;
          }
        } catch(e) {}
        return this._mem[key] !== undefined ? this._mem[key] : null;
      },
      setItem(key, val) {
        const strVal = String(val);
        this._mem[key] = strVal;
        try {
          if (window.localStorage) window.localStorage.setItem(key, strVal);
        } catch(e) {}
      },
      removeItem(key) {
        delete this._mem[key];
        try {
          if (window.localStorage) window.localStorage.removeItem(key);
        } catch(e) {}
      },
      getAllKeys() {
        const keysSet = new Set(Object.keys(this._mem));
        try {
          if (window.localStorage) {
            for (let i = 0; i < window.localStorage.length; i++) {
              keysSet.add(window.localStorage.key(i));
            }
          }
        } catch(e) {}
        return Array.from(keysSet);
      }
    };

    // State Variables
    let isCloudOnline = false;
    let activeTab = 'top40';
    let currentLeaderboardType = 'combat';
    let currentLeaderboardFilter = 'ALL';
    let speedLeaderboardWeek = 'w8_hw1';
    let speedLeaderboardWordCount = 10;
    let currentSpeedWeek = 'w8_hw1';
    let currentSpeedWordCount = 10;
    let isSpeedPracticeMode = false;
    let speedWordList = [];
    let speedWordIdx = 0;
    let speedInputCodes = [];
    let speedStartTime = null;
    let speedTimerInterval = null;
    let speedPenaltySeconds = 0.0;
    let speedMistakes = 0;
    let speedTotalKeys = 0;
    let speedCorrectKeys = 0;
    let speedHintTimer = null;
    let speedActive = false;
    let speedWordReadyForSpace = false;
    let currentClass = 'P6A';
    let currentStudent = null;       // { cls, num, name }
    let activeSkills = [];
    let focusSkillActiveThisRound = false;           // 當前已解鎖技能清單
    let gameStage = 1;               // 1..5 關卡循環
    let sessionScore = 0;            // 當前輪次得分
    let sessionCorrectCount = 0;     // 當前輪次答對關數
    let comboCount = 0;              // 連擊數
    let roundMistakeCount = 0;       // 當前關卡累積失誤次數 (>=5次觸發提示)
    let currentGameMode = 'connected'; // 'connected' | 'split' | 'special'
    let currentQuiz = null;          // 當前題目物件
    let selectedCodes = [];          // 模式1與3已捕捉字碼
    let selectedPrefix = [];         // 模式2已捕捉字首碼
    let selectedBody = [];           // 模式2已捕捉字身碼
    let activeOrbs = [];             // 畫面上的遊行球集合
    let wanderingSpeedMultiplier = 0.85;
    let animationFrameId = null;
    let autoNextTimer = null;
    let roundShieldActive = false;
    let isKiosk = false;
    let kioskInterval = null;

    // 題目佇列與跨輪防重複歷史紀錄 (保證每輪5關隨機且跨輪絕不連續重複)
    let modeQuizQueues = {
      connected: [],
      siege: [],
      feature: [],
      pet: [],
      survival: [],
      special: []
    };
    let modeQuizHistory = {
      connected: [],
      siege: [],
      feature: [],
      pet: [],
      survival: [],
      special: []
    };

    function getNextQuiz(mode) {
      if (!modeQuizQueues[mode] || modeQuizQueues[mode].length === 0) {
        let pool = [];
        if (mode === 'connected') pool = [...(DATA.connected_words || [])];
        else if (mode === 'split') pool = [...(DATA.split_words || [])];
        else if (mode === 'special') pool = [...(DATA.special_words || [])];
        else if (mode === 'feature') pool = [...(DATA.feature_words || DATA.connected_words || [])];

        // 使用 Fisher-Yates 隨機均勻洗牌演算法
        let shuffled = (typeof fisherYatesShuffle === 'function')
          ? fisherYatesShuffle(pool)
          : fisherYatesShuffle(pool);

        // 跨輪次防重複機制：剛洗完牌時，若前幾道題恰好在上一輪最後 5 題中出現過，將其沉底延後抽取
        const recent = modeQuizHistory[mode] || [];
        if (recent.length > 0 && shuffled.length > 5) {
          const fresh = [];
          const delayed = [];
          shuffled.forEach(item => {
            if (recent.slice(-5).includes(item.char)) {
              delayed.push(item);
            } else {
              fresh.push(item);
            }
          });
          shuffled = fresh.concat(delayed);
        }

        modeQuizQueues[mode] = shuffled;
      }

      const quiz = modeQuizQueues[mode].pop();
      if (quiz) {
        if (!modeQuizHistory[mode]) modeQuizHistory[mode] = [];
        modeQuizHistory[mode].push(quiz.char);
        if (modeQuizHistory[mode].length > 20) {
          modeQuizHistory[mode].shift();
        }
        // ★ 核心原則：以《2026每周打字字庫表》> cj3-30000.txt > cj3-special.txt 為字碼最高真值準則
        const getAuthFn = (typeof getAuthoritativeCj3 === 'function') ? getAuthoritativeCj3 : (typeof window !== 'undefined' ? window.getAuthoritativeCj3 : null);
        if (typeof getAuthFn === 'function' && quiz && quiz.char) {
          const canon = getAuthFn(quiz.char);
          if (canon) {
            if (canon.codes) quiz.codes = canon.codes.slice();
            if (canon.keys) quiz.keys = canon.keys.slice();
            if (canon.full) quiz.full = canon.full;
            if (canon.secret) quiz.secret = canon.secret;
            if (canon.quickCode) quiz.quickCode = canon.quickCode;
          }
        }
      }
      return quiz;
    }

    // Confetti Engine
    function burstConfetti() {
      const canvas = document.getElementById('confetti-canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      const pieces = [];
      const colors = ['#FACC15', '#EF4444', '#3B82F6', '#10B981', '#8B5CF6', '#F97316'];
      for (let i = 0; i < 95; i++) {
        pieces.push({
          x: canvas.width * 0.5,
          y: canvas.height * 0.35,
          vx: (Math.random() - 0.5) * 18,
          vy: (Math.random() - 0.7) * 18,
          size: Math.random() * 8 + 5,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          vrot: (Math.random() - 0.5) * 14,
          gravity: 0.35,
          opacity: 1
        });
      }
      
      function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        pieces.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += p.gravity;
          p.rotation += p.vrot;
          p.opacity -= 0.009;
          if (p.opacity > 0) {
            alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
          }
        });
        if (alive) requestAnimationFrame(render);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      render();
    }

    // Tier and Skills Engine
    

    

    function triggerSkillToast(icon, text) {
      const toast = document.getElementById('skill-toast');
      document.getElementById('skill-toast-icon').textContent = icon;
      document.getElementById('skill-toast-text').textContent = text;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2200);
    }

    function triggerStagePassToast(modeLabel, stageNum, scoreEarned, nextStageNum) {
      const toast = document.getElementById('stage-pass-toast');
      const icon = document.getElementById('stage-pass-toast-icon');
      const text = document.getElementById('stage-pass-toast-text');
      if (!toast) return;

      icon.textContent = nextStageNum ? '🎉' : '🏆';
      if (nextStageNum) {
        text.innerHTML = `<strong>${modeLabel}</strong> 第 ${stageNum} 關 通關成功！<span style="color:#FEF08A;font-weight:900;">+${scoreEarned} 分</span> ➔ 自動進入第 ${nextStageNum} 關...`;
      } else {
        text.innerHTML = `<strong>${modeLabel}</strong> 5 關挑戰全數通關！<span style="color:#FEF08A;font-weight:900;">+${scoreEarned} 分</span> ➔ 正在進行總結算...`;
      }
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1600);
    }

    // Local Storage & Stats Management
    function getStudentStats(cls, num) {
      const key = `p6_score_${cls}_${num}`;
      let stats = { totalScore: 0, kills: 0, mode1Score: 0, mode2Score: 0, mode3Score: 0 };
      const val = SafeStorage.getItem(key);
      if (val) {
        try { Object.assign(stats, JSON.parse(val)); } catch(e) {}
      }

      // 🛡️ 雙向同步：從雲端榜單/基準資料庫獲取最新試算表真實累計總分與擊破數
      if (typeof DATA !== 'undefined' && Array.isArray(DATA.benchmark_leaderboard)) {
        const padNum = parseInt(num, 10);
        const cloudMatch = DATA.benchmark_leaderboard.find(item => 
          item.cls === cls && parseInt(item.num, 10) === padNum
        );
        if (cloudMatch) {
          const cloudPts = (typeof cloudMatch.grandTotal === 'number') ? cloudMatch.grandTotal : 
                           ((typeof cloudMatch.score === 'number') ? cloudMatch.score : (parseInt(cloudMatch.totalScore, 10) || 0));
          if (cloudPts > stats.totalScore) {
            stats.totalScore = cloudPts;
          }
          if (cloudMatch.kills && cloudMatch.kills > stats.kills) {
            stats.kills = cloudMatch.kills;
          }
        }
      }
      return stats;
    }

    // =========================================================================
    // 🛡️ 雲端上傳可靠性引擎 (冪等性 requestId + 離線補送隊列 + 結算批次發送)
    // =========================================================================
    function generateRequestId() {
      return 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }

    async function sendReliableWebhook(payload) {
      // 🚀 優先交由 P6UploadQueue 高韌性持久佇列發送 (冪等去重 + 指數退避抖動重試)
      if (typeof P6UploadQueue !== 'undefined') {
        P6UploadQueue.enqueue(payload, function(success, remaining) {
          if (success) {
            updateSyncStatus('🟢 雲端天梯已連線');
          } else if (remaining > 0) {
            updateSyncStatus(`🟡 待補送隊列 (${remaining})`);
          }
        });
        return;
      }

      const url = getGasWebhookUrl();
      if (!url) return;

      if (!payload.requestId) {
        payload.requestId = generateRequestId();
      }

      let success = false;
      // 🚀 即時重試機制：發生異常時進行 2 次重發嘗試 (間隔 1.2 秒)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise(r => setTimeout(r, 1200));
          }
          await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          });
          success = true;
          break;
        } catch (err) {
          console.warn(`第 ${attempt + 1} 次雲端上傳嘗試失敗:`, err);
        }
      }

      if (success) {
        // 成功上傳後觸發雲端榜單延遲刷新
        setTimeout(() => {
          if (typeof fetchCloudLeaderboard === 'function') fetchCloudLeaderboard(true);
        }, 1500);
        // 上傳成功且網路順暢，順帶檢查有無先前遺留的離線補送項目
        setTimeout(() => {
          flushPendingUploads();
        }, 2000);
      } else {
        // 經重試依然失敗，安全存入本機離線補送隊列 (FIFO 保存，不丟失)
        console.warn('雲端上傳暫時失敗，已安全移入待補送清單');
        try {
          const rawPending = SafeStorage.getItem('p6_pending_uploads');
          const queue = rawPending ? JSON.parse(rawPending) : [];
          queue.push({ payload, time: Date.now() });
          SafeStorage.setItem('p6_pending_uploads', JSON.stringify(queue.slice(-30))); // 最多保留最近30筆
          if (typeof showPassToast === 'function') {
            showPassToast('⚠️ 網路不穩，成績已安全暫存本機，連線恢復時將自動補送！');
          }
        } catch(e) {}
      }
    }

    // 🚀 當網路暢通或恢復時，自動清空並補發離線隊列
    async function flushPendingUploads() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const url = getGasWebhookUrl();
      if (!url) return;

      try {
        const rawPending = SafeStorage.getItem('p6_pending_uploads');
        if (!rawPending) return;
        const queue = JSON.parse(rawPending);
        if (!Array.isArray(queue) || queue.length === 0) return;

        const remainingQueue = [];
        let anySucceeded = false;

        for (const item of queue) {
          if (item && item.payload) {
            try {
              await fetch(url, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(item.payload)
              });
              anySucceeded = true;
              await new Promise(r => setTimeout(r, 400)); // 輕微防洪間隔
            } catch (err) {
              remainingQueue.push(item);
            }
          }
        }

        if (remainingQueue.length > 0) {
          SafeStorage.setItem('p6_pending_uploads', JSON.stringify(remainingQueue));
        } else {
          SafeStorage.removeItem('p6_pending_uploads');
        }

        if (anySucceeded) {
          console.log('✅ 離線隊列補送成功！');
          if (typeof showPassToast === 'function') {
            showPassToast('☁️ 離線成績已成功補送至 Google 雲端試算表！');
          }
          setTimeout(() => {
            if (typeof fetchCloudLeaderboard === 'function') fetchCloudLeaderboard(true);
          }, 2200);
        }
      } catch(e) {}
    }

    function saveStudentStats(cls, num, scoreDelta, isKill, mode, bestTime = null, wordCount = 10, weekKey = 'w7_hw1') {
      const key = `p6_score_${cls}_${num}`;
      const stats = getStudentStats(cls, num);
      stats.totalScore += scoreDelta;
      // 📅 累加至當日獲得分數 (驅動每日 150~400 分解鎖鏈)
      if (typeof P6Mode !== 'undefined') {
        P6Mode.addDailyEarnedScore(cls, num, scoreDelta);
        renderModeTabs();
      }
      if (isKill) stats.kills++;
      if (mode === 'connected') stats.mode1Score = (stats.mode1Score || 0) + scoreDelta;
      else if (mode === 'split') stats.mode2Score = (stats.mode2Score || 0) + scoreDelta;
      else if (mode === 'special') stats.mode3Score = (stats.mode3Score || 0) + scoreDelta;
      stats.lastUpdate = new Date().toISOString();
      SafeStorage.setItem(key, JSON.stringify(stats));

      // 🛡️ 即時同步記憶體中的 DATA.benchmark_leaderboard，確保榜單與技能館一致
      if (typeof DATA !== 'undefined' && Array.isArray(DATA.benchmark_leaderboard)) {
        const padNum = parseInt(num, 10);
        const cloudMatch = DATA.benchmark_leaderboard.find(item => 
          item.cls === cls && parseInt(item.num, 10) === padNum
        );
        if (cloudMatch) {
          cloudMatch.grandTotal = stats.totalScore;
          cloudMatch.score = stats.totalScore;
          cloudMatch.totalScore = stats.totalScore;
          cloudMatch.total = stats.totalScore;
          cloudMatch.kills = stats.kills;
          if (typeof P6Mode !== 'undefined') {
            cloudMatch.todayScore = P6Mode.getDailyEarnedScore(cls, num);
          }
          const { currentTier } = evalTierAndSkills(stats.totalScore);
          cloudMatch.title = currentTier.title;
          cloudMatch.badge = currentTier.badge;
        }
      }

      // 若為手速賽或關卡結算，發送可靠上傳
      sendReliableWebhook({
        grade: 6,
        cls: cls,
        num: num,
        roundScore: scoreDelta,
        scoreDelta: scoreDelta,
        gameMode: mode,
        mode: mode,
        bestTime: bestTime,
        wordCount: wordCount,
        weekKey: weekKey,
        totalScore: stats.totalScore,
        kills: stats.kills,
        timestamp: stats.lastUpdate
      });
    }

    // ==========================================
    // 📊 統計棒形圖 (Bar Chart) 生成組件
    // ==========================================
    function buildBarChartHtml(title, subtitle, dataList, maxVal, barGradient, totalBadge) {
      const barsHtml = dataList.map(item => {
        const pct = Math.max(12, Math.round((item.val / Math.max(1, maxVal)) * 100));
        return `
          <div class="chart-bar-col">
            <div class="chart-bar-val">${item.val} 人</div>
            <div class="chart-bar-pillar" style="height: ${pct}%; background: ${barGradient};" title="${item.cls}：${item.val} 人"></div>
            <div class="chart-bar-label">${item.cls}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="chart-container-card">
          <div class="chart-header">
            <div>
              <div class="chart-title">${title}</div>
              <div style="font-size: 12px; color: #64748B; margin-top: 2px;">${subtitle}</div>
            </div>
            <div class="stat-pill" style="font-size: 12px; padding: 3px 10px; background: #F8FAFC; border-color: #CBD5E1;">
              <strong>${totalBadge}</strong>
            </div>
          </div>
          <div class="chart-bars-wrap">
            ${barsHtml}
          </div>
        </div>
      `;
    }

    function renderClassBarCharts() {
      const classes = ['P6A', 'P6B', 'P6C', 'P6D', 'P6E', 'P6F'];

      // 1. 各班入選前 40 名人數分佈統計
      const top40Counts = {};
      const top40List = (DATA && Array.isArray(DATA.top40)) ? DATA.top40 : [];
      top40List.forEach(s => top40Counts[s.cls] = (top40Counts[s.cls] || 0) + 1);
      let maxTop40 = 1;
      classes.forEach(c => {
        if ((top40Counts[c] || 0) > maxTop40) maxTop40 = top40Counts[c];
      });
      const top40Data = classes.map(c => ({ cls: c, val: top40Counts[c] || 0 }));
      const chartTop40El = document.getElementById('chart-top40-container');
      if (chartTop40El) {
        chartTop40El.innerHTML = buildBarChartHtml(
          '📊 各班入選全級前 40 名人數分佈 (統計棒形圖)',
          '統計 P6A 至 P6F 各班在全級前 40 名龍虎榜中所佔之傑出訓練家人數',
          top40Data,
          maxTop40,
          'linear-gradient(180deg, #60A5FA 0%, #2563EB 100%)',
          '全級前40名合計：40 人'
        );
      }

      // 2. 各班 400 分大滿貫人數分佈統計
      let maxPerf = 1;
      let totalPerf = 0;
      const perfData = classes.map(c => {
        const count = (DATA && DATA.perfect_students && DATA.perfect_students[c] ? DATA.perfect_students[c] : []).length;
        if (count > maxPerf) maxPerf = count;
        totalPerf += count;
        return { cls: c, val: count };
      });
      const chartPerfEl = document.getElementById('chart-perfect-container');
      if (chartPerfEl) {
        chartPerfEl.innerHTML = buildBarChartHtml(
          '📊 各班 400 分大滿貫滿分人數分佈 (統計棒形圖)',
          '統計各班達成 4 次作業 400 分全滿分榮譽之訓練家人數',
          perfData,
          maxPerf,
          'linear-gradient(180deg, #FDE047 0%, #D97706 100%)',
          `全級滿分合計：${totalPerf} 人`
        );
      }
    }

    // ==========================================
    // TAB 1: 🏆 全級前 40 名龍虎榜 (頒獎台 + 角色卡)
    // ==========================================
    
    // 🛡️ 日期安全解析輔助函式 (徹底防禦 undefined.replace 崩潰)
    function getSafeDateText(dateVal) {
      if (!dateVal || typeof dateVal !== 'string') return '';
      return dateVal.replace('2026-', '').replace(/^(\d{4}-)/, '').trim();
    }

    // 🛡️ 學生姓名去識別化格式化 (落實 GITHUB_PRIVACY_MODE 設定開關)
    function formatStudentDisplayName(student) {
      if (!student) return '';
      const cfg = (typeof CONFIG !== 'undefined') ? CONFIG : (typeof window !== 'undefined' ? window.CONFIG : null);
      if (cfg && cfg.GITHUB_PRIVACY_MODE) {
        const cls = student.cls || '';
        const num = parseInt(student.num, 10);
        if (cls && !isNaN(num)) {
          return `${cls} ${(num < 10 ? '0' : '') + num}號`;
        }
      }
      return student.name || `${student.cls || ''} ${(student.num < 10 ? '0' : '') + (student.num || '')}號`.trim();
    }

    function renderTop40() {
      const top40List = (DATA && Array.isArray(DATA.top40)) ? DATA.top40 : [];
      if (top40List.length < 3) {
        const podiumArea = document.getElementById('podium-area');
        if (podiumArea) {
          podiumArea.innerHTML = `
            <div style="text-align: center; padding: 32px 16px; color: #64748B; font-weight: 800; font-size: 15px; width: 100%;">
              🏆 龍虎榜數據同步中，請點擊上方【全級前40名龍虎榜】或登入挑戰開創紀錄！
            </div>
          `;
        }
        const listArea = document.getElementById('top40-list');
        if (listArea) listArea.innerHTML = '';
        return;
      }
      const top3 = top40List.slice(0, 3);
      const rest = top40List.slice(3);
      
      const podiumArea = document.getElementById('podium-area');
      const p2Score = top3[1].total ?? top3[1].score ?? 400;
      const p2Badge = top3[1].badge || top3[1].title || '🔥 榮譽訓練家';
      const p2Time = getSafeDateText(top3[1].date || top3[1].lastTime);

      const p1Score = top3[0].total ?? top3[0].score ?? 400;
      const p1Badge = top3[0].badge || top3[0].title || '👑 榮譽訓練家';
      const p1Time = getSafeDateText(top3[0].date || top3[0].lastTime);

      const p3Score = top3[2].total ?? top3[2].score ?? 400;
      const p3Badge = top3[2].badge || top3[2].title || '🍃 榮譽訓練家';
      const p3Time = getSafeDateText(top3[2].date || top3[2].lastTime);

      podiumArea.innerHTML = `
        <div class="podium-step podium-2">
          <div class="crown-banner"><span class="emoji-icon">🥈</span></div>
          <img class="podium-pokemon-img" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png" alt="小火龍" title="小火龍 (Charmander) 🔥" onerror="handlePodiumImgError(this, '🔥')">
          <div class="podium-name">${formatStudentDisplayName(top3[1])}</div>
          <div class="podium-class">${top3[1].cls} (${top3[1].num}號) · 小火龍之火</div>
          <div class="podium-badge-score">${p2Score} 分 ｜ ${p2Badge}</div>
          ${p2Time ? `<div class="podium-time">⏱️ ${p2Time}</div>` : ''}
        </div>
        <div class="podium-step podium-1">
          <div class="crown-banner"><span class="emoji-icon">👑</span></div>
          <img class="podium-pokemon-img" style="width:88px; height:88px;" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png" alt="皮卡丘" title="皮卡丘 (Pikachu) ⚡" onerror="handlePodiumImgError(this, '⚡')">
          <div class="podium-name">${formatStudentDisplayName(top3[0])}</div>
          <div class="podium-class">${top3[0].cls} (${top3[0].num}號) · 皮卡丘雷霆</div>
          <div class="podium-badge-score">${p1Score} 分 ｜ ${p1Badge}</div>
          ${p1Time ? `<div class="podium-time">⏱️ ${p1Time}</div>` : ''}
        </div>
        <div class="podium-step podium-3">
          <div class="crown-banner"><span class="emoji-icon">🥉</span></div>
          <img class="podium-pokemon-img" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png" alt="妙蛙種子" title="妙蛙種子 (Bulbasaur) 🍃" onerror="handlePodiumImgError(this, '🍃')">
          <div class="podium-name">${formatStudentDisplayName(top3[2])}</div>
          <div class="podium-class">${top3[2].cls} (${top3[2].num}號) · 妙蛙飛葉</div>
          <div class="podium-badge-score">${p3Score} 分 ｜ ${p3Badge}</div>
          ${p3Time ? `<div class="podium-time">⏱️ ${p3Time}</div>` : ''}
        </div>
      `;
      
      const restPool = DATA.pokemon_pool.slice(3);
      const listArea = document.getElementById('top40-list');
      listArea.innerHTML = rest.map((s, idx) => {
        const pm = restPool[idx % restPool.length];
        const isElite = (s.rank >= 4 && s.rank <= 10);
        const displayName = formatStudentDisplayName(s);
        return `
          <div class="rank-card ${isElite ? 'rank-card-elite-flash' : ''}" data-student="${s.cls}-${s.num}-${displayName}">
            <div class="rank-left">
              <div class="rank-poke-avatar" style="background:${pm.color}; border-color:${pm.border};" title="${pm.name}">
                <img class="rank-poke-img" src="${pm.img}" alt="${pm.name}" onerror="handleRankImgError(this, '${pm.icon || '⚡'}')">
              </div>
              <div>
                <div class="st-name">
                  #${s.rank} ${formatStudentDisplayName(s)} <span class="st-poke-tag">${pm.name}</span>
                  ${isElite ? '<span class="badge-elite-top10">✨ TOP 10 菁英</span>' : ''}
                </div>
                <div class="st-class">${s.cls} · ${s.num}號 · 夥伴：${pm.name} (${pm.tag})</div>
              </div>
            </div>
            <div class="rank-right">
              <div class="st-score">${s.total ?? s.score ?? 400} 分</div>
              <div class="st-date">${getSafeDateText(s.date || s.lastTime) ? `交齊: ${getSafeDateText(s.date || s.lastTime)}` : '已交齊作業'}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 2: 🌟 各班前 10 名榮譽榜 (角色卡展示)
    // ==========================================
    function switchClass(cls) {
      currentClass = cls;
      document.querySelectorAll('.cls-chip').forEach(c => {
        c.classList.toggle('active', c.textContent.includes(cls));
      });
      renderClassCards();
    }

    function renderClassCards() {
      const container = document.getElementById('class-cards');
      const students = (DATA && DATA.class_top10 && DATA.class_top10[currentClass]) ? DATA.class_top10[currentClass] : [];
      const classOffset = ['P6A', 'P6B', 'P6C', 'P6D', 'P6E', 'P6F'].indexOf(currentClass) * 14;
      
      container.innerHTML = students.map((s, idx) => {
        const pm = DATA.pokemon_pool[(classOffset + idx) % DATA.pokemon_pool.length];
        let medal = '';
        let cardClass = 'rank-card';
        let honorBadge = '';

        // 各班前 10 名榮譽榜：前 3 名配置冠軍、亞軍、季軍專屬流光閃爍特效
        if (idx === 0) {
          medal = '<span class="emoji-icon">🥇</span> ';
          cardClass += ' rank-card-class-champion';
          honorBadge = '<span class="badge-class-honor gold"><span class="emoji-icon">👑</span> 班級冠軍</span>';
        } else if (idx === 1) {
          medal = '<span class="emoji-icon">🥈</span> ';
          cardClass += ' rank-card-class-runnerup';
          honorBadge = '<span class="badge-class-honor silver"><span class="emoji-icon">🥈</span> 班級亞軍</span>';
        } else if (idx === 2) {
          medal = '<span class="emoji-icon">🥉</span> ';
          cardClass += ' rank-card-class-third';
          honorBadge = '<span class="badge-class-honor bronze"><span class="emoji-icon">🥉</span> 班級季軍</span>';
        }

        return `
          <div class="${cardClass}" data-student="${currentClass}-${s.num}-${s.name}">
            <div class="rank-left">
              <div class="rank-poke-avatar" style="background:${pm.color}; border-color:${pm.border};" title="${pm.name}">
                <img class="rank-poke-img" src="${pm.img}" alt="${pm.name}" onerror="handleRankImgError(this, '${pm.icon || '⚡'}')">
              </div>
              <div>
                <div class="st-name">
                  ${medal}#${s.rank} ${formatStudentDisplayName(s)} <span class="st-poke-tag">${pm.name}</span>
                  ${honorBadge}
                </div>
                <div class="st-class">${currentClass} · ${s.num}號 · 夥伴：${pm.name} (${pm.tag})</div>
              </div>
            </div>
            <div class="rank-right">
              <div class="st-score">${s.grandTotal ?? s.total ?? s.score ?? 0} 分</div>
              <div class="st-date">${getSafeDateText(s.lastTime || s.date) ? `⏱️ ${getSafeDateText(s.lastTime || s.date)}` : (s.badge || '已登記戰績')}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 3: 🎉 400分滿分星光榜 (107人全員展示)
    // ==========================================
    function renderPerfectScorers() {
      const container = document.getElementById('perfect-class-groups');
      const classes = ['P6A', 'P6B', 'P6C', 'P6D', 'P6E', 'P6F'];
      let globalCounter = 0;
      
      container.innerHTML = classes.map(cls => {
        const members = (DATA && DATA.perfect_students && DATA.perfect_students[cls]) ? DATA.perfect_students[cls] : [];
        return `
          <div style="margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 17px; font-weight: 900; color: #1E3A8A;">● ${cls} 班</span>
              <span style="background: #DBEAFE; color: #1D4ED8; font-size: 12px; font-weight: 800; padding: 2px 10px; border-radius: 12px;">共 ${members.length} 位滿分</span>
            </div>
            <div class="perfect-grid">
              ${members.map((m) => {
                const pm = DATA.pokemon_pool[(globalCounter++) % DATA.pokemon_pool.length];
                return `
                  <div class="star-card" data-student="${cls}-${m}">
                    <div class="star-avatar" title="${pm.name}">
                      <img class="star-poke-img" src="${pm.img}" alt="${pm.name}" onerror="handleRankImgError(this, '${pm.icon || '⭐'}')">
                    </div>
                    <div class="star-name">${m}</div>
                    <div class="star-cls">${pm.name} · 400分</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 5: 📖 Top 12 錯字寶典與診斷
    // ==========================================
    function renderVocabTable() {
      const tbody = document.getElementById('vocab-tbody');
      const typos = [
        { rank: "第 1 名", char: "兔", count: "77 人次", hw: "功課3", code: "弓日戈 (NAI)", secret: "【分體字】字首「勹」取折筆【弓(N)】；字身「口」取【日(A)】，末筆撇彎鉤連點取【戈(I)】。切勿誤取「竹」或「口」！" },
        { rank: "第 2 名", char: "術", count: "60 人次", hw: "功課4", code: "竹人戈木 (HOID)", secret: "【行部包圍】字首左側「彳」取【竹人(HO)】；字身右側「术」取【戈木(ID)】。六年級是倉頡全碼，切勿按速成只取首尾！" },
        { rank: "第 3 名", char: "卵", count: "55 人次", hw: "功課3", code: "竹竹尸中戈 (HHSLI)", secret: "【分體字】左側首筆取撇【竹(H)】；右側撇取【竹(H)】，末筆點取【戈(I)】。" },
        { rank: "第 4 名", char: "錄", count: "54 人次", hw: "功課2", code: "金女弓水 (CVNE)", secret: "【左右分體】字首【金(C)】；字身「录」上部彑取【女弓(NV)】，下部氺取【水(E)】。" },
        { rank: "第 5 名", char: "卑", count: "54 人次", hw: "功課3", code: "竹竹十 (HHJ)", secret: "【上下分體】頂端撇筆取【竹(H)】；中間框筆取【竹(H)】，底端懸針十字取【十(J)】。" },
        { rank: "第 6 名", char: "歷", count: "54 人次", hw: "功課4", code: "一木卜中一 (MDYLM)", secret: "【半包圍全碼】外廓「厂」取【一(M)】；字身取禾【木(D)】＋止部【卜中一(YLM)】。標準全碼：一木卜中一 (MDYLM)。速成碼：一一 (MM)！" },
        { rank: "第 7 名", char: "究", count: "50 人次", hw: "功課3", code: "十金大弓 (JCKN)", secret: "【上下分體】字首穴部取寶蓋與八【十金(JC)】；字身九部取首筆【大(K)】與末筆彎折【弓(N)】。速成碼：十弓 (JN)！" },
        { rank: "第 8 名", char: "亞", count: "49 人次", hw: "功課4", code: "一中廿 (MLT)", secret: "【連體字】首筆頂橫【一(M)】；貫穿雙豎取【中(L)】；底端封口橫折取【廿(T)】。" },
        { rank: "第 9 名", char: "鬼", count: "46 人次", hw: "功課3", code: "竹戈竹山 (HIHU)", secret: "【連體字】頂端撇點取【竹戈(HI)】；字身下部兒與厶取【竹山(HU)】。" },
        { rank: "第 10 名", char: "演", count: "44 人次", hw: "功課1", code: "水十一金 (EJMC)", secret: "【左右分體】三點水取【水(E)】；字身「寅」取首碼寶蓋【十(J)】、次碼一橫【一(M)】與尾碼底筆【金(C)】。" },
        { rank: "第 11 名", char: "郵", count: "44 人次", hw: "功課4", code: "竹一弓中 (HMNL)", secret: "【左右分體】字首左側「垂」取首撇【竹(H)】與末橫【一(M)】；字身右側耳旁「阝」取【弓中(NL)】。速成碼：竹中 (HL)！" },
        { rank: "第 12 名", char: "潑", count: "43 人次", hw: "功課2", code: "水弓人水 (ENOE)", secret: "【左右分體】三點水取【水(E)】；字身「發」取登字頭【弓(N)】、撇點【戈(I)】及末筆又【水(E)】。" }
      ];

      tbody.innerHTML = typos.map(t => `
        <tr>
          <td style="font-weight: 800; text-align: center; color: #1E3A8A;">${t.rank}</td>
          <td style="font-size: 20px; font-weight: 900; text-align: center; color: #EF4444;">${t.char}</td>
          <td style="text-align: center; font-weight: 700; color: #D97706;">${t.count}</td>
          <td style="text-align: center; color: #64748B;">${t.hw}</td>
          <td style="font-weight: 800; color: #2563EB;">${t.code}</td>
          <td style="font-size: 13px; color: #334155; line-height: 1.4;">${t.secret}</td>
        </tr>
      `).join('');
    }

    // ==========================================
    // 搜尋與 Kiosk 輪播
    // ==========================================
    function handleSearch(keyword) {
      const q = keyword.trim().toLowerCase();
      document.querySelectorAll('.rank-card, .star-card').forEach(card => {
        const info = card.getAttribute('data-student') || '';
        if (!q) {
          card.classList.remove('highlight');
          card.style.display = '';
        } else if (info.toLowerCase().includes(q)) {
          card.classList.add('highlight');
          card.style.display = '';
        } else {
          card.classList.remove('highlight');
          card.style.display = 'none';
        }
      });
    }

    function toggleKioskMode() {
      const btn = document.getElementById('kiosk-btn');
      if (isKiosk) {
        clearInterval(kioskInterval);
        isKiosk = false;
        btn.textContent = '🖥️ 投影輪播';
        btn.style.background = 'white';
        btn.style.color = '#2563EB';
      } else {
        isKiosk = true;
        btn.textContent = '⏸️ 停止輪播';
        btn.style.background = '#2563EB';
        btn.style.color = 'white';
        const tabs = ['top40', 'class', 'perfect'];
        let idx = 0;
        kioskInterval = setInterval(() => {
          idx = (idx + 1) % tabs.length;
          switchTab(tabs[idx]);
        }, 6000);
      }
    }

    function switchTab(tabId) {
      activeTab = tabId;
      try {
        if (typeof BgmManager !== 'undefined') {
          if (tabId === 'top40' || tabId === 'class' || tabId === 'perfect' || tabId === 'vocab') {
            BgmManager.playTrack('lobby');
          } else if (tabId === 'game') {
            if (currentGameMode === 'siege' || currentGameMode === 'speed') {
              BgmManager.playTrack('siege_speed');
            } else {
              BgmManager.playTrack('stages');
            }
          }
        }
      } catch(e) {}
      document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
        const ids = ['top40', 'class', 'perfect', 'game', 'vocab'];
        btn.classList.toggle('active', ids[idx] === tabId);
      });
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
      const activePanel = document.getElementById(`panel-${tabId}`);
      if (activePanel) activePanel.classList.add('active');

      if (tabId === 'top40') {
        try { renderTop40(); renderClassBarCharts(); } catch(e){}
      } else if (tabId === 'class') {
        try { renderClassCards(); } catch(e){}
      } else if (tabId === 'perfect') {
        try { renderPerfectScorers(); renderClassBarCharts(); } catch(e){}
      } else if (tabId === 'game') {
        if (!currentQuiz) loadRound();
      }
    }

    // ==========================================
    // 學生身份登入 (下拉式選單選擇班別與學號 1-36)
    // ==========================================
    function submitStudentLogin() {
      const cls = document.getElementById('login-class-select').value;
      const numVal = document.getElementById('login-num-select').value;
      if (!numVal) {
        alert('請從下拉選單選擇你的學號 (1 ~ 36 號)！');
        return;
      }
      const num = parseInt(numVal);
      const padNum = num < 10 ? '0' + num : num;
      currentStudent = { cls, num, name: `${cls} ${padNum}號` };
      SafeStorage.setItem('p6_last_login', JSON.stringify(currentStudent));
      
      document.getElementById('identity-section').style.display = 'none';
      document.getElementById('battle-section').style.display = 'block';
      try { loadStudentProfile(); } catch(e) { console.error('loadStudentProfile error:', e); }
      try { startNewSession(); } catch(e) { console.error('startNewSession error:', e); }
      // 🚀 換電腦無縫漫遊：學生登入時立即同步雲端排行榜與當日解鎖狀態
      if (typeof fetchCloudLeaderboard === 'function') {
        fetchCloudLeaderboard(true);
      }
    }

    function switchIdentity() {
      currentStudent = null;
      activeSkills = [];
      SafeStorage.removeItem('p6_last_login');
      document.getElementById('battle-section').style.display = 'none';
      document.getElementById('identity-section').style.display = 'block';
    }

    function loadStudentProfile() {
      // 學生登入時自動檢查並補送離線隊列
      try { flushPendingUploads(); } catch(e) {}
      if (!currentStudent) return;
      const stats = getStudentStats(currentStudent.cls, currentStudent.num);
      const { currentTier, unlockedSkills } = evalTierAndSkills(stats.totalScore);
      activeSkills = unlockedSkills || [];
      // 🛡️ 跨電腦解鎖狀態漫遊對齊
      if (typeof P6Mode !== 'undefined' && currentStudent) {
        P6Mode.reconcileWithCloud(currentStudent.cls, currentStudent.num);
      }

      const nameEl = document.getElementById('trainer-display-name');
      const titleEl = document.getElementById('trainer-display-title');
      const badgeEl = document.getElementById('trainer-current-badge');
      const killsEl = document.getElementById('trainer-display-kills');
      const scoreEl = document.getElementById('trainer-display-score');

      if (nameEl) nameEl.textContent = currentStudent.name;
      if (titleEl) titleEl.textContent = currentTier.title;
      if (badgeEl) badgeEl.textContent = currentTier.badge;
      if (killsEl) killsEl.textContent = stats.kills;
      if (scoreEl) scoreEl.textContent = stats.totalScore.toLocaleString();

      // 🎖️ 同步刷新勳章技能館畫面與進度
      renderSkillsHall();
      renderModeTabs();
    }

    // ==========================================
    // 🎮 GAME ENGINE: 方案 B【教學難點攻堅方案】
    // ==========================================
    
    // ==========================================
    // 🎲 Fisher-Yates 標準隨機洗牌演算法
    // ==========================================
    function cleanupAllGameModes() {
      if (typeof autoNextTimer !== 'undefined' && autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
      if (typeof speedTimerInterval !== 'undefined' && speedTimerInterval) { clearInterval(speedTimerInterval); speedTimerInterval = null; }
      if (typeof speedHintTimer !== 'undefined' && speedHintTimer) { clearTimeout(speedHintTimer); speedHintTimer = null; }
      if (typeof siegeAnimId !== 'undefined' && siegeAnimId) { cancelAnimationFrame(siegeAnimId); siegeAnimId = null; }
      if (typeof siegeTimeInterval !== 'undefined' && siegeTimeInterval) { clearInterval(siegeTimeInterval); siegeTimeInterval = null; }
      if (typeof survComboTimer !== 'undefined' && survComboTimer) { clearTimeout(survComboTimer); survComboTimer = null; }
      if (typeof survTimeInterval !== 'undefined' && survTimeInterval) { clearInterval(survTimeInterval); survTimeInterval = null; }

      if (typeof handleSpeedKeydown === 'function') window.removeEventListener('keydown', handleSpeedKeydown, true);
      if (typeof handleSiegeKeydown === 'function') window.removeEventListener('keydown', handleSiegeKeydown, true);
      if (typeof handlePetKeydown === 'function') window.removeEventListener('keydown', handlePetKeydown, true);
      if (typeof handleSurvKeydown === 'function') window.removeEventListener('keydown', handleSurvKeydown, true);

      speedActive = false;
      speedRunning = false;
      siegeActive = false;
      siegeRunning = false;
      siegeIsPaused = false;
      petActive = false;
      survActive = false;
    }

    function setGameMode(mode) {
      cleanupAllGameModes();

      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }

      currentQuiz = null;
      currentGameMode = mode;
      try {
        if (typeof BgmManager !== 'undefined') {
          if (mode === 'siege' || mode === 'speed') {
            BgmManager.playTrack('siege_speed');
          } else if (mode === 'pet' || mode === 'survival' || mode === 'standard' || mode === 'connected' || mode === 'split' || mode === 'compound' || mode === 'difficult' || mode === 'special') {
            BgmManager.playTrack('stages');
          } else {
            BgmManager.playTrack('lobby');
          }
        }
      } catch(e) {}

      // 🔒 每日階梯式解鎖鏈安全檢查 (當日得分 150~400 分判定)
      if (typeof P6Mode !== 'undefined') {
        const isTeacher = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
        const unlock = P6Mode.getUnlockStatus(mode, currentStudent?.cls, currentStudent?.num, isTeacher);
        if (!unlock.unlocked) {
          if (typeof isCloudOnline !== 'undefined' && isCloudOnline) {
            showPassToast(`🔒 本關尚未解鎖！今日還差 ${unlock.neededScore} 分（滿 ${unlock.threshold} 分開啟）`);
            return;
          } else {
            showPassToast(`⚠️ 離線安全網：今日尚未滿 ${unlock.threshold} 分，但允許進入練習`);
          }
        }
      }

      renderModeTabs();

      const speedSection = document.getElementById('speed-arena-section');
      const siegeSection = document.getElementById('siege-arena-section');
      const petSection = document.getElementById('pet-arena-section');
      const survSection = document.getElementById('survival-arena-section');
      const wildArena = document.getElementById('capture-arena');
      const targetWord = document.getElementById('target-char');
      const monsterIcon = document.getElementById('monster-icon');
      const targetSubHint = document.getElementById('target-sub-hint');
      const standardSlots = document.getElementById('standard-slots-row');
      const splitSlots = document.getElementById('split-slots-row');
      const secretBox = document.getElementById('secret-box');
      const stageStatusBar = document.querySelector('.stage-status-bar');
      const gamePrompt = document.getElementById('game-prompt');

      // 隱藏所有異構競技場
      if (speedSection) speedSection.style.display = 'none';
      if (siegeSection) siegeSection.style.display = 'none';
      if (petSection) petSection.style.display = 'none';
      if (survSection) survSection.style.display = 'none';

      // 統一輔助函式：切換標準原野抓寶介面（消除跨站殘留標題與文字）
      const setStandardWildVisible = (visible) => {
        const disp = visible ? '' : 'none';
        if (stageStatusBar) stageStatusBar.style.display = visible ? 'flex' : 'none';
        if (gamePrompt) gamePrompt.style.display = disp;
        if (targetWord) targetWord.style.display = disp;
        if (monsterIcon) monsterIcon.style.display = disp;
        if (targetSubHint) targetSubHint.style.display = disp;
        if (wildArena) wildArena.style.display = disp;
        if (secretBox) secretBox.style.display = 'none';
        if (!visible) {
          if (standardSlots) standardSlots.style.display = 'none';
          if (splitSlots) splitSlots.style.display = 'none';
        }
      };

      if (mode === 'siege') {
        setStandardWildVisible(false);
        if (siegeSection) siegeSection.style.display = 'block';
        launchSiegeMatch();
        return;
      }

      if (mode === 'pet') {
        setStandardWildVisible(false);
        if (petSection) petSection.style.display = 'block';
        launchPetMatch();
        return;
      }

      if (mode === 'survival') {
        setStandardWildVisible(false);
        if (survSection) survSection.style.display = 'block';
        returnToSurvivalReadyStage();
        return;
      }

      if (mode === 'speed') {
        setStandardWildVisible(false);
        if (speedSection) speedSection.style.display = 'block';
        initSpeedWeekDropdown();
        returnToSpeedReadyStage();
        window.addEventListener('keydown', handleSpeedKeydown, true);
        return;
      }

      // 標準原野捕捉模式 (connected, split, feature, special)
      setStandardWildVisible(true);
      if (standardSlots) standardSlots.style.display = (mode === 'split') ? 'none' : 'flex';
      if (splitSlots) splitSlots.style.display = (mode === 'split') ? 'flex' : 'none';

      modeQuizQueues[mode] = [];
      startNewSession();
    }

    
    // ==========================================
    // 🔔 速度與通行提示框 (showPassToast)
    // ==========================================
    function setArenaSpeed(speed, activeBtnId) {
      wanderingSpeedMultiplier = speed;
      document.querySelectorAll('.arena-speed-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById(activeBtnId);
      if (activeBtn) activeBtn.classList.add('active');

      let tip = '';
      if (speed > 1.2) {
        tip = '⚡ 切換為【敏捷速度】：精靈球高速遊行，答對享有 1.4x (+40%) 速度積分加成！';
      } else if (speed === 0) {
        tip = '⏸️ 切換為【定點輔助】：精靈球靜止不動，簡易模式得分為 0.6x 折減。';
      } else {
        tip = '🟢 切換為【悠閒模式】：標準遊行速度，答對獲取 1.0x 標準分數。';
      }
      showPassToast(tip);
    }

    function startNewSession() {
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
      gameStage = 1;
      sessionScore = 0;
      sessionCorrectCount = 0;
      comboCount = 0;
      // 保留未出過的題目繼續出題，實現多輪連續不重複；待完整題庫抽盡後才自動觸發新一輪洗牌
      currentQuiz = null;

      document.getElementById('session-summary-box').style.display = 'none';
      document.getElementById('active-play-area').style.display = 'block';
      loadRound();
    }

    function loadRound() {
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }

      selectedCodes = [];
      selectedPrefix = [];
      selectedBody = [];
      roundMistakeCount = 0;
      roundShieldActive = false;

      document.getElementById('secret-box').style.display = 'none';
      document.getElementById('game-stage-tag').textContent = `關卡 ${gameStage} / 5`;
      document.getElementById('game-combo-tag').textContent = `連擊：${comboCount} Hit 🔥`;
      document.getElementById('game-score-tag').textContent = `本輪得分：${sessionScore} 分`;

      const stdRow = document.getElementById('standard-slots-row');
      const splitRow = document.getElementById('split-slots-row');

      if (currentGameMode === 'connected') {
        // 模式 1：連體字全碼突破戰
        stdRow.style.display = 'flex';
        splitRow.style.display = 'none';
        document.getElementById('monster-icon').textContent = '⚔️';

        if (!currentQuiz || !currentQuiz.codes) {
          currentQuiz = getNextQuiz('connected');
        }

        document.getElementById('target-char').textContent = currentQuiz.char;
        document.getElementById('target-sub-hint').textContent = `【連體字全碼取碼】 取碼長度：${currentQuiz.codes.length} 碼 ｜ 依筆順連擊突破！`;
        document.getElementById('game-prompt').textContent = `請依筆順依序捕捉【 ${currentQuiz.char} 】的完整 ${currentQuiz.codes.length} 碼倉頡字根！`;
        document.getElementById('game-prompt').style.color = '#1E3A8A';

        for (let i = 1; i <= 4; i++) {
          const slot = document.getElementById(`slot-${i}`);
          const val = document.getElementById(`val-${i}`);
          const label = document.getElementById(`label-slot-${i}`);
          if (i <= currentQuiz.codes.length) {
            slot.style.display = 'flex';
            slot.className = 'code-slot';
            val.textContent = '？';
            const labels = ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼'];
            label.textContent = labels[i - 1];
          } else {
            slot.style.display = 'none';
          }
        }

        let options = [];
        currentQuiz.codes.forEach((c, idx) => {
          options.push({ code: c, isCorrect: true, stepIdx: idx, orbId: `corr-${idx}` });
        });

        const distractors = fisherYatesShuffle(
          DATA.cangjie_clean_letters.filter(l => !currentQuiz.codes.includes(l.code))
        );

        let distCount = 0;
        while (options.length < 8 && distractors.length > 0) {
          const item = distractors.pop();
          distCount++;
          options.push({ code: item.code, isCorrect: false, orbId: `dist-${distCount}` });
        }
        options = fisherYatesShuffle(options);
        setupWanderingOrbs(options);

      } else if (currentGameMode === 'split') {
        // 模式 2：分體字結構挑戰戰
        stdRow.style.display = 'none';
        splitRow.style.display = 'flex';
        document.getElementById('monster-icon').textContent = '🧩';

        if (!currentQuiz || !currentQuiz.prefix_codes) {
          currentQuiz = getNextQuiz('split');
        }

        document.getElementById('target-char').textContent = currentQuiz.char;
        document.getElementById('target-sub-hint').textContent = `【分體字取碼：字首最多2碼取首尾，字身最多3碼取首二尾】 總碼長度：${currentQuiz.prefix_codes.length + currentQuiz.body_codes.length} 碼！`;
        document.getElementById('game-prompt').textContent = `先捕捉【字首區】(${currentQuiz.prefix_codes.length}碼)，再捕捉【字身區】(${currentQuiz.body_codes.length}碼)！`;
        document.getElementById('game-prompt').style.color = '#7C3AED';

        const pre1 = document.getElementById('slot-pre-1');
        const pre2 = document.getElementById('slot-pre-2');
        pre1.className = 'code-slot'; document.getElementById('val-pre-1').textContent = '？';
        if (currentQuiz.prefix_codes.length > 1) {
          pre2.style.display = 'flex';
          pre2.className = 'code-slot';
          document.getElementById('val-pre-2').textContent = '？';
          document.getElementById('label-pre-1').textContent = '字首首碼';
          document.getElementById('label-pre-2').textContent = '字首尾碼';
        } else {
          pre2.style.display = 'none';
          document.getElementById('label-pre-1').textContent = '字首碼';
        }

        for (let i = 1; i <= 3; i++) {
          const bSlot = document.getElementById(`slot-body-${i}`);
          const bVal = document.getElementById(`val-body-${i}`);
          const bLabel = document.getElementById(`label-body-${i}`);
          if (i <= currentQuiz.body_codes.length) {
            bSlot.style.display = 'flex';
            bSlot.className = 'code-slot';
            bVal.textContent = '？';
            if (currentQuiz.body_codes.length === 1) {
              if (bLabel) bLabel.textContent = '字身碼';
            } else if (currentQuiz.body_codes.length === 2) {
              if (bLabel) bLabel.textContent = i === 1 ? '字身首碼' : '字身尾碼';
            } else if (currentQuiz.body_codes.length === 3) {
              if (bLabel) bLabel.textContent = i === 1 ? '字身首碼' : (i === 2 ? '字身次碼' : '字身尾碼');
            }
          } else {
            bSlot.style.display = 'none';
          }
        }

        let options = [];
        currentQuiz.prefix_codes.forEach((c, idx) => {
          options.push({ code: c, part: 'prefix', partIdx: idx, isCorrect: true, orbId: `pre-${idx}` });
        });
        currentQuiz.body_codes.forEach((c, idx) => {
          options.push({ code: c, part: 'body', partIdx: idx, isCorrect: true, orbId: `body-${idx}` });
        });

        const allTargetCodes = [...currentQuiz.prefix_codes, ...currentQuiz.body_codes];
        const distractors = fisherYatesShuffle(
          DATA.cangjie_clean_letters.filter(l => !allTargetCodes.includes(l.code))
        );

        let distCount = 0;
        while (options.length < 8 && distractors.length > 0) {
          const item = distractors.pop();
          distCount++;
          options.push({ code: item.code, isCorrect: false, orbId: `dist-${distCount}` });
        }
        options = fisherYatesShuffle(options);
        setupWanderingOrbs(options);

      } else if (currentGameMode === 'feature') {
        stdRow.style.display = 'flex';
        splitRow.style.display = 'none';
        document.getElementById('monster-icon').textContent = '🕵️';

        if (!currentQuiz || !currentQuiz.codes) {
          currentQuiz = getNextQuiz('feature');
        }

        document.getElementById('target-char').textContent = currentQuiz.char;
        document.getElementById('target-sub-hint').textContent = currentQuiz.secret || '【字形神探】字形特徵原則特訓（包含、交錯、連貫）！';
        document.getElementById('game-prompt').textContent = `請依筆順依序捕捉【 ${currentQuiz.char} 】的字形特徵倉頡字碼！`;
        document.getElementById('game-prompt').style.color = '#0D9488';

        for (let i = 1; i <= 4; i++) {
          const slot = document.getElementById(`slot-${i}`);
          const val = document.getElementById(`val-${i}`);
          const label = document.getElementById(`label-slot-${i}`);
          if (i <= currentQuiz.codes.length) {
            slot.style.display = 'flex';
            slot.className = 'code-slot';
            val.textContent = '？';
            const labels = ['① 首碼', '② 次碼', '③ 尾碼', '④ 末碼'];
            label.textContent = labels[i - 1];
          } else {
            slot.style.display = 'none';
          }
        }

        let options = [];
        currentQuiz.codes.forEach((c, idx) => {
          options.push({ code: c, isCorrect: true, stepIdx: idx, orbId: `feat-${idx}` });
        });

        const distractors = fisherYatesShuffle(
          DATA.cangjie_clean_letters.filter(l => !currentQuiz.codes.includes(l.code))
        );

        let distCount = 0;
        while (options.length < 8 && distractors.length > 0) {
          const item = distractors.pop();
          distCount++;
          options.push({ code: item.code, isCorrect: false, orbId: `dist-${distCount}` });
        }
        options = fisherYatesShuffle(options);
        setupWanderingOrbs(options);
      } else if (currentGameMode === 'special') {
        // 模式 3：難字與複合字特訓
        stdRow.style.display = 'flex';
        splitRow.style.display = 'none';
        document.getElementById('monster-icon').textContent = '🔮';

        if (!currentQuiz || !currentQuiz.codes) {
          currentQuiz = getNextQuiz('special');
        }

        document.getElementById('target-char').textContent = currentQuiz.char;
        document.getElementById('target-sub-hint').textContent = `【${currentQuiz.type}】 特殊取碼規則特訓！`;
        document.getElementById('game-prompt').textContent = `捕捉【 ${currentQuiz.char} 】的特殊字根球（注意難字 X 鍵或複合字碼）！`;
        document.getElementById('game-prompt').style.color = '#059669';

        for (let i = 1; i <= 4; i++) {
          const slot = document.getElementById(`slot-${i}`);
          const val = document.getElementById(`val-${i}`);
          const label = document.getElementById(`label-slot-${i}`);
          if (i <= currentQuiz.codes.length) {
            slot.style.display = 'flex';
            slot.className = 'code-slot';
            val.textContent = '？';
            const labels = ['① 首碼', '② 次碼', '③ 尾碼', '④ 末碼'];
            label.textContent = labels[i - 1];
          } else {
            slot.style.display = 'none';
          }
        }

        let options = [];
        currentQuiz.codes.forEach((c, idx) => {
          options.push({ code: c, isCorrect: true, stepIdx: idx, orbId: `spec-${idx}` });
        });

        const distractors = fisherYatesShuffle(
          DATA.cangjie_clean_letters.filter(l => !currentQuiz.codes.includes(l.code))
        );

        let distCount = 0;
        while (options.length < 8 && distractors.length > 0) {
          const item = distractors.pop();
          distCount++;
          options.push({ code: item.code, isCorrect: false, orbId: `dist-${distCount}` });
        }
        options = fisherYatesShuffle(options);
        setupWanderingOrbs(options);
      }

      // 戰鬥隨機技能觸發：精準直覺 (修正：僅動態高亮首碼字根球，避免一次全亮導致點擊誤判失靈)
      focusSkillActiveThisRound = false;
      const focusSkill = activeSkills.find(s => s.name.includes('精準直覺'));
      if (focusSkill && Math.random() < focusSkill.rate) {
        focusSkillActiveThisRound = true;
        let targetCode = '';
        if (currentGameMode === 'connected' || currentGameMode === 'special' || currentGameMode === 'feature') {
          targetCode = (currentQuiz.codes && currentQuiz.codes[0]) ? currentQuiz.codes[0] : '';
        } else if (currentGameMode === 'split') {
          targetCode = (currentQuiz.prefix_codes && currentQuiz.prefix_codes[0]) ? currentQuiz.prefix_codes[0] : '';
        }
        if (targetCode) {
          activeOrbs.forEach(orb => {
            if (orb.code === targetCode && orb.isCorrect) {
              orb.el.classList.add('highlight-focus');
            }
          });
          triggerSkillToast('⚡', `觸發【精準直覺】！感應到首碼字根【${targetCode}】發出強烈能量光暈！`);
        }
      }
    }

    // 精靈球物理遊行引擎 (純粹精靈球，無提示，無灰色殘留)
    function setupWanderingOrbs(options) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      const arena = document.getElementById('capture-arena');
      const orbsContainer = document.getElementById('orbs-container');
      orbsContainer.innerHTML = '';

      const arenaW = arena.clientWidth || 600;
      const arenaH = arena.clientHeight || 250;
      const orbSize = 72;

      const padX = 14;
      const padTop = 44;
      const padBottom = 14;
      const minX = padX;
      const maxX = Math.max(minX + 10, arenaW - orbSize - padX);
      const minY = padTop;
      const maxY = Math.max(minY + 10, arenaH - orbSize - padBottom);

      activeOrbs = [];

      options.forEach((opt, idx) => {
        const el = document.createElement('div');
        el.className = 'poke-orb';
        el.id = `orb-${idx}`;

        el.innerHTML = `
          <div class="poke-orb-center-ring"></div>
          <div class="poke-orb-content">
            <div class="poke-orb-char">${opt.code}</div>
          </div>
        `;

        const cols = 4;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellW = (maxX - minX) / cols;
        const cellH = (maxY - minY) / 2;
        const initX = minX + col * cellW + Math.random() * (cellW * 0.35);
        const initY = minY + row * cellH + Math.random() * (cellH * 0.35);

        const angle = Math.random() * Math.PI * 2;
        const baseSpeed = 0.85 + Math.random() * 0.4;
        const vx = Math.cos(angle) * baseSpeed;
        const vy = Math.sin(angle) * baseSpeed;

        const orbObj = {
          el: el,
          ...opt,
          x: Math.max(minX, Math.min(maxX, initX)),
          y: Math.max(minY, Math.min(maxY, initY)),
          vx: vx,
          vy: vy,
          isHovered: false,
          isCaught: false
        };

        el.addEventListener('mouseenter', () => { orbObj.isHovered = true; });
        el.addEventListener('mouseleave', () => { orbObj.isHovered = false; });
        el.addEventListener('click', () => { catchOrb(orbObj); });

        orbsContainer.appendChild(el);
        activeOrbs.push(orbObj);
      });

      runWanderingPhysics();
    }

    function runWanderingPhysics() {
      const arena = document.getElementById('capture-arena');
      const arenaW = arena.clientWidth || 600;
      const arenaH = arena.clientHeight || 250;
      const orbSize = 72;

      const padX = 14;
      const padTop = 44;
      const padBottom = 14;
      const minX = padX;
      const maxX = Math.max(minX + 10, arenaW - orbSize - padX);
      const minY = padTop;
      const maxY = Math.max(minY + 10, arenaH - orbSize - padBottom);

      activeOrbs.forEach(o => {
        if (!o.isHovered && wanderingSpeedMultiplier > 0) {
          o.x += o.vx * wanderingSpeedMultiplier;
          o.y += o.vy * wanderingSpeedMultiplier;

          if (o.x <= minX) { o.x = minX; o.vx = Math.abs(o.vx); }
          else if (o.x >= maxX) { o.x = maxX; o.vx = -Math.abs(o.vx); }

          if (o.y <= minY) { o.y = minY; o.vy = Math.abs(o.vy); }
          else if (o.y >= maxY) { o.y = maxY; o.vy = -Math.abs(o.vy); }
        }
        o.el.style.transform = `translate3d(${o.x}px, ${o.y}px, 0)`;
      });

      animationFrameId = requestAnimationFrame(runWanderingPhysics);
    }

    // ==========================================
    // 點選捕捉判定 (修復：錯誤時不消失、連續5次失誤提示)
    // ==========================================
    function catchOrb(orbObj) {
      if (!orbObj || orbObj.isCaught || (orbObj.el && orbObj.el.classList.contains('caught'))) return;
      let currentNeededCode = '';

      if (currentGameMode === 'connected' || currentGameMode === 'special' || currentGameMode === 'feature') {
        const neededIdx = selectedCodes.length;
        currentNeededCode = currentQuiz.codes[neededIdx];

        if (orbObj.code === currentNeededCode) {
          orbObj.isCaught = true;
          orbObj.el.classList.add('caught');
          orbObj.el.classList.remove('highlight-focus');
          orbObj.el.classList.remove('highlight-hint');
          orbObj.el.style.pointerEvents = 'none';

          selectedCodes.push(orbObj.code);
          const currentSlot = document.getElementById(`slot-${neededIdx + 1}`);
          currentSlot.className = 'code-slot filled';
          document.getElementById(`val-${neededIdx + 1}`).textContent = orbObj.code;

          // 若本輪觸發了【精準直覺】，動態引導高亮下一碼字根球
          if (focusSkillActiveThisRound && selectedCodes.length < currentQuiz.codes.length) {
            const nextNeeded = currentQuiz.codes[selectedCodes.length];
            activeOrbs.forEach(o => {
              if (o.code === nextNeeded && !o.isCaught) {
                o.el.classList.add('highlight-focus');
              }
            });
          }

          if (selectedCodes.length < currentQuiz.codes.length) {
            document.getElementById('game-prompt').innerHTML = `🎯 <span style="color:#2563EB;font-weight:900;">成功捕捉第 ${neededIdx + 1} 碼【${orbObj.code}】！快捕捉下一碼！</span>`;
          } else {
            checkAnswer(true);
          }
        } else {
          triggerMistake(orbObj, `捕捉錯誤！【${orbObj.code}】不是當前所需字碼，請再試！`);
        }

      } else if (currentGameMode === 'split') {
        const preLen = currentQuiz.prefix_codes.length;
        const bodyLen = currentQuiz.body_codes.length;

        if (selectedPrefix.length < preLen) {
          currentNeededCode = currentQuiz.prefix_codes[selectedPrefix.length];
          if (orbObj.code === currentNeededCode) {
            orbObj.isCaught = true;
            orbObj.el.classList.add('caught');
            orbObj.el.classList.remove('highlight-focus');
            orbObj.el.classList.remove('highlight-hint');
            orbObj.el.style.pointerEvents = 'none';

            selectedPrefix.push(orbObj.code);
            const slot = document.getElementById(`slot-pre-${selectedPrefix.length}`);
            slot.className = 'code-slot filled';
            document.getElementById(`val-pre-${selectedPrefix.length}`).textContent = orbObj.code;

            // 若本輪觸發【精準直覺】，動態更新高亮
            if (focusSkillActiveThisRound) {
              let nextNeeded = '';
              if (selectedPrefix.length < preLen) {
                nextNeeded = currentQuiz.prefix_codes[selectedPrefix.length];
              } else if (selectedBody.length < bodyLen) {
                nextNeeded = currentQuiz.body_codes[selectedBody.length];
              }
              if (nextNeeded) {
                activeOrbs.forEach(o => {
                  if (o.code === nextNeeded && !o.isCaught) {
                    o.el.classList.add('highlight-focus');
                  }
                });
              }
            }

            if (selectedPrefix.length < preLen) {
              document.getElementById('game-prompt').innerHTML = `🔵 <span style="color:#1D4ED8;font-weight:900;">字首首碼命中！接著捕捉字首尾碼！</span>`;
            } else {
              document.getElementById('game-prompt').innerHTML = `🟣 <span style="color:#6D28D9;font-weight:900;">字首完成！接著捕捉【字身區】字碼！</span>`;
            }
          } else {
            triggerMistake(orbObj, `捕捉錯誤！這是字首區，【${orbObj.code}】不屬於字首，請再試！`);
          }

        } else if (selectedBody.length < bodyLen) {
          currentNeededCode = currentQuiz.body_codes[selectedBody.length];
          if (orbObj.code === currentNeededCode) {
            orbObj.isCaught = true;
            orbObj.el.classList.add('caught');
            orbObj.el.classList.remove('highlight-focus');
            orbObj.el.classList.remove('highlight-hint');
            orbObj.el.style.pointerEvents = 'none';

            selectedBody.push(orbObj.code);
            const slot = document.getElementById(`slot-body-${selectedBody.length}`);
            slot.className = 'code-slot filled';
            document.getElementById(`val-body-${selectedBody.length}`).textContent = orbObj.code;

            // 若本輪觸發【精準直覺】，動態更新高亮
            if (focusSkillActiveThisRound && selectedBody.length < bodyLen) {
              const nextNeeded = currentQuiz.body_codes[selectedBody.length];
              activeOrbs.forEach(o => {
                if (o.code === nextNeeded && !o.isCaught) {
                  o.el.classList.add('highlight-focus');
                }
              });
            }

            if (selectedBody.length < bodyLen) {
              document.getElementById('game-prompt').innerHTML = `🟣 <span style="color:#6D28D9;font-weight:900;">字身命中 (${selectedBody.length}/${bodyLen})，快找出下一碼！</span>`;
            } else {
              checkAnswer(true);
            }
          } else {
            triggerMistake(orbObj, `捕捉錯誤！【${orbObj.code}】不是當前字身所需碼，請再試！`);
          }
        }
      }
    }

    
    // 🎈 浮動扣分與罰時標籤動畫生成器
    function triggerFloatingNotice(targetEl, text) {
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      const tag = document.createElement('div');
      tag.className = 'floating-deduct-tag';
      tag.textContent = text;
      tag.style.left = (rect.left + rect.width / 2) + 'px';
      tag.style.top = rect.top + 'px';
      document.body.appendChild(tag);
      setTimeout(() => tag.remove(), 850);
    }

    function triggerMistake(orbObj, alertMsg) {
      roundMistakeCount++;

      // 錯誤搖晃動效，不隱藏球體
      orbObj.el.classList.add('mistake-shake');
      setTimeout(() => {
        orbObj.el.classList.remove('mistake-shake');
      }, 500);

      const shieldSkill = activeSkills.find(s => s.name.includes('聖盾防護'));
      const timewardSkill = activeSkills.find(s => s.name.includes('時空結界'));
      if (!roundShieldActive && ((shieldSkill && Math.random() < shieldSkill.rate) || (timewardSkill && Math.random() < timewardSkill.rate))) {
        roundShieldActive = true;
        triggerSkillToast('🛡️', '觸發【聖盾防護】！成功格擋失誤，保留連擊！');
        document.getElementById('game-prompt').innerHTML = `🛡️ <span style="color:#2563EB;font-weight:900;">聖盾格擋成功！失誤已免除，連擊保留，請再試！</span>`;
      } else {
        comboCount = 0;
        document.getElementById('game-combo-tag').textContent = `連擊：0 Hit 🔥`;
        
        // 🎯 依使用者需求：按錯選項按比例扣減得分 (-2 分)
        const deductPts = 2;
        sessionScore = Math.max(0, sessionScore - deductPts);
        document.getElementById('game-score-tag').textContent = `本輪得分：${sessionScore} 分 (-${deductPts})`;
        
        // 浮動扣分紅字提示
        if (typeof triggerFloatingNotice === 'function' && orbObj && orbObj.el) {
          triggerFloatingNotice(orbObj.el, `-${deductPts} 分 ⚠️`);
        }
        
        document.getElementById('game-prompt').innerHTML = `⚠️ <span style="color:#DC2626;font-weight:900;">${alertMsg} (扣減 ${deductPts} 分)</span>`;
      }

      // ★ 連續選錯超過 5 次：給予強烈提示與答案展開
      if (roundMistakeCount >= 5) {
        let needed = '';
        if (currentGameMode === 'connected' || currentGameMode === 'special' || currentGameMode === 'feature') {
          needed = currentQuiz.codes[selectedCodes.length];
        } else if (currentGameMode === 'split') {
          if (selectedPrefix.length < currentQuiz.prefix_codes.length) {
            needed = currentQuiz.prefix_codes[selectedPrefix.length];
          } else {
            needed = currentQuiz.body_codes[selectedBody.length];
          }
        }

        // 原野中將該正確字碼球高亮金光環繞
        activeOrbs.forEach(o => {
          if (o.code === needed && !o.el.classList.contains('caught')) {
            o.el.classList.add('highlight-hint');
          }
        });

        document.getElementById('game-prompt').innerHTML = `💡 <span style="color:#D97706;font-weight:900;">【提示模式已啟動（已失誤 ${roundMistakeCount} 次）】：目標字根為金光閃爍的【${needed}】球！</span>`;
        
        // 展開拆碼解析秘笈供學生學習
        document.getElementById('secret-box').style.display = 'block';
        document.getElementById('secret-char-badge').textContent = `標準倉頡全碼：${currentQuiz.full}`;
        document.getElementById('secret-desc').textContent = currentQuiz.secret;

        triggerSkillToast('💡', `連續失誤 5 次！雷達已為你感應並鎖定目標字根【${needed}】！`);
      }
    }

    // 通關結算
    function checkAnswer(isCorrect) {
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }

      const secretBox = document.getElementById('secret-box');
      secretBox.style.display = 'block';

      let baseScore = 15;
      if (currentGameMode === 'special') baseScore = 10;
      
      // 🎯 依失誤次數按比例扣減結算基礎分 (每次失誤扣 2 分，模式1保底3分，模式3保底2分)
      const minBase = (currentGameMode === 'special') ? 2 : 3;
      const penalty = Math.min(baseScore - minBase, roundMistakeCount * 2);
      baseScore = Math.max(minBase, baseScore - penalty);

      document.getElementById('secret-char-badge').textContent = `標準倉頡全碼：${currentQuiz.full}`;
      document.getElementById('secret-desc').textContent = currentQuiz.secret;

      if (isCorrect) {
        comboCount++;
        sessionCorrectCount++;

        // 🎯 游行速度不同選擇對得分的影響 (定點最容易得分最低，敏捷最高)
        let speedMultiplier = 1.0;
        let speedNotice = '';
        if (wanderingSpeedMultiplier > 1.2) {
          speedMultiplier = 1.4; // 敏捷模式獎勵 +40%
          speedNotice = '⚡敏捷1.4x';
        } else if (wanderingSpeedMultiplier === 0) {
          speedMultiplier = 0.6; // 定點簡易模式扣減至 60%
          speedNotice = '⏸️定點0.6x';
        } else {
          speedMultiplier = 1.0; // 悠閒標準模式 100%
          speedNotice = '🟢悠閒1.0x';
        }

        let roundEarned = Math.max(1, Math.round(baseScore * speedMultiplier));

        let comboBonus = 0;
        if (comboCount === 2) comboBonus = 2;
        else if (comboCount === 3) comboBonus = 4;
        else if (comboCount === 4) comboBonus = 6;
        else if (comboCount >= 5) comboBonus = 10;

        roundEarned += comboBonus;

        let skillBonus = 0;
        const critSkill = activeSkills.find(s => s.name.includes('烈焰爆擊'));
        if (critSkill && Math.random() < critSkill.rate) {
          skillBonus += 5;
          triggerSkillToast('💥', '觸發【烈焰爆擊】！傷害提升，額外獲得 +5 分！');
        }

        const divineSkill = activeSkills.find(s => s.name.includes('神域天罰'));
        if (divineSkill && Math.random() < divineSkill.rate) {
          skillBonus += 6;
          triggerSkillToast('🌌', '觸發【神域天罰】！天雷降臨，額外獲得 +6 分！');
        }

        const chainSkill = activeSkills.find(s => s.name.includes('極限連擊'));
        if (chainSkill && comboCount >= 2 && Math.random() < chainSkill.rate) {
          skillBonus += 3;
          triggerSkillToast('🌊', '觸發【極限連擊】！連擊增益額外獲得 +3 分！');
        }

        const auraSkill = activeSkills.find(s => s.name.includes('波導感知'));
        if (auraSkill && comboCount >= 3 && Math.random() < auraSkill.rate) {
          skillBonus += 2;
          triggerSkillToast('🌀', '觸發【波導感知】！波導同頻，額外獲得 +2 分！');
        }

        const dynamaxSkill = activeSkills.find(s => s.name.includes('極巨衝能'));
        if (dynamaxSkill && Math.random() < dynamaxSkill.rate) {
          skillBonus += 4;
          triggerSkillToast('🌠', '觸發【極巨衝能】！極巨能量爆發，額外獲得 +4 分！');
        }

        const swiftSkill = activeSkills.find(s => s.name.includes('疾風迅雷'));
        if (swiftSkill && Math.random() < swiftSkill.rate) {
          skillBonus += 3;
          triggerSkillToast('⚡', '觸發【疾風迅雷】！疾風神速，額外獲得 +3 分！');
        }

        const starlightSkill = activeSkills.find(s => s.name.includes('星輝庇佑'));
        if (starlightSkill && comboCount >= 4 && Math.random() < starlightSkill.rate) {
          skillBonus += 4;
          triggerSkillToast('💫', '觸發【星輝庇佑】！星輝守護，額外獲得 +4 分！');
        }

        const genesisSkill = activeSkills.find(s => s.name.includes('創世審判'));
        if (genesisSkill && Math.random() < genesisSkill.rate) {
          skillBonus += 6;
          triggerSkillToast('🔱', '觸發【創世審判】！創世神光降臨，額外獲得 +6 分！');
        }

        roundEarned += skillBonus;

        // 🎯 依使用者規則：前置關卡按次數衰減 (第1次全額, 第2次一半, 第3次1/4, 滿3次為練習)
        let decayMult = 1.0;
        const isTeacherCheck = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
        if (typeof P6Mode !== 'undefined' && currentStudent) {
          decayMult = P6Mode.getScoreDecayMultiplier(currentGameMode, currentStudent.cls, currentStudent.num, isTeacherCheck);
        }
        let actualEarned = Math.round(roundEarned * decayMult);
        sessionScore += actualEarned;

        document.getElementById('game-score-tag').textContent = `本輪得分：${sessionScore} 分 (+${roundEarned} ${speedNotice})`;
        document.getElementById('game-combo-tag').textContent = `連擊：${comboCount} Hit 🔥`;
        document.getElementById('monster-icon').textContent = '💥';

        if (currentStudent) {
          saveStudentStats(currentStudent.cls, currentStudent.num, actualEarned, true, currentGameMode);
          try { loadStudentProfile(); } catch(e) { console.error('loadStudentProfile error:', e); }
        }

        burstConfetti();

        let modeName = currentGameMode === 'connected' ? '連體字突破' : currentGameMode === 'split' ? '分體字挑戰' : '難字特訓';
        let clearMsg = `🎉 <span style="color:#15803D;font-weight:900;">完美通關！全碼擊破【${currentQuiz.char}】！(+${roundEarned}分)</span>`;

        if (gameStage < 5) {
          document.getElementById('game-prompt').innerHTML = `${clearMsg} <span style="color:#2563EB;font-weight:800;margin-left:8px;">➔ 即將自動進入第 ${gameStage + 1} 關...</span>`;
          triggerStagePassToast(modeName, gameStage, actualEarned, gameStage + 1);
          autoNextTimer = setTimeout(() => nextRound(), 1400);
        } else {
          if (typeof P6Mode !== 'undefined' && currentStudent) {
            P6Mode.incrementDailyStationPlayCount(currentGameMode, currentStudent.cls, currentStudent.num);
          }
          document.getElementById('game-prompt').innerHTML = `🏆 <span style="color:#D97706;font-weight:900;">太強了！5 關挑戰全數通關！(+${roundEarned}分) ➔ 正在進行總結算...</span>`;
          triggerStagePassToast(modeName, 5, roundEarned, null);
          autoNextTimer = setTimeout(() => nextRound(), 1400);
        }
      }
    }

    function nextRound() {
      currentQuiz = null;
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }

      if (gameStage >= 5) {
        document.getElementById('active-play-area').style.display = 'none';
        const summaryBox = document.getElementById('session-summary-box');
        summaryBox.style.display = 'block';

        let clearBonus = 0;
        if (sessionCorrectCount === 5) {
          clearBonus = 20;
          sessionScore += clearBonus;
          if (currentStudent) {
            saveStudentStats(currentStudent.cls, currentStudent.num, clearBonus, false, currentGameMode);
            loadStudentProfile();
          }
          document.getElementById('summary-congrats-text').innerHTML = `🌟 <strong>大滿貫！5 關全中！</strong> 額外獎勵 <strong>+${clearBonus}</strong> 點通關積分！`;
        } else {
          document.getElementById('summary-congrats-text').textContent = `本輪挑戰完成！答對 ${sessionCorrectCount} 關，繼續挑戰突破極限！`;
        }

        const stats = currentStudent ? getStudentStats(currentStudent.cls, currentStudent.num) : { totalScore: sessionScore };
        const { currentTier } = evalTierAndSkills(stats.totalScore);

        document.getElementById('summary-correct-stat').textContent = `${sessionCorrectCount} / 5 關`;
        document.getElementById('summary-earned-stat').textContent = `+${sessionScore} 分`;
        document.getElementById('summary-total-stat').textContent = `${stats.totalScore.toLocaleString()} 分`;
        document.getElementById('summary-title-stat').textContent = currentTier.title;

        burstConfetti();
      } else {
        gameStage++;
        loadRound();
      }
    }

    // Leaderboard Modal
    // currentLeaderboardFilter already declared at top
    function openLeaderboardModal(defaultType) {
      if (defaultType === 'speed') {
        switchLeaderboardType('speed');
      } else {
        switchLeaderboardType('score');
      }
      openModal('modal-leaderboard');
      if (typeof fetchCloudLeaderboard === 'function') {
        fetchCloudLeaderboard(true);
      }
    }

    function filterLeaderboard(cls) {
      currentLeaderboardFilter = cls;
      document.querySelectorAll('.lb-filter-btn').forEach(b => {
        const isAll = (cls === 'ALL' && b.textContent.includes('全級總榜'));
        const isClass = (cls !== 'ALL' && b.textContent.includes(cls));
        b.classList.toggle('active', isAll || isClass);
      });
      renderLeaderboardTable();
    }

    
    // =========================================================================
    // 🌐 全級跨電腦即時天梯連動引擎 (Cloud Real-Time Sync)
    // =========================================================================
    let isFetchingCloudLeaderboard = false;
    let lastCloudSyncTime = null;

    function updateSyncStatus(msg, isError = false) {
      try {
        const text = document.getElementById('lb-cloud-status');
        if (text) {
          text.textContent = msg;
          text.style.background = isError ? '#FEF2F2' : '#F0FDF4';
          text.style.color = isError ? '#DC2626' : '#15803D';
          text.style.borderColor = isError ? '#F87171' : '#86EFAC';
        }
      } catch(e) {}
    }

    async function fetchCloudLeaderboard(silent = false) {
      if (isFetchingCloudLeaderboard) return;
      const url = getGasWebhookUrl();
      if (!url) {
        updateSyncStatus('🟡 離線單機模式', false);
        if (!silent) {
          showPassToast('🟡 本機離線模式：全級榮譽榜已就緒');
        }
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        isFetchingCloudLeaderboard = true;
        if (!silent) updateSyncStatus('⏳ 正在同步 Google 雲端試算表最新題庫與榮譽榜...');

        // 🛡️ 方案 A 錯峰防護：隨機等待 0~300ms (打散電腦室全班併發請求)
        await new Promise(r => setTimeout(r, Math.random() * 300));

        // 🚀 方案 A：向 GAS 請求完整動態題庫與天梯戰況 (支援 CacheService 記憶體秒級回傳)
        const queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_data&t=' + Date.now();
        const res = await fetch(queryUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error('伺服器 HTTP 狀態碼: ' + res.status);

        const data = await res.json();
        if (data && data.status === "success") {
          isCloudOnline = true;
          // 1. 動態更新名冊與天梯榜單 (雙向欄位正規化，確保相容離線與雲端)
          if (Array.isArray(data.combatLeaderboard) && data.combatLeaderboard.length > 0) {
            DATA.benchmark_leaderboard = data.combatLeaderboard.map(item => {
              const pts = (typeof item.grandTotal === 'number') ? item.grandTotal : 
                          ((typeof item.score === 'number') ? item.score : (parseInt(item.totalScore, 10) || 0));
              const badge = item.badge || item.title || '🥉【新手訓練家】';
              const time = item.lastTime || item.date || '';
              return {
                ...item,
                score: pts,
                grandTotal: pts,
                total: pts,
                todayScore: (typeof item.todayScore === 'number') ? item.todayScore : 0,
                title: badge,
                badge: badge,
                kills: (typeof item.kills === 'number') ? item.kills : 0,
                date: time,
                lastTime: time
              };
            });
            // 雲端即時 Top 40 資料同步正規化
            // ★ 保持全級前 40 名龍虎榜（嚴格依據周次功課 1-4 總分與交齊日期時間排序，絕不以討伐積分覆蓋）
            if (DATA.top40 && Array.isArray(DATA.top40)) {
              DATA.top40.sort((a, b) => {
                const scoreA = a.total ?? a.score ?? 0;
                const scoreB = b.total ?? b.score ?? 0;
                if (scoreB !== scoreA) return scoreB - scoreA;
                const timeA = new Date(a.date || a.lastTime || '2099-12-31').getTime();
                const timeB = new Date(b.date || b.lastTime || '2099-12-31').getTime();
                return timeA - timeB;
              });
              DATA.top40.forEach((item, idx) => { item.rank = idx + 1; });
            }

            // 🔄 若當前已有學生登入，立即刷新其個人檔案與技能境界
            if (currentStudent) {
              loadStudentProfile();
            }
          }
          if (data.speedLeaderboard || data.speedByWeek) {
            DATA.cloud_speed_records = data.speedLeaderboard || data.speedByWeek;
          }
          if (Array.isArray(data.top40) && data.top40.length > 0) {
            DATA.top40 = data.top40;
          }
          if (data.class_top10) DATA.class_top10 = data.class_top10;
          if (data.perfect_students) DATA.perfect_students = data.perfect_students;

          // 2. 🛡️ 方案 A 核心：動態由雲端載入本週及全部正式題庫 (GitHub 完全不公開)
          if (data.weeklyBanks && typeof data.weeklyBanks === 'object' && Object.keys(data.weeklyBanks).length > 0) {
            window.MODE2_WEEKLY_BANKS = data.weeklyBanks;
            // 🛡️ 權威校本防護：防止雲端 Webhook 快取殘留或舊部署覆蓋導致字碼偏差
            Object.values(window.MODE2_WEEKLY_BANKS).forEach(b => {
              if (b && Array.isArray(b.words)) {
                b.words.forEach(w => {
                  if (w && w.char === '機') {
                    w.codes = ['木', '女', '戈', '戈'];
                    w.keys = ['D', 'V', 'I', 'I'];
                    w.full = '木女戈戈 (DVII)';
                    w.secret = '機：木女戈戈 (DVII)';
                  }
                });
              }
            });
            if (typeof initSpeedWeekDropdown === 'function') {
              try { initSpeedWeekDropdown(); } catch(e) {}
            }
            // 自動校準鍵位
            Object.values(window.MODE2_WEEKLY_BANKS).forEach(b => {
              if (b && Array.isArray(b.words)) {
                b.words.forEach(w => {
                  if (typeof autoDeriveWordKeys === 'function') autoDeriveWordKeys(w);
                });
              }
            });
          }
          if (Array.isArray(data.cangjieWords) && data.cangjieWords.length > 0) {
            DATA.cangjie_words = data.cangjieWords;
          }
          if (Array.isArray(data.connectedWords) && data.connectedWords.length > 0) {
            DATA.connected_words = data.connectedWords;
          }
          if (Array.isArray(data.splitWords) && data.splitWords.length > 0) {
            DATA.split_words = data.splitWords;
          }
          if (Array.isArray(data.specialWords) && data.specialWords.length > 0) {
            DATA.special_words = data.specialWords;
          }

          // 3. 刷新頁面天梯排行榜渲染
          renderLeaderboardTable();
          renderSpeedLeaderboardTable();

          // 4. 更新頂部數據統計條
          if (data.stats) {
            const pCountEl = document.querySelector('.stat-pill:nth-child(1)');
            if (pCountEl && data.stats.perfectCount !== undefined) {
              pCountEl.innerHTML = `🎉 滿分訓練家：<strong>${data.stats.perfectCount} 位同學獲得 400 分！</strong>`;
            }
            const avgEl = document.querySelector('.stat-pill:nth-child(2)');
            if (avgEl && data.stats.avgScore !== undefined) {
              avgEl.innerHTML = `⭐ 全級平均分：<strong>${data.stats.avgScore} 分</strong>`;
            }
            const speedKingEl = document.querySelector('.stat-pill:nth-child(3)');
            if (speedKingEl && data.stats.speedKing) {
              speedKingEl.innerHTML = `⚡ 速度神捕：<strong>${data.stats.speedKing}</strong>`;
            }
          }

          lastCloudSyncTime = new Date();
          const timeStr = lastCloudSyncTime.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          updateSyncStatus(`✅ 雲端已同步 (${timeStr})`, false);
          if (!silent) showPassToast('⚡ 雲端試算表最新題庫與榮譽榜已即時同步！');
        } else {
          throw new Error((data && data.message) ? data.message : '後端回傳格式非 success');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('雲端載入提醒 (自動維持本機安全離線模式):', err);
        const errMsg = (err.name === 'AbortError') ? '連線超時(>6s)' : (err.message || '權限或跨域阻擋');
        updateSyncStatus(`🔴 同步失敗: ${errMsg}`, true);
        if (!silent) showPassToast(`⚠️ 雲端連線失敗: ${errMsg} (請點擊狀態標籤查看詳情)`);
      } finally {
        isFetchingCloudLeaderboard = false;
      }
    }

    // 🛡️ 格式化勳章稱號 (防範數字代碼或異常格式，保證 100% 呈現標準圖文勳章)
    function getFormattedBadgeTitle(item) {
      if (!item) return '🥉【新手訓練家】';
      let titleStr = item.badge || item.title;
      // 若為純數字 (例如被誤寫為 5) 或缺少【】括號，依分數動態重新評定
      if (!titleStr || !isNaN(titleStr) || titleStr === '5' || !String(titleStr).includes('【')) {
        const score = (typeof item.score === 'number') ? item.score : (parseInt(item.grandTotal, 10) || 0);
        if (typeof evalTierAndSkills === 'function') {
          const { currentTier } = evalTierAndSkills(score);
          return `${currentTier.badge}【${currentTier.title}】`;
        }
        return '🥉【新手訓練家】';
      }
      return String(titleStr);
    }

    function renderLeaderboardTable() {
      if (currentLeaderboardType === 'speed') {
        renderSpeedLeaderboardTable();
        return;
      }

      // 恢復討伐累積總分榜表頭 (7欄)
      const thead = document.querySelector('#modal-leaderboard thead tr');
      if (thead) {
        thead.innerHTML = `
          <th>排名</th>
          <th>班別</th>
          <th>學號</th>
          <th>訓練家代號</th>
          <th>勳章稱號</th>
          <th>討伐總分</th>
          <th>擊倒魔王</th>
        `;
      }

      const scoreLabel = document.getElementById('lb-my-score-label');
      const rankLabel = document.getElementById('lb-my-rank-label');
      if (scoreLabel) scoreLabel.textContent = '累計討伐總分';
      if (rankLabel) rankLabel.textContent = (currentLeaderboardFilter === 'ALL') ? '全級討伐排名' : '班內討伐排名';

      // 1. 雙軌智能合併：整合 Google 試算表最新真實數據與本地 localStorage
      const allMap = {};

      if (DATA.benchmark_leaderboard && Array.isArray(DATA.benchmark_leaderboard)) {
        DATA.benchmark_leaderboard.forEach(item => {
          const rawScore = (typeof item.grandTotal === 'number') ? item.grandTotal : 
                           ((typeof item.score === 'number') ? item.score : (parseInt(item.totalScore, 10) || 0));
          const rawTitle = item.badge || item.title || '🥉【新手訓練家】';
          const rawKills = (typeof item.kills === 'number') ? item.kills : 0;
          allMap[`${item.cls}_${item.num}`] = {
            cls: item.cls,
            num: item.num,
            name: `${item.cls} ${(item.num < 10 ? '0' : '') + item.num}號`,
            score: rawScore,
            grandTotal: rawScore,
            kills: rawKills,
            title: rawTitle,
            badge: rawTitle
          };
        });
      }

      const allKeys = SafeStorage.getAllKeys ? SafeStorage.getAllKeys() : [];
      allKeys.forEach(key => {
        if (key.startsWith('p6_score_')) {
          const parts = key.replace('p6_score_', '').split('_');
          const cls = parts[0];
          const num = parseInt(parts[1], 10);
          try {
            const parsed = JSON.parse(SafeStorage.getItem(key));
            if (parsed && typeof parsed.totalScore === 'number' && parsed.totalScore > 0) {
              const mapKey = `${cls}_${num}`;
              const cur = allMap[mapKey];
              const localScore = parsed.totalScore;
              const localKills = parsed.kills || 0;
              const { currentTier } = evalTierAndSkills(localScore);
              if (!cur || localScore > cur.score) {
                allMap[mapKey] = {
                  cls, num,
                  name: `${cls} ${(num < 10 ? '0' : '') + num}號`,
                  score: localScore,
                  kills: Math.max(localKills, cur ? cur.kills : 0),
                  title: `${currentTier.badge}【${currentTier.title}】`, badge: `${currentTier.badge}【${currentTier.title}】`
                };
              }
            }
          } catch(e) {}
        }
      });

      const fullList = Object.values(allMap);
      fullList.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.kills !== a.kills) return b.kills - a.kills;
        if (a.cls !== b.cls) return a.cls.localeCompare(b.cls);
        return a.num - b.num;
      });
      fullList.forEach((item, idx) => {
        item.overallRank = idx + 1;
      });

      const classGroups = {};
      ['P6A', 'P6B', 'P6C', 'P6D', 'P6E', 'P6F'].forEach(c => {
        classGroups[c] = fullList.filter(s => s.cls === c);
        classGroups[c].forEach((item, idx) => {
          item.classRank = idx + 1;
        });
      });

      if (currentStudent) {
        const myKey = `${currentStudent.cls}_${currentStudent.num}`;
        const myEntry = allMap[myKey] || {
          cls: currentStudent.cls,
          num: currentStudent.num,
          name: `${currentStudent.cls} ${(currentStudent.num < 10 ? '0' : '') + currentStudent.num}號`,
          score: 0,
          kills: 0,
          overallRank: fullList.length,
          classRank: (classGroups[currentStudent.cls] || []).length
        };
        const { currentTier } = evalTierAndSkills(myEntry.score);

        document.getElementById('lb-my-name').textContent = myEntry.name;
        document.getElementById('lb-my-title').textContent = `當前境界：${currentTier.title}`;
        document.getElementById('lb-my-score').textContent = `${myEntry.score.toLocaleString()} 分`;
        document.getElementById('lb-my-badge').textContent = currentTier.badge;

        if (currentLeaderboardFilter === 'ALL') {
          document.getElementById('lb-my-rank').innerHTML = `<span style="color:#B45309; font-weight:900;">全級第 ${myEntry.overallRank} 名</span> <span style="font-size:12px;color:#64748B;">(全級共 ${fullList.length} 人)</span>`;
        } else {
          if (currentStudent.cls === currentLeaderboardFilter) {
            document.getElementById('lb-my-rank').innerHTML = `<span style="color:#2563EB; font-weight:900;">${currentLeaderboardFilter} 班內第 ${myEntry.classRank} 名</span> <span style="font-size:12px;color:#64748B;">(全級第 ${myEntry.overallRank} 名)</span>`;
          } else {
            document.getElementById('lb-my-rank').innerHTML = `<span style="color:#64748B;">原班 (${currentStudent.cls}) 第 ${myEntry.classRank} 名</span> <span style="font-size:11px;color:#94A3B8;">(正在瀏覽 ${currentLeaderboardFilter})</span>`;
          }
        }
      }

      const tbody = document.getElementById('leaderboard-tbody');
      const isClassFilter = currentLeaderboardFilter !== 'ALL';
      const limit = isClassFilter ? 15 : 20;
      const sourceList = isClassFilter ? (classGroups[currentLeaderboardFilter] || []) : fullList;
      const scoredList = sourceList.filter(s => s.score > 0);
      const displayList = (scoredList.length > 0 ? scoredList : sourceList).slice(0, limit);

      let myInDisplay = false;
      if (currentStudent) {
        if (!isClassFilter || currentStudent.cls === currentLeaderboardFilter) {
          myInDisplay = displayList.some(s => s.cls === currentStudent.cls && s.num === currentStudent.num);
        }
      }

      let rowsHtml = displayList.map(s => {
        const rankNum = isClassFilter ? s.classRank : s.overallRank;
        const medal = rankNum === 1 ? '🥇 1' : rankNum === 2 ? '🥈 2' : rankNum === 3 ? '🥉 3' : `${rankNum}`;
        const isMe = currentStudent && s.cls === currentStudent.cls && s.num === currentStudent.num;
        return `
          <tr style="${isMe ? 'background: #FEF3C7; font-weight: bold; border-left: 4px solid #D97706;' : ''}">
            <td style="padding: 7px; text-align: center; font-weight: 800; color: #1E3A8A;">${medal}</td>
            <td style="padding: 7px; text-align: center;">${s.cls}</td>
            <td style="padding: 7px; text-align: center;">${(s.num < 10 ? '0' : '') + s.num}號</td>
            <td style="padding: 7px; text-align: center; font-weight: 800;">${s.name} ${isMe ? '⭐(我)' : ''}</td>
            <td style="padding: 7px; text-align: center; font-size: 11px;">${getFormattedBadgeTitle(s)}</td>
            <td style="padding: 7px; text-align: center; font-weight: 900; color: #D97706;">${s.score.toLocaleString()}</td>
            <td style="padding: 7px; text-align: center;">${s.kills} 隻</td>
          </tr>
        `;
      }).join('');

      if (displayList.length === 0) {
        rowsHtml = `
          <tr>
            <td colspan="7" style="padding: 24px; text-align: center; color: #64748B; font-weight: 800; font-size: 13.5px;">
              🎮 該班尚無同學完成討伐破關，快登入挑戰成為第一位班級先鋒！
            </td>
          </tr>
        `;
      }

      if (currentStudent && !myInDisplay) {
        const myKey = `${currentStudent.cls}_${currentStudent.num}`;
        const myEntry = allMap[myKey];
        if (myEntry && (!isClassFilter || currentStudent.cls === currentLeaderboardFilter)) {
          const myRank = isClassFilter ? myEntry.classRank : myEntry.overallRank;
          const cutoffRank = isClassFilter ? 15 : 20;
          const targetStudent = sourceList[cutoffRank - 1];
          const gap = targetStudent ? Math.max(0, targetStudent.score - myEntry.score + 10) : 0;
          rowsHtml += `
            <tr style="background: #FFFBEB; border-top: 2px dashed #D97706; font-weight: bold;">
              <td style="padding: 9px; text-align: center; font-weight: 900; color: #B45309;">第 ${myRank} 名</td>
              <td style="padding: 9px; text-align: center;">${myEntry.cls}</td>
              <td style="padding: 9px; text-align: center;">${(myEntry.num < 10 ? '0' : '') + myEntry.num}號</td>
              <td style="padding: 9px; text-align: center; color: #B45309; font-weight: 900;">
                ${myEntry.name} ⭐ (我的目前排名)
                <div style="font-size: 11px; font-weight: 600; color: #D97706; margin-top: 2px;">
                  ⚡ 距離進榜 (第${cutoffRank}名) 還差 ${gap.toLocaleString()} 分，立即開戰追趕！
                </div>
              </td>
              <td style="padding: 9px; text-align: center; font-size: 11px;">${myEntry.title}</td>
              <td style="padding: 9px; text-align: center; font-weight: 900; color: #D97706;">${myEntry.score.toLocaleString()}</td>
              <td style="padding: 9px; text-align: center;">${myEntry.kills} 隻</td>
            </tr>
          `;
        }
      }

      tbody.innerHTML = rowsHtml;
    }

    // Skills Hall Modal
    function openSkillsModal() {
      renderSkillsHall();
      openModal('modal-skills');
    }

    function renderSkillsHall() {
      let score = 0;
      let studentName = '未登入訓練家';
      if (currentStudent) {
        const stats = getStudentStats(currentStudent.cls, currentStudent.num);
        score = stats.totalScore || 0;
        studentName = currentStudent.name;
      } else {
        const lastLogin = SafeStorage.getItem('p6_last_login');
        if (lastLogin) {
          try {
            const st = JSON.parse(lastLogin);
            if (st && st.cls && st.num) {
              const stats = getStudentStats(st.cls, st.num);
              score = stats.totalScore || 0;
              studentName = st.name;
            }
          } catch(e) {}
        }
      }

      const { currentTier, nextTier, unlockedSkills } = evalTierAndSkills(score);

      // 1. 動態更新頂部當前境界標題與勳章
      const titleEl = document.getElementById('hall-current-title');
      if (titleEl) {
        titleEl.innerHTML = `當前境界：<span style="color: ${currentTier.color}; font-size: 16px; font-weight: 900;">${currentTier.badge}【${currentTier.title}】</span>`;
      }

      // 2. 動態計算晉升下一階進度與文字說明
      let pct = 100;
      const ptsEl = document.getElementById('hall-current-pts');
      const fillEl = document.getElementById('hall-progress-fill');
      if (nextTier) {
        const span = nextTier.min - currentTier.min;
        const currentProgress = score - currentTier.min;
        pct = Math.min(100, Math.max(0, Math.round((currentProgress / Math.max(1, span)) * 100)));
        const needPts = nextTier.min - score;
        if (ptsEl) {
          ptsEl.innerHTML = `累積積分：<strong>${score.toLocaleString()}</strong> / 晉升【${nextTier.title}】需 ${nextTier.min.toLocaleString()} 分 (<span style="color: #2563EB; font-weight: 800;">還差 ${needPts.toLocaleString()} 分 · ${pct}%</span>)`;
        }
      } else {
        if (ptsEl) {
          ptsEl.innerHTML = `累積積分：<strong>${score.toLocaleString()}</strong> 分 (🏆 已榮登最高創世神皇殿堂！)`;
        }
      }
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
      }

      // 3. 渲染 8 大境界卡片 (動態標註已達成、當前段位與未解鎖)
      const tiersContainer = document.getElementById('tiers-grid-container');
      if (tiersContainer) {
        tiersContainer.innerHTML = TIERS.map(t => {
          const isReached = score >= t.min;
          const isCurrent = (t.title === currentTier.title);
          let borderStyle = isCurrent 
            ? `border: 2.5px solid ${t.color}; box-shadow: 0 0 14px ${t.color}55; transform: scale(1.03);` 
            : (isReached ? `border: 2px solid ${t.color}80;` : `border: 2px solid #E2E8F0; opacity: 0.55;`);
          let bgStyle = isReached ? t.bg : '#F8FAFC';
          let statusBadge = isCurrent 
            ? `<span style="font-size:10px; font-weight:900; background:${t.color}; color:#fff; padding:2px 8px; border-radius:10px; display:inline-block; margin-top:4px;">🌟 當前段位</span>`
            : (isReached 
                ? `<span style="font-size:10px; font-weight:800; color:#16A34A; background:#DCFCE7; padding:1px 6px; border-radius:6px; display:inline-block; margin-top:4px;">✓ 已達成</span>`
                : `<span style="font-size:10px; font-weight:700; color:#94A3B8; display:inline-block; margin-top:4px;">🔒 差 ${(t.min - score).toLocaleString()} 分</span>`);
          
          return `
            <div class="tier-card ${isReached ? 'unlocked' : 'locked'}" style="${borderStyle} background: ${bgStyle};">
              <div class="tier-card-badge">${isReached ? t.badge : '🔒'}</div>
              <div class="tier-card-title" style="color: ${isReached ? t.color : '#64748B'}; font-weight: 900; font-size: 14px;">${t.title}</div>
              <div class="tier-card-score" style="color: ${isReached ? '#B45309' : '#94A3B8'}; font-size: 11px;">${t.min.toLocaleString()} 分解鎖</div>
              ${statusBadge}
            </div>
          `;
        }).join('');
      }

      // 4. 渲染 5 大技能殿堂 (動態高亮已解鎖技能)
      const skillsContainer = document.getElementById('skills-grid-container');
      if (skillsContainer) {
        const closeBtnHtml = `
          <div style="margin-top: 24px; text-align: center; grid-column: 1 / -1;">
            <button class="btn-primary-action" onclick="closeModal('modal-skills')" style="padding: 10px 36px; font-size: 15px; font-weight: 900; background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%); border-radius: 30px; box-shadow: 0 4px 14px rgba(37,99,235,0.35); cursor: pointer;">
              關閉技能館
            </button>
          </div>
        `;
        const cardsHtml = SKILLS.map(s => {
          const isUnlocked = score >= s.reqPts;
          return `
            <div class="skill-card ${isUnlocked ? 'unlocked' : 'locked'}">
              <div class="skill-name-row">
                <span class="skill-name">${isUnlocked ? ('⚡ ' + s.name) : ('🔒 ' + s.name)}</span>
                <span class="skill-rate">${isUnlocked ? `發動率 ${Math.round(s.rate * 100)}%` : `需 ${s.reqPts.toLocaleString()} 分`}</span>
              </div>
              <div class="skill-desc">${s.desc}</div>
              <div style="font-size: 10px; color: ${isUnlocked ? '#16A34A' : '#94A3B8'}; margin-top: 4px; font-weight: 700;">
                ${isUnlocked ? '✅ 戰鬥已實裝發動' : `🔒 還差 ${(s.reqPts - score).toLocaleString()} 分自動解鎖`}
              </div>
            </div>
          `;
        }).join('');
        skillsContainer.innerHTML = cardsHtml + closeBtnHtml;
      }
    }

    function openModal(id) { document.getElementById(id).style.display = 'flex'; }
    function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

    // 快捷鍵：按下 Escape 鍵隨時關閉所有彈窗
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeModal('modal-skills');
        closeModal('modal-leaderboard');
        const confirmModal = document.getElementById('modal-confirm');
        if (confirmModal) confirmModal.style.display = 'none';
      }
    });


    // Window Load Initialization

  // =========================================================================
  // ⚡ 十萬伏特雙軌實體音效緩衝池 (Web Audio API Buffer + Audio Pool Fallback)
  // =========================================================================
  const ThunderboltSFX = (function() {
    let sfxAudioCtx = null;
    let sfxBuffer = null;
    const fallbackPool = [];
    const POOL_SIZE = 4;
    let poolIdx = 0;

    function init() {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          sfxAudioCtx = new AudioContextClass();
          fetch('audio/sfx_thunderbolt.mp3')
            .then(res => res.arrayBuffer())
            .then(buf => sfxAudioCtx.decodeAudioData(buf))
            .then(decoded => {
              sfxBuffer = decoded;
              console.log('[SFX] 十萬伏特 Web Audio 緩衝區預載解碼完成 (0ms 延遲就緒)');
            })
            .catch(err => {
              console.warn('[SFX] Web Audio 解碼失敗，使用 Audio 緩衝池備用:', err);
            });
        }
      } catch (e) {
        console.warn('[SFX] AudioContext 不支援:', e);
      }

      for (let i = 0; i < POOL_SIZE; i++) {
        try {
          const a = new Audio('audio/sfx_thunderbolt.mp3');
          a.preload = 'auto';
          fallbackPool.push(a);
        } catch (e) {}
      }

      const unlock = () => {
        if (sfxAudioCtx && sfxAudioCtx.state === 'suspended') {
          sfxAudioCtx.resume().catch(() => {});
        }
      };
      window.addEventListener('click', unlock, { capture: true, once: true });
      window.addEventListener('keydown', unlock, { capture: true, once: true });
      window.addEventListener('touchstart', unlock, { capture: true, once: true });
    }

    function play() {
      if (sfxAudioCtx && sfxAudioCtx.state === 'suspended') {
        sfxAudioCtx.resume().catch(() => {});
      }
      // 軌道 1：Web Audio API (0ms 延遲、無上限多重重疊發聲)
      if (sfxAudioCtx && sfxBuffer) {
        try {
          const src = sfxAudioCtx.createBufferSource();
          src.buffer = sfxBuffer;
          const gain = sfxAudioCtx.createGain();
          gain.gain.value = 0.95;
          src.connect(gain);
          gain.connect(sfxAudioCtx.destination);
          src.start(0);
          return;
        } catch (err) {
          console.warn('[SFX] Web Audio 播放例外，降級至實體緩衝池:', err);
        }
      }

      // 軌道 2：實體 Audio 實體緩衝池輪播備用
      if (fallbackPool.length > 0) {
        try {
          const a = fallbackPool[poolIdx];
          poolIdx = (poolIdx + 1) % fallbackPool.length;
          a.currentTime = 0;
          a.play().catch(() => {});
        } catch (e) {}
      }
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }

    return { play, init };
  })();

  // ==========================================
  // 🎵 背景音樂管理器 (BGM Audio Manager)
  // ==========================================
  // 專為 GitHub Pages 串流優化，防卡頓、省流量、支援瀏覽器自動播放策略與靜音持久化
  const BgmManager = (function() {
    const TRACKS = {
      lobby: 'audio/bgm_lobby.mp3',             // 遊戲大廳及榮譽榜音樂
      siege_speed: 'audio/bgm_siege_speed.mp3', // 逃出恐怖屋 & 手速遊戲音樂
      stages: 'audio/bgm_stages.mp3'            // 一般關卡音樂 (標準抓寶、寵物、生存)
    };

    const audioElements = {};
    let currentTrackKey = null;
    let isMuted = true; // 預設關閉
    let userInteracted = false;
    let pendingTrackKey = 'lobby';

    function init() {
      try {
        const saved = SafeStorage.getItem('p6_bgm_muted');
        if (saved !== null) {
          isMuted = (saved === 'true' || saved === true); } else { isMuted = true;
        }
      } catch(e) {}

      Object.keys(TRACKS).forEach(key => {
        try {
          const audio = new Audio();
          audio.src = TRACKS[key];
          audio.preload = 'auto';
          audio.loop = true;
          audio.volume = 0.45;
          audio.addEventListener('error', (e) => {
            console.warn('[BGM] 音訊載入異常 (' + key + '):', e);
          });
          audio.addEventListener('ended', function() {
            if (!isMuted && currentTrackKey === key) {
              this.currentTime = 0;
              this.play().catch(() => {});
            }
          });
          audioElements[key] = audio;
        } catch (err) {
          console.warn('[BGM] 初始化音訊元素失敗 (' + key + '):', err);
        }
      });

      updateUiButton();

      const unlockAudio = () => {
        userInteracted = true;
        window.removeEventListener('click', unlockAudio, true);
        window.removeEventListener('keydown', unlockAudio, true);
        window.removeEventListener('touchstart', unlockAudio, true);
        if (!isMuted && pendingTrackKey) {
          playTrack(pendingTrackKey);
        }
      };
      window.addEventListener('click', unlockAudio, { capture: true, once: true });
      window.addEventListener('keydown', unlockAudio, { capture: true, once: true });
      window.addEventListener('touchstart', unlockAudio, { capture: true, once: true });
    }

    function playTrack(trackKey) {
      pendingTrackKey = trackKey;
      if (isMuted || !userInteracted) return;
      if (currentTrackKey === trackKey && audioElements[trackKey] && !audioElements[trackKey].paused) {
        return;
      }

      if (currentTrackKey && audioElements[currentTrackKey] && currentTrackKey !== trackKey) {
        const oldAudio = audioElements[currentTrackKey];
        try {
          oldAudio.pause();
          oldAudio.currentTime = 0;
        } catch(e) {}
      }

      currentTrackKey = trackKey;
      const newAudio = audioElements[trackKey];
      if (newAudio) {
        newAudio.volume = 0.45;
        const playPromise = newAudio.play();
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            console.log('[BGM] 自動播放等待使用者互動:', err);
          });
        }
      }
    }

    function stopAll() {
      Object.keys(audioElements).forEach(key => {
        try {
          const a = audioElements[key];
          a.pause();
          a.currentTime = 0;
        } catch(e) {}
      });
      currentTrackKey = null;
    }

    function toggleMute() {
      isMuted = !isMuted;
      try {
        SafeStorage.setItem('p6_bgm_muted', isMuted);
      } catch(e) {}

      updateUiButton();

      if (isMuted) {
        stopAll();
        if (typeof showPassToast === 'function') showPassToast('🔇 背景音樂已關閉');
      } else {
        userInteracted = true;
        if (typeof showPassToast === 'function') showPassToast('🎵 背景音樂已開啟');
        if (pendingTrackKey) {
          playTrack(pendingTrackKey);
        } else {
          playTrack('lobby');
        }
      }
    }

    function updateUiButton() {
      const btn = document.getElementById('bgm-toggle-btn');
      if (btn) {
        btn.textContent = isMuted ? '🔇 音樂: 關' : '🎵 音樂: 開';
        btn.classList.toggle('bgm-muted', isMuted);
      }
    }

    function resumeCurrentTrack() {
      if (isMuted || !userInteracted) return;
      const track = currentTrackKey || pendingTrackKey || (currentGameMode === 'siege' || currentGameMode === 'speed' ? 'siege_speed' : 'lobby');
      const audio = audioElements[track];
      if (audio) {
        if (audio.paused) {
          audio.volume = 0.45;
          const p = audio.play();
          if (p !== undefined) p.catch(() => {});
        }
      } else {
        playTrack(track);
      }
    }

    return {
      init,
      playTrack,
      stopAll,
      toggleMute,
      updateUiButton,
      resumeCurrentTrack,
      getCurrentTrack: () => currentTrackKey,
      isMuted: () => isMuted
    };
  })();

  function toggleBgmMusic() {
    BgmManager.toggleMute();
  }

    function initAllViews() {
      try { renderModeTabs(); } catch(e) { console.error("renderModeTabs error:", e); }
      try { renderTop40(); } catch(e) { console.error('renderTop40 error:', e); }
      try { renderClassBarCharts(); } catch(e) { console.error('renderClassBarCharts error:', e); }
      try { renderClassCards(); } catch(e) { console.error('renderClassCards error:', e); }
      try { renderPerfectScorers(); } catch(e) { console.error('renderPerfectScorers error:', e); }
      try { renderVocabTable(); } catch(e) { console.error('renderVocabTable error:', e); }
      try { renderSkillsHall(); } catch(e) { console.error('renderSkillsHall error:', e); }
      try { initSpeedWeekDropdown(); } catch(e) { console.error('initSpeedWeekDropdown error:', e); }
      try { BgmManager.init(); BgmManager.playTrack("lobby"); } catch(e) { console.error("BgmManager init error:", e); }

      const lastLogin = SafeStorage.getItem('p6_last_login');
      if (lastLogin) {
        try {
          currentStudent = JSON.parse(lastLogin);
          const idSec = document.getElementById('identity-section');
          if (idSec) idSec.style.display = 'none';
          const batSec = document.getElementById('battle-section');
          if (batSec) batSec.style.display = 'block';
          loadStudentProfile();
        } catch(e) {}
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      try { initAllViews(); } catch(e) {}
    } else {
      window.addEventListener('DOMContentLoaded', initAllViews);
    }
  
    // =========================================================================
    // ⚡ 模式 2：倉頡 10 字極速鍵盤手速賽核心引擎 (完全忽略作業系統輸入法)
    // =========================================================================

    // 每周固定 10 個核心字庫 (每周更換，開局全隨機洗牌)
    ;

    
    // =========================================================================
    // 🔤 倉頡字碼來源單一化：由字根陣列自動動態生成按鍵字母串 (防止人為轉寫錯漏)
    // =========================================================================
    

    

    function getActiveSpeedWeek() {
      // 支援網址參數手動切換測試 (例如 ?week=w8, ?week=w10)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const qWk = urlParams.get('week');
        if (qWk) {
          return qWk.toLowerCase();
        }
      } catch (e) {}

      // 1. 優先採用微服務雲端動態同步的開放週次 (SSOT)
      if (typeof window !== 'undefined' && window.DYNAMIC_ACTIVE_WEEK) {
        return window.DYNAMIC_ACTIVE_WEEK;
      }

      // 2. 依當前實際日期時間比對排程
      const now = new Date();
      const schedules = (typeof SPEED_WEEK_SCHEDULES !== 'undefined' && Array.isArray(SPEED_WEEK_SCHEDULES) && SPEED_WEEK_SCHEDULES.length > 0)
        ? SPEED_WEEK_SCHEDULES
        : (window.SPEED_WEEK_SCHEDULES || [
            { week: 'w2', start: new Date('2026-09-07T00:00:00+08:00'), end: new Date('2026-09-13T23:59:59+08:00') },
            { week: 'w3', start: new Date('2026-09-14T00:00:00+08:00'), end: new Date('2026-09-20T23:59:59+08:00') },
            { week: 'w4', start: new Date('2026-09-21T00:00:00+08:00'), end: new Date('2026-10-04T23:59:59+08:00') },
            { week: 'w6', start: new Date('2026-10-05T00:00:00+08:00'), end: new Date('2026-10-11T23:59:59+08:00') },
            { week: 'w7', start: new Date('2026-10-12T00:00:00+08:00'), end: new Date('2026-10-19T23:59:59+08:00') },
            { week: 'w8', start: new Date('2026-10-20T08:00:00+08:00'), end: new Date('2026-10-25T23:30:00+08:00') },
            { week: 'w10', start: new Date('2026-11-02T08:00:00+08:00'), end: new Date('2026-11-08T23:30:00+08:00') }
          ]);

      for (const s of schedules) {
        const sStart = s.start instanceof Date ? s.start : new Date(s.start);
        const sEnd = s.end instanceof Date ? s.end : new Date(s.end);
        if (now >= sStart && now <= sEnd) {
          return s.week;
        }
      }
      if (schedules.length > 0) {
        for (let i = schedules.length - 1; i >= 0; i--) {
          const sStart = schedules[i].start instanceof Date ? schedules[i].start : new Date(schedules[i].start);
          if (now >= sStart) return schedules[i].week;
        }
        return schedules[0].week;
      }
      return 'w8';
    }

    function initSpeedWeekDropdown() {
      const select = document.getElementById('speed-ready-week-select');
      const activeWk = getActiveSpeedWeek();
      const allBanks = (typeof window !== 'undefined' && window.MODE2_WEEKLY_BANKS) ? window.MODE2_WEEKLY_BANKS : (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS ? MODE2_WEEKLY_BANKS : {});

      if (select) {
        // 全動態構建分組選單：支援微服務隨時注入新周次題庫 (w8, w10, w11...)
        const availableWeeks = [];
        const now = new Date();
        const schedules = (typeof SPEED_WEEK_SCHEDULES !== 'undefined' && Array.isArray(SPEED_WEEK_SCHEDULES) && SPEED_WEEK_SCHEDULES.length > 0)
          ? SPEED_WEEK_SCHEDULES
          : (window.SPEED_WEEK_SCHEDULES || []);

        Object.keys(allBanks).forEach(k => {
          const m = k.match(/^(w\d+)_hw/);
          if (m && !availableWeeks.includes(m[1])) {
            const wk = m[1];
            // ★ 依當前實際日期時間過濾：尚未到開放時間之未來周次 (如第10周)，絕對不呈現在選單中！
            const sched = schedules.find(s => s.week === wk);
            if (sched) {
              const sStart = sched.start instanceof Date ? sched.start : new Date(sched.start);
              if (now >= sStart) {
                availableWeeks.push(wk);
              }
            } else {
              const wkNum = parseInt(wk.slice(1), 10);
              if (wkNum <= 8) availableWeeks.push(wk);
            }
          }
        });

        // 依周次降序排列 (例如 w10, w8, w7, w6, w5, w4, w3, w2)，最新周次置頂
        availableWeeks.sort((a, b) => {
          const numA = parseInt(a.slice(1), 10);
          const numB = parseInt(b.slice(1), 10);
          return numB - numA;
        });

        if (availableWeeks.length > 0) {
          select.innerHTML = '';
          availableWeeks.forEach(wk => {
            const isCur = (wk === activeWk);
            const grp = document.createElement('optgroup');
            const wkNum = wk.slice(1);
            grp.label = isCur 
              ? `🔥 第 ${wkNum} 周 倉頡手速字庫 (當前開放中)` 
              : `📅 第 ${wkNum} 周 倉頡手速字庫 (溫故知新)`;

            for (let idx = 1; idx <= 4; idx++) {
              const k = `${wk}_hw${idx}`;
              const bank = allBanks[k];
              if (bank) {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = bank.title || `第${wkNum}周功課${idx}`;
                if (k === `${activeWk}_hw1`) opt.selected = true;
                grp.appendChild(opt);
              }
            }
            if (grp.children && grp.children.length > 0) {
              select.appendChild(grp);
            }
          });

          // 選中當前活躍周次的功課1
          const targetVal = `${activeWk}_hw1`;
          let matched = false;
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === targetVal) {
              select.selectedIndex = i;
              currentSpeedWeek = targetVal;
              matched = true;
              break;
            }
          }
          if (!matched && select.options.length > 0) {
            select.selectedIndex = 0;
            currentSpeedWeek = select.value;
          }
        }
      }

      // 同步天梯榜周次選單狀態
      const lbSelect = document.getElementById('speed-lb-week-select');
      if (lbSelect) {
        if (!speedLeaderboardWeek) speedLeaderboardWeek = `${activeWk}_hw1`;
        lbSelect.value = speedLeaderboardWeek;
      }
    }

    function updateSpeedLeaderboardButtons(activeWk) {
      const container = document.getElementById('speed-lb-week-buttons');
      if (!container) return;
      container.innerHTML = '';

      const allBanks = (typeof window !== 'undefined' && window.MODE2_WEEKLY_BANKS) ? window.MODE2_WEEKLY_BANKS : (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS ? MODE2_WEEKLY_BANKS : {});
      let hwKeys = [1, 2, 3, 4].map(idx => `${activeWk}_hw${idx}`);
      // 若當前週次無題庫，展示所有可用題庫按鈕
      if (!hwKeys.some(k => allBanks[k])) {
        hwKeys = Object.keys(allBanks);
      }

      if (!hwKeys.includes(speedLeaderboardWeek)) {
        speedLeaderboardWeek = hwKeys[0] || 'w7_hw1';
      }

      // 優先加入「全部周次」按鈕以瀏覽全級生涯手速紀錄
      const allBtn = document.createElement('button');
      allBtn.className = 'lb-sub-pill' + (speedLeaderboardWeek === 'ALL' ? ' active' : '');
      allBtn.id = 'lb-week-ALL';
      allBtn.textContent = '🏆 全部周次 (生涯最佳)';
      allBtn.onclick = () => filterSpeedLeaderboardWeek('ALL');
      container.appendChild(allBtn);

      hwKeys.forEach(k => {
        const bank = allBanks[k];
        const btn = document.createElement('button');
        btn.className = 'lb-sub-pill' + (k === speedLeaderboardWeek ? ' active' : '');
        btn.id = `lb-week-${k}`;
        btn.textContent = bank ? bank.title : k;
        btn.onclick = () => filterSpeedLeaderboardWeek(k);
        container.appendChild(btn);
      });
    }

    
    // =========================================================================
    // 🖼️ 圖片載入容錯降級處理 (Image Fallback Handlers)
    // =========================================================================
    function handlePodiumImgError(el, icon) {
      el.outerHTML = `<div class="podium-pokemon-icon">${icon}</div>`;
    }
    function handleRankImgError(el, icon) {
      el.outerHTML = icon || '⚡';
    }

    // =========================================================================
    // ⚡ 手速賽等效競賽耗時演算法與控制輔助函式
    // =========================================================================
    function calculateEffectiveSpeedTime(rawTime, mistakes, accuracy, wordCount) {
      const keyPenalty = mistakes * 0.3;
      const baseFactor = (wordCount === 20) ? 30.0 : 15.0;
      const accRatio = Math.max(0, Math.min(100, accuracy)) / 100;
      const accPenalty = Math.round(baseFactor * (1 - Math.pow(accRatio, 2)) * 100) / 100;
      const bonus = (accuracy >= 100) ? ((wordCount === 20) ? 2.0 : 1.0) : 0.0;
      const effectiveTime = parseFloat((rawTime + keyPenalty + accPenalty - bonus).toFixed(2));
      return {
        keyPenalty: parseFloat(keyPenalty.toFixed(2)),
        accPenalty: parseFloat(accPenalty.toFixed(2)),
        bonus: parseFloat(bonus.toFixed(2)),
        effectiveTime: Math.max(1.0, effectiveTime)
      };
    }

    function onSpeedSettingChange() {
      const wcSelect = document.getElementById('speed-word-count-select');
      const wkSelect = document.getElementById('speed-ready-week-select');
      if (wcSelect) currentSpeedWordCount = parseInt(wcSelect.value, 10) || 10;
      if (wkSelect) currentSpeedWeek = wkSelect.value || 'w7_hw1';
    }

    function toggleSpeedPracticeMode() {
      isSpeedPracticeMode = !isSpeedPracticeMode;
      const btn = document.getElementById('speed-mode-toggle-btn');
      if (btn) {
        if (isSpeedPracticeMode) {
          btn.innerHTML = '💡 練習模式 (全程字根可見)';
          btn.style.color = '#34D399';
          btn.style.borderColor = '#10B981';
          btn.style.background = '#0F172A';
        } else {
          btn.innerHTML = '⚔️ 競技排位賽 (停頓3秒提燈)';
          btn.style.color = '#FDE047';
          btn.style.borderColor = '#FACC15';
          btn.style.background = '#0F172A';
        }
      }
      if (typeof speedActive !== 'undefined' && speedActive) {
        renderSpeedTargetWord();
      }
    }

    function returnToSpeedReadyStage() {
      const mainStage = document.getElementById('speed-main-stage');
      const finishBox = document.getElementById('speed-finish-box');
      const readyStage = document.getElementById('speed-ready-stage');
      if (mainStage) mainStage.style.display = 'none';
      if (finishBox) finishBox.style.display = 'none';
      if (readyStage) readyStage.style.display = 'block';
    }

    // 🚀 核心入口：按下開始按鈕才真正啟動比賽與碼表計時
    function launchSpeedMatch() {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }

      onSpeedSettingChange();

      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);

      const bank = (typeof MODE2_WEEKLY_BANKS !== "undefined") ? (MODE2_WEEKLY_BANKS[currentSpeedWeek] || MODE2_WEEKLY_BANKS["w5_hw1"] || MODE2_WEEKLY_BANKS["w3_hw1"] || Object.values(MODE2_WEEKLY_BANKS)[0]) : null;
      const rawWords = [...bank.words];
      const shuffled = fisherYatesShuffle(rawWords);
      speedWordList = shuffled.slice(0, currentSpeedWordCount);
      const getAuthFnSpeed = (typeof getAuthoritativeCj3 === 'function') ? getAuthoritativeCj3 : (typeof window !== 'undefined' ? window.getAuthoritativeCj3 : null);
      if (typeof getAuthFnSpeed === 'function') {
        speedWordList.forEach(w => {
          if (w && w.char) {
            const auth = getAuthFnSpeed(w.char);
            if (auth) {
              if (auth.codes) w.codes = auth.codes.slice();
              if (auth.keys) w.keys = auth.keys.slice();
              if (auth.full) w.full = auth.full;
              if (auth.secret) w.secret = auth.secret;
              if (auth.quickCode) w.quickCode = auth.quickCode;
            }
          }
        });
      }

      speedWordIdx = 0;
      speedInputCodes = [];
      speedMistakes = 0;
      speedPenaltySeconds = 0.0;
      speedTotalKeys = 0;
      speedCorrectKeys = 0;
      speedActive = true;
      speedWordReadyForSpace = false;

      // 切換舞台：隱藏備戰大廳與結算卡，展示輸入主舞台
      document.getElementById('speed-ready-stage').style.display = 'none';
      document.getElementById('speed-finish-box').style.display = 'none';
      document.getElementById('speed-main-stage').style.display = 'block';

      // 更新頂部標籤與計時器
      document.getElementById('speed-total-count-text').textContent = speedWordList.length;
      document.getElementById('speed-timer-val').textContent = '00.00s';
      document.getElementById('speed-penalty-display').innerHTML = `⚠️ 失誤 0 次 (+0.0s 罰時)`;
      
      const badgeTag = document.getElementById('speed-active-badge-tag');
      if (badgeTag) {
        const bankObj = MODE2_WEEKLY_BANKS[currentSpeedWeek] || Object.values(MODE2_WEEKLY_BANKS)[0];
        badgeTag.textContent = `⚡ ${currentSpeedWordCount} 字賽 · ${bankObj.title}`;
      }

      const spacePrompt = document.getElementById('speed-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      renderSpeedProgressDots();
      renderSpeedTargetWord();

      // 真正啟動高精度即時碼表
      speedStartTime = performance.now();
      speedTimerInterval = setInterval(updateSpeedClock, 30);

      // 監聽鍵盤原生事件
      window.removeEventListener('keydown', handleSpeedKeydown, true);
      window.addEventListener('keydown', handleSpeedKeydown, true);
    }

    // 放棄比賽返回備戰大廳
    function abortSpeedMatchToReady() {
      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);
      speedActive = false;
      speedWordReadyForSpace = false;
      window.removeEventListener('keydown', handleSpeedKeydown, true);

      initSpeedWeekDropdown();
        returnToSpeedReadyStage();
    }

    // 更新即時碼表
    function updateSpeedClock() {
      if (!speedStartTime || !speedActive) return;
      const now = performance.now();
      const elapsed = ((now - speedStartTime) / 1000) + speedPenaltySeconds;
      document.getElementById('speed-timer-val').textContent = elapsed.toFixed(2) + 's';
    }

    // 渲染進度圓點
    function renderSpeedProgressDots() {
      const container = document.getElementById('speed-progress-dots');
      if (!container) return;
      container.innerHTML = '';
      const total = speedWordList.length;
      for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = 'speed-dot' + (i === speedWordIdx ? ' active' : (i < speedWordIdx ? ' done' : ''));
        container.appendChild(dot);
      }
    }

    // 渲染當前目標中文字與字碼卡槽
    function renderSpeedTargetWord() {
      if (speedWordIdx >= speedWordList.length) return;
      const currentWord = speedWordList[speedWordIdx];

      speedWordReadyForSpace = false;
      const spacePrompt = document.getElementById('speed-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      document.getElementById('speed-target-char').textContent = currentWord.char;
      document.getElementById('speed-current-idx-text').textContent = speedWordIdx + 1;
      document.getElementById('speed-bottom-tip').innerHTML = `💡 規則：按錯鍵每次加計 <strong>+0.3 秒罰時</strong> · 停頓 <strong>3 秒</strong> 未按鍵自動亮起字碼提示 · <strong>打完字碼請按【空白鍵 Space】送出</strong>`;

      renderSpeedProgressDots();

      const slotsContainer = document.getElementById('speed-slots-row');
      slotsContainer.innerHTML = '';

      const neededIdx = speedInputCodes.length;

      currentWord.codes.forEach((code, idx) => {
        const slot = document.createElement('div');
        slot.id = `speed-slot-${idx}`;
        slot.className = 'speed-key-slot';

        if (idx < speedInputCodes.length) {
          slot.classList.add('filled');
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #34D399;">${speedInputCodes[idx].code}</div>
            <div class="speed-slot-sub" style="color: #A7F3D0;">${speedInputCodes[idx].key}</div>
          `;
        } else if (idx === neededIdx) {
          slot.classList.add('current');
          if (isSpeedPracticeMode) {
            slot.innerHTML = `
              <div class="speed-slot-hint-text">${code}</div>
              <div class="speed-slot-sub" style="color: #FACC15; font-weight: 900;">${currentWord.keys[idx]}</div>
            `;
          } else {
            slot.innerHTML = `
              <div class="speed-slot-code" style="color: #94A3B8;">？</div>
              <div class="speed-slot-sub">第${idx + 1}碼</div>
            `;
          }
        } else {
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #475569;">·</div>
            <div class="speed-slot-sub">第${idx + 1}碼</div>
          `;
        }
        slotsContainer.appendChild(slot);
      });

      startSpeedHintTimer();
    }

    // 3 秒未輸入自動提燈提示
    function startSpeedHintTimer() {
      if (speedHintTimer) clearTimeout(speedHintTimer);
      if (isSpeedPracticeMode || !speedActive || speedWordReadyForSpace) return;

      const currentWord = speedWordList[speedWordIdx];
      const neededIdx = speedInputCodes.length;
      if (!currentWord || neededIdx >= currentWord.codes.length) return;

      speedHintTimer = setTimeout(() => {
        const targetSlot = document.getElementById(`speed-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('hint-glow');
          targetSlot.innerHTML = `
            <div class="speed-slot-hint-text">${currentWord.codes[neededIdx]}</div>
            <div class="speed-slot-sub" style="color: #FACC15; font-weight: 900;">${currentWord.keys[neededIdx]}</div>
          `;
          document.getElementById('speed-bottom-tip').innerHTML = `💡 <span style="color:#FACC15;font-weight:900;">【提燈指引啟動】：目標字根為【${currentWord.codes[neededIdx]}】(按鍵 ${currentWord.keys[neededIdx]})！</span>`;
        }
      }, 3000);
    }

    // ⌨️ 鍵盤原生事件監聽 (徹底解決按空白鍵重開問題，完全忽略輸入法)
    function handleSpeedKeydown(e) {
      if (currentGameMode !== 'speed') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // 🛑 情況 1：在備戰大廳，按下 Space 或 Enter 允許快速啟動
      const readyStage = document.getElementById('speed-ready-stage');
      if (readyStage && readyStage.style.display !== 'none') {
        if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          launchSpeedMatch();
        }
        return;
      }

      if (!speedActive) return;

      // 🛑 情況 2：比賽進行中按下了空白鍵 (Space) —— 全局嚴格攔截，絕不允許觸發瀏覽器預設按鈕點擊！
      if (e.key === ' ' || e.code === 'Space' || e.keyCode === 32) {
        e.preventDefault();
        e.stopPropagation();

        if (speedWordReadyForSpace) {
          // 正確狀態：字碼已完成，按下空白鍵確認送出並進入下一題
          confirmSpeedWordSpace();
        } else {
          // 學生在尚未敲完全部字碼時誤按空白鍵 —— 溫和提醒，絕不重開題目！
          const stage = document.getElementById('speed-main-stage');
          triggerFloatingNotice(stage, '請先敲完字碼再按空白鍵！⚠️');
          const currentWord = speedWordList[speedWordIdx];
          if (currentWord) {
            const neededIdx = speedInputCodes.length;
            const targetSlot = document.getElementById(`speed-slot-${neededIdx}`);
            if (targetSlot) {
              targetSlot.classList.add('shake-error');
              setTimeout(() => targetSlot.classList.remove('shake-error'), 400);
            }
          }
        }
        return;
      }

      // 情況 3：支援 Backspace 退回上一碼
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (speedWordReadyForSpace) {
          speedWordReadyForSpace = false;
          speedInputCodes.pop();
          renderSpeedTargetWord();
        } else if (speedInputCodes.length > 0) {
          speedInputCodes.pop();
          renderSpeedTargetWord();
        }
        return;
      }

      // 情況 4：已打完字碼等待按空白鍵時，若按其他英文字母，提醒按下空白鍵
      if (speedWordReadyForSpace) {
        e.preventDefault();
        e.stopPropagation();
        const spacePrompt = document.getElementById('speed-space-prompt');
        if (spacePrompt) {
          spacePrompt.classList.add('shake-error');
          setTimeout(() => spacePrompt.classList.remove('shake-error'), 400);
        }
        return;
      }

      // 情況 5：攔截英文字母鍵 A ~ Z (完全忽略輸入法)
      const keyUpper = e.key.toUpperCase();
      if (keyUpper.length === 1 && keyUpper >= 'A' && keyUpper <= 'Z') {
        e.preventDefault(); // 阻止瀏覽器組字上屏
        e.stopPropagation();
        processSpeedKeyInput(keyUpper);
      }
    }

    // 處理手速賽按鍵
    function processSpeedKeyInput(pressedKey) {
      if (speedWordReadyForSpace) return;
      const currentWord = speedWordList[speedWordIdx];
      if (!currentWord) return;

      const neededIdx = speedInputCodes.length;
      const targetKey = currentWord.keys[neededIdx];
      const targetCode = currentWord.codes[neededIdx];

      speedTotalKeys++;

      if (pressedKey === targetKey) {
        // 正確按鍵
        speedCorrectKeys++;
        speedInputCodes.push({ key: pressedKey, code: targetCode });

        // 檢查該字是否全部碼位完成
        if (speedInputCodes.length === currentWord.keys.length) {
          speedWordReadyForSpace = true;
          if (speedHintTimer) clearTimeout(speedHintTimer);

          // 更新卡槽為全綠成功狀態
          const slotsContainer = document.getElementById('speed-slots-row');
          if (slotsContainer) {
            slotsContainer.innerHTML = '';
            currentWord.codes.forEach((code, idx) => {
              const slot = document.createElement('div');
              slot.className = 'speed-key-slot filled';
              slot.style.borderColor = '#10B981';
              slot.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.5)';
              slot.innerHTML = `
                <div class="speed-slot-code" style="color: #34D399;">${code}</div>
                <div class="speed-slot-sub" style="color: #A7F3D0;">${currentWord.keys[idx]} ✓</div>
              `;
              slotsContainer.appendChild(slot);
            });
          }

          // 浮現空白鍵確認送出提示列
          const spacePrompt = document.getElementById('speed-space-prompt');
          if (spacePrompt) {
            spacePrompt.style.display = 'flex';
          }
          document.getElementById('speed-bottom-tip').innerHTML = `✨ <strong style="color:#34D399;">【${currentWord.char}】字碼全對！</strong>請按下鍵盤<strong>【Space 空白鍵】</strong>送出並進入下一題 ➔`;
        } else {
          renderSpeedTargetWord();
        }
      } else {
        // 按錯鍵：按要求嚴格加計 +0.3 秒罰時
        speedMistakes++;
        speedPenaltySeconds += 0.3;

        // 畫面抖動與泛紅
        const targetSlot = document.getElementById(`speed-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('shake-error');
          setTimeout(() => targetSlot.classList.remove('shake-error'), 400);
        }

        // 浮動紅字標籤
        const stage = document.getElementById('speed-main-stage');
        triggerFloatingNotice(stage, '+0.3s 罰時 ⚠️');

        document.getElementById('speed-penalty-display').innerHTML = `⚠️ 失誤 <strong style="color:#EF4444;">${speedMistakes}</strong> 次 (+<strong style="color:#EF4444;">${speedPenaltySeconds.toFixed(1)}s</strong> 罰時)`;
      }
    }

    // 學生按下空白鍵送出此字並進入下一關
    function confirmSpeedWordSpace() {
      if (!speedWordReadyForSpace || !speedActive) return;
      speedWordReadyForSpace = false;

      const spacePrompt = document.getElementById('speed-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      burstConfetti();
      speedWordIdx++;
      speedInputCodes = [];

      if (speedWordIdx < speedWordList.length) {
        renderSpeedTargetWord();
      } else {
        // 全部題目完成！進入結算
        onSpeedMatchComplete();
      }
    }

    // 手速賽圓滿結算 (秒數制 · 擊鍵準確率二次方加權罰時)
    function onSpeedMatchComplete() {
      speedActive = false;
      speedWordReadyForSpace = false;
      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);
      window.removeEventListener('keydown', handleSpeedKeydown, true);

      const endTime = performance.now();
      const rawElapsed = parseFloat(((endTime - speedStartTime) / 1000).toFixed(2));
      const accuracy = Math.max(10, Math.round((speedCorrectKeys / Math.max(1, speedTotalKeys)) * 100));

      // 計算等效競賽總耗時 (秒)
      const penaltyObj = calculateEffectiveSpeedTime(rawElapsed, speedMistakes, accuracy, currentSpeedWordCount);
      const effectiveFinalTime = penaltyObj.effectiveTime;

      const cpm = Math.round(currentSpeedWordCount / (effectiveFinalTime / 60)); // 等效中文字速
      const speedTier = getSpeedTier(effectiveFinalTime, currentSpeedWordCount);

      // 展示結算卡
      document.getElementById('speed-main-stage').style.display = 'none';
      document.getElementById('speed-finish-box').style.display = 'block';

      document.getElementById('speed-finish-title').textContent = `${currentSpeedWordCount} 字極速鍵盤手速賽完成！`;
      document.getElementById('speed-stat-final-time').textContent = effectiveFinalTime.toFixed(2) + 's';
      document.getElementById('speed-stat-raw-time').textContent = rawElapsed.toFixed(2) + 's';
      document.getElementById('speed-stat-acc').textContent = accuracy + '%';
      document.getElementById('speed-stat-acc-penalty').textContent = (penaltyObj.accPenalty >= 0 ? '+' : '') + penaltyObj.accPenalty.toFixed(2) + 's';
      document.getElementById('speed-stat-cpm').textContent = cpm + ' 字/分';
      document.getElementById('speed-stat-tier').textContent = speedTier;

      // 儲存至本地 SafeStorage (依周次與題量獨立儲存個人最佳秒數紀錄)
      if (currentStudent) {
        const speedKey = `p6_speed_${currentStudent.cls}_${currentStudent.num}_${currentSpeedWordCount}_${currentSpeedWeek}`;
        const prev = SafeStorage.getItem(speedKey);
        let bestRecord = {
          cls: currentStudent.cls,
          num: currentStudent.num,
          wordCount: currentSpeedWordCount,
          weekKey: currentSpeedWeek,
          bestTime: effectiveFinalTime, // 核心天梯排名依據 (秒數越小越前)
          rawTime: rawElapsed,
          accuracy: accuracy,
          cpm: cpm,
          accPenalty: penaltyObj.accPenalty,
          tier: speedTier,
          date: new Date().toISOString()
        };

        if (prev) {
          try {
            const parsed = JSON.parse(prev);
            if (parsed && typeof parsed.bestTime === 'number' && parsed.bestTime < effectiveFinalTime) {
              bestRecord = parsed; // 保留歷史最快紀錄
            }
          } catch(e) {}
        }
        SafeStorage.setItem(speedKey, JSON.stringify(bestRecord));

        // 向下相容舊鍵 (10字 w3)
        if (currentSpeedWordCount === 10) {
          const prevOverall = SafeStorage.getItem(`p6_speed_${currentStudent.cls}_${currentStudent.num}`);
          let shouldUpdateOverall = true;
          if (prevOverall) {
            try {
              const parsedPrev = JSON.parse(prevOverall);
              if (parsedPrev && parsedPrev.bestTime <= effectiveFinalTime) {
                shouldUpdateOverall = false;
              }
            } catch (e) {}
          }
          if (shouldUpdateOverall) {
            SafeStorage.setItem(`p6_speed_${currentStudent.cls}_${currentStudent.num}`, JSON.stringify(bestRecord));
          }
        }

        // 同步手速獎勵至總分 (依完成題目量與用時換算)
        let roundScore = Math.max(20, Math.round(150 - effectiveFinalTime * 2));
        if (currentSpeedWordCount === 20) roundScore = Math.round(roundScore * 1.8);
        // 手速賽純秒數天梯，不加總分，只回傳最佳秒數與周次
        saveStudentStats(currentStudent.cls, currentStudent.num, 0, false, 'speed', effectiveFinalTime, 10, currentSpeedWeek);
        loadStudentProfile();
      }

              // 同步手速榜篩選器與按鈕狀態至當前挑戰項目
        speedLeaderboardWordCount = currentSpeedWordCount;
        speedLeaderboardWeek = currentSpeedWeek;
        document.querySelectorAll('#speed-lb-sub-filters .lb-sub-pill[id^="lb-wc-"]').forEach(p => {
          p.classList.toggle('active', p.id === `lb-wc-${speedLeaderboardWordCount}`);
        });
        document.querySelectorAll('#speed-lb-week-buttons .lb-sub-pill').forEach(p => {
          p.classList.toggle('active', p.id === `lb-week-${speedLeaderboardWeek}`);
        });

      burstConfetti();
    }

    // 重玩手速賽 (同配置全新亂序)
    function restartSpeedMatch() {
      launchSpeedMatch();
    }

    // =========================================================================
    // 🏆 排行榜雙軌切換：討伐累積總分榜 vs 獨立手速天梯榜 (題量/周次/秒數升序)
    // =========================================================================
    function switchLeaderboardType(type) {
      currentLeaderboardType = type;
      document.querySelectorAll('.lb-sub-nav-btn').forEach(b => {
        b.classList.toggle('active', (type === 'score' && b.id === 'lb-type-score') || (type === 'speed' && b.id === 'lb-type-speed'));
      });
      
      const subFilters = document.getElementById('speed-lb-sub-filters');
      if (subFilters) {
        subFilters.style.display = (type === 'speed') ? 'block' : 'none';
        const select = document.getElementById('speed-lb-week-select');
        if (select && speedLeaderboardWeek) {
          select.value = speedLeaderboardWeek;
        }
      }

      const modalTitle = document.getElementById('lb-modal-main-title');
      if (modalTitle) {
        modalTitle.textContent = (type === 'speed') ? '⚡ 六年級寶可夢倉頡手速天梯榜' : '🏆 六年級寶可夢倉頡討伐龍虎榜';
      }

      renderLeaderboardTable();
    }

    // 周次子篩選器 (支援切換全部周次或指定周次功課)
    function filterSpeedLeaderboardWeek(weekKey) {
      speedLeaderboardWeek = weekKey;
      const select = document.getElementById('speed-lb-week-select');
      if (select && select.value !== weekKey) {
        select.value = weekKey;
      }
      renderSpeedLeaderboardTable();
    }

    // 獨立手速天梯榜渲染函數 (秒數升序 ASC · 擊鍵準確率二次加權罰時已計入)
    function renderSpeedLeaderboardTable() {
      // 1. 替換表頭為純10字秒數制各項指標 (11欄)
      const thead = document.querySelector('#modal-leaderboard thead tr');
      if (thead) {
        thead.innerHTML = `
          <th>排名</th>
          <th>班別</th>
          <th>學號</th>
          <th>訓練家代號</th>
          <th>周次功課</th>
          <th style="color:#0284C7;">⏱️ 10字等效耗時 (秒)</th>
          <th>原始碼表耗時</th>
          <th>擊鍵準確率</th>
          <th>準確率加權罰時</th>
          <th>等效中文字速</th>
          <th>手速段位</th>
        `;
      }

      const scoreLabel = document.getElementById('lb-my-score-label');
      const rankLabel = document.getElementById('lb-my-rank-label');
      if (scoreLabel) scoreLabel.textContent = '10字等效總耗時';
      if (rankLabel) rankLabel.textContent = (currentLeaderboardFilter === 'ALL') ? '全級手速名次' : '班內手速名次';

      const bankObj = (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS) ? MODE2_WEEKLY_BANKS[speedLeaderboardWeek] : null;
      const wkTitle = bankObj ? bankObj.title : (speedLeaderboardWeek === 'ALL' ? '全部周次 (生涯最佳)' : speedLeaderboardWeek);

      const allSpeedMap = {};

      // 1. 初始化全級名冊 (預設全部未參賽，不入榜)
      if (DATA.benchmark_leaderboard && Array.isArray(DATA.benchmark_leaderboard)) {
        DATA.benchmark_leaderboard.forEach(item => {
          let hasRec = false;
          let timeVal = 9999.0;

          if (item.weekly_speed && typeof item.weekly_speed[speedLeaderboardWeek] === 'number' && item.weekly_speed[speedLeaderboardWeek] > 0) {
            timeVal = Number(item.weekly_speed[speedLeaderboardWeek]);
            hasRec = true;
          } else if (speedLeaderboardWeek === 'ALL') {
            let best = 9999.0;
            if (typeof item.best10 === 'number' && item.best10 > 0 && item.best10 < 900) {
              best = item.best10;
            }
            if (item.weekly_speed && typeof item.weekly_speed === 'object') {
              Object.values(item.weekly_speed).forEach(v => {
                const numV = Number(v);
                if (!isNaN(numV) && numV > 0 && numV < best) {
                  best = numV;
                }
              });
            }
            if (best < 900) {
              timeVal = best;
              hasRec = true;
            }
          }

          const cpmVal = (hasRec && timeVal > 0) ? Math.round(10 / (timeVal / 60)) : 0;
          const tierVal = hasRec ? getSpeedTier(timeVal, 10) : '--';

          allSpeedMap[`${item.cls}_${item.num}`] = {
            cls: item.cls,
            num: item.num,
            name: item.name || `${item.cls} ${(item.num < 10 ? '0' : '') + item.num}號`,
            bestTime: timeVal,
            rawTime: timeVal,
            cpm: cpmVal,
            accuracy: 100,
            accPenalty: 0,
            tier: tierVal,
            weekKey: speedLeaderboardWeek,
            hasRecord: hasRec
          };
        });
      }

      // 2. 從本地 SafeStorage 讀取該周次功課之真實手速紀錄 (優先採用本機最新最佳)
      const allKeys = SafeStorage.getAllKeys ? SafeStorage.getAllKeys() : [];
      allKeys.forEach(key => {
        if (key.startsWith('p6_speed_')) {
          const parts = key.replace('p6_speed_', '').split('_');
          const cls = String(parts[0] || '').trim().toUpperCase();
          const num = parseInt(parts[1], 10);
          if (!cls || isNaN(num) || num < 1 || num > 36) return;
          const recWc = parts[2] ? parseInt(parts[2], 10) : 10;
          const recWk = parts.slice(3).join('_') || 'w7_hw1';

          if (recWc !== 10) return; // 六年級鎖定純10字
          if (speedLeaderboardWeek !== 'ALL' && recWk !== speedLeaderboardWeek) return;

          try {
            const parsed = JSON.parse(SafeStorage.getItem(key));
            if (parsed && typeof parsed.bestTime === 'number' && parsed.bestTime > 0 && parsed.bestTime < 900) {
              const mapKey = `${cls}_${num}`;
              const time = parsed.bestTime;
              const raw = (typeof parsed.rawTime === 'number') ? parsed.rawTime : time;
              const acc = (typeof parsed.accuracy === 'number') ? parsed.accuracy : 100;
              const cpm = parsed.cpm || Math.round(10 / (time / 60));
              const penalty = parsed.accPenalty || 0;
              const tier = parsed.tier || getSpeedTier(time, 10);

              if (!allSpeedMap[mapKey] || !allSpeedMap[mapKey].hasRecord || allSpeedMap[mapKey].bestTime > time) {
                allSpeedMap[mapKey] = {
                  cls, num,
                  name: `${cls} ${(num < 10 ? '0' : '') + num}號`,
                  bestTime: time,
                  rawTime: raw,
                  cpm: cpm,
                  accuracy: acc,
                  accPenalty: penalty,
                  tier: tier,
                  weekKey: recWk,
                  hasRecord: true
                };
              }
            }
          } catch(e) {}
        }
      });

      // 3. 從雲端即時手速榜合併跨電腦成績
      if (DATA.cloud_speed_records) {
        let cloudList = [];
        if (Array.isArray(DATA.cloud_speed_records)) {
          cloudList = DATA.cloud_speed_records;
        } else if (DATA.cloud_speed_records[speedLeaderboardWeek]) {
          cloudList = DATA.cloud_speed_records[speedLeaderboardWeek];
        } else if (speedLeaderboardWeek === 'ALL' && DATA.cloud_speed_records['overall']) {
          cloudList = DATA.cloud_speed_records['overall'];
        }

        cloudList.forEach(cs => {
          const mapKey = `${cs.cls}_${cs.num}`;
          const time = cs.bestTime || cs.best10;
          if (time && typeof time === 'number' && time > 0 && time < 900) {
            const curEntry = allSpeedMap[mapKey];
            if (!curEntry || !curEntry.hasRecord || curEntry.bestTime > time) {
              const cpm = cs.cpm || Math.round(10 / (time / 60));
              allSpeedMap[mapKey] = {
                cls: cs.cls,
                num: cs.num,
                name: cs.name || `${cs.cls} ${(cs.num < 10 ? '0' : '') + cs.num}號`,
                bestTime: time,
                rawTime: cs.rawTime || time,
                cpm: cpm,
                accuracy: cs.accuracy || 100,
                accPenalty: cs.accPenalty || 0,
                tier: cs.tier || getSpeedTier(time, 10),
                weekKey: speedLeaderboardWeek,
                hasRecord: true
              };
            }
          }
        });
      }

      // 4. 嚴格過濾：未參與本項手速遊戲者直接不入榜！
      const speedList = Object.values(allSpeedMap).filter(s => s.hasRecord && typeof s.bestTime === 'number' && s.bestTime < 900);
      speedList.sort((a, b) => {
        if (a.bestTime !== b.bestTime) return a.bestTime - b.bestTime;
        return b.accuracy - a.accuracy;
      });
      speedList.forEach((item, idx) => item.overallRank = idx + 1);

      // 分班計算班內名次 (僅限有成績者)
      const classGroups = {};
      ['P6A', 'P6B', 'P6C', 'P6D', 'P6E', 'P6F'].forEach(c => {
        classGroups[c] = speedList.filter(s => s.cls === c);
        classGroups[c].forEach((item, idx) => item.classRank = idx + 1);
      });

      // 5. 更新頂部我的個人戰報 (防呆容錯，杜絕 NaN 與 toFixed TypeError)
      if (currentStudent) {
        const myKey = `${currentStudent.cls}_${currentStudent.num}`;
        const myEntry = allSpeedMap[myKey];
        const myNameEl = document.getElementById('lb-my-name');
        if (myNameEl) myNameEl.textContent = `${currentStudent.cls} ${(currentStudent.num < 10 ? '0' : '') + currentStudent.num}號`;

        const myTitleEl = document.getElementById('lb-my-title');
        const myScoreEl = document.getElementById('lb-my-score');
        const myBadgeEl = document.getElementById('lb-my-badge');
        const myRankEl = document.getElementById('lb-my-rank');

        if (myEntry && myEntry.hasRecord && typeof myEntry.bestTime === 'number' && myEntry.bestTime < 900) {
          const displayCpm = myEntry.cpm || Math.round(10 / (myEntry.bestTime / 60));
          if (myTitleEl) myTitleEl.textContent = `分類：10字賽 · ${wkTitle} ｜ 字速：${displayCpm} 字/分`;
          if (myScoreEl) myScoreEl.textContent = `${myEntry.bestTime.toFixed(2)} 秒 (準確率 ${myEntry.accuracy || 100}%)`;
          if (myBadgeEl) myBadgeEl.textContent = '⚡';
          if (myRankEl) {
            if (currentLeaderboardFilter === "ALL") {
              myRankEl.innerHTML = `<span style="color:#B45309;font-weight:900;">全級手速第 ${myEntry.overallRank} 名 (共 ${speedList.length} 人上榜)</span>`;
            } else {
              const classTotal = (classGroups[currentLeaderboardFilter] || []).length;
              myRankEl.innerHTML = `<span style="color:#2563EB;font-weight:900;">${currentLeaderboardFilter} 班內手速第 ${myEntry.classRank} 名 (共 ${classTotal} 人上榜)</span>`;
            }
          }
        } else {
          if (myTitleEl) myTitleEl.textContent = `分類：10字賽 · ${wkTitle}`;
          if (myScoreEl) myScoreEl.textContent = '-- 秒';
          if (myBadgeEl) myBadgeEl.textContent = '⏱️';
          if (myRankEl) myRankEl.innerHTML = '<span style="color:#64748B;">未參加本周次手速挑戰 (未入榜)</span>';
        }
      }

      // 6. 渲染表格 (11欄)
      const isClassFilter = currentLeaderboardFilter !== 'ALL';
      const displayList = isClassFilter ? (classGroups[currentLeaderboardFilter] || []) : speedList;

      const tbody = document.getElementById('leaderboard-tbody');
      if (!tbody) return;

      if (displayList.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="11" style="padding: 26px; text-align: center; color: #64748B; font-weight: 800; font-size: 13.5px;">
              ⚡ 該組分類 (10字賽 · ${wkTitle}) 尚無同學完成，快成為第一位手速神手！
            </td>
          </tr>
        `;
        return;
      }

      let rowsHtml = displayList.map(s => {
        const rankNum = isClassFilter ? s.classRank : s.overallRank;
        let medal = `${rankNum}`;
        if (rankNum === 1) medal = '🥇 1';
        else if (rankNum === 2) medal = '🥈 2';
        else if (rankNum === 3) medal = '🥉 3';

        const isMe = currentStudent && s.cls === currentStudent.cls && s.num === currentStudent.num;
        const rowBank = (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS) ? MODE2_WEEKLY_BANKS[s.weekKey || speedLeaderboardWeek] : null;
        const rowWkTitle = rowBank ? rowBank.title : (s.weekKey === 'ALL' || speedLeaderboardWeek === 'ALL' ? '生涯最佳' : (s.weekKey || speedLeaderboardWeek));
        const tierName = (typeof s.tier === 'object' && s.tier) ? (s.tier.name || s.tier.badge || '--') : String(s.tier || '--');

        return `
          <tr style="${isMe ? 'background: #EFF6FF; font-weight: bold; border-left: 4px solid #2563EB;' : ''}">
            <td style="padding: 8px 6px; text-align: center; font-weight: 900; color: ${rankNum <= 3 ? '#B45309' : '#1E293B'};"><span class="emoji-icon">${medal}</span></td>
            <td style="padding: 8px 6px; text-align: center;"><span class="st-poke-tag" style="background:#DBEAFE;color:#1E40AF;font-weight:800;">${s.cls}</span></td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 700;">${(s.num < 10 ? '0' : '') + s.num}號</td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 800;">${s.name} ${isMe ? '⭐(我)' : ''}</td>
            <td style="padding: 8px 6px; text-align: center;"><span style="color:#2563EB;font-weight:800;font-size:12px;">${rowWkTitle}</span></td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 900; color: #0284C7; font-size: 14.5px;">⏱️ ${typeof s.bestTime === 'number' ? s.bestTime.toFixed(2) : s.bestTime}s</td>
            <td style="padding: 8px 6px; text-align: center; color: #64748B; font-size: 12px;">${typeof s.rawTime === 'number' ? s.rawTime.toFixed(2) : s.rawTime}s</td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 800; color: ${s.accuracy >= 95 ? '#059669' : '#DC2626'};"><span class="emoji-icon">${s.accuracy}%</span></td>
            <td style="padding: 8px 6px; text-align: center; color: #DC2626; font-size: 11.5px;">+${(s.accPenalty || 0).toFixed(2)}s</td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 800; color: #D97706;">${s.cpm} 字/分</td>
            <td style="padding: 8px 6px; text-align: center;"><span class="speed-tier-badge">${tierName}</span></td>
          </tr>
        `;
      }).join('');
      tbody.innerHTML = rowsHtml;
    }

    // 頁面載入時依日期自動初始化手速字庫下拉選單與排行榜篩選器，並檢查離線補送隊列
    window.addEventListener('DOMContentLoaded', () => {
      initSpeedWeekDropdown();
      flushPendingUploads();
      // 🚀 開局自動向雲端同步全級最新戰況與學生檔案 (確保換電腦自動漫遊)
      if (typeof fetchCloudLeaderboard === 'function') {
        fetchCloudLeaderboard(true);
      }
    });

    // 📡 監聽網路連線恢復事件 (當校園網路重新連通時自動補送成績)
    window.addEventListener('online', () => {
      console.log('📡 偵測到網路已重新連通，自動補發離線成績...');
      flushPendingUploads();
    });
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      try { initSpeedWeekDropdown(); } catch(e) {}
    }

    // =========================================================================
    // 🎮 寶可夢三大異構新玩法引擎 (逃出恐怖屋 / 精靈養成 / 道館生存戰)
    // ＋ 每日階梯式解鎖鏈 (150~400分) ＋ upload-queue 整合
    // =========================================================================

    // --- A. 動態模式分頁與每日階梯式解鎖鏈渲染 ---
    function renderModeTabs() {
      const container = document.querySelector('.mode-tab-bar');
      if (!container || typeof P6Mode === 'undefined') return;

      const isTeacher = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
      const student = currentStudent || null;
      const cls = student ? student.cls : null;
      const num = student ? student.num : null;
      const modes = P6Mode.all();
      const dailyScore = P6Mode.getDailyEarnedScore(cls, num);

      let html = '';
      modes.forEach(m => {
        const unlock = P6Mode.getUnlockStatus(m.id, cls, num, isTeacher);
        const isActive = (currentGameMode === m.id);
        const isLocked = !unlock.unlocked;

        let lockClass = '';
        let badgeHtml = '';
        let circleHtml = '';

        if (m.line === 'challenge') {
          circleHtml = `<span class="mode-circle-challenge">挑戰</span>`;
          badgeHtml = `<span class="mode-badge-pill mode-badge-speed">${m.badge}</span>`;
        } else {
          circleHtml = `<span class="mode-circle-num">${m.circle || m.order}</span>`;
          if (isLocked) {
            lockClass = 'locked' + ((typeof isCloudOnline !== 'undefined' && isCloudOnline) ? ' hard-locked' : '');
            badgeHtml = `<span class="mode-badge-pill mode-badge-locked">🔒 差 ${unlock.neededScore} 分</span>`;
          } else {
            badgeHtml = `<span class="mode-badge-pill mode-badge-done">✓ ${m.badge}</span>`;
          }
        }

        html += `
          <button id="mode-tab-${m.id}" class="mode-tab-btn ${isActive ? 'active' : ''} ${lockClass}" 
                  onclick="setGameMode('${m.id}')" title="${m.note || m.name}">
            ${circleHtml}
            <span>${m.icon}</span> <span>${m.name}</span>
            ${badgeHtml}
          </button>
        `;
      });

      container.innerHTML = html;

      // 📖 動態更新常駐計分說明橫條 (主線全解 vs 未全解狀態即時響應)
      const bannerEl = document.getElementById('scoring-note-banner');
      if (bannerEl && typeof P6Mode !== 'undefined') {
        const isAllUnlocked = P6Mode.isMainLineFullyUnlocked(cls, num, isTeacher);
        if (isAllUnlocked) {
          bannerEl.style.background = '#ECFDF5';
          bannerEl.style.borderColor = '#A7F3D0';
          bannerEl.style.color = '#065F46';
          bannerEl.innerHTML = `🎉 <strong>主線全解鎖特權已啟動！</strong>第 3 站【逃出恐怖屋】(基礎分×1.2)、第 5 站【道館生存】(基礎分×1.5 疊加連擊加成) 全面解除限制，按原設定正常無限獲取積分！其他前置站次維持每日次數衰減規則。`;
        } else {
          bannerEl.style.background = '#FFFBEB';
          bannerEl.style.borderColor = '#FDE68A';
          bannerEl.style.color = '#B45309';
          bannerEl.innerHTML = `📖 <strong>計分規則</strong>：主線未全解時，前置關卡按防刷分規則計分（第 1 次全額，第 2 次一半，第 3 次四分之一，第 4 次起為練習不加分）；當主線全解時，只有第 3 站【逃出恐怖屋】與第 5 站【道館生存】解除限制並按原設定無限獲取積分！其他前置站次維持每日次數衰減規則。`;
        }
      }
    }

    // --- B. 逃出恐怖屋・野生寶可夢突圍戰 (無上限階梯 + 1-10級當周字庫/11級後全字庫真隨機 + 十萬伏特按鍵2) ---
    let siegeActive = false;
    let siegeRunning = false;
    let siegeIsPaused = false;
    let siegeHp = 100;
    let siegeMaxHp = 100;
    let siegeLevel = 1;
    let siegeWave = 1; // 嚴格等於 siegeLevel
    let siegeKills = 0;
    let siegeKillsInLevel = 0;
    let siegeExpNeeded = 3;
    let siegeMisses = 0;
    let siegeScore = 0;
    let siegePotionsCount = 0;
    let siegeSeconds = 0;
    let siegeTimeInterval = null;
    let siegeEnemies = [];
    let siegeParticles = [];
    let siegeLightnings = [];
    let siegeHealParticles = [];
    let siegeAnimId = null;
    let siegeTargetEnemy = null;
    let siegeCandidateEnemies = [];
    // 👑 Boss 戰系統狀態變數 (Wave 5 / Wave 10 雙階霸主機制)
    let currentBoss = null;
    let siegeDodgeActive = false;
    let siegeDodgeWord = null;
    let siegeDodgeTypedIdx = 0;
    let siegeDodgeTimer = 0;
    let siegeDodgeMaxTimer = 5.0;
    let siegeDodgeInterval = null;
    let siegeUltCharge = 0;
    let siegeBarrierHitTimer = 0;
    let siegeIsSpawningSquad = false;
    let siegeDashOffset = 0;
    let siegeWordQueue = []; // 真隨機題庫抽取隊列
    let recentSiegeWordHistory = []; // 近期已抽題目防重快取 (容量 40 字)
    let siegeLastPoolWaveType = 0; // 記錄前次題庫波次模式 (<=10 或 >10)

    function drawUniqueSiegeWord() {
      const curWaveType = (siegeWave > 10) ? 2 : 1;
      // 若波次跨越第 10 波進入第 11+ 波，立即刷新題庫隊列為全週次 686 字大牌堆
      if (curWaveType !== siegeLastPoolWaveType) {
        siegeWordQueue = [];
        siegeLastPoolWaveType = curWaveType;
      }

      if (!siegeWordQueue || siegeWordQueue.length === 0) {
        const fullPool = getSiegeWordPool(siegeWave, siegeLevel);
        siegeWordQueue = secureFisherYatesShuffle(fullPool);
      }

      // 提取畫面上所有活躍怪獸已攜帶的漢字，防止同屏撞字
      const onScreenChars = new Set();
      if (Array.isArray(siegeEnemies)) {
        siegeEnemies.forEach(e => {
          if (e && e.word && e.word.char) onScreenChars.add(e.word.char);
          if (e && e.wordsQueue && Array.isArray(e.wordsQueue)) {
            e.wordsQueue.forEach(w => { if (w && w.char) onScreenChars.add(w.char); });
          }
        });
      }

      // 從洗牌隊列中尋找非同屏且不在近期重覆緩衝區的漢字
      let chosen = null;
      let searched = 0;
      while (siegeWordQueue.length > 0 && searched < siegeWordQueue.length) {
        const candidate = siegeWordQueue.pop();
        searched++;
        if (!candidate || !candidate.char) continue;

        // 若畫面上已有該字，暫時放回隊列底部
        if (onScreenChars.has(candidate.char)) {
          siegeWordQueue.unshift(candidate);
          continue;
        }

        // 若在最近 40 次抽取歷史中，且隊列尚有餘裕，亦暫緩使用
        if (recentSiegeWordHistory.includes(candidate.char) && siegeWordQueue.length > 15) {
          siegeWordQueue.unshift(candidate);
          continue;
        }

        chosen = candidate;
        break;
      }

      // 若隊列過度擁擠則強行彈出或兜底重新洗牌
      if (!chosen) {
        if (siegeWordQueue.length === 0) {
          const fullPool = getSiegeWordPool(siegeWave, siegeLevel);
          siegeWordQueue = secureFisherYatesShuffle(fullPool);
        }
        chosen = siegeWordQueue.pop() || { char: '鬼', codes: ['竹', '戈', '竹', '山'], keys: ['H', 'I', 'H', 'U'] };
      }

      // 🛡️ 權威真值校正：以《2026每周打字字庫表》> cj3-30000.txt > cj3-special.txt 刷新字碼
      const getAuthFn = (typeof getAuthoritativeCj3 === 'function') ? getAuthoritativeCj3 : (typeof window !== 'undefined' ? window.getAuthoritativeCj3 : null);
      if (typeof getAuthFn === 'function' && chosen && chosen.char) {
        const auth = getAuthFn(chosen.char);
        if (auth) {
          if (auth.codes) chosen.codes = auth.codes.slice();
          if (auth.keys) chosen.keys = auth.keys.slice();
          if (auth.full) chosen.full = auth.full;
          if (auth.secret) chosen.secret = auth.secret;
          if (auth.quickCode) chosen.quickCode = auth.quickCode;
        }
      }

      // 記入近期歷史快取 (最長 40 筆)
      recentSiegeWordHistory.push(chosen.char);
      if (recentSiegeWordHistory.length > 40) recentSiegeWordHistory.shift();

      return chosen;
    }
    let siegeUltToastShown = false;

    // 招式效果
    let siegeLearnedMoves = [];
    let siegeBonusScore = 0;
    let siegeUltChargeRate = 1.0;
    let siegeLightningChains = 0;
    let siegeBarrierShieldCount = 0;
    let siegeSlowFactor = 1.0;
    let siegePotionHealBonus = 0;
    let siegeKeepProgressOnMiss = false;
    let siegeDoubleScoreChance = 0;
    let siegeKillsInWave = 0;
    let siegeWaveKillsNeeded = 2; // 波次推進門檻
    let siegeLevelKillsNeeded = 5; // 等級晉升門檻 (Lv.1->2 需 5 隻，Lv.2->3 需 10 隻...)
    let siegeSpeedPenalty = 1.0; // 招式負面效果：怪獸加速因子
    let siegeExtraEnemyCount = 0; // 招式負面效果：同時入侵額外數量
    let siegeImpactDamageExtra = 0; // 招式負面效果：額外撞擊傷害
    let siegeHasLeftovers = false; // 吃剩的東西持續回復狀態
    let siegeLeftoversHeal = 1; // 吃剩的東西回復量 (每10秒+1)

    const siegeAshImg = new Image();
    siegeAshImg.src = 'images/pokemon_ash_pikachu.png';

    const siegePotionImg = new Image();
    siegePotionImg.src = 'images/pokemon_potion.png';

    const siegeMonsterImgs = {
      gastly: new Image(),
      haunter: new Image(),
      gourgeist: new Image(),
      gengar: new Image()
    };
    siegeMonsterImgs.gastly.src = 'images/pokemon_gastly.png';
    siegeMonsterImgs.haunter.src = 'images/pokemon_haunter.png';
    siegeMonsterImgs.gourgeist.src = 'images/pokemon_gourgeist.png';
    siegeMonsterImgs.gengar.src = 'images/pokemon_gengar.png';

    // 🎲 密碼學安全真隨機生成器 (Web Crypto API，真正做到真隨機)
    function getSecureRandom() {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] / (0xFFFFFFFF + 1);
      }
      return Math.random();
    }

    function secureFisherYatesShuffle(array) {
      const arr = array.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(getSecureRandom() * (i + 1));
        const temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
      }
      return arr;
    }

    // ★ 題庫選取：等級 1-10 級使用「當前周數」字庫，10 級以後 (Lv.11+) 使用「全部周數字庫」隨機
    function getSiegeWordPool(wave, level) {
      let pool = [];
      const weekly = (typeof window !== 'undefined' && window.MODE2_WEEKLY_BANKS) 
        ? window.MODE2_WEEKLY_BANKS 
        : (typeof MODE2_WEEKLY_BANKS !== 'undefined' ? MODE2_WEEKLY_BANKS : {});

      const cloud = (typeof window !== 'undefined' && window.CLOUD_WEEKLY_BANKS)
        ? window.CLOUD_WEEKLY_BANKS
        : (typeof CLOUD_WEEKLY_BANKS !== 'undefined' ? CLOUD_WEEKLY_BANKS : {});

      const curWave = (typeof wave === 'number') ? wave : (typeof siegeWave !== 'undefined' ? siegeWave : 1);
      const curLvl = (typeof level === 'number') ? level : (typeof siegeLevel !== 'undefined' ? siegeLevel : 1);

      // ★ 依使用者指示：波次 1-10 (Wave 1~10) 嚴格使用當前開放周次（第 8 周）字庫與答案；波次超過 10 (Wave 11+) 全周次題庫隨機
      if (curWave <= 10) {
        let qWk = (typeof getActiveSpeedWeek === 'function') ? getActiveSpeedWeek() : 'w8';
        if (!qWk) qWk = 'w8';
        for (let i = 1; i <= 4; i++) {
          const key = `${qWk}_hw${i}`;
          if (weekly[key] && Array.isArray(weekly[key].words) && weekly[key].words.length > 0) {
            pool = pool.concat(weekly[key].words);
          } else if (cloud[key] && Array.isArray(cloud[key].words) && cloud[key].words.length > 0) {
            pool = pool.concat(cloud[key].words);
          }
        }
        // 若當前週次題庫暫時未載入，嚴格保底從 MODE2_WEEKLY_BANKS 抽取當前開放周次 (w8)
        if (pool.length === 0 && typeof MODE2_WEEKLY_BANKS !== 'undefined') {
          for (let i = 1; i <= 4; i++) {
            const k = `${qWk}_hw${i}`;
            if (MODE2_WEEKLY_BANKS[k] && Array.isArray(MODE2_WEEKLY_BANKS[k].words)) {
              pool = pool.concat(MODE2_WEEKLY_BANKS[k].words);
            }
          }
        }
      } else {
        // ★ 波次超過 10 (Wave 11+)：全面匯整《2026每周打字字庫表》所有周次題庫！
        // 包含使用者所列全部字根：式行微川冷租戊拜牧強鬥所翻麥數斤神參物厭底生祖筷丈府車附穿窗較守划疾麵、貝熱糧炎波潔杯常采朋昊昔巴象用冥冤炙只共弟並朮術材村五韋汝求叉反丕否肉等
        Object.keys(weekly).forEach(k => {
          if (weekly[k] && Array.isArray(weekly[k].words)) {
            pool = pool.concat(weekly[k].words);
          }
        });
        Object.keys(cloud).forEach(k => {
          if (cloud[k] && Array.isArray(cloud[k].words)) {
            pool = pool.concat(cloud[k].words);
          }
        });
        if (typeof DATA !== 'undefined') {
          if (DATA.abbrev_words) pool = pool.concat(DATA.abbrev_words);
          if (DATA.feature_words) pool = pool.concat(DATA.feature_words);
          if (DATA.connected_words) pool = pool.concat(DATA.connected_words);
          if (DATA.split_words) pool = pool.concat(DATA.split_words);
          if (DATA.difficult_words) pool = pool.concat(DATA.difficult_words);
        }
      }

      // 去重與真值字典校驗 (自動規格化補齊 codes 與 keys)
      const seen = new Set();
      const unique = [];
      pool.forEach(item => {
        if (item && item.char) {
          if (!item.keys && item.prefix_keys && item.body_keys) {
            item.keys = item.prefix_keys.concat(item.body_keys);
          }
          if (!item.codes && item.prefix_codes && item.body_codes) {
            item.codes = item.prefix_codes.concat(item.body_codes);
          }
          if (!seen.has(item.char)) {
            seen.add(item.char);
            // ★ SSOT 原則：若題庫本身已有設定好的 codes 與 keys（來自《2026每周打字字庫表》），嚴格保留真值，絕不覆蓋！
            if ((!item.keys || item.keys.length === 0 || item.keys.includes('?')) && typeof MASTER_CJ3_DICT !== 'undefined' && MASTER_CJ3_DICT[item.char]) {
              const canon = MASTER_CJ3_DICT[item.char];
              item.codes = canon.codes.slice();
              item.keys = canon.keys.slice();
              item.full = canon.full;
            }
            unique.push(item);
          }
        }
      });
      return unique;
    }

    // ─────────────────────────────────────────────────────────────
    // 📖 52 種寶可夢招式技能庫
    // ─────────────────────────────────────────────────────────────
    const SIEGE_POKEMON_MOVES = [
      { id: 'protect', name: '守住 (Protect)', icon: '🛡️', tier: 1, desc: '立刻獲得 1 面電氣護盾，可完全抵擋 1 次怪獸衝擊！', preview: { shieldAdd: 1 }, apply: () => { siegeBarrierShieldCount += 1; } },
      { id: 'light_screen', name: '光牆 (Light Screen)', icon: '✨', tier: 1, desc: '展開光牆能量屏障，傷藥回復效果永久提升 +5 點！', preview: { potionBonus: 5 }, apply: () => { siegePotionHealBonus += 5; } },
      { id: 'substitute', name: '替身 (Substitute)', icon: '🧸', tier: 2, desc: '釋放比卡丘替身玩偶，免疫接下來 2 次怪獸衝擊！', preview: { shieldAdd: 2 }, apply: () => { siegeBarrierShieldCount += 2; } },
      { id: 'safeguard', name: '神秘守護 (Safeguard)', icon: '🔮', tier: 1, desc: '小智生命上限提升 25 點，並立刻恢復 25 點生命值。', preview: { hpMaxAdd: 25, hpAdd: 25 }, apply: () => { siegeMaxHp += 25; siegeHp = Math.min(siegeMaxHp, siegeHp + 25); } },
      { id: 'max_guard', name: '極巨防壁 (Max Guard)', icon: '🏰', tier: 3, desc: '展開極巨金光結界，立刻獲得 3 面堅韌護盾！', preview: { shieldAdd: 3 }, apply: () => { siegeBarrierShieldCount += 3; } },
      { id: 'focus_sash', name: '氣勢披帶 (Focus Sash)', icon: '🥋', tier: 2, desc: '獲得披帶庇佑，生命上限提升 15 點並獲 1 面護盾！', preview: { shieldAdd: 1, hpMaxAdd: 15 }, apply: () => { siegeBarrierShieldCount += 1; siegeMaxHp += 15; } },
      { id: 'rocky_helmet', name: '凸凸頭盔 (Rocky Helmet)', icon: '🪖', tier: 2, desc: '堅硬防護，立刻獲得 1 面電氣護盾抵擋衝擊！', preview: { shieldAdd: 1 }, apply: () => { siegeBarrierShieldCount += 1; } },
      { id: 'assault_vest', name: '突擊背心 (Assault Vest)', icon: '🦺', tier: 1, desc: '耐力倍增，小智生命上限提升 30 點並回復 30 點生命值。', preview: { hpMaxAdd: 30, hpAdd: 30 }, apply: () => { siegeMaxHp += 30; siegeHp = Math.min(siegeMaxHp, siegeHp + 30); } },
      { id: 'quick_attack', name: '電光一閃 (Quick Attack)', icon: '⚡', tier: 1, desc: '比卡丘極速出擊，閃電擊破時連鎖彈射攻擊 1 隻相鄰怪獸！', preview: { chainAdd: 1 }, apply: () => { siegeLightningChains += 1; } },
      { id: 'volt_tackle', name: '伏特狂鯊 (Volt Tackle)', icon: '🦈', tier: 2, desc: '閃電狂暴衝擊，擊破怪獸獲得的戰鬥積分永久 +12 分！', preview: { scoreAdd: 12 }, apply: () => { siegeBonusScore += 12; } },
      { id: 'discharge', name: '放電 (Discharge)', icon: '💥', tier: 2, desc: '擊破怪獸時連鎖 +1 隻相鄰怪獸，且額外獲得 +8 積分！', preview: { scoreAdd: 8, chainAdd: 1 }, apply: () => { siegeBonusScore += 8; siegeLightningChains += 1; } },
      { id: 'thunder_punch', name: '雷電拳 (Thunder Punch)', icon: '🥊', tier: 1, desc: '重拳聚能，十萬伏特充能速度提升 +25%！', preview: { chargeRateAdd: 0.25 }, apply: () => { siegeUltChargeRate += 0.25; } },
      { id: 'thunder', name: '打雷 (Thunder)', icon: '⛈️', tier: 2, desc: '暴風雷鳴，十萬伏特充能速度提升 +35%，擊破得分 +10 分。', preview: { chargeRateAdd: 0.35, scoreAdd: 10 }, apply: () => { siegeUltChargeRate += 0.35; siegeBonusScore += 10; } },
      { id: 'gigavolt', name: '百萬伏特 (Gigavolt)', icon: '🌩️', tier: 3, desc: '比卡丘究極雷霆！擊破怪獸額外獲取 +25 積分，閃電連鎖 +1 隻！', preview: { scoreAdd: 25, chainAdd: 1 }, apply: () => { siegeBonusScore += 25; siegeLightningChains += 1; } },
      { id: 'pika_10m', name: '智皮卡神雷 (10,000,000V)', icon: '👑', tier: 3, desc: '小智與戴帽比卡丘超絕神技！閃電連鎖 +2 隻，積分獲取 +30！', drawback: '⚠️ 萬雷引動雷雲狂潮，每波同時入侵怪獸數量上限 +1 隻！', preview: { chainAdd: 2, scoreAdd: 30, countAdd: 1 }, apply: () => { siegeLightningChains += 2; siegeBonusScore += 30; siegeExtraEnemyCount += 1; } },
      { id: 'electric_terrain', name: '電氣場地 (Electric Terrain)', icon: '🌐', tier: 2, desc: '展開地表電氣場，全場所有怪獸飛行逼近速度永久減緩 20%！', preview: { slowMult: 0.80 }, apply: () => { siegeSlowFactor *= 0.80; } },
      { id: 'thunder_wave', name: '電磁波 (Thunder Wave)', icon: '〰️', tier: 1, desc: '發射微弱電流麻痹怪獸，全場怪獸飛行逼近速度減緩 15%！', preview: { slowMult: 0.85 }, apply: () => { siegeSlowFactor *= 0.85; } },
      { id: 'charge', name: '充電 (Charge)', icon: '🔋', tier: 1, desc: '蓄積雷電能量，大招充能效率額外提升 +30%！', preview: { chargeRateAdd: 0.30 }, apply: () => { siegeUltChargeRate += 0.30; } },
      { id: 'magnet_rise', name: '電磁浮游 (Magnet Rise)', icon: '🧲', tier: 1, desc: '利用電磁力浮空，全場怪獸逼近速度減緩 10%！', preview: { slowMult: 0.90 }, apply: () => { siegeSlowFactor *= 0.90; } },
      { id: 'agility', name: '高速移動 (Agility)', icon: '💨', tier: 1, desc: '身手敏捷，每次擊破額外獲得 +6 積分，瞄準響應更靈敏。', preview: { scoreAdd: 6 }, apply: () => { siegeBonusScore += 6; } },
      { id: 'focus_energy', name: '聚氣 (Focus Energy)', icon: '🎯', tier: 2, desc: '注意力高度集中，擊破時有 35% 機率觸發雙倍積分！', preview: { critAdd: 0.35 }, apply: () => { siegeDoubleScoreChance += 0.35; } },
      { id: 'double_team', name: '影子分身 (Double Team)', icon: '👥', tier: 2, desc: '幻化多個分身迷惑對手，怪獸飛行逼近速度減緩 15%！', preview: { slowMult: 0.85 }, apply: () => { siegeSlowFactor *= 0.85; } },
      { id: 'rain_dance', name: '祈雨 (Rain Dance)', icon: '🌧️', tier: 1, desc: '召喚雨雲助長電氣威力，大招充能效率提升 +20%。', preview: { chargeRateAdd: 0.20 }, apply: () => { siegeUltChargeRate += 0.20; } },
      { id: 'calm_mind', name: '冥想 (Calm Mind)', icon: '🧘', tier: 2, desc: '平心靜氣，立即為小智回復 15 點生命值！', preview: { hpAdd: 15 }, apply: () => { siegeHp = Math.min(siegeMaxHp, siegeHp + 15); } },
      { id: 'recover', name: '自我再生 (Recover)', icon: '💖', tier: 1, desc: '細胞快速活化，立即為小智回復 45 點生命值！', preview: { hpAdd: 45 }, apply: () => { siegeHp = Math.min(siegeMaxHp, siegeHp + 45); } },
      { id: 'morning_sun', name: '晨光 (Morning Sun)', icon: '🌅', tier: 2, desc: '沐浴晨光，生命上限提升 20 點並立即回復 50 點生命值！', preview: { hpMaxAdd: 20, hpAdd: 50 }, apply: () => { siegeMaxHp += 20; siegeHp = Math.min(siegeMaxHp, siegeHp + 50); } },
      { id: 'dynamax', name: '極巨化 (Dynamax)', icon: '🔴', tier: 3, desc: '比卡丘極巨化覺醒！生命上限提升 50 點並直接補滿生命值！', drawback: '⚠️ 身軀龐大招引敵潮，怪獸逼近飛行速度增加 +15%！', preview: { hpMaxAdd: 50, speedMult: 1.15 }, apply: () => { siegeMaxHp += 50; siegeHp = siegeMaxHp; siegeSpeedPenalty *= 1.15; } },
      { id: 'helping_hand', name: '幫助 (Helping Hand)', icon: '🤝', tier: 1, desc: '夥伴同心協力，擊破怪獸時獲得的大招充能額外 +25%。', preview: { chargeRateAdd: 0.25 }, apply: () => { siegeUltChargeRate += 0.25; } },
      { id: 'follow_me', name: '看我嘛 (Follow Me)', icon: '👀', tier: 2, desc: '吸引怪獸注意力，中途偶爾按錯鍵時保留當前拆碼進度不重置！', preview: { keepProgress: true }, apply: () => { siegeKeepProgressOnMiss = true; } },
      { id: 'sweet_scent', name: '甜甜香氣 (Sweet Scent)', icon: '🌸', tier: 1, desc: '香氣安撫野生怪獸，怪獸前進飛行速度減緩 12%。', preview: { slowMult: 0.88 }, apply: () => { siegeSlowFactor *= 0.88; } },
      { id: 'potion_master', name: '藥劑大師 (Potion Master)', icon: '🧪', tier: 2, desc: '精研製藥技術，每次使用【傷藥】回復數值額外 +25 HP！', preview: { potionBonus: 25 }, apply: () => { siegePotionHealBonus += 25; } },
      { id: 'clever_mix', name: '巧手調配 (Clever Mix)', icon: '⚗️', tier: 1, desc: '立刻額外獲贈 2 瓶【傷藥】，並提升傷藥回復底限 +10 HP！', preview: { potionAdd: 2, potionBonus: 10 }, apply: () => { siegePotionsCount += 2; siegePotionHealBonus += 10; } },
      { id: 'revive_shard', name: '活力碎片 (Revive Shard)', icon: '💎', tier: 2, desc: '立刻獲贈 1 面電氣護盾（可完全抵擋 1 次撞擊）！', preview: { shieldAdd: 1 }, apply: () => { siegeBarrierShieldCount += 1; } },
      { id: 'leftovers', name: '吃剩的東西 (Leftovers)', icon: '🍎', tier: 2, desc: '攜帶美味樹果，每過 10 秒自動為小智回復 1 點生命值！', drawback: '⚠️ 樹果甜香吸引強敵，入侵怪獸移動速度增加 +30%！', preview: { hpRegen: 1, speedMult: 1.30 }, apply: () => { siegeHasLeftovers = true; siegeSpeedPenalty *= 1.30; } },
      { id: 'miracle_seed', name: '奇蹟之種 (Miracle Seed)', icon: '🌱', tier: 1, desc: '蘊含自然生機，小智生命上限提升 20 點並獲贈 1 瓶【傷藥】。', preview: { hpMaxAdd: 20, potionAdd: 1 }, apply: () => { siegeMaxHp += 20; siegePotionsCount += 1; } },
      { id: 'weakness_policy', name: '弱點保險 (Weakness Policy)', icon: '🛡️', tier: 2, desc: '越挫越勇！擊破怪獸積分額外加贈 +10 分！', preview: { scoreAdd: 10 }, apply: () => { siegeBonusScore += 10; } },
      { id: 'berry_juice', name: '勁爽汽水 (Berry Juice)', icon: '🥤', tier: 1, desc: '立刻回復 35 點生命值，並獲贈 1 瓶【傷藥】！', preview: { hpAdd: 35, potionAdd: 1 }, apply: () => { siegeHp = Math.min(siegeMaxHp, siegeHp + 35); siegePotionsCount += 1; } },
      { id: 'max_potion_tech', name: '全滿秘藥 (Max Potion)', icon: '💉', tier: 3, desc: '獲得高階全滿藥配方，傷藥回復額外 +40 HP，並贈 2 瓶傷藥！', preview: { potionBonus: 40, potionAdd: 2 }, apply: () => { siegePotionHealBonus += 40; siegePotionsCount += 2; } },
      { id: 'lum_berry', name: '木子果 (Lum Berry)', icon: '🍒', tier: 1, desc: '奇蹟果實除厄，立即為小智回復 20 點生命值！', preview: { hpAdd: 20 }, apply: () => { siegeHp = Math.min(siegeMaxHp, siegeHp + 20); } },
      { id: 'sacred_fire', name: '神聖之火 (Sacred Fire)', icon: '🔥', tier: 3, desc: '鳳王聖火庇護！十萬伏特大招充能速度提升 +100% (×2)！', drawback: '⚠️ 聖火烈焰刺目，怪獸逼近飛行速度增加 +20%！', preview: { chargeRateAdd: 1.0, speedMult: 1.20 }, apply: () => { siegeUltChargeRate += 1.0; siegeSpeedPenalty *= 1.20; } },
      { id: 'primal_reversion', name: '原始回歸 (Primal Power)', icon: '🌊', tier: 3, desc: '超古代神力湧動！全場所有怪獸逼近速度大幅減速 30%！', drawback: '⚠️ 原始能量過載，小智每次被怪獸撞擊額外承受 +5 點衝擊傷害！', preview: { slowMult: 0.70, extraDamage: 5 }, apply: () => { siegeSlowFactor *= 0.70; siegeImpactDamageExtra += 5; } },
      { id: 'roar_of_time', name: '時光咆哮 (Roar of Time)', icon: '⏳', tier: 3, desc: '帝牙盧卡掌控時間！全場怪獸全部擊退至地圖最外圈！', preview: { knockback: true }, apply: () => { siegeEnemies.forEach(em => { em.x *= 1.35; em.y *= 1.35; }); } },
      { id: 'spacial_rend', name: '亞空裂斬 (Spacial Rend)', icon: '🌌', tier: 3, desc: '帕路奇亞撕裂空間！比卡丘閃電連鎖擊破數永久 +2 隻！', drawback: '⚠️ 空間裂隙撕扯，怪獸移動飛行速度加快 +10%！', preview: { chainAdd: 2, speedMult: 1.10 }, apply: () => { siegeLightningChains += 2; siegeSpeedPenalty *= 1.10; } },
      { id: 'judgment', name: '創世神光 (Judgment)', icon: '🌟', tier: 3, desc: '阿爾宙斯裁決！擊破怪獸時獲取積分永久 +20 分，護盾 +1 面！', preview: { scoreAdd: 20, shieldAdd: 1 }, apply: () => { siegeBonusScore += 20; siegeBarrierShieldCount += 1; } },
      { id: 'psychic', name: '精神強念 (Psychic)', icon: '🧠', tier: 2, desc: '超夢強大超能力！全場怪獸逼近速度減緩 15%！', preview: { slowMult: 0.85 }, apply: () => { siegeSlowFactor *= 0.85; } },
      { id: 'dragon_pulse', name: '龍之波動 (Dragon Pulse)', icon: '🐉', tier: 2, desc: '烈空坐龍威激盪！擊破怪獸積分額外 +15 分！', preview: { scoreAdd: 15 }, apply: () => { siegeBonusScore += 15; } },
      { id: 'hyper_beam', name: '破壞光線 (Hyper Beam)', icon: '💥', tier: 3, desc: '狂暴光束轟擊！十萬伏特充能效率 +50%，擊破積分 +15 分！', drawback: '⚠️ 強烈能量反衝，怪獸逼近飛行速度增加 +15%！', preview: { scoreAdd: 15, chargeRateAdd: 0.5, speedMult: 1.15 }, apply: () => { siegeBonusScore += 15; siegeUltChargeRate += 0.5; siegeSpeedPenalty *= 1.15; } },
      { id: 'giga_impact', name: '終極衝擊 (Giga Impact)', icon: '☄️', tier: 3, desc: '霸道衝擊波！每次擊破怪獸雙倍積分機率提升 +40%！', drawback: '⚠️ 衝擊擾亂時空，每波同時入侵怪獸數量上限 +1 隻！', preview: { critAdd: 0.40, countAdd: 1 }, apply: () => { siegeDoubleScoreChance += 0.40; siegeExtraEnemyCount += 1; } },
      { id: 'beast_boost', name: '異獸提升 (Beast Boost)', icon: '👾', tier: 2, desc: '越戰越強！擊破怪獸基礎得分永久 +10 分！', preview: { scoreAdd: 10 }, apply: () => { siegeBonusScore += 10; } },
      { id: 'aura_break', name: '氣場破壞 (Aura Break)', icon: '🌀', tier: 2, desc: '基格爾德壓制幽靈系！怪獸飛行速度減慢 18%！', preview: { slowMult: 0.82 }, apply: () => { siegeSlowFactor *= 0.82; } },
      { id: 'magic_guard', name: '魔法防守 (Magic Guard)', icon: '🛡️', tier: 2, desc: '受神秘魔法庇護，小智生命上限提升 25 點，護盾 +1 面！', preview: { hpMaxAdd: 25, shieldAdd: 1 }, apply: () => { siegeMaxHp += 25; siegeBarrierShieldCount += 1; } },
      { id: 'mega_evolution', name: '超級進化 (Mega Evolution)', icon: '🧬', tier: 3, desc: '超級比卡丘進化！得分+15、速度減15%、護盾+1面！', preview: { scoreAdd: 15, slowMult: 0.85, shieldAdd: 1 }, apply: () => { siegeBonusScore += 15; siegeSlowFactor *= 0.85; siegeBarrierShieldCount += 1; } }
    ];

    function launchSiegeMatch() {
      if (siegeAnimId) cancelAnimationFrame(siegeAnimId);
      if (siegeTimeInterval) clearInterval(siegeTimeInterval);
      window.removeEventListener('keydown', handleSiegeKeydown, true);

      siegeActive = true;
      siegeRunning = false;
      siegeIsPaused = false;
      siegeHp = 100;
      siegeMaxHp = 100;
      siegeLevel = 1;
      siegeWave = 1;
      siegeKills = 0;
      siegeKillsInWave = 0;
      siegeWaveKillsNeeded = 2;
      siegeKillsInLevel = 0;
      siegeLevelKillsNeeded = 5; // Lv.1 升 Lv.2 需擊破 5 隻
      siegeSpeedPenalty = 1.0;
      siegeExtraEnemyCount = 0;
      siegeImpactDamageExtra = 0;
      siegeHasLeftovers = false;
      siegeLeftoversHeal = 1;
      siegeMisses = 0;
      siegeScore = 0;
      siegePotionsCount = 0;
      siegeSeconds = 0;
      siegeEnemies = [];
      siegeParticles = [];
      siegeLightnings = [];
      siegeHealParticles = [];
      siegeTargetEnemy = null;
      siegeUltCharge = 0;
      siegeBarrierHitTimer = 0;
      siegeDashOffset = 0;
      siegeIsSpawningSquad = false;
      siegeWordQueue = [];
      siegeUltToastShown = false;
      currentBoss = null;
      hideBossHUD();
      siegeCandidateEnemies = [];
      siegeEmptyFieldTimer = 0;

      // 重置疊加招式效果
      siegeLearnedMoves = [];
      siegeBonusScore = 0;
      siegeUltChargeRate = 1.0;
      siegeLightningChains = 0;
      siegeBarrierShieldCount = 0;
      siegeSlowFactor = 1.0;
      siegePotionHealBonus = 0;
      siegeKeepProgressOnMiss = false;
      siegeDoubleScoreChance = 0;

      updateSiegeHUD();

      const readyOverlay = document.getElementById('siege-ready-overlay');
      const overOverlay = document.getElementById('siege-over-overlay');
      const upgradeOverlay = document.getElementById('siege-upgrade-overlay');
      if (readyOverlay) readyOverlay.style.display = 'flex';
      if (overOverlay) overOverlay.style.display = 'none';
      if (upgradeOverlay) upgradeOverlay.style.display = 'none';

      const canvas = document.getElementById('siege-canvas');
      const wrap = document.getElementById('siege-stage-wrap');
      if (canvas && wrap) {
        canvas.width = wrap.clientWidth || 800;
        canvas.height = wrap.clientHeight || 420;
      }

      window.addEventListener('keydown', handleSiegeKeydown, true);
    }

    function siegeStartGame() {
      const readyOverlay = document.getElementById('siege-ready-overlay');
      if (readyOverlay) readyOverlay.style.display = 'none';

      siegeRunning = true;
      siegeIsPaused = false;
      siegeIsSpawningSquad = false;
      currentBoss = null;
      hideBossHUD();
      siegeCandidateEnemies = [];
      siegeEmptyFieldTimer = 0;
      spawnSiegeWave();

      if (siegeTimeInterval) clearInterval(siegeTimeInterval);
      siegeTimeInterval = setInterval(() => {
        if (!siegeIsPaused && siegeActive && siegeRunning) {
          siegeSeconds++;
          updateSiegeTimerDisplay();

          // 🍎 吃剩的東西 (Leftovers): 每 10 秒自動為小智回復 1 點生命值！
          if (siegeHasLeftovers && siegeSeconds % 10 === 0 && siegeHp < siegeMaxHp) {
            siegeHp = Math.min(siegeMaxHp, siegeHp + siegeLeftoversHeal);
            updateSiegeHUD();
            if (typeof showPassToast === 'function') {
              showPassToast('🍎【吃剩的東西】發動：小智自動回復了 +1 點生命值！');
            }
          }
        }
      }, 1000);

      const wrap = document.getElementById('siege-stage-wrap');
      if (wrap) wrap.focus();

      requestAnimationFrame(tickSiege);
    }

    function updateSiegeTimerDisplay() {
      const timerVal = document.getElementById('siege-time-val');
      if (timerVal) {
        const m = String(Math.floor(siegeSeconds / 60)).padStart(2, '0');
        const s = String(siegeSeconds % 60).padStart(2, '0');
        timerVal.textContent = `${m}:${s}`;
      }
    }

    function updateSiegeHUD() {
      const hpText = document.getElementById('siege-hp-text');
      const hpFill = document.getElementById('siege-hp-fill');
      const waveVal = document.getElementById('siege-wave-val');
      const levelVal = document.getElementById('siege-level-val');
      const expFill = document.getElementById('siege-exp-fill');
      const scoreVal = document.getElementById('siege-score-val');
      const ultCharge = document.getElementById('siege-ult-charge');
      const ultBtn = document.getElementById('siege-ult-btn');
      const potionBadge = document.getElementById('siege-potion-count');
      const killsFooter = document.getElementById('siege-kills-footer');
      const movesCount = document.getElementById('siege-moves-count');
      const potionsFooter = document.getElementById('siege-potions-footer');

      if (hpText) hpText.textContent = `${Math.max(0, siegeHp)} / ${siegeMaxHp}`;
      if (hpFill) {
        const pct = Math.max(0, Math.min(100, Math.round((siegeHp / siegeMaxHp) * 100)));
        hpFill.style.width = `${pct}%`;
        hpFill.style.background = pct > 50 
          ? 'linear-gradient(90deg, #10B981, #34D399)' 
          : (pct > 25 ? 'linear-gradient(90deg, #F59E0B, #FBBF24)' : 'linear-gradient(90deg, #EF4444, #F87171)');
      }

      if (waveVal) waveVal.textContent = `Wave ${siegeWave}`;
      if (levelVal) levelVal.textContent = `Lv.${siegeLevel}`;
      if (expFill) {
        const expPct = Math.min(100, Math.round((siegeKillsInLevel / siegeLevelKillsNeeded) * 100));
        expFill.style.width = `${expPct}%`;
      }
      if (scoreVal) scoreVal.textContent = `+${siegeScore}`;
      if (ultCharge) ultCharge.textContent = `(${siegeUltCharge}%)`;
      if (ultBtn) {
        ultBtn.disabled = (siegeUltCharge < 100);
        if (siegeUltCharge >= 100) {
          // ★ 大招充能完畢：可發動提示高亮脈衝！
          ultBtn.classList.add('ult-ready-glow');
          ultBtn.title = "⚡【十萬伏特】充能完畢！按數字鍵 2 或點擊發動！";
          if (!siegeUltToastShown) {
            siegeUltToastShown = true;
            if (typeof showPassToast === 'function') {
              showPassToast('⚡【十萬伏特】充能完畢！按數字鍵 2 或點擊按鈕發動！');
            }
          }
        } else {
          ultBtn.classList.remove('ult-ready-glow');
          ultBtn.title = "十萬伏特充能中 (快捷鍵: 數字鍵 2)";
          siegeUltToastShown = false;
        }
      }
      if (potionBadge) potionBadge.textContent = String(siegePotionsCount);
      if (killsFooter) killsFooter.textContent = String(siegeKills);
      if (movesCount) movesCount.textContent = String(siegeLearnedMoves.length);
      if (potionsFooter) potionsFooter.textContent = String(siegePotionsCount);
      updateSiegeTimerDisplay();
    }

    // 🧪 使用傷藥 (快捷鍵：數字鍵 1 或點擊按鈕)
    function useSiegePotion() {
      if (!siegeActive || !siegeRunning) return;
      if (siegePotionsCount <= 0) {
        if (typeof showPassToast === 'function') {
          showPassToast('⚠️ 目前沒有傷藥！擊破怪獸提升寶可夢等級即可獲贈【傷藥】！');
        }
        return;
      }

      siegePotionsCount--;
      const baseHeal = Math.floor(getSecureRandom() * 91) + 10; // 隨機 10 ~ 100 HP
      const totalHeal = baseHeal + siegePotionHealBonus;
      const oldHp = siegeHp;
      siegeHp = Math.min(siegeMaxHp, siegeHp + totalHeal);
      const actualHeal = siegeHp - oldHp;

      const canvas = document.getElementById('siege-canvas');
      const cx = canvas ? canvas.width / 2 : 400;
      const cy = canvas ? canvas.height / 2 : 210;
      for (let i = 0; i < 20; i++) {
        const ang = getSecureRandom() * Math.PI * 2;
        const spd = 1.5 + getSecureRandom() * 3.5;
        siegeHealParticles.push({
          x: cx,
          y: cy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.2,
          life: 25,
          maxLife: 25,
          color: ['#34D399', '#6EE7B7', '#A7F3D0', '#10B981'][Math.floor(getSecureRandom() * 4)],
          size: 3 + getSecureRandom() * 3
        });
      }

      updateSiegeHUD();
      if (typeof showPassToast === 'function') {
        showPassToast(`🧪 使用【傷藥】！小智回復了 +${actualHeal} 點生命值！（剩餘 ${siegePotionsCount} 瓶）`);
      }
    }

    // ⚡ 升級彈窗
    function triggerSiegeLevelUpModal() {
      siegeIsPaused = true;
      siegePotionsCount++;
      updateSiegeHUD();

      const modal = document.getElementById('siege-upgrade-overlay');
      const titleEl = document.getElementById('siege-upgrade-title');
      const descEl = document.getElementById('siege-upgrade-desc');
      const optionsContainer = document.getElementById('siege-upgrade-options');
      if (!modal || !optionsContainer) return;

      if (titleEl) titleEl.textContent = `⚡ 寶可夢等級晉升至 Lv.${siegeLevel}！`;
      if (descEl) descEl.innerHTML = `🎁 <strong>升級獎勵</strong>：獲得【傷藥】×1（現存 ${siegePotionsCount} 瓶，按數字鍵 1 或點擊使用）！<br>請選擇一項寶可夢招式學習（滑鼠懸浮可即時預覽戰況數據變化）：`;

      const availableMoves = SIEGE_POKEMON_MOVES.filter(m => !siegeLearnedMoves.includes(m));
      const pool = availableMoves.length >= 2 ? availableMoves : SIEGE_POKEMON_MOVES;
      const shuffled = secureFisherYatesShuffle([...pool]);
      const picked = shuffled.slice(0, 2);

      optionsContainer.innerHTML = '';
      picked.forEach(move => {
        const card = document.createElement('div');
        card.className = 'siege-upgrade-card';
        const drawbackHtml = move.drawback 
          ? `<div class="siege-upgrade-drawback">${move.drawback}</div>` 
          : `<div style="font-size: 11px; color: #10B981; font-weight: 600; margin-top: 4px;">✨ 純增益奧義（無負面副作用）</div>`;
        card.innerHTML = `
          <div class="siege-upgrade-icon">${move.icon}</div>
          <div class="siege-upgrade-info" style="flex: 1;">
            <div class="siege-upgrade-name">${move.name}</div>
            <div class="siege-upgrade-desc">${move.desc}</div>
            ${drawbackHtml}
          </div>
          <div class="siege-upgrade-tier">階級 ${move.tier}</div>
        `;
        card.onclick = () => {
          selectSiegeMove(move);
        };
        card.onmouseenter = () => {
          updateSiegeStatusDashboard(move);
        };
        card.onmouseleave = () => {
          updateSiegeStatusDashboard(null);
        };
        optionsContainer.appendChild(card);
      });

      updateSiegeStatusDashboard(null);
      modal.style.display = 'flex';
    }

    function selectSiegeMove(move) {
      move.apply();
      siegeLearnedMoves.push(move);

      const modal = document.getElementById('siege-upgrade-overlay');
      if (modal) modal.style.display = 'none';

      if (typeof triggerSkillToast === 'function') {
        triggerSkillToast(move.icon, `學會奧義【${move.name}】！${move.desc}`);
      }

      updateSiegeHUD();
      siegeIsPaused = false;
      // 🎵 確保等級晉升選擇招式後，背景音樂無縫持續播放，絕不中斷
      try {
        if (typeof BgmManager !== 'undefined' && !BgmManager.isMuted()) {
          BgmManager.resumeCurrentTrack();
        }
      } catch(bgmErr) {}
      // ★ 關鍵修復：升級選擇招式後，無縫恢復當前戰場，保留場上既有怪獸與 Boss，切勿清空重刷！
      resumeSiegeLoop();
    }


    // ★ 難度階梯 1：同時出現入侵怪獸數量隨機範圍 (波次數值驅動)
    
    
    // 👑 Boss HUD 顯示與更新
    
    // ★ 耿鬼大型 Boss 畫布邊界內外圍安全漂浮座標計算器 (保證 100% 在遊戲畫面邊界內)
    function getInBoundsBossHoverPos(cw, ch, radius) {
      const r = radius || 58;
      const marginX = r + 20;
      const marginY = r + 20;
      const cx = cw / 2;
      const cy = ch / 2;
      // ★ 依使用者要求：大型 Boss Phase 2 與小智距離再遠一點 (保持外圍遠距待機，至少距離中心 190px 以上)
      const isLeft = getSecureRandom() < 0.5;
      const minX = isLeft ? marginX : Math.min(cx + 190, cw - marginX - 60);
      const maxX = isLeft ? Math.max(minX + 20, cx - 190) : (cw - marginX);
      const x = minX + getSecureRandom() * Math.max(10, maxX - minX);
      const minY = marginY;
      const maxY = ch - marginY;
      const y = minY + getSecureRandom() * Math.max(10, maxY - minY);
      return { x, y, anchorX: x, anchorY: y, ang: 0, rx: 0, ry: 0 };
    }

    let bossHudTimer = null;

    function showBossHUD(boss) {
      const bar = document.getElementById('siege-boss-hud-bar');
      if (!bar || !boss) return;
      bar.classList.add('show-boss-bar');
      updateBossHUD();

      // ★ 依使用者指示：Boss 出現時才顯示資訊欄，顯示 5 秒後自動淡出隱藏，絕不遮擋上方怪獸！
      if (bossHudTimer) clearTimeout(bossHudTimer);
      bossHudTimer = setTimeout(() => {
        hideBossHUD();
      }, 5000);
    }

    function hideBossHUD() {
      const bar = document.getElementById('siege-boss-hud-bar');
      if (bar) {
        bar.classList.remove('show-boss-bar');
      }
      if (bossHudTimer) {
        clearTimeout(bossHudTimer);
        bossHudTimer = null;
      }
    }

    function updateBossHUD() {
      if (!currentBoss) {
        hideBossHUD();
        return;
      }
      const nameEl = document.getElementById('siege-boss-name');
      const subEl = document.getElementById('siege-boss-sub');
      const fillEl = document.getElementById('siege-boss-hp-fill');
      const textEl = document.getElementById('siege-boss-hp-text');
      const badgeEl = document.getElementById('siege-boss-badge');
      const avatarBox = document.getElementById('siege-boss-avatar-box');

      if (avatarBox) {
        const mImg = siegeMonsterImgs[currentBoss.monsterType];
        if (mImg && mImg.src) {
          avatarBox.innerHTML = `<img src="${mImg.src}" alt="Boss">`;
        } else {
          avatarBox.textContent = '👑';
        }
      }

      if (currentBoss.bossType === 'mini') {
        if (nameEl) nameEl.textContent = `👑 小型月Boss · ${currentBoss.name}`;
        if (subEl) {
          subEl.textContent = currentBoss.miniFormType === 'speedy' 
            ? '型態 1：疾風突刺 · 移動與衝擊傷害 1.5 倍！' 
            : `型態 2：雙字護盾 · 剩餘 ${currentBoss.wordsQueue.length} 個字`;
        }
        if (fillEl) {
          const pct = Math.max(0, Math.min(100, Math.round((currentBoss.hp / currentBoss.maxHp) * 100)));
          fillEl.style.width = `${pct}%`;
          fillEl.style.background = 'linear-gradient(90deg, #F59E0B, #EF4444)';
        }
        if (textEl) textEl.textContent = `${Math.max(0, currentBoss.hp)} / ${currentBoss.maxHp} HP`;
        if (badgeEl) badgeEl.textContent = '⭐ 擊破獲得 3 倍巨額積分';
      } else if (currentBoss.bossType === 'major') {
        if (nameEl) nameEl.textContent = '👑 大型Boss · 耿鬼 Gengar';
        if (subEl) {
          subEl.textContent = currentBoss.form === 1 
            ? `第 1 型態：十字輪轉迫近 · 剩餘 ${currentBoss.wordsQueue.length} 個字未破！`
            : `第 2 型態：暗黑幻影閃現 · 清除怪獸扣減 Boss 血量！`;
        }
        if (fillEl) {
          const pct = Math.max(0, Math.min(100, Math.round((currentBoss.hp / currentBoss.maxHp) * 100)));
          fillEl.style.width = `${pct}%`;
          fillEl.style.background = currentBoss.form === 1
            ? 'linear-gradient(90deg, #A855F7, #EC4899)'
            : 'linear-gradient(90deg, #DC2626, #F59E0B)';
        }
        if (textEl) textEl.textContent = `${Math.max(0, currentBoss.hp)} / ${currentBoss.maxHp} HP`;
        if (badgeEl) {
          if (currentBoss.form === 1) {
            badgeEl.textContent = `⏳ 換字倒計: ${Math.max(0, Math.ceil(currentBoss.wordTimer))}s`;
          } else {
            const ok = currentBoss.minionsKilledBeforeRush >= 3;
            badgeEl.textContent = ok ? '🛡️ 閃避資格: 已達成 (≥3隻) ✅' : `🛡️ 閃避資格: ${currentBoss.minionsKilledBeforeRush} / 3 隻 ⚠️`;
            badgeEl.style.borderColor = ok ? '#10B981' : '#F59E0B';
            badgeEl.style.color = ok ? '#34D399' : '#FBBF24';
          }
        }
      }
    }

    // ⚡ 閃避 QTE 視窗邏輯
    function triggerSiegeDodgeModal() {
      if (siegeDodgeActive) return;
      siegeDodgeActive = true;
      siegeIsPaused = true;
      if (siegeAnimId) {
        cancelAnimationFrame(siegeAnimId);
        siegeAnimId = null;
      }

      const overlay = document.getElementById('siege-dodge-overlay');
      const charEl = document.getElementById('siege-dodge-char');
      const timerFill = document.getElementById('siege-dodge-timer-fill');
      const timerText = document.getElementById('siege-dodge-timer-text');
      const pipsBox = document.getElementById('siege-dodge-pips');
      if (!overlay) return;

      // ★ 牌堆真隨機抽取 1 個閃避漢字
      siegeDodgeWord = drawUniqueSiegeWord();
      siegeDodgeTypedIdx = 0;
      const majorTier = Math.max(0, Math.floor((siegeWave - 10) / 10));
      siegeDodgeMaxTimer = Math.max(3.2, (4.0 + getSecureRandom() * 4.0) - majorTier * 0.4); // 隨波次縮短QTE視窗
      siegeDodgeTimer = siegeDodgeMaxTimer;

      if (charEl) charEl.textContent = siegeDodgeWord.char;
      updateDodgePips();

      if (timerFill) timerFill.style.width = '100%';
      if (timerText) timerText.textContent = `${siegeDodgeTimer.toFixed(1)}s`;

      overlay.style.display = 'flex';

      if (siegeDodgeInterval) clearInterval(siegeDodgeInterval);
      siegeDodgeInterval = setInterval(() => {
        siegeDodgeTimer -= 0.1;
        if (timerFill) {
          const pct = Math.max(0, Math.min(100, (siegeDodgeTimer / siegeDodgeMaxTimer) * 100));
          timerFill.style.width = `${pct}%`;
        }
        if (timerText) timerText.textContent = `${Math.max(0, siegeDodgeTimer).toFixed(1)}s`;

        if (siegeDodgeTimer <= 0) {
          clearInterval(siegeDodgeInterval);
          resolveSiegeDodge(false); // 超時閃避失敗
        }
      }, 100);
    }

    function updateDodgePips() {
      const pipsBox = document.getElementById('siege-dodge-pips');
      if (!pipsBox || !siegeDodgeWord || !siegeDodgeWord.keys) return;
      pipsBox.innerHTML = '';
      siegeDodgeWord.keys.forEach((k, idx) => {
        const dot = document.createElement('div');
        dot.style.cssText = `width: 14px; height: 14px; transform: rotate(45deg); border: 1.5px solid #38BDF8; background: ${idx < siegeDodgeTypedIdx ? '#38BDF8' : 'transparent'}; box-shadow: ${idx < siegeDodgeTypedIdx ? '0 0 8px #00F0FF' : 'none'}; transition: all 0.2s;`;
        pipsBox.appendChild(dot);
      });
    }

    function resolveSiegeDodge(success) {
      if (!siegeDodgeActive) return;
      siegeDodgeActive = false;
      if (siegeDodgeInterval) clearInterval(siegeDodgeInterval);

      const overlay = document.getElementById('siege-dodge-overlay');
      if (overlay) overlay.style.display = 'none';

      siegeIsPaused = false;

      // 大型 Boss 每次突襲發動完成，不論成功與否均自損 10 HP
      if (currentBoss) {
        currentBoss.hp -= 10;
        currentBoss.isRushing = false;
        currentBoss.minionsKilledBeforeRush = 0;
        currentBoss.attackTimer = 5 + getSecureRandom() * 5; // 重置 5-10 秒突襲倒數
        currentBoss.blinkTimer = 1 + getSecureRandom() * 2;
        // 退回隨機外圍位置
        const canvas = document.getElementById('siege-canvas');
        const cw = canvas ? canvas.width : 800;
        const ch = canvas ? canvas.height : 420;
        const cx = cw / 2;
        const cy = ch / 2;
        const rPos = getInBoundsBossHoverPos(cw, ch, currentBoss.radius);
        currentBoss.x = rPos.x;
        currentBoss.y = rPos.y;
        currentBoss.anchorX = rPos.x;
        currentBoss.anchorY = rPos.y;
        currentBoss.phase = getSecureRandom() * Math.PI * 2;
        updateBossHUD();
      }

      const majorTier = Math.max(0, Math.floor((siegeWave - 10) / 10));
      const majorDmg = 30 + Math.min(20, majorTier * 5);

      if (success) {
        if (typeof showPassToast === 'function') {
          showPassToast('✨ 閃避成功！比卡丘施展電光一閃完美避開耿鬼衝撞！耿鬼自損 10 HP！');
        }
        triggerPikachuLightning(currentBoss);
      } else {
        // 閃避失敗
        if (siegeBarrierShieldCount > 0) {
          siegeBarrierShieldCount--;
          const actualDmg = Math.round(majorDmg / 2);
          siegeHp = Math.max(0, siegeHp - actualDmg);
          if (typeof showPassToast === 'function') {
            showPassToast(`🛡️ 護盾抵擋部分衝擊！小智受到 ${actualDmg} 點傷害！耿鬼自損 10 HP！`);
          }
        } else {
          siegeHp = Math.max(0, siegeHp - majorDmg);
          if (typeof showPassToast === 'function') {
            showPassToast(`💥 閃避失敗！耿鬼猛烈撞擊！小智受到 ${majorDmg} 點傷害！耿鬼自損 10 HP！`);
          }
        }
        siegeBarrierHitTimer = 12;
        updateSiegeHUD();
        if (siegeHp <= 0) {
          onSiegeGameOver();
          return;
        }
      }

      // ★ 若耿鬼血量降為 0，徹底擊潰大型 Boss！
      if (currentBoss && currentBoss.hp <= 0) {
        defeatMajorBoss();
        resumeSiegeLoop();
        return;
      }

      // ★ 強制喚醒動畫主迴圈，確保耿鬼退回外圍並持續運轉
      resumeSiegeLoop();
    }

    function defeatMajorBoss() {
      if (!currentBoss) return;
      const boss = currentBoss;
      currentBoss = null;
      hideBossHUD();

      // 淨化全場雜怪
      siegeEnemies = [];
      siegeCandidateEnemies = [];
      siegeTargetEnemy = null;

      // 巨額得分與獎勵
      const bossBonus = (Math.round(15 * 1.2) + siegeBonusScore) * 10 + Math.floor(siegeWave * 15);
      siegeScore += bossBonus;
      siegePotionsCount += 2; // 額外贈送 2 瓶傷藥
      updateSiegeHUD();

      if (typeof burstConfetti === 'function') burstConfetti();
      if (typeof showPassToast === 'function') {
        showPassToast('🎉 成功擊潰大型霸主【耿鬼】！全場淨化！波次推進！');
      }

      // ★ 推進波次並生成新怪 (杜絕停留在空場卡頓)
      advanceToNextSiegeWave();
      // ★ 喚醒動畫主迴圈，確保下一波流暢運轉
      resumeSiegeLoop();
    }

    // ★ 矩形畫面邊緣貼合生成演算法 (敵人緊貼四邊外緣 20px 生成，進場即刻可見)
    function getRectBoundarySpawnPoint(cw, ch, index, total) {
      const margin = 20; // 僅距畫面可視邊緣 20 像素，避免離界太遠
      const w = cw + margin * 2;
      const h = ch + margin * 2;
      const perimeter = 2 * (w + h);

      // 周長均勻分佈 + 微幅隨機擾動
      const segment = perimeter / Math.max(1, total);
      let pos = (index * segment + (getSecureRandom() - 0.5) * (segment * 0.45) + perimeter) % perimeter;

      let x, y;
      if (pos < w) {
        // 頂部邊界 (Top edge)
        x = pos - margin;
        y = -margin;
      } else if (pos < w + h) {
        // 右側邊界 (Right edge)
        x = cw + margin;
        y = (pos - w) - margin;
      } else if (pos < 2 * w + h) {
        // 底部邊界 (Bottom edge)
        x = cw - (pos - (w + h)) + margin;
        y = ch + margin;
      } else {
        // 左側邊界 (Left edge)
        x = -margin;
        y = ch - (pos - (2 * w + h)) + margin;
      }

      x = Math.max(-margin, Math.min(cw + margin, x));
      y = Math.max(-margin, Math.min(ch + margin, y));
      return { x, y };
    }

    function getSiegeEnemyCountRange(wave) {
      let minCount, maxCount;
      if (wave <= 1) {
        minCount = 2; maxCount = 3; // Wave 1: 保證至少生成 2-3 隻，杜絕只出 1 隻怪獸
      } else if (wave <= 2) {
        minCount = 2; maxCount = 3; // Wave 2: 穩定生成 2-3 隻
      } else if (wave <= 4) {
        minCount = 2; maxCount = 3;
      } else if (wave <= 6) {
        minCount = 2; maxCount = 4; // Wave 5-6: 隨機 2-4 隻
      } else if (wave <= 8) {
        minCount = 3; maxCount = 4;
      } else if (wave <= 11) {
        minCount = 3; maxCount = 5;
      } else if (wave <= 15) {
        minCount = 4; maxCount = 5;
      } else {
        minCount = Math.min(6, 4 + Math.floor((wave - 15) * 0.15));
        maxCount = Math.min(7, 6 + Math.floor((wave - 15) * 0.15));
      }
      if (typeof siegeExtraEnemyCount !== 'undefined') {
        minCount += siegeExtraEnemyCount;
        maxCount += siegeExtraEnemyCount;
      }
      return { min: Math.max(1, minCount), max: Math.max(minCount, maxCount) };
    }

    // ★ 難度階梯 2：入侵怪獸移動速度隨機範圍 (波次數值驅動 + 招式調製)
    function getSiegeSpeedRange(wave) {
      let baseMin, baseMax;
      if (wave <= 1) {
        baseMin = 0.22; baseMax = 0.30;
      } else if (wave <= 2) {
        baseMin = 0.25; baseMax = 0.33;
      } else if (wave <= 4) {
        baseMin = 0.27; baseMax = 0.36;
      } else if (wave <= 6) {
        baseMin = 0.29; baseMax = 0.39;
      } else if (wave <= 8) {
        baseMin = 0.31; baseMax = 0.42;
      } else if (wave <= 11) {
        baseMin = 0.33; baseMax = 0.45;
      } else if (wave <= 15) {
        baseMin = 0.35; baseMax = 0.48;
      } else {
        baseMin = 0.35 + (wave - 15) * 0.01;
        baseMax = 0.48 + (wave - 15) * 0.012;
      }
      const effectiveFactor = (typeof siegeSlowFactor !== 'undefined' ? siegeSlowFactor : 1.0) * 
                              (typeof siegeSpeedPenalty !== 'undefined' ? siegeSpeedPenalty : 1.0);
      return {
        min: parseFloat((baseMin * effectiveFactor).toFixed(3)),
        max: parseFloat((baseMax * effectiveFactor).toFixed(3))
      };
    }

    // ★ 戰況即時狀態儀表板更新與 Hover 招式動態預覽
    function updateSiegeStatusDashboard(previewMove = null) {
      const dashboard = document.getElementById('siege-status-dashboard');
      if (!dashboard) return;

      const badge = document.getElementById('ssd-preview-badge');
      const stageInfo = document.getElementById('ssd-stage-info');
      const valEnemies = document.getElementById('ssd-val-enemies');
      const diffEnemies = document.getElementById('ssd-diff-enemies');
      const valSpeed = document.getElementById('ssd-val-speed');
      const diffSpeed = document.getElementById('ssd-diff-speed');
      const valHp = document.getElementById('ssd-val-hp');
      const diffHp = document.getElementById('ssd-diff-hp');
      const valCharge = document.getElementById('ssd-val-charge');
      const diffCharge = document.getElementById('ssd-diff-charge');
      const warningStrip = document.getElementById('ssd-warning-strip');
      const warningText = document.getElementById('ssd-warning-text');

      const cardEnemies = document.getElementById('ssd-metric-enemies');
      const cardSpeed = document.getElementById('ssd-metric-speed');
      const cardHp = document.getElementById('ssd-metric-hp');
      const cardCharge = document.getElementById('ssd-metric-charge');

      const curCount = getSiegeEnemyCountRange(siegeWave);
      const curSpeed = getSiegeSpeedRange(siegeWave);

      if (stageInfo) {
        stageInfo.textContent = `波次 Wave ${siegeWave} · 寶可夢等級 Lv.${siegeLevel}`;
      }

      if (!previewMove) {
        dashboard.classList.remove('ssd-preview-active');
        if (badge) badge.style.display = 'none';
        if (warningStrip) warningStrip.style.display = 'none';

        [cardEnemies, cardSpeed, cardHp, cardCharge].forEach(c => c && c.classList.remove('ssd-metric-highlight'));

        if (valEnemies) valEnemies.textContent = `${curCount.min} ~ ${curCount.max} 隻`;
        if (diffEnemies) diffEnemies.textContent = '';

        if (valSpeed) valSpeed.textContent = `${curSpeed.min.toFixed(2)} ~ ${curSpeed.max.toFixed(2)} px/f`;
        if (diffSpeed) diffSpeed.textContent = '';

        if (valHp) valHp.textContent = `${Math.max(0, siegeHp)} / ${siegeMaxHp}`;
        if (diffHp) diffHp.textContent = `護盾: ${siegeBarrierShieldCount} 面`;

        if (valCharge) valCharge.textContent = `×${siegeUltChargeRate.toFixed(2)} 倍率`;
        if (diffCharge) diffCharge.textContent = `擊破 +${15 + siegeBonusScore}分`;
      } else {
        dashboard.classList.add('ssd-preview-active');
        if (badge) badge.style.display = 'inline';

        const prev = previewMove.preview || {};

        // 1. 怪獸數量預覽
        const nextMinCount = curCount.min + (prev.countAdd || 0);
        const nextMaxCount = curCount.max + (prev.countAdd || 0);
        if (valEnemies) valEnemies.textContent = `${nextMinCount} ~ ${nextMaxCount} 隻`;
        if (diffEnemies) {
          if (prev.countAdd) {
            diffEnemies.innerHTML = `<span class="ssd-diff-nerf">⚠️ +${prev.countAdd} 隻狂潮</span>`;
            if (cardEnemies) cardEnemies.classList.add('ssd-metric-highlight');
          } else {
            diffEnemies.textContent = '數量持平';
            if (cardEnemies) cardEnemies.classList.remove('ssd-metric-highlight');
          }
        }

        // 2. 移動速度預覽
        let simSpeedMult = (prev.speedMult || 1.0) * (prev.slowMult || 1.0);
        const nextMinSpeed = parseFloat((curSpeed.min * simSpeedMult).toFixed(2));
        const nextMaxSpeed = parseFloat((curSpeed.max * simSpeedMult).toFixed(2));
        if (valSpeed) valSpeed.textContent = `${nextMinSpeed.toFixed(2)} ~ ${nextMaxSpeed.toFixed(2)} px/f`;
        if (diffSpeed) {
          if (simSpeedMult > 1.0) {
            const pct = Math.round((simSpeedMult - 1) * 100);
            diffSpeed.innerHTML = `<span class="ssd-diff-nerf">⚠️ 加速 +${pct}%</span>`;
            if (cardSpeed) cardSpeed.classList.add('ssd-metric-highlight');
          } else if (simSpeedMult < 1.0) {
            const pct = Math.round((1 - simSpeedMult) * 100);
            diffSpeed.innerHTML = `<span class="ssd-diff-buff">🛡️ 減緩 ${pct}%</span>`;
            if (cardSpeed) cardSpeed.classList.add('ssd-metric-highlight');
          } else {
            diffSpeed.textContent = '速度不變';
            if (cardSpeed) cardSpeed.classList.remove('ssd-metric-highlight');
          }
        }

        // 3. 生命值預覽
        const nextMaxHp = siegeMaxHp + (prev.hpMaxAdd || 0);
        const nextHp = Math.min(nextMaxHp, siegeHp + (prev.hpAdd || 0) + (prev.hpMaxAdd || 0));
        if (valHp) valHp.textContent = `${nextHp} / ${nextMaxHp}`;
        if (diffHp) {
          if (prev.hpMaxAdd || prev.hpAdd || prev.hpRegen) {
            const regenText = prev.hpRegen ? ` (每10秒+${prev.hpRegen})` : '';
            diffHp.innerHTML = `<span class="ssd-diff-buff">💚 HP提升${regenText}</span>`;
            if (cardHp) cardHp.classList.add('ssd-metric-highlight');
          } else if (prev.extraDamage) {
            diffHp.innerHTML = `<span class="ssd-diff-nerf">⚠️ 撞擊傷+${prev.extraDamage}</span>`;
            if (cardHp) cardHp.classList.add('ssd-metric-highlight');
          } else {
            diffHp.textContent = `護盾: ${siegeBarrierShieldCount} 面`;
            if (cardHp) cardHp.classList.remove('ssd-metric-highlight');
          }
        }

        // 4. 充能與攻擊預覽
        const nextChargeRate = siegeUltChargeRate + (prev.chargeRateAdd || 0);
        if (valCharge) valCharge.textContent = `×${nextChargeRate.toFixed(2)} 倍率`;
        if (diffCharge) {
          if (prev.chargeRateAdd) {
            diffCharge.innerHTML = `<span class="ssd-diff-buff">⚡ 充能加速</span>`;
            if (cardCharge) cardCharge.classList.add('ssd-metric-highlight');
          } else if (prev.scoreAdd) {
            diffCharge.innerHTML = `<span class="ssd-diff-buff">🎯 得分+${prev.scoreAdd}</span>`;
            if (cardCharge) cardCharge.classList.add('ssd-metric-highlight');
          } else {
            diffCharge.textContent = `擊破 +${15 + siegeBonusScore}分`;
            if (cardCharge) cardCharge.classList.remove('ssd-metric-highlight');
          }
        }

        // 5. 負面代價警示條
        if (previewMove.drawback && warningStrip && warningText) {
          warningText.textContent = previewMove.drawback;
          warningStrip.style.display = 'flex';
        } else if (warningStrip) {
          warningStrip.style.display = 'none';
        }
      }
    }

    // ★ 問題 1 核心升級：無上限階梯配置 + 1-10級當周字庫 / 11級後全字庫真隨機 + 零空白等待
    function spawnSiegeWave() {
      if (!siegeActive || !siegeRunning) return;

      if (!siegeWordQueue || siegeWordQueue.length === 0) {
        const fullPool = getSiegeWordPool(siegeWave, siegeLevel);
        siegeWordQueue = secureFisherYatesShuffle(fullPool);
      }
      if (!siegeWordQueue || siegeWordQueue.length === 0) return;

      const canvas = document.getElementById('siege-canvas');
      const cw = canvas ? canvas.width : 800;
      const ch = canvas ? canvas.height : 420;
      const cx = cw / 2;
      const cy = ch / 2;

      // 清理前波殘留 Boss 指標
      if (currentBoss && currentBoss.hp <= 0) {
        currentBoss = null;
        hideBossHUD();
      }

      const flightTypes = ['straight', 'sine_wobble', 'spiral', 'zigzag', 's_curve'];
      const speedRange = getSiegeSpeedRange(siegeWave);

      // =========================================================================
      // 👑 情況 1：每 10 波出現【大型Boss · 耿鬼 Gengar】(Wave 10, 20, 30...)
      // =========================================================================
      if (siegeWave % 10 === 0 && (!currentBoss || currentBoss.bossType !== 'major')) {
        const majorTier = Math.max(0, Math.floor((siegeWave - 10) / 10));
        const numBossWords = 10 + majorTier * 2; // Wave 10: 10字; Wave 20: 12字; Wave 30: 14字
        const totalMajorHp = 200 + majorTier * 40; // Wave 10: 200; Wave 20: 240; Wave 30: 280
        const bossWords = [];
        for (let w = 0; w < numBossWords; w++) {
          bossWords.push(drawUniqueSiegeWord());
        }

        const spawnPt = getRectBoundarySpawnPoint(cw, ch, 0, 4);
        currentBoss = {
          isBoss: true,
          bossType: 'major',
          name: '耿鬼 Gengar',
          monsterType: 'gengar',
          form: 1, // 第 1 型態：十字輪轉
          hp: totalMajorHp,
          maxHp: totalMajorHp,
          phase2BaseHp: totalMajorHp / 2, // 第 2 型態起點血量 (100, 120, 140...)
          wordsQueue: bossWords,
          word: bossWords[0],
          wordTimer: 4 + getSecureRandom() * 4, // 4-8 秒換字
          wordMaxTimer: 6,
          blinkTimer: 1 + getSecureRandom() * 2, // 1-3 秒閃現
          attackTimer: 6 + getSecureRandom() * 4, // 5-10 秒突襲
          isRushing: false,
          minionsKilledBeforeRush: 0,
          x: spawnPt.x,
          y: spawnPt.y,
          speed: speedRange.min * (0.85 + Math.min(0.3, majorTier * 0.1)),
          rushSpeed: 2.4 + Math.min(0.8, majorTier * 0.25),
          radius: 58, // 大尺寸
          typedIdx: 0,
          shake: 0,
          flightType: 'straight',
          phase: 0,
          timer: 0,
          dir: 1
        };

        siegeEnemies.push(currentBoss);
        showBossHUD(currentBoss);

        if (typeof showPassToast === 'function') {
          showPassToast(`👑 警報！第 Wave ${siegeWave} 波大型Boss【耿鬼 Gengar】降臨！總血量 ${totalMajorHp}！`);
        }

        // 同時召喚普通怪獸（隨波次增長：Wave 10 為 3~5 隻，Wave 20 為 5~8 隻，Wave 30 為 7~11 隻...）
        const minionMin = 3 + majorTier * 2;
        const minionMax = 5 + majorTier * 3;
        const minionCount = Math.floor(minionMin + getSecureRandom() * (minionMax - minionMin + 1));
        const monsterTypes = ['gastly', 'haunter', 'gourgeist'];
        for (let i = 0; i < minionCount; i++) {
          const randWord = drawUniqueSiegeWord();
          const pt = getRectBoundarySpawnPoint(cw, ch, i + 1, minionCount + 1);
          siegeEnemies.push({
            isBoss: false,
            word: randWord,
            x: pt.x,
            y: pt.y,
            speed: speedRange.min + getSecureRandom() * (speedRange.max - speedRange.min),
            typedIdx: 0,
            radius: 30,
            shake: 0,
            monsterType: monsterTypes[i % monsterTypes.length],
            flightType: flightTypes[Math.floor(getSecureRandom() * flightTypes.length)],
            phase: getSecureRandom() * Math.PI * 2,
            timer: 0,
            dir: getSecureRandom() < 0.5 ? 1 : -1
          });
        }
        return;
      }

      // =========================================================================
      // 🚨 情況 1.5：每隔波次 13 出現【恐怖獸潮 HORROR SWARM】(Wave 13, 26, 39, 52...)
      // =========================================================================
      if (siegeWave % 13 === 0) {
        hideBossHUD();
        const swarmTier = Math.floor(siegeWave / 13);
        const normalCountRange = getSiegeEnemyCountRange(siegeWave);
        const baseCount = Math.floor(normalCountRange.min + getSecureRandom() * (normalCountRange.max - normalCountRange.min + 1));

        // 寶可夢數目增加隨機 8-15 隻（隨波次階梯遞增：Wave 13 為 8~15 隻，後續階梯累增）
        const extraMin = 8 + (swarmTier - 1) * 3;
        const extraMax = 15 + (swarmTier - 1) * 5;
        const extraCount = Math.floor(extraMin + getSecureRandom() * (extraMax - extraMin + 1));
        const totalMinions = baseCount + extraCount;

        // 一定機率 (85%) 出現 3-5 隻小型 Boss（隨波次階梯遞增：Wave 13 為 3~5 隻）
        const spawnMiniBosses = getSecureRandom() < 0.85;
        const miniMin = 3 + (swarmTier - 1);
        const miniMax = 5 + (swarmTier - 1) * 2;
        const miniCount = spawnMiniBosses ? Math.floor(miniMin + getSecureRandom() * (miniMax - miniMin + 1)) : 0;

        const totalEntities = totalMinions + miniCount;
        const baseNormalSpeed = speedRange.min + getSecureRandom() * (speedRange.max - speedRange.min);
        // ★ 小型 Boss 迫近速度嚴格設定為：該波次普通寶可夢速度的 0.8 倍！
        const miniBossSpeed = baseNormalSpeed * 0.8;

        const monsterTypes = ['gastly', 'haunter', 'gourgeist'];

        // 1. 生成小型 Boss（附帶 3-5 隻小型 Boss，從四方八面隨機方向進場）
        for (let b = 0; b < miniCount; b++) {
          const miniWords = [drawUniqueSiegeWord()];
          if (swarmTier >= 2 && getSecureRandom() < 0.5) {
            miniWords.push(drawUniqueSiegeWord());
          }
          const spawnPt = getRectBoundarySpawnPoint(cw, ch, b, totalEntities);
          const miniBossObj = {
            isBoss: true,
            bossType: 'mini',
            isSwarmBoss: true,
            name: b % 2 === 0 ? '鬼斯通 Haunter' : '鬼斯 Gastly',
            monsterType: b % 2 === 0 ? 'haunter' : 'gastly',
            miniFormType: 'swarm_mini',
            hp: miniWords.length,
            maxHp: miniWords.length,
            wordsQueue: miniWords,
            word: miniWords[0],
            x: spawnPt.x,
            y: spawnPt.y,
            speed: miniBossSpeed, // 0.8倍普通寶可夢速度
            radius: 40,
            typedIdx: 0,
            shake: 0,
            flightType: flightTypes[Math.floor(getSecureRandom() * flightTypes.length)],
            phase: getSecureRandom() * Math.PI * 2,
            timer: 0,
            dir: getSecureRandom() < 0.5 ? 1 : -1
          };
          siegeEnemies.push(miniBossObj);
        }

        // 2. 生成常態大群入侵寶可夢（從四方八面隨機方向進場）
        for (let m = 0; m < totalMinions; m++) {
          const randWord = drawUniqueSiegeWord();
          const spawnPt = getRectBoundarySpawnPoint(cw, ch, miniCount + m, totalEntities);
          const mSpeed = speedRange.min + getSecureRandom() * (speedRange.max - speedRange.min);
          siegeEnemies.push({
            isBoss: false,
            word: randWord,
            x: spawnPt.x,
            y: spawnPt.y,
            speed: mSpeed,
            typedIdx: 0,
            radius: 30,
            shake: 0,
            monsterType: monsterTypes[m % monsterTypes.length],
            flightType: flightTypes[Math.floor(getSecureRandom() * flightTypes.length)],
            phase: getSecureRandom() * Math.PI * 2,
            timer: 0,
            dir: getSecureRandom() < 0.5 ? 1 : -1
          });
        }

        if (miniCount > 0) {
          currentBoss = siegeEnemies.find(e => e.isBoss);
          showBossHUD(currentBoss);
        }

        if (typeof showPassToast === 'function') {
          showPassToast(`🚨 警報！第 Wave ${siegeWave} 波【恐怖獸潮 HORROR SWARM】爆發！共 ${totalMinions} 隻怪獸湧入${miniCount > 0 ? `，伴隨 ${miniCount} 隻小型Boss（0.8倍速）！` : '！'}`);
        }
        return;
      }

      // =========================================================================
      // 👑 情況 2：每 5 波出現【小型月Boss】(Wave 5, 15, 25, 35...)
      // =========================================================================
      if (siegeWave % 5 === 0 && siegeWave % 10 !== 0 && (!currentBoss || currentBoss.bossType !== 'mini')) {
        const miniTier = Math.max(0, Math.floor((siegeWave - 5) / 10));
        const miniTypes = ['gastly', 'haunter'];
        const chosenMonster = miniTypes[Math.floor(getSecureRandom() * miniTypes.length)];
        const miniName = chosenMonster === 'gastly' ? '鬼斯 Gastly' : '鬼斯通 Haunter';
        const isSpeedy = getSecureRandom() < 0.5; // 隨機型態 1 (迅捷) 或 型態 2 (多字盾)

        // 隨波次增長小型 Boss 帶字數：迅捷型 1~2 字，盾型 2~4 字
        const numWords = isSpeedy ? (1 + Math.min(1, miniTier)) : (2 + Math.min(2, miniTier));
        const miniWords = [];
        for (let w = 0; w < numWords; w++) {
          miniWords.push(drawUniqueSiegeWord());
        }

        const baseNormalSpeed = speedRange.min + getSecureRandom() * (speedRange.max - speedRange.min);
        // 迫近速度隨波次適度增加
        const speedScale = 1.0 + Math.min(0.4, (siegeWave - 5) * 0.015);
        const spawnPt = getRectBoundarySpawnPoint(cw, ch, 0, 5);

        currentBoss = {
          isBoss: true,
          bossType: 'mini',
          name: miniName,
          monsterType: chosenMonster,
          miniFormType: isSpeedy ? 'speedy' : 'dual_word',
          hp: numWords,
          maxHp: numWords,
          wordsQueue: miniWords,
          word: miniWords[0],
          x: spawnPt.x,
          y: spawnPt.y,
          speed: (isSpeedy ? baseNormalSpeed * 1.5 : baseNormalSpeed * 0.7) * speedScale,
          radius: 42, // 比普通寶可夢大
          typedIdx: 0,
          shake: 0,
          flightType: isSpeedy ? 'straight' : 'sine_wobble',
          phase: 0,
          timer: 0,
          dir: 1
        };

        siegeEnemies.push(currentBoss);
        showBossHUD(currentBoss);

        if (typeof showPassToast === 'function') {
          showPassToast(`👑 警報！第 Wave ${siegeWave} 波【小型月Boss · ${miniName}】突襲進犯！（血量/帶字數: ${numWords}）`);
        }

        // 同時生成當前波次常態怪獸
        const countRange = getSiegeEnemyCountRange(siegeWave);
        const count = Math.floor(countRange.min + getSecureRandom() * (countRange.max - countRange.min + 1));
        const monsterTypes = ['gastly', 'haunter', 'gourgeist'];
        for (let i = 0; i < count; i++) {
          const randWord = drawUniqueSiegeWord();
          const pt = getRectBoundarySpawnPoint(cw, ch, i + 1, count + 1);
          siegeEnemies.push({
            isBoss: false,
            word: randWord,
            x: pt.x,
            y: pt.y,
            speed: speedRange.min + getSecureRandom() * (speedRange.max - speedRange.min),
            typedIdx: 0,
            radius: 30,
            shake: 0,
            monsterType: monsterTypes[i % monsterTypes.length],
            flightType: flightTypes[Math.floor(getSecureRandom() * flightTypes.length)],
            phase: getSecureRandom() * Math.PI * 2,
            timer: 0,
            dir: getSecureRandom() < 0.5 ? 1 : -1
          });
        }
        return;
      }

      // =========================================================================
      // 👾 情況 3：常態波次生成 (貼合四邊邊緣生成)
      // =========================================================================
      hideBossHUD();
      const countRange = getSiegeEnemyCountRange(siegeWave);
      const count = Math.floor(countRange.min + getSecureRandom() * (countRange.max - countRange.min + 1));
      const monsterTypes = ['gastly', 'haunter', 'gourgeist'];

      for (let i = 0; i < count; i++) {
        const randWord = drawUniqueSiegeWord();
        const spawnPt = getRectBoundarySpawnPoint(cw, ch, i, count);
        const speed = speedRange.min + getSecureRandom() * (speedRange.max - speedRange.min);

        siegeEnemies.push({
          isBoss: false,
          word: randWord,
          x: spawnPt.x,
          y: spawnPt.y,
          speed: speed,
          typedIdx: 0,
          radius: 30,
          shake: 0,
          monsterType: monsterTypes[i % monsterTypes.length],
          flightType: flightTypes[Math.floor(getSecureRandom() * flightTypes.length)],
          phase: getSecureRandom() * Math.PI * 2,
          timer: 0,
          dir: getSecureRandom() < 0.5 ? 1 : -1
        });
      }
    }

    // 鍵盤原生事件監聽 (數字鍵 1 傷藥、數字鍵 2 十萬伏特)
    function handleSiegeKeydown(e) {
      if (currentGameMode !== 'siege') return;
      if (!siegeActive) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const readyOverlay = document.getElementById('siege-ready-overlay');
      if (readyOverlay && readyOverlay.style.display !== 'none') {
        if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          siegeStartGame();
        }
        return;
      }

            // ⚡ 閃避 QTE 視窗專屬鍵盤監聽
      if (siegeDodgeActive && siegeDodgeWord && Array.isArray(siegeDodgeWord.keys)) {
        e.preventDefault();
        e.stopPropagation();
        let dodgeLetter = '';
        if (e.code && e.code.startsWith('Key') && e.code.length === 4) {
          dodgeLetter = e.code.slice(3).toUpperCase();
        } else if (e.key && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
          dodgeLetter = e.key.toUpperCase();
        } else if (e.keyCode && e.keyCode >= 65 && e.keyCode <= 90) {
          dodgeLetter = String.fromCharCode(e.keyCode).toUpperCase();
        }
        if (!dodgeLetter) return;

        if (siegeDodgeWord.keys[siegeDodgeTypedIdx] === dodgeLetter) {
          siegeDodgeTypedIdx++;
          updateDodgePips();
          if (siegeDodgeTypedIdx >= siegeDodgeWord.keys.length) {
            resolveSiegeDodge(true);
          }
        } else {
          // ★ 依規則與使用者要求：按錯字碼即刻判定閃避失敗！承受 30 點攻擊傷害！
          resolveSiegeDodge(false);
        }
        return;
      }

      if (!siegeRunning || siegeIsPaused) return;

      // 數字鍵 1：使用傷藥
      if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1') {
        e.preventDefault();
        e.stopPropagation();
        useSiegePotion();
        return;
      }

      // ★ 數字鍵 2：發動「十萬伏特」(玩家自行選擇時機發動，充能滿方可施放)
      if (e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2') {
        e.preventDefault();
        e.stopPropagation();
        if (siegeUltCharge >= 100) {
          siegeCastUltimate();
        } else {
          if (typeof showPassToast === 'function') {
            showPassToast('⚡【十萬伏特】充能未滿！擊破怪獸即可累積充能！');
          }
        }
        return;
      }

      let letter = '';
      if (e.code && e.code.startsWith('Key') && e.code.length === 4) {
        letter = e.code.slice(3).toUpperCase();
      } else if (e.key && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        letter = e.key.toUpperCase();
      } else if (e.keyCode && e.keyCode >= 65 && e.keyCode <= 90) {
        letter = String.fromCharCode(e.keyCode).toUpperCase();
      }

      // 空白鍵防滾動（十萬伏特改由玩家點擊按鈕或按數字鍵 2 手動發動，絕不自動觸發）
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (!letter || letter < 'A' || letter > 'Z') return;
      e.preventDefault();
      e.stopPropagation();

      processSiegeKey(letter);
    }

    // 目標靈活切換機制
    function processSiegeKey(key) {
      const canvas = document.getElementById('siege-canvas');
      const cw = canvas ? canvas.width : 800;
      const ch = canvas ? canvas.height : 420;
      const cx = cw / 2;
      const cy = ch / 2;

      // 確保候選清單有效
      if (!Array.isArray(siegeCandidateEnemies)) {
        siegeCandidateEnemies = [];
      }
      siegeCandidateEnemies = siegeCandidateEnemies.filter(em => siegeEnemies.includes(em));

      // ─────────────────────────────────────────────────────────────
      // 情況 A：當前已有候選怪獸群 (支援同首碼多目標並行鎖定與分支過濾)
      // 例如：拿 (OMRQ) 與 全 (OMG) 首碼均為 O，輸入 O 時兩者均鎖定；
      // 輸入第二碼 M 時兩者繼續前進；輸入第三碼 G 時自動鎖定「全」，輸入 R 時鎖定「拿」！
      // ─────────────────────────────────────────────────────────────
      if (siegeCandidateEnemies.length > 0) {
        // 篩選出當前字碼能匹配 key 的候選怪獸
        const matching = siegeCandidateEnemies.filter(em => {
          return em.word && Array.isArray(em.word.keys) && em.word.keys[em.typedIdx] === key;
        });

        if (matching.length > 0) {
          // 成功推進匹配的怪獸進度
          matching.forEach(em => {
            em.typedIdx++;
          });

          // 未匹配者排除並重置進度 (除非學會看我嘛保留進度)
          siegeCandidateEnemies.forEach(em => {
            if (!matching.includes(em) && !siegeKeepProgressOnMiss) {
              em.typedIdx = 0;
            }
          });

          siegeCandidateEnemies = matching;
          siegeTargetEnemy = (siegeCandidateEnemies.length === 1) ? siegeCandidateEnemies[0] : null;

          // 檢查是否已有怪獸打完完整拆碼
          const completed = siegeCandidateEnemies.filter(em => em.typedIdx >= em.word.keys.length);
          if (completed.length > 0) {
            // 擊破最先完成的怪獸 (若同時完成優先擊破離中心最近者)
            completed.sort((a, b) => Math.hypot(cx - a.x, cy - a.y) - Math.hypot(cx - b.x, cy - b.y));
            const victim = completed[0];
            defeatSiegeEnemy(victim);
            siegeCandidateEnemies = siegeCandidateEnemies.filter(em => em !== victim);
            siegeTargetEnemy = (siegeCandidateEnemies.length === 1) ? siegeCandidateEnemies[0] : null;
          }
          return;
        } else {
          // 當前候選群無一匹配，檢查玩家是否切換擊打場上「以 key 為首碼」的新怪獸
          const newCands = siegeEnemies.filter(em => em.word && Array.isArray(em.word.keys) && em.word.keys[0] === key);
          if (newCands.length > 0) {
            if (!siegeKeepProgressOnMiss) {
              siegeCandidateEnemies.forEach(em => { em.typedIdx = 0; });
            }
            newCands.forEach(em => { em.typedIdx = 1; });
            siegeCandidateEnemies = newCands;
            siegeTargetEnemy = (siegeCandidateEnemies.length === 1) ? siegeCandidateEnemies[0] : null;

            const completed = newCands.filter(em => em.typedIdx >= em.word.keys.length);
            if (completed.length > 0) {
              completed.sort((a, b) => Math.hypot(cx - a.x, cy - a.y) - Math.hypot(cx - b.x, cy - b.y));
              const victim = completed[0];
              defeatSiegeEnemy(victim);
              siegeCandidateEnemies = siegeCandidateEnemies.filter(em => em !== victim);
              siegeTargetEnemy = (siegeCandidateEnemies.length === 1) ? siegeCandidateEnemies[0] : null;
            }
            return;
          } else {
            // 真正按錯：震動並重置
            if (!siegeKeepProgressOnMiss) {
              siegeCandidateEnemies.forEach(em => { em.typedIdx = 0; em.shake = 10; });
            }
            siegeCandidateEnemies = [];
            siegeTargetEnemy = null;
            siegeMisses++;
            updateSiegeHUD();
            return;
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 情況 B：當前未鎖定怪獸 (搜尋場上所有首碼符合 key 的怪獸，全部納入候選)
      // ─────────────────────────────────────────────────────────────
      const cands = siegeEnemies.filter(em => em.word && Array.isArray(em.word.keys) && em.word.keys[0] === key);

      if (cands.length > 0) {
        cands.forEach(em => { em.typedIdx = 1; });
        siegeCandidateEnemies = cands;
        siegeTargetEnemy = (cands.length === 1) ? cands[0] : null;

        const completed = cands.filter(em => em.typedIdx >= em.word.keys.length);
        if (completed.length > 0) {
          completed.sort((a, b) => Math.hypot(cx - a.x, cy - a.y) - Math.hypot(cx - b.x, cy - b.y));
          const victim = completed[0];
          defeatSiegeEnemy(victim);
          siegeCandidateEnemies = siegeCandidateEnemies.filter(em => em !== victim);
          siegeTargetEnemy = (siegeCandidateEnemies.length === 1) ? siegeCandidateEnemies[0] : null;
        }
      } else {
        siegeMisses++;
        updateSiegeHUD();
      }
    }

    function triggerPikachuLightning(target) {
      const canvas = document.getElementById('siege-canvas');
      const cw = canvas ? canvas.width : 800;
      const ch = canvas ? canvas.height : 420;
      const cx = cw / 2;
      const cy = ch / 2;

      const steps = 14;
      const points = [{ x: cx, y: cy }];
      const dx = target.x - cx;
      const dy = target.y - cy;
      const dist = Math.hypot(dx, dy) || 1;

      for (let i = 1; i < steps; i++) {
        const ratio = i / steps;
        const nx = cx + dx * ratio;
        const ny = cy + dy * ratio;
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const jitter = (getSecureRandom() - 0.5) * 26 * Math.sin(ratio * Math.PI);
        points.push({ x: nx + perpX * jitter, y: ny + perpY * jitter });
      }
      points.push({ x: target.x, y: target.y });

      siegeLightnings.push({
        points: points,
        life: 14,
        maxLife: 14,
        targetX: target.x,
        targetY: target.y
      });
    }

    
    function defeatSiegeEnemy(em) {
      // 👑 小型 Boss 處理 (支援多字隊列擊退與波次血量)
      if (em.isBoss && em.bossType === 'mini') {
        if (em.wordsQueue && em.wordsQueue.length > 1) {
          triggerPikachuLightning(em);
          em.wordsQueue.shift();
          em.word = em.wordsQueue[0];
          em.typedIdx = 0;
          em.hp = em.wordsQueue.length;
          // 受到強烈擊退向外後退 75px
          const canvas = document.getElementById('siege-canvas');
          const cx = canvas ? canvas.width / 2 : 400;
          const cy = canvas ? canvas.height / 2 : 210;
          const angle = Math.atan2(em.y - cy, em.x - cx);
          em.x += Math.cos(angle) * 75;
          em.y += Math.sin(angle) * 75;
          em.shake = 15;
          updateBossHUD();
          if (typeof showPassToast === 'function') {
            showPassToast(`👑【小型月Boss】字靈擊破！受到強烈擊退，剩餘 ${em.wordsQueue.length} 個字！`);
          }
          return;
        } else {
          // 小型 Boss 徹底擊破：獲得 3 倍巨額積分並順暢推進波次！
          let bonusScore = (Math.round(15 * 1.2) + siegeBonusScore) * 3;
          bonusScore += Math.floor(siegeWave * 5); // 隨波次調高
          siegeScore += bonusScore;
          updateSiegeHUD();
          if (typeof burstConfetti === 'function') burstConfetti();
          if (typeof showPassToast === 'function') {
            showPassToast(`👑 擊潰小型Boss【${em.name}】！獲得 +${bonusScore} 巨額積分！`);
          }

          // ★ 若場上尚有其他小型 Boss，切換 HUD 目標；若全滅則隱藏
          const otherBosses = siegeEnemies.filter(item => item.isBoss && item !== em);
          if (otherBosses.length > 0) {
            currentBoss = otherBosses[0];
            updateBossHUD();
          } else {
            currentBoss = null;
            hideBossHUD();
          }
        }
      }

      // 👑 大型 Boss (耿鬼) 第 1 型態處理
      if (em.isBoss && em.bossType === 'major' && em.form === 1) {
        triggerPikachuLightning(em);
        em.wordsQueue = em.wordsQueue.filter(w => w !== em.word);
        const p2Hp = em.phase2BaseHp || 100;
        em.hp = Math.max(p2Hp, em.hp - 10);
        em.typedIdx = 0;
        em.shake = 12;
        // 擊退 35px
        const canvas = document.getElementById('siege-canvas');
        const cx = canvas ? canvas.width / 2 : 400;
        const cy = canvas ? canvas.height / 2 : 210;
        const angle = Math.atan2(em.y - cy, em.x - cx);
        em.x += Math.cos(angle) * 35;
        em.y += Math.sin(angle) * 35;

        if (em.wordsQueue.length > 0 && em.hp > p2Hp) {
          em.word = em.wordsQueue[Math.floor(getSecureRandom() * em.wordsQueue.length)];
          em.wordTimer = 4 + getSecureRandom() * 4;
          updateBossHUD();
          if (typeof showPassToast === 'function') {
            showPassToast(`⚡ 擊破耿鬼 1 字！耿鬼受到 10 點傷害！剩餘 ${em.wordsQueue.length} 個字！`);
          }
          return;
        } else {
          // 第 1 型態破除，轉入第 2 型態！
          em.form = 2;
          em.hp = p2Hp;
          em.wordsQueue = [];
          em.word = null; // 身上不再顯示字
          em.isRushing = false;
          em.minionsKilledBeforeRush = 0;
          em.blinkTimer = 1 + getSecureRandom() * 2;
          em.attackTimer = 6 + getSecureRandom() * 4;
          // ★ 確保轉入 Phase 2 瞬間安全置於遊戲畫面邊界內！
          const cw2 = canvas ? canvas.width : 800;
          const ch2 = canvas ? canvas.height : 420;
          const inBounds = getInBoundsBossHoverPos(cw2, ch2, em.radius);
          em.x = inBounds.x;
          em.y = inBounds.y;
          em.anchorX = inBounds.x;
          em.anchorY = inBounds.y;
          em.phase = getSecureRandom() * Math.PI * 2;
          showBossHUD(em); // 短暫展示 5 秒第 2 型態警報
          updateBossHUD();
          if (typeof showPassToast === 'function') {
            showPassToast('💥 耿鬼第 1 型態破除！進入第 2 型態【暗黑幻影閃現】！清除小怪削弱耿鬼！');
          }
          return;
        }
      }

      // 👑 大型 Boss 第 2 型態下：玩家清除普通怪獸，連鎖對耿鬼造成 10 點傷害！
      if (!em.isBoss && currentBoss && currentBoss.bossType === 'major' && currentBoss.form === 2) {
        currentBoss.hp = Math.max(0, currentBoss.hp - 10);
        currentBoss.minionsKilledBeforeRush++;
        updateBossHUD();
        triggerPikachuLightning(currentBoss);
        if (typeof showPassToast === 'function') {
          showPassToast(`⚡ 清除護衛怪獸！對耿鬼造成 10 點傷害！(已累積清除 ${currentBoss.minionsKilledBeforeRush}/3 隻)`);
        }
        if (currentBoss.hp <= 0) {
          defeatMajorBoss();
          return;
        }
      }

      triggerPikachuLightning(em);

      if (siegeLightningChains > 0 && siegeEnemies.length > 1) {
        const others = siegeEnemies.filter(item => item !== em);
        for (let c = 0; c < Math.min(siegeLightningChains, others.length); c++) {
          triggerPikachuLightning(others[c]);
        }
      }

      for (let i = 0; i < 22; i++) {
        const angle = getSecureRandom() * Math.PI * 2;
        const spd = 2.5 + getSecureRandom() * 5.5;
        siegeParticles.push({
          x: em.x,
          y: em.y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          color: ['#FACC15', '#FEF08A', '#38BDF8', '#67E8F9', '#FFFFFF'][Math.floor(getSecureRandom() * 5)],
          life: 25,
          maxLife: 25,
          size: 3 + getSecureRandom() * 3.5
        });
      }

      siegeKills++;
      siegeKillsInWave++;
      siegeKillsInLevel++;

      let pts = Math.round(15 * 1.2) + siegeBonusScore;
      if (siegeDoubleScoreChance > 0 && getSecureRandom() < siegeDoubleScoreChance) {
        pts *= 2;
        if (typeof showPassToast === 'function') showPassToast('🎯 觸發【聚氣暴擊】！獲得雙倍得分！');
      }
      siegeScore += pts;

      // ★ 充能規則：上限 100%，滿 100% 後不作累計，發動後才重新累積！
      if (siegeUltCharge < 100) {
        siegeUltCharge = Math.min(100, siegeUltCharge + Math.round(15 * siegeUltChargeRate));
      }

      siegeEnemies = siegeEnemies.filter(item => item !== em);
      if (siegeTargetEnemy === em) siegeTargetEnemy = null;
      if (Array.isArray(siegeCandidateEnemies)) siegeCandidateEnemies = siegeCandidateEnemies.filter(item => item !== em);
      // ★ 波次推進統一由整波怪物清空時之 advanceToNextSiegeWave 判定 (杜絕擊殺計數與清屏重複自增)

      updateSiegeHUD();

      // ★ 等級晉升檢查 (擊破數驅動，增長比波次慢)
      // Lv.1->2: 5 隻; Lv.2->3: 10 隻; Lv.3->4: 15 隻...
      if (siegeKillsInLevel >= siegeLevelKillsNeeded) {
        siegeLevel++;
        siegeKillsInLevel = 0;
        siegeLevelKillsNeeded = siegeLevel * 5;
        triggerSiegeLevelUpModal();
        return;
      }
    }

    // ★ 十萬伏特大招釋放 (由玩家自行選擇時機發動，閃電特效延遲 2.2 秒配合原音效)
    let siegeIsCastingUlt = false;
    let siegeUltChargingTimer = 0;

    function siegeCastUltimate() {
      if (siegeUltCharge < 100 || !siegeActive || !siegeRunning || siegeIsPaused || siegeIsCastingUlt) return;
      siegeIsCastingUlt = true;
      siegeUltCharge = 0; // 發動後立即歸零，重新累積，防止連擊重複施放
      siegeUltToastShown = false;
      siegeUltChargingTimer = 2.2; // 啟動 2.2 秒蓄力電弧動畫計時
      updateSiegeHUD();

      // 1. 原音效設定完全保留，立即播放 (音效持續約 3 秒，前段為蓄力呼喊，約 2.2 秒迎來雷鳴重音爆發)
      if (typeof ThunderboltSFX !== 'undefined' && ThunderboltSFX.play) {
        ThunderboltSFX.play();
      }

      // 2. 蓄力前置提示
      if (typeof showPassToast === 'function') {
        showPassToast('⚡【十萬伏特】啟動！皮卡丘正在聚集雷霆神力（2.2秒後雷霆轟頂）...');
      }

      // 3. 閃電特效延遲 2.2 秒精準爆發，完美對齊音效重音爆發點！
      setTimeout(() => {
        siegeIsCastingUlt = false;
        siegeUltChargingTimer = 0;

        if (!siegeActive || !siegeRunning || siegeHp <= 0) return;

        const canvas = document.getElementById('siege-canvas');
        const cw = canvas ? canvas.width : 800;
        const ch = canvas ? canvas.height : 420;
        const cx = cw / 2;
        const cy = ch / 2;

        // ★ 核心分離：普通怪獸被淨化，小、大型 Boss 具備霸體完全免疫十萬伏特！
        const normalEnemies = siegeEnemies.filter(em => !em.isBoss);
        const bossEnemies = siegeEnemies.filter(em => em.isBoss);

        let killedNormal = [];
        let sparedNormal = [];

        const isSwarmWave = (siegeWave % 13 === 0);
        if (isSwarmWave) {
          // ★ 恐怖獸潮波次：每次只能消除場上 1/4 的入侵普通寶可夢！
          // 優先消除離小智中心最近的 1/4 隻，精準解圍
          const countToKill = Math.max(1, Math.ceil(normalEnemies.length / 4));
          const sorted = [...normalEnemies].sort((a, b) => Math.hypot(cx - a.x, cy - a.y) - Math.hypot(cx - b.x, cy - b.y));
          killedNormal = sorted.slice(0, countToKill);
          sparedNormal = sorted.slice(countToKill);
        } else {
          // ★ 恆常波次：消除全場普通怪獸
          killedNormal = normalEnemies;
          sparedNormal = [];
        }

        // 觸發比卡丘閃電電弧連鎖動畫
        killedNormal.forEach(em => triggerPikachuLightning(em));

        // 畫面金黃電光粒子四濺
        for (let i = 0; i < 45; i++) {
          siegeParticles.push({
            x: getSecureRandom() * cw,
            y: getSecureRandom() * ch,
            vx: (getSecureRandom() - 0.5) * 8,
            vy: (getSecureRandom() - 0.5) * 8,
            color: '#FACC15',
            life: 30,
            maxLife: 30,
            size: 4
          });
        }

        // 畫面微震
        siegeDashOffset = 12;

        // ★ 存活實體 = 所有 Boss + 未被消除的普通怪獸 (獸潮時為剩下的 3/4)
        siegeEnemies = bossEnemies.concat(sparedNormal);
        if (Array.isArray(siegeCandidateEnemies)) {
          siegeCandidateEnemies = siegeCandidateEnemies.filter(em => siegeEnemies.includes(em));
          siegeTargetEnemy = (siegeCandidateEnemies.length === 1) ? siegeCandidateEnemies[0] : null;
        } else {
          siegeTargetEnemy = null;
        }

        updateSiegeHUD();

        if (isSwarmWave) {
          if (typeof showPassToast === 'function') {
            showPassToast(`⚡【十萬伏特】雷霆轟頂！消滅了場上 1/4 的普通怪獸（${killedNormal.length} 隻）！剩餘 ${sparedNormal.length} 隻繼續進犯！`);
          }
        } else if (bossEnemies.length > 0) {
          if (typeof showPassToast === 'function') {
            showPassToast('⚡【十萬伏特】雷霆轟頂！全場普通怪獸淨化！（Boss具備霸體，完全免疫十萬伏特！）');
          }
        } else {
          if (typeof triggerSkillToast === 'function') {
            triggerSkillToast('⚡', '觸發【十萬伏特】！比卡丘釋放神雷，淨化全場字靈！');
          }
        }
      }, 2200);
    }

    // ★ 動畫主迴圈安全喚醒器 (杜絕 QTE 或暫停後的主線程休克)
    function resumeSiegeLoop() {
      if (siegeAnimId) {
        cancelAnimationFrame(siegeAnimId);
        siegeAnimId = null;
      }
      if (siegeActive && siegeRunning && !siegeIsPaused) {
        siegeAnimId = requestAnimationFrame(tickSiege);
      }
    }

    // ★ 統一波次推進引擎 (Single Source of Truth，杜絕多處自增導致跳波)
    function advanceToNextSiegeWave() {
      if (!siegeActive || !siegeRunning || siegeIsPaused || siegeHp <= 0) return;
      if (siegeIsSpawningSquad) return;
      siegeIsSpawningSquad = true;

      siegeWave++;
      siegeKillsInWave = 0;
      siegeWaveKillsNeeded = Math.min(10, 2 + Math.floor(siegeWave * 0.35));
      updateSiegeHUD();

      if (siegeWave % 13 === 0) {
        const swarmTier = Math.floor(siegeWave / 13);
        siegeWaveKillsNeeded = Math.min(25, 10 + (swarmTier - 1) * 3 + Math.floor(8 + getSecureRandom() * 8));
      }

      if (typeof showPassToast === 'function') {
        if (siegeWave % 13 === 0) {
          showPassToast('🚨 警報！突破至第 Wave ' + siegeWave + ' 波！【恐怖獸潮】全面爆發！大量寶可夢從四方八面湧入！');
        } else if (siegeWave % 10 === 0) {
          showPassToast('👑 突破至第 Wave ' + siegeWave + ' 波！大型霸主【耿鬼】即將降臨！');
        } else if (siegeWave % 5 === 0) {
          showPassToast('👑 突破至第 Wave ' + siegeWave + ' 波！小型月Boss 即將突襲！');
        } else {
          showPassToast('🌊 突破至第 Wave ' + siegeWave + ' 波！入侵精靈攻勢增強！');
        }
      }

      const delay = (siegeWave % 13 === 0) ? 1000 : (siegeWave % 5 === 0 || siegeWave % 10 === 0) ? 800 : 500;
      setTimeout(() => {
        if (siegeActive && siegeRunning && !siegeIsPaused && siegeHp > 0) {
          spawnSiegeWave();
          resumeSiegeLoop();
        }
        siegeIsSpawningSquad = false;
      }, delay);
    }

    function tickSiege() {
      siegeAnimId = null; // 當前幀已進入執行，清空標記
      if (!siegeActive || !siegeRunning) return;
      if (siegeIsPaused) return;

      const canvas = document.getElementById('siege-canvas');
      const wrap = document.getElementById('siege-stage-wrap');
      if (!canvas) return;

      if (wrap && wrap.clientWidth && canvas.width !== wrap.clientWidth) {
        canvas.width = wrap.clientWidth;
        canvas.height = wrap.clientHeight || 420;
      }

      const ctx = canvas.getContext('2d');
      const cw = canvas.width;
      const ch = canvas.height;
      const cx = cw / 2;
      const cy = ch / 2;

      ctx.clearRect(0, 0, cw, ch);

      // 1. 戰術雷達網格背景
      ctx.save();
      ctx.strokeStyle = 'rgba(30, 58, 138, 0.22)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < cw; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
      }
      for (let y = 0; y < ch; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
      }
      ctx.restore();

      // 2. 雙層防守圈 (實線結界＋旋轉虛線雷達)
      ctx.save();

      siegeDashOffset = (siegeDashOffset + 0.35) % 16;
      ctx.beginPath();
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -siegeDashOffset;
      ctx.arc(cx, cy, 88, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(cx, cy, 40, 0, Math.PI * 2);
      if (siegeBarrierHitTimer > 0) {
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 5;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      } else if (siegeBarrierShieldCount > 0) {
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = 3.5;
        ctx.fillStyle = 'rgba(250, 204, 21, 0.2)';
      } else {
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2.5;
        ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
      }
      ctx.stroke();
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 160, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();

      if (siegeBarrierHitTimer > 0) siegeBarrierHitTimer--;

      // 3. 瞄準指示線
      if (siegeTargetEnemy && siegeEnemies.includes(siegeTargetEnemy)) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(siegeTargetEnemy.x, siegeTargetEnemy.y);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
      }

      // ⚡ 十萬伏特 2.2 秒蓄力電弧光環
      if (typeof siegeUltChargingTimer !== 'undefined' && siegeUltChargingTimer > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 26 + 8 + Math.sin(Date.now() / 40) * 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#FACC15';
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.restore();
      }

      // 4. 中央小智與比卡丘圖示
      ctx.save();
      const avatarR = 26;
      ctx.beginPath();
      ctx.arc(cx, cy, avatarR, 0, Math.PI * 2);
      ctx.clip();
      if (siegeAshImg.complete && siegeAshImg.naturalWidth > 0) {
        ctx.drawImage(siegeAshImg, cx - avatarR, cy - avatarR, avatarR * 2, avatarR * 2);
      } else {
        ctx.fillStyle = '#1E3A8A';
        ctx.fill();
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', cx, cy);
      }
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, avatarR, 0, Math.PI * 2);
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = '#FACC15';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();

      // 5. 比卡丘十萬伏特閃電光束
      for (let l = siegeLightnings.length - 1; l >= 0; l--) {
        const lt = siegeLightnings[l];
        ctx.save();
        ctx.globalAlpha = Math.max(0, lt.life / lt.maxLife);
        ctx.strokeStyle = (lt.life % 2 === 0) ? '#FFFFFF' : '#FACC15';
        ctx.shadowColor = '#FEF08A';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        if (lt.points && lt.points.length > 0) {
          ctx.moveTo(lt.points[0].x, lt.points[0].y);
          for (let p = 1; p < lt.points.length; p++) {
            ctx.lineTo(lt.points[p].x, lt.points[p].y);
          }
        }
        ctx.stroke();

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
        lt.life--;
        if (lt.life <= 0) siegeLightnings.splice(l, 1);
      }

      // 6. 治癒綠色能量粒子
      for (let h = siegeHealParticles.length - 1; h >= 0; h--) {
        const hp = siegeHealParticles[h];
        hp.x += hp.vx;
        hp.y += hp.vy;
        hp.life--;
        ctx.save();
        ctx.globalAlpha = Math.max(0, hp.life / hp.maxLife);
        ctx.fillStyle = hp.color;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, hp.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (hp.life <= 0) siegeHealParticles.splice(h, 1);
      }

      // 7. 擊破雷電火花粒子
      for (let p = siegeParticles.length - 1; p >= 0; p--) {
        const pt = siegeParticles[p];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life--;
        ctx.save();
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (pt.life <= 0) siegeParticles.splice(p, 1);
      }

      // 8. 5 種隨機飛行路徑 (直線、正弦波浪、螺旋、鋸齒、S形)
      for (let i = siegeEnemies.length - 1; i >= 0; i--) {
        const em = siegeEnemies[i];

        const edx = cx - em.x;
        const edy = cy - em.y;
        const dist = Math.hypot(edx, edy);

        if (dist > 1) {
          const ux = edx / dist;
          const uy = edy / dist;
          const perpX = -uy;
          const perpY = ux;

          em.timer = (em.timer || 0) + 1;

          // 👑 大型 Boss 第 2 型態特殊移動：未發動突襲時在外圍邊界內漂浮待機，絕不逼近小智！
          if (em.isBoss && em.bossType === 'major' && em.form === 2) {
            if (!em.isRushing) {
              // ★ 在畫面邊界外圍優雅漂浮：錨點小幅懸浮微動 (距離小智甚遠，絕不逼近小智)
              em.phase = (em.phase || 0) + 0.02;
              const marginX = em.radius + 18;
              const marginY = em.radius + 18;
              const anchorX = (typeof em.anchorX === 'number') ? em.anchorX : em.x;
              const anchorY = (typeof em.anchorY === 'number') ? em.anchorY : em.y;
              em.x = Math.max(marginX, Math.min(cw - marginX, anchorX + Math.cos(em.phase) * 16));
              em.y = Math.max(marginY, Math.min(ch - marginY, anchorY + Math.sin(em.phase * 1.2) * 12));
            } else {
              // 急速突襲！以 2.8 px/f 朝小智疾速猛衝
              em.x += ux * 2.8;
              em.y += uy * 2.8;
            }
          } else if (em.flightType === 'sine_wobble') {
            em.phase = (em.phase || 0) + 0.038;
            const wobble = Math.sin(em.phase) * 1.25;
            em.x += ux * em.speed + perpX * wobble;
            em.y += uy * em.speed + perpY * wobble;
          } else if (em.flightType === 'spiral') {
            const spiralTangent = (em.dir || 1) * (em.speed * 0.75);
            em.x += ux * em.speed + perpX * spiralTangent;
            em.y += uy * em.speed + perpY * spiralTangent;
          } else if (em.flightType === 'zigzag') {
            if (em.timer % 42 === 0) em.dir = -(em.dir || 1);
            const zigOffset = (em.dir || 1) * 1.35;
            em.x += ux * em.speed + perpX * zigOffset;
            em.y += uy * em.speed + perpY * zigOffset;
          } else if (em.flightType === 's_curve') {
            em.phase = (em.phase || 0) + 0.02;
            const sWobble = Math.cos(em.phase) * 1.8;
            em.x += ux * em.speed + perpX * sWobble;
            em.y += uy * em.speed + perpY * sWobble;
          } else {
            em.x += ux * em.speed;
            em.y += uy * em.speed;
          }
        }

        let drawX = em.x;
        let drawY = em.y;
        if (em.shake > 0) {
          drawX += (getSecureRandom() - 0.5) * 8;
          drawY += (getSecureRandom() - 0.5) * 8;
          em.shake--;
        }

        ctx.save();
        const isTarget = (em === siegeTargetEnemy);
        const isCandidate = (Array.isArray(siegeCandidateEnemies) && siegeCandidateEnemies.includes(em));
        const activeAura = isTarget || isCandidate;

        // 外層光環
        ctx.beginPath();
        ctx.arc(drawX, drawY, em.radius + (isTarget ? 5 : 2), 0, Math.PI * 2);
        ctx.fillStyle = isTarget ? 'rgba(250, 204, 21, 0.55)' : (isCandidate ? 'rgba(56, 189, 248, 0.45)' : 'rgba(168, 85, 247, 0.3)');
        ctx.fill();

        // 怪獸圓形圖示
        ctx.save();
        ctx.beginPath();
        ctx.arc(drawX, drawY, em.radius, 0, Math.PI * 2);
        ctx.clip();
        const mImg = siegeMonsterImgs[em.monsterType];
        if (mImg && mImg.complete && mImg.naturalWidth > 0) {
          ctx.drawImage(mImg, drawX - em.radius, drawY - em.radius, em.radius * 2, em.radius * 2);
        } else {
          ctx.fillStyle = isTarget ? '#7C3AED' : '#312E81';
          ctx.fill();
        }
        ctx.restore();

        // 圓形邊框
        ctx.beginPath();
        ctx.arc(drawX, drawY, em.radius, 0, Math.PI * 2);
        ctx.strokeStyle = isTarget ? '#FACC15' : (isCandidate ? '#38BDF8' : '#818CF8');
        ctx.lineWidth = isTarget ? 3.5 : (isCandidate ? 2.8 : 2);
        ctx.stroke();

        // 👑 Boss 專屬頭頂標記與實時 HP 數值膠囊 (隨 Boss 移動實時增減)
        if (em.isBoss) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          if (em.bossType === 'major') {
            const hpVal = Math.max(0, Math.round(em.hp));
            const hpText = `HP：${hpVal}`;

            // 繪製深色圓角膠囊底框
            ctx.font = '900 13px "Microsoft JhengHei", "PingFang SC", sans-serif';
            const pillW = ctx.measureText(hpText).width + 16;
            const pillH = 22;
            const pillX = drawX - pillW / 2;
            const pillY = drawY - em.radius - 22;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.strokeStyle = em.form === 1 ? '#A855F7' : '#EF4444';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(pillX, pillY, pillW, pillH, 11);
            } else {
              ctx.rect(pillX, pillY, pillW, pillH);
            }
            ctx.fill();
            ctx.stroke();

            // 實時 HP 文字 (Phase 1 金黃 / Phase 2 警示紅)
            ctx.fillStyle = em.form === 1 ? '#FACC15' : '#F87171';
            ctx.shadowColor = em.form === 1 ? 'rgba(250, 204, 21, 0.8)' : 'rgba(239, 68, 68, 0.8)';
            ctx.shadowBlur = 6;
            ctx.fillText(hpText, drawX, pillY + pillH / 2);

            // 稱號副標 (突襲或型態)
            ctx.font = '700 11px sans-serif';
            ctx.fillStyle = '#DDD6FE';
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 4;
            const subTitle = em.form === 1
              ? `👑 耿鬼 (${em.wordsQueue ? em.wordsQueue.length : 1}字)`
              : (em.isRushing ? '⚡ 耿鬼極速猛衝！' : '👑 耿鬼 (外圍待機)');
            ctx.fillText(subTitle, drawX, pillY - 8);
          } else if (em.bossType === 'mini') {
            const miniHpText = `HP：${Math.max(0, Math.round(em.hp * 50))}`;
            ctx.font = '900 12px "Microsoft JhengHei", sans-serif';
            ctx.fillStyle = '#FACC15';
            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 4;
            ctx.fillText(`👑 小型Boss (${miniHpText})`, drawX, drawY - em.radius - 12);
          }
          ctx.restore();
        }

        // 漢字 (安全判斷：當前怪獸附帶漢字時渲染)
        if (em.word && em.word.char) {
          ctx.fillStyle = '#FFFFFF';
          const fontSize = em.isBoss ? (em.bossType === 'major' ? 32 : 28) : 24;
          ctx.font = '900 ' + fontSize + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.95)';
          ctx.shadowBlur = 6;
          ctx.fillText(em.word.char, drawX, drawY);

          // 菱形進度格
          const numCodes = em.word.keys ? em.word.keys.length : 2;
          const pipSize = em.isBoss ? 7 : 6;
          const pipGap = em.isBoss ? 15 : 13;
          const totalW = (numCodes - 1) * pipGap;
          const startPipX = drawX - totalW / 2;
          const pipY = drawY + em.radius + (em.isBoss ? 12 : 9);

          for (let p = 0; p < numCodes; p++) {
            const px = startPipX + p * pipGap;
            ctx.save();
            ctx.translate(px, pipY);
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.rect(-pipSize / 2, -pipSize / 2, pipSize, pipSize);
            if (p < em.typedIdx) {
              ctx.fillStyle = '#38BDF8';
              ctx.shadowColor = '#00F0FF';
              ctx.shadowBlur = 8;
              ctx.fill();
            } else {
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.lineWidth = 1.3;
              ctx.stroke();
            }
            ctx.restore();
          }
        }

        ctx.restore();

        
        // 撞擊防守圈 (dist <= 42)
        const hitDist = em.isBoss ? (38 + em.radius * 0.65) : 42;
        if (dist <= hitDist) {
          // 👑 情況 1：大型 Boss (耿鬼) 撞擊防守圈
          if (em.isBoss && em.bossType === 'major') {
            if (em.form === 1) {
              // 第 1 型態：傷害 = 未正確輸入的字數 * 5
              const uncompletedCount = em.wordsQueue ? em.wordsQueue.length : 1;
              const dmg = Math.max(5, uncompletedCount * 5);
              if (siegeBarrierShieldCount > 0) {
                siegeBarrierShieldCount--;
                siegeHp = Math.max(0, siegeHp - Math.max(0, dmg - 15));
                if (typeof showPassToast === 'function') {
                  showPassToast(`🛡️ 護盾抵擋衝擊！小智承受 ${Math.max(0, dmg - 15)} 點傷害 (未完成 ${uncompletedCount} 字×5)！`);
                }
              } else {
                siegeHp = Math.max(0, siegeHp - dmg);
                if (typeof showPassToast === 'function') {
                  showPassToast(`💥 耿鬼猛烈撞擊！造成 ${dmg} 點重創 (未完成 ${uncompletedCount} 字×5)！`);
                }
              }
              // 退回外圍隨機位置，身上未擊破的字保留不重置！
              const ang = getSecureRandom() * Math.PI * 2;
              em.x = cx + Math.cos(ang) * 280;
              em.y = cy + Math.sin(ang) * 280;
              em.flightType = ['straight', 'zigzag', 's_curve'][Math.floor(getSecureRandom() * 3)];
              em.typedIdx = 0;
              em.shake = 15;
              updateSiegeHUD();
              updateBossHUD();
              if (siegeHp <= 0) { onSiegeGameOver(); return; }
              continue;
            } else if (em.form === 2) {
              // 第 2 型態：突襲撞擊小智
              if (em.isRushing) {
                if (em.minionsKilledBeforeRush >= 3) {
                  // 達成消除 ≥ 3 隻小怪：解鎖極限閃避 QTE 判定！
                  triggerSiegeDodgeModal();
                  return;
                } else {
                  // 未能達成 ≥ 3 隻小怪：直接對小智造成 30 點傷害！
                  em.hp -= 10;
                  em.isRushing = false;
                  em.minionsKilledBeforeRush = 0;
                  em.attackTimer = 6 + getSecureRandom() * 4;
                  // 退回外圍
                  const rPos = getInBoundsBossHoverPos(cw, ch, em.radius);
                  em.x = rPos.x;
                  em.y = rPos.y;
                  em.anchorX = rPos.x;
                  em.anchorY = rPos.y;
                  em.phase = getSecureRandom() * Math.PI * 2;

                  const majorTier = Math.max(0, Math.floor((siegeWave - 10) / 10));
                  const majorDmg = 30 + Math.min(20, majorTier * 5);
                  if (siegeBarrierShieldCount > 0) {
                    siegeBarrierShieldCount--;
                    const actualDmg = Math.round(majorDmg / 2);
                    siegeHp = Math.max(0, siegeHp - actualDmg);
                  } else {
                    siegeHp = Math.max(0, siegeHp - majorDmg);
                  }
                  if (typeof showPassToast === 'function') {
                    showPassToast(`⚠️ 護衛怪獸未及時清除（需 ≥ 3 隻），無法啟動閃避！受到 ${majorDmg} 點重創！耿鬼自損 10 HP！`);
                  }
                  updateSiegeHUD();
                  updateBossHUD();
                  if (em.hp <= 0) { defeatMajorBoss(); resumeSiegeLoop(); return; }
                  if (siegeHp <= 0) { onSiegeGameOver(); return; }
                  continue;
                }
              }
            }
          }

          // 👑 情況 2：小型 Boss 撞擊防守圈
          if (em.isBoss && em.bossType === 'mini') {
            const miniTier = Math.max(0, Math.floor((siegeWave - 5) / 10));
            const baseDmg = em.miniFormType === 'speedy' ? 23 : 20;
            const dmg = baseDmg + Math.min(15, miniTier * 3);
            if (siegeBarrierShieldCount > 0) {
              siegeBarrierShieldCount--;
              if (typeof showPassToast === 'function') {
                showPassToast('🛡️ 護盾完全抵擋了小型Boss衝擊！');
              }
            } else {
              siegeHp = Math.max(0, siegeHp - dmg);
              siegeBarrierHitTimer = 10;
              if (typeof showPassToast === 'function') {
                showPassToast(`💥 小型Boss【${em.name}】撞擊！小智受到 ${dmg} 點傷害！`);
              }
            }
            const remainingBosses = siegeEnemies.filter(item => item.isBoss && item !== em);
            if (remainingBosses.length > 0) {
              currentBoss = remainingBosses[0];
              updateBossHUD();
            } else {
              currentBoss = null;
              hideBossHUD();
            }
            updateSiegeHUD();
            siegeEnemies.splice(i, 1);
            if (em === siegeTargetEnemy) siegeTargetEnemy = null;
            if (siegeCandidateEnemies) siegeCandidateEnemies = siegeCandidateEnemies.filter(item => item !== em);
            if (siegeHp <= 0) { onSiegeGameOver(); return; }
            continue;
          }

          // 情況 3：普通怪獸撞擊防守圈

          if (siegeBarrierShieldCount > 0) {
            siegeBarrierShieldCount--;
            if (typeof showPassToast === 'function') {
              showPassToast('🛡️【電氣護盾】觸發！完全抵擋了一次野生怪獸撞擊！');
            }
          } else {
            const damage = 15 + (typeof siegeImpactDamageExtra !== 'undefined' ? siegeImpactDamageExtra : 0);
            siegeHp = Math.max(0, siegeHp - damage);
            siegeBarrierHitTimer = 10;
          }

          updateSiegeHUD();
          siegeEnemies.splice(i, 1);
          if (em === siegeTargetEnemy) siegeTargetEnemy = null;
          if (Array.isArray(siegeCandidateEnemies)) siegeCandidateEnemies = siegeCandidateEnemies.filter(item => item !== em);

          if (siegeHp <= 0) {
            onSiegeGameOver();
            return;
          }
        }
      }


      // ★ 幽靈 Boss 自動回收機制 (防止歷史殘留 Boss 引用卡死波次推進)
      if (currentBoss && (!Array.isArray(siegeEnemies) || !siegeEnemies.includes(currentBoss))) {
        currentBoss = null;
        hideBossHUD();
      }

      // ★ 緊湊刷怪 (當前波次怪獸全滅時，推進至下一波並刷怪，消除空白等待)
      if (siegeActive && siegeRunning && !siegeIsPaused && siegeEnemies.length === 0 && !currentBoss && !siegeIsSpawningSquad && siegeHp > 0) {
        advanceToNextSiegeWave();
      }

      // ★ 空場看門狗超時保護 (防任何意外卡死)：若場上怪獸為空超過 1.5 秒 (90幀) 且小智存活，強制喚醒推進波次
      if (siegeActive && siegeRunning && !siegeIsPaused && siegeEnemies.length === 0 && siegeHp > 0) {
        if (typeof siegeEmptyFieldTimer === 'undefined') siegeEmptyFieldTimer = 0;
        siegeEmptyFieldTimer++;
        if (siegeEmptyFieldTimer > 90) {
          siegeEmptyFieldTimer = 0;
          currentBoss = null;
          hideBossHUD();
          siegeIsSpawningSquad = false;
          advanceToNextSiegeWave();
        }
      } else {
        siegeEmptyFieldTimer = 0;
      }

      if (siegeActive && siegeRunning && !siegeIsPaused) {

      // 👑 Boss 特殊 AI 狀態機與計時器更新
      if (currentBoss && siegeEnemies.includes(currentBoss)) {
        // A. 大型 Boss 第 1 型態：4-8 秒動態換字
        if (currentBoss.bossType === 'major' && currentBoss.form === 1) {
          currentBoss.wordTimer -= 1/60;
          if (currentBoss.wordTimer <= 0 && currentBoss.wordsQueue.length > 0) {
            currentBoss.word = currentBoss.wordsQueue[Math.floor(getSecureRandom() * currentBoss.wordsQueue.length)];
            currentBoss.wordTimer = 4 + getSecureRandom() * 4;
            currentBoss.typedIdx = 0;
            currentBoss.shake = 10;
            updateBossHUD();
          }
        }

        // B. 大型 Boss 第 2 型態：閃現與急速突襲
        if (currentBoss.bossType === 'major' && currentBoss.form === 2) {
          if (!currentBoss.isRushing) {
            // 隨機 1-3 秒閃現位移
            currentBoss.blinkTimer -= 1/60;
            if (currentBoss.blinkTimer <= 0) {
              // ★ 隨機閃現：保證 100% 在遊戲畫面邊界內且遠離小智！
              const bPos = getInBoundsBossHoverPos(cw, ch, currentBoss.radius);
              currentBoss.x = bPos.x;
              currentBoss.y = bPos.y;
              currentBoss.anchorX = bPos.x;
              currentBoss.anchorY = bPos.y;
              currentBoss.phase = getSecureRandom() * Math.PI * 2;
              currentBoss.blinkTimer = 1 + getSecureRandom() * 2;
            }

            // 5-10 秒突襲倒數
            currentBoss.attackTimer -= 1/60;
            if (currentBoss.attackTimer <= 0) {
              currentBoss.isRushing = true;
              currentBoss.speed = currentBoss.rushSpeed || 2.4; // 急速突襲(隨波次增長)
              if (typeof showPassToast === 'function') {
                showPassToast('⚠️ 耿鬼發動急速突襲！急速撞向小智！');
              }
            }
          }

        }

        // 👑 大型 Boss 在場期間（第 1 型態與第 2 型態），保持場上附帶普通寶可夢持續進場（數量隨波次增長）！
        if (currentBoss && currentBoss.bossType === 'major') {
          const majorTier = Math.max(0, Math.floor((siegeWave - 10) / 10));
          // 場上常駐普通怪獸底限：Wave 10 至少 3 隻，Wave 20 至少 5 隻，Wave 30 至少 7 隻，Wave 40+ 至少 9 隻
          const minActiveMinions = Math.min(10, 3 + majorTier * 2);
          const activeMinions = siegeEnemies.filter(m => !m.isBoss);
          if (activeMinions.length < minActiveMinions && !siegeIsSpawningSquad) {
            const spawnPt = getRectBoundarySpawnPoint(cw, ch, activeMinions.length, 4);
            const randWord = drawUniqueSiegeWord();
            const mTypes = ['gastly', 'haunter', 'gourgeist'];
            siegeEnemies.push({
              isBoss: false,
              word: randWord,
              x: spawnPt.x,
              y: spawnPt.y,
              speed: 0.28 + getSecureRandom() * 0.12,
              typedIdx: 0,
              radius: 30,
              shake: 0,
              monsterType: mTypes[Math.floor(getSecureRandom() * mTypes.length)],
              flightType: ['straight', 'sine_wobble', 'spiral', 'zigzag', 's_curve'][Math.floor(getSecureRandom() * 5)],
              phase: getSecureRandom() * Math.PI * 2,
              timer: 0,
              dir: getSecureRandom() < 0.5 ? 1 : -1
            });
          }
        }
      }

        siegeAnimId = requestAnimationFrame(tickSiege);
      }
    }

    function onSiegeGameOver() {
      siegeRunning = false;
      if (siegeAnimId) cancelAnimationFrame(siegeAnimId);
      if (siegeTimeInterval) clearInterval(siegeTimeInterval);

      let decayMult = 1.0;
      const isTeacherCheck = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
      if (typeof P6Mode !== 'undefined' && currentStudent) {
        decayMult = P6Mode.getScoreDecayMultiplier('siege', currentStudent.cls, currentStudent.num, isTeacherCheck);
      }
      const earned = Math.round(siegeScore * decayMult);

      if (currentStudent && earned > 0) {
        saveStudentStats(currentStudent.cls, currentStudent.num, earned, siegeKills > 0, 'siege');
        sendReliableWebhook({
          grade: 6,
          cls: currentStudent.cls,
          num: currentStudent.num,
          scoreDelta: earned,
          roundScore: earned,
          gameMode: 'siege',
          mode: 'siege',
          kills: siegeKills,
          level: siegeLevel,
          survSeconds: siegeSeconds,
          timestamp: new Date().toISOString()
        });
      }

      const overOverlay = document.getElementById('siege-over-overlay');
      if (overOverlay) {
        const totalAttempts = siegeKills + siegeMisses;
        const accuracy = totalAttempts > 0 ? Math.round((siegeKills / totalAttempts) * 100) : 100;
        const m = String(Math.floor(siegeSeconds / 60)).padStart(2, '0');
        const s = String(siegeSeconds % 60).padStart(2, '0');

        const waveEl = document.getElementById('siege-final-wave');
        const timeEl = document.getElementById('siege-final-time');
        const levelEl = document.getElementById('siege-final-level');
        const killsEl = document.getElementById('siege-final-kills');
        const movesEl = document.getElementById('siege-final-moves');
        const earnedEl = document.getElementById('siege-final-earned');
        const accEl = document.getElementById('siege-final-accuracy');

        if (waveEl) waveEl.textContent = `Wave ${siegeLevel}`;
        if (timeEl) timeEl.textContent = `${m}:${s}`;
        if (levelEl) levelEl.textContent = `Lv.${siegeLevel}`;
        if (killsEl) killsEl.textContent = `${siegeKills} 隻`;
        if (movesEl) movesEl.textContent = `${siegeLearnedMoves.length} 個`;
        if (earnedEl) earnedEl.textContent = `+${earned} 分`;
        if (accEl) accEl.textContent = `${accuracy}%`;

        overOverlay.style.display = 'flex';
      }
    }

    function restartSiegeMatch() {
      launchSiegeMatch();
      siegeStartGame();
    }

    function abortSiegeMatch() {
      if (siegeActive && siegeRunning) {
        onSiegeGameOver();
      }
      setGameMode('connected');
    }
// --- C. 精靈養成・樹果餵食進化 (真實寶可夢配圖 + 80+ 題目不重複洗牌隊列) ---
    let petActive = false;
    let petExp = 0;
    let petSatiety = 80;
    let petCurrentWord = null;
    let petInputKeys = [];
    let petScore = 0;
    let petStageIdx = 0;
    let petQuizQueue = []; // ★ 消除高度重複：不重複隨機題庫隊列

    const PET_STAGES = [
      { name: '🥚 寶可夢精靈蛋', img: 'images/pokemon_egg.jpg', reqExp: 30, sound: '🥚' },
      { name: '🐣 皮丘 (幼年期)',   img: 'images/pokemon_pichu.jpg', reqExp: 80, sound: '⚡ 皮丘！' },
      { name: '⚡ 皮卡丘 (成長期)', img: 'images/pokemon_pikachu.jpg', reqExp: 200, sound: '⚡ 皮卡！皮卡丘！' },
      { name: '⚡ 雷丘 (成熟期)',   img: 'images/pokemon_raichu.jpg', reqExp: 450, sound: '⚡ 雷丘雷！' },
      { name: '👑 創世阿爾宙斯 (傳說神級)', img: 'images/pokemon_arceus.jpg', reqExp: 99999, sound: '🌌 創世神光！' }
    ];

    function launchPetMatch() {
      petActive = true;
      petScore = 0;
      petInputKeys = [];
      petQuizQueue = []; // 每次開局洗牌

      const stuCls = currentStudent ? currentStudent.cls : 'p6';
      const stuNum = currentStudent ? currentStudent.num : '01';
      const localExp = parseInt(SafeStorage.getItem(`p6_pet_exp_${stuCls}_${stuNum}`) || '0', 10);
      petExp = localExp;

      updatePetEvolutionDisplay();
      loadPetNextWord();
      window.removeEventListener('keydown', handlePetKeydown, true);
      window.addEventListener('keydown', handlePetKeydown, true);
    }

    function updatePetEvolutionDisplay() {
      let stage = 0;
      if (petExp >= 450) stage = 4;
      else if (petExp >= 200) stage = 3;
      else if (petExp >= 80) stage = 2;
      else if (petExp >= 30) stage = 1;
      petStageIdx = stage;

      const cur = PET_STAGES[stage];
      const nextExp = cur.reqExp;

      const imgEl = document.getElementById('pet-main-img');
      if (imgEl) imgEl.src = cur.img;

      const stageNameEl = document.getElementById('pet-stage-name');
      if (stageNameEl) stageNameEl.textContent = cur.name;

      const expEl = document.getElementById('pet-exp-val');
      if (expEl) expEl.textContent = `${petExp} / ${nextExp === 99999 ? 'MAX' : nextExp}`;

      for (let i = 1; i <= 5; i++) {
        const card = document.getElementById(`evo-card-${i}`);
        if (card) {
          if (i - 1 === stage) card.classList.add('active');
          else card.classList.remove('active');
        }
      }
    }

    // ★ 問題 2 核心修復：擴充至 80+ 題庫池，採用洗牌隊列逐一彈出，徹底消除題目高度重複！
    function loadPetNextWord() {
      if (!petQuizQueue || petQuizQueue.length === 0) {
        let pool = [];
        if (typeof DATA !== 'undefined') {
          if (DATA.omit_words) pool = pool.concat(DATA.omit_words);
          if (DATA.feature_words) pool = pool.concat(DATA.feature_words);
          if (DATA.abbrev_words) pool = pool.concat(DATA.abbrev_words);
          if (DATA.connected_words) pool = pool.concat(DATA.connected_words.slice(0, 35));
        }
        // 去重
        const seen = new Set();
        const uniquePool = [];
        pool.forEach(w => {
          if (w && w.char && !seen.has(w.char)) {
            seen.add(w.char);
            uniquePool.push(w);
          }
        });
        petQuizQueue = fisherYatesShuffle(uniquePool);
      }

      petCurrentWord = petQuizQueue.pop();
      petInputKeys = [];

      const targetCharEl = document.getElementById('pet-target-char');
      if (targetCharEl) targetCharEl.textContent = petCurrentWord.char;
      renderPetSlots();
    }

    function renderPetSlots() {
      const container = document.getElementById('pet-slots-row');
      if (!container || !petCurrentWord) return;

      const keys = petCurrentWord.keys || [];
      let html = '';
      keys.forEach((k, idx) => {
        const isFilled = idx < petInputKeys.length;
        html += `
          <div class="code-slot ${isFilled ? 'filled' : ''}">
            <div class="code-slot-label">${idx === 0 ? '①首碼' : (idx === keys.length - 1 ? '④尾碼' : '碼' + (idx+1))}</div>
            <div class="code-slot-val">${isFilled ? petCurrentWord.codes[idx] : '？'}</div>
          </div>
        `;
      });
      container.innerHTML = html;

      const bannerEl = document.getElementById('scoring-note-banner');
      if (bannerEl && typeof P6Mode !== 'undefined') {
        const stuCls = currentStudent ? currentStudent.cls : 'p6';
        const stuNum = currentStudent ? currentStudent.num : '01';
        const isTeacherCheck = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
        try {
          const isAllUnlocked = P6Mode.isMainLineFullyUnlocked(stuCls, stuNum, isTeacherCheck);
          if (isAllUnlocked) {
            bannerEl.style.background = '#ECFDF5';
            bannerEl.style.borderColor = '#A7F3D0';
            bannerEl.style.color = '#065F46';
            bannerEl.innerHTML = `🎉 <strong>主線全解鎖特權已啟動！</strong>第 3 站【逃出恐怖屋】(基礎分×1.2)、第 5 站【道館生存】(基礎分×1.5 疊加連擊加成) 全面解除限制，按原設定正常無限獲取積分！其他前置站次維持每日次數衰減規則。`;
          } else {
            bannerEl.style.background = '#FFFBEB';
            bannerEl.style.borderColor = '#FDE68A';
            bannerEl.style.color = '#B45309';
            bannerEl.innerHTML = `📖 <strong>計分規則</strong>：主線未全解時，前置關卡按防刷分規則計分（第 1 次全額，第 2 次一半，第 3 次四分之一，第 4 次起為練習不加分）；當主線全解時，只有第 3 站【逃出恐怖屋】與第 5 站【道館生存】解除限制並按原設定無限獲取積分！其他前置站次維持每日次數衰減規則。`;
          }
        } catch(e) {
          console.warn("P6Mode banner error handled:", e);
        }
      }
    }

    function handlePetKeydown(e) {
      if (currentGameMode !== 'pet') return;
      if (!petActive || !petCurrentWord) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      let key = '';
      if (e.code && e.code.startsWith('Key') && e.code.length === 4) {
        key = e.code.slice(3).toUpperCase();
      } else if (e.key && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        key = e.key.toUpperCase();
      } else if (e.keyCode && e.keyCode >= 65 && e.keyCode <= 90) {
        key = String.fromCharCode(e.keyCode).toUpperCase();
      }

      if (!key || key < 'A' || key > 'Z') return;
      e.preventDefault();
      e.stopPropagation();

      const neededIdx = petInputKeys.length;
      const targetKeys = petCurrentWord.keys || [];

      if (targetKeys[neededIdx] === key) {
        petInputKeys.push(key);
        renderPetSlots();

        if (petInputKeys.length === targetKeys.length) {
          onPetFeedSuccess();
        }
      } else {
        const img = document.getElementById('pet-main-img');
        if (img) {
          img.style.animation = 'none';
          img.offsetHeight;
          img.style.animation = 'wrongShake 0.4s ease';
        }
        const bubble = document.getElementById('pet-speech-bubble');
        if (bubble) bubble.textContent = '「嗚... 樹果口味好像不對～再試試！🫐」';
      }
    }

    function onPetFeedSuccess() {
      const gainedExp = 5 + (petCurrentWord.codes.length * 2);
      petExp += gainedExp;
      petScore += 15;

      if (currentStudent) {
        SafeStorage.setItem(`p6_pet_exp_${currentStudent.cls}_${currentStudent.num}`, String(petExp));
      }

      const bubble = document.getElementById('pet-speech-bubble');
      if (bubble) bubble.textContent = `「美味！獲得 +${gainedExp} EXP！好開心！🍎」`;
      burstConfetti();

      const oldStage = petStageIdx;
      updatePetEvolutionDisplay();
      if (petStageIdx > oldStage) {
        showPassToast(`🎉 恭喜！你的寶可夢夥伴進化為【${PET_STAGES[petStageIdx].name}】！`);
      }

      setTimeout(loadPetNextWord, 600);
    }

    function abortPetMatch() {
      petActive = false;
      window.removeEventListener('keydown', handlePetKeydown, true);

      let decayMult = 1.0;
      const isTeacherCheck = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
      if (typeof P6Mode !== 'undefined' && currentStudent) {
        decayMult = P6Mode.getScoreDecayMultiplier('pet', currentStudent.cls, currentStudent.num, isTeacherCheck);
      }
      let finalPetScore = Math.round(petScore * decayMult);

      if (currentStudent && finalPetScore > 0) {
        saveStudentStats(currentStudent.cls, currentStudent.num, finalPetScore, false, 'pet');
        sendReliableWebhook({
          studentClass: currentStudent.cls,
          studentNum: currentStudent.num,
          scoreDelta: finalPetScore,
          mode: 'pet',
          exp: petExp
        });
      }
      if (typeof P6Mode !== 'undefined' && currentStudent) {
        P6Mode.incrementDailyStationPlayCount('pet', currentStudent.cls, currentStudent.num);
      }
      setGameMode('connected');
      renderModeTabs();
    }
    // --- D. 極限對決・道館 5 條命生存戰 (道館打擊音效 + 視覺暴擊 + 空白鍵送出 + 成績結算彈窗) ---
    let survActive = false;
    let survLives = 5;
    let survCombo = 0;
    let survMaxCombo = 0;
    let survScore = 0;
    let survCorrectCount = 0;
    let survCurrentWord = null;
    let survInputKeys = [];
    let survWordReadyForSpace = false;
    let survComboTimer = null;
    let survSeconds = 0;
    let survTimeInterval = null;

    // 🎵 寶可夢對戰合成音效核心 (Web Audio API，純原生物理發聲，零外部音檔依賴)
    let audioCtx = null;
    function playPokemonCombatSfx(type) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'hit') {
          // 敲擊字碼命中音：清脆電氣進階音
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(580, t);
          osc.frequency.exponentialRampToValueAtTime(840, t + 0.07);
          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
          osc.start(t);
          osc.stop(t + 0.07);
        } else if (type === 'critical_gym') {
          // 道館對戰擊破音：沉重震撼暴擊
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(320, t);
          osc.frequency.exponentialRampToValueAtTime(780, t + 0.12);
          gain.gain.setValueAtTime(0.3, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
          osc.start(t);
          osc.stop(t + 0.22);

          // 疊加金屬和弦
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(880, t);
          osc2.frequency.exponentialRampToValueAtTime(440, t + 0.25);
          gain2.gain.setValueAtTime(0.2, t);
          gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
          osc2.start(t);
          osc2.stop(t + 0.25);
        } else if (type === 'miss') {
          // 敲錯音：低頻警示蜂鳴
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(140, t);
          osc.frequency.setValueAtTime(110, t + 0.08);
          gain.gain.setValueAtTime(0.22, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
          osc.start(t);
          osc.stop(t + 0.18);
        }
      } catch(e) {
        console.warn('Audio play error:', e);
      }
    }

    // 💥 寶可夢道館浮動戰鬥打擊文字特效
    function triggerSurvCombatImpact(badgeText) {
      const container = document.getElementById('surv-impact-container');
      if (!container) return;

      const floatEl = document.createElement('div');
      floatEl.className = 'battle-impact-text';
      floatEl.innerHTML = badgeText;
      container.appendChild(floatEl);

      setTimeout(() => {
        if (floatEl.parentNode) floatEl.parentNode.removeChild(floatEl);
      }, 750);
    }

    function returnToSurvivalReadyStage() {
      survActive = false;
      if (survComboTimer) clearTimeout(survComboTimer);
      if (survTimeInterval) clearInterval(survTimeInterval);
      window.removeEventListener('keydown', handleSurvKeydown, true);

      const readyStage = document.getElementById('survival-ready-stage');
      const mainStage = document.getElementById('survival-main-stage');
      const overOverlay = document.getElementById('survival-over-overlay');
      if (readyStage) readyStage.style.display = 'block';
      if (mainStage) mainStage.style.display = 'none';
      if (overOverlay) overOverlay.style.display = 'none';

      window.addEventListener('keydown', handleSurvKeydown, true);
    }

    function abortSurvivalToReady() {
      survActive = false;
      if (survComboTimer) clearTimeout(survComboTimer);
      if (survTimeInterval) clearInterval(survTimeInterval);
      returnToSurvivalReadyStage();
    }

    function restartSurvivalMatch() {
      const overOverlay = document.getElementById('survival-over-overlay');
      if (overOverlay) overOverlay.style.display = 'none';
      launchSurvivalMatch();
    }

    function launchSurvivalMatch() {
      if (survComboTimer) clearTimeout(survComboTimer);
      if (survTimeInterval) clearInterval(survTimeInterval);
      window.removeEventListener('keydown', handleSurvKeydown, true);

      const readyStage = document.getElementById('survival-ready-stage');
      const mainStage = document.getElementById('survival-main-stage');
      const overOverlay = document.getElementById('survival-over-overlay');
      if (readyStage) readyStage.style.display = 'none';
      if (mainStage) mainStage.style.display = 'block';
      if (overOverlay) overOverlay.style.display = 'none';

      survActive = true;
      survLives = 5;
      survCombo = 0;
      survMaxCombo = 0;
      survScore = 0;
      survCorrectCount = 0;
      survSeconds = 0;
      survInputKeys = [];
      survWordReadyForSpace = false;

      updateSurvivalHearts();
      updateSurvivalComboDisplay();
      updateSurvTimerDisplay();

      survTimeInterval = setInterval(() => {
        if (survActive) {
          survSeconds++;
          updateSurvTimerDisplay();
        }
      }, 1000);

      loadSurvNextWord();
      window.addEventListener('keydown', handleSurvKeydown, true);
    }

    function updateSurvTimerDisplay() {
      const timerEl = document.getElementById('surv-timer-val');
      if (timerEl) {
        const m = String(Math.floor(survSeconds / 60)).padStart(2, '0');
        const s = String(survSeconds % 60).padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
      }
    }

    function updateSurvivalHearts() {
      for (let i = 1; i <= 5; i++) {
        const h = document.getElementById(`heart-${i}`);
        if (h) {
          if (i <= survLives) {
            h.classList.remove('lost');
            h.textContent = '❤️';
          } else {
            h.classList.add('lost');
            h.textContent = '🖤';
          }
        }
      }
    }

    function updateSurvivalComboDisplay() {
      let mult = 1.0;
      if (survCombo >= 20) mult = 3.0;
      else if (survCombo >= 10) mult = 2.0;
      else if (survCombo >= 5) mult = 1.5;

      const comboEl = document.getElementById('surv-combo-box');
      if (comboEl) {
        comboEl.textContent = `連擊：${survCombo} Hit 🔥 (${mult.toFixed(1)}x)`;
      }
    }

    function resetSurvComboCountdown() {
      if (survComboTimer) clearTimeout(survComboTimer);
      survComboTimer = setTimeout(() => {
        if (survActive && survCombo > 0) {
          survCombo = 0;
          updateSurvivalComboDisplay();
          if (typeof showSkillToast === 'function') {
            showSkillToast('⌛ 6 秒超時！連擊歸零', '⌛');
          }
        }
      }, 6000);
    }

    // ★ 道館生存戰專屬「非重覆大牌堆」與歷史防重緩衝區 (全面串接全週次與全分類 686 字庫)
    let survWordDeck = [];
    let survWordHistory = [];

    function getCompleteSurvivalWordPool() {
      let pool = [];
      const weekly = (typeof window !== 'undefined' && window.MODE2_WEEKLY_BANKS) 
        ? window.MODE2_WEEKLY_BANKS 
        : (typeof MODE2_WEEKLY_BANKS !== 'undefined' ? MODE2_WEEKLY_BANKS : {});
      const cloud = (typeof window !== 'undefined' && window.CLOUD_WEEKLY_BANKS)
        ? window.CLOUD_WEEKLY_BANKS
        : (typeof CLOUD_WEEKLY_BANKS !== 'undefined' ? CLOUD_WEEKLY_BANKS : {});

      Object.keys(weekly).forEach(k => {
        if (weekly[k] && Array.isArray(weekly[k].words)) pool = pool.concat(weekly[k].words);
      });
      Object.keys(cloud).forEach(k => {
        if (cloud[k] && Array.isArray(cloud[k].words)) pool = pool.concat(cloud[k].words);
      });
      if (typeof DATA !== 'undefined') {
        if (DATA.connected_words) pool = pool.concat(DATA.connected_words);
        if (DATA.feature_words) pool = pool.concat(DATA.feature_words);
        if (DATA.split_words) pool = pool.concat(DATA.split_words);
        if (DATA.abbrev_words) pool = pool.concat(DATA.abbrev_words);
        if (DATA.difficult_words) pool = pool.concat(DATA.difficult_words);
      }

      // 嚴格去重與標準化校準
      const seen = new Set();
      const unique = [];
      pool.forEach(item => {
        if (item && item.char) {
          if (!item.keys && item.prefix_keys && item.body_keys) {
            item.keys = item.prefix_keys.concat(item.body_keys);
          }
          if (!item.codes && item.prefix_codes && item.body_codes) {
            item.codes = item.prefix_codes.concat(item.body_codes);
          }
          if (!seen.has(item.char)) {
            seen.add(item.char);
            // ★ SSOT 原則：若題庫本身已有設定好的 codes 與 keys（來自《2026每周打字字庫表》），嚴格保留真值，絕不覆蓋！
            if ((!item.keys || item.keys.length === 0 || item.keys.includes('?')) && typeof MASTER_CJ3_DICT !== 'undefined' && MASTER_CJ3_DICT[item.char]) {
              const canon = MASTER_CJ3_DICT[item.char];
              item.codes = canon.codes.slice();
              item.keys = canon.keys.slice();
              item.full = canon.full;
            }
            unique.push(item);
          }
        }
      });
      return unique;
    }

    function loadSurvNextWord() {
      if (!survWordDeck || survWordDeck.length === 0) {
        const fullPool = getCompleteSurvivalWordPool();
        survWordDeck = secureFisherYatesShuffle(fullPool);
      }
      if (!survWordDeck || survWordDeck.length === 0) return;

      // 防連續重覆：排除最近 40 次已出現字根
      let chosen = null;
      let checked = 0;
      while (survWordDeck.length > 0 && checked < survWordDeck.length) {
        const candidate = survWordDeck.pop();
        checked++;
        if (!candidate || !candidate.char) continue;
        if (survWordHistory.includes(candidate.char) && survWordDeck.length > 10) {
          survWordDeck.unshift(candidate);
          continue;
        }
        chosen = candidate;
        break;
      }
      if (!chosen) chosen = survWordDeck.pop() || { char: '道', codes: ['卜', '竹', '尸', '山'], keys: ['Y', 'H', 'S', 'U'] };

      survWordHistory.push(chosen.char);
      if (survWordHistory.length > 40) survWordHistory.shift();

      survCurrentWord = chosen;
      survInputKeys = [];
      survWordReadyForSpace = false;

      const promptEl = document.getElementById('surv-space-prompt');
      if (promptEl) promptEl.style.display = 'none';

      const targetEl = document.getElementById('surv-target-char');
      if (targetEl) targetEl.textContent = survCurrentWord.char;

      renderSurvSlots();
      resetSurvComboCountdown();
    }

    function renderSurvSlots() {
      const container = document.getElementById('surv-slots-row');
      if (!container || !survCurrentWord) return;

      const keys = survCurrentWord.keys || [];
      let html = '';
      keys.forEach((k, idx) => {
        const isFilled = idx < survInputKeys.length;
        html += `
          <div class="code-slot ${isFilled ? 'filled' : ''}">
            <div class="code-slot-label">${idx === 0 ? '首碼' : (idx === keys.length - 1 ? '尾碼' : '碼' + (idx+1))}</div>
            <div class="code-slot-val">${isFilled ? survCurrentWord.codes[idx] : '？'}</div>
          </div>
        `;
      });
      container.innerHTML = html;
    }

    // ★ 核心修復：嚴格即時比對按鍵（絕無 I 鍵盲顯作弊）+ 道館打擊音效與暴擊動效
    function handleSurvKeydown(e) {
      if (currentGameMode !== 'survival') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const readyStage = document.getElementById('survival-ready-stage');
      if (readyStage && readyStage.style.display !== 'none') {
        if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32 || e.code === 'Enter' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          launchSurvivalMatch();
        }
        return;
      }

      if (!survActive || !survCurrentWord) return;

      // 1. 按空白鍵 (Space) 送出
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        e.stopPropagation();

        const targetKeys = survCurrentWord.keys || [];
        if (survInputKeys.length < targetKeys.length) {
          playPokemonCombatSfx('miss');
          const targetEl = document.getElementById('surv-target-char');
          if (targetEl) {
            targetEl.classList.add('shake-error');
            setTimeout(() => targetEl.classList.remove('shake-error'), 400);
          }
          return;
        }

        // 全碼輸入正確，觸發道館打擊音效與暴擊文字特效
        playPokemonCombatSfx('critical_gym');

        survCorrectCount++;
        survCombo++;
        survMaxCombo = Math.max(survMaxCombo, survCombo);
        document.getElementById('surv-correct-val').textContent = String(survCorrectCount);

        let mult = 1.0;
        if (survCombo >= 20) mult = 3.0;
        else if (survCombo >= 10) mult = 2.0;
        else if (survCombo >= 5) mult = 1.5;

        const pts = Math.round(15 * 1.5 * mult);
        survScore += pts;

        // 道館暴擊打擊動態浮字
        const impacts = [
          `⚡ CRITICAL HIT! +${pts}`,
          `🔥 效果絕佳！ +${pts}`,
          `🏆 道館會心一擊！ +${pts}`,
          `⚡ GYM STRIKE! +${pts}`
        ];
        triggerSurvCombatImpact(impacts[Math.floor(Math.random() * impacts.length)]);

        updateSurvivalComboDisplay();

        const promptEl = document.getElementById('surv-space-prompt');
        if (promptEl) promptEl.style.display = 'none';

        setTimeout(loadSurvNextWord, 350);
        return;
      }

      // 2. Backspace 退回上一碼
      if (e.code === 'Backspace' || e.key === 'Backspace' || e.keyCode === 8) {
        e.preventDefault();
        e.stopPropagation();
        if (survInputKeys.length > 0) {
          survInputKeys.pop();
          survWordReadyForSpace = false;
          const promptEl = document.getElementById('surv-space-prompt');
          if (promptEl) promptEl.style.display = 'none';
          renderSurvSlots();
        }
        return;
      }

      // 3. 攔截字母 A ~ Z (徹底免疫中文輸入法)
      let key = '';
      if (e.code && e.code.startsWith('Key') && e.code.length === 4) {
        key = e.code.slice(3).toUpperCase();
      } else if (e.key && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        key = e.key.toUpperCase();
      } else if (e.keyCode && e.keyCode >= 65 && e.keyCode <= 90) {
        key = String.fromCharCode(e.keyCode).toUpperCase();
      }

      if (!key || key < 'A' || key > 'Z') return;
      e.preventDefault();
      e.stopPropagation();

      const targetKeys = survCurrentWord.keys || [];

      // 若已填滿所有字碼，若玩家「仍繼續敲鍵」，才出現按空白鍵的提示 (問題 3)
      if (survInputKeys.length >= targetKeys.length) {
        const promptEl = document.getElementById('surv-space-prompt');
        if (promptEl) {
          promptEl.style.display = 'inline-block';
          promptEl.classList.add('shake-error');
          setTimeout(() => promptEl.classList.remove('shake-error'), 400);
        }
        return;
      }

      // 嚴格即時比對：必須與當前字碼相符！
      const neededIdx = survInputKeys.length;
      if (key === targetKeys[neededIdx]) {
        // 敲對字根碼：播放清脆打擊音效
        playPokemonCombatSfx('hit');
        survInputKeys.push(key);
        renderSurvSlots();
        resetSurvComboCountdown();

        if (survInputKeys.length === targetKeys.length) {
          survWordReadyForSpace = true;
        }
      } else {
        // 按錯扣命、打斷連擊、播放錯誤低音！
        playPokemonCombatSfx('miss');
        survLives = Math.max(0, survLives - 1);
        survCombo = 0;
        updateSurvivalHearts();
        updateSurvivalComboDisplay();

        const targetEl = document.getElementById('surv-target-char');
        if (targetEl) {
          targetEl.classList.add('shake-error');
          setTimeout(() => targetEl.classList.remove('shake-error'), 400);
        }

        if (survLives <= 0) {
          onSurvivalMatchFinish();
        }
      }
    }

    function onSurvivalMatchFinish() {
      survActive = false;
      if (survComboTimer) clearTimeout(survComboTimer);
      if (survTimeInterval) clearInterval(survTimeInterval);
      window.removeEventListener('keydown', handleSurvKeydown, true);

      let decayMult = 1.0;
      const isTeacherCheck = (typeof isTeacherMode !== 'undefined' && isTeacherMode);
      if (typeof P6Mode !== 'undefined' && currentStudent) {
        decayMult = P6Mode.getScoreDecayMultiplier('survival', currentStudent.cls, currentStudent.num, isTeacherCheck);
      }
      let finalSurvScore = Math.round(survScore * decayMult);

      if (currentStudent && finalSurvScore > 0) {
        saveStudentStats(currentStudent.cls, currentStudent.num, finalSurvScore, false, 'survival');
        sendReliableWebhook({
          studentClass: currentStudent.cls,
          studentNum: currentStudent.num,
          scoreDelta: finalSurvScore,
          mode: 'survival',
          correct: survCorrectCount,
          maxCombo: survMaxCombo,
          survSeconds: survSeconds
        });
      }
      if (typeof P6Mode !== 'undefined' && currentStudent) {
        P6Mode.incrementDailyStationPlayCount('survival', currentStudent.cls, currentStudent.num);
      }

      const overOverlay = document.getElementById('survival-over-overlay');
      if (overOverlay) {
        const m = String(Math.floor(survSeconds / 60)).padStart(2, '0');
        const s = String(survSeconds % 60).padStart(2, '0');
        const timeEl = document.getElementById('surv-final-time');
        const corrEl = document.getElementById('surv-final-correct');
        const comboEl = document.getElementById('surv-final-combo');
        const earnedEl = document.getElementById('surv-final-earned');
        const accEl = document.getElementById('surv-final-accuracy');

        if (timeEl) timeEl.textContent = `${m}:${s}`;
        if (corrEl) corrEl.textContent = `${survCorrectCount} 字`;
        if (comboEl) comboEl.textContent = `${survMaxCombo} Hit`;
        if (earnedEl) earnedEl.textContent = `+${finalSurvScore} 分`;
        if (accEl) {
          const totalAttempts = survCorrectCount + (5 - survLives);
          const acc = totalAttempts > 0 ? Math.round((survCorrectCount / totalAttempts) * 100) : 100;
          accEl.textContent = `${acc}%`;
        }
        overOverlay.style.display = 'flex';
      }
    }

    function abortSurvivalMatch() {
      if (survActive) abortSurvivalToReady();
      else setGameMode('connected');
    }

    // ★ 防作弊背景執行引擎：學生切換至其他分頁查字碼時，遊戲背景持續運行！怪獸持續逼近衝擊結界！
    let siegeBgHeartbeatInterval = null;
    let siegeLastFrameTimestamp = performance.now();

    function runSiegeBackgroundPhysics() {
      if (!siegeActive || !siegeRunning || siegeIsPaused || siegeHp <= 0) {
        if (siegeBgHeartbeatInterval) {
          clearInterval(siegeBgHeartbeatInterval);
          siegeBgHeartbeatInterval = null;
        }
        return;
      }

      const now = performance.now();
      const dt = Math.min(2.0, Math.max(0.016, (now - siegeLastFrameTimestamp) / 1000));
      siegeLastFrameTimestamp = now;

      const canvas = document.getElementById('siege-canvas');
      const cw = canvas ? canvas.width : 800;
      const ch = canvas ? canvas.height : 420;
      const cx = cw / 2;
      const cy = ch / 2;

      // 在背景中推進所有在場怪獸位置
      const speedFactor = dt * 60; // 等效 60fps 幀乘數
      for (let i = siegeEnemies.length - 1; i >= 0; i--) {
        const em = siegeEnemies[i];
        const edx = cx - em.x;
        const edy = cy - em.y;
        const dist = Math.hypot(edx, edy);

        if (dist > 1) {
          const ux = edx / dist;
          const uy = edy / dist;
          em.x += ux * em.speed * speedFactor;
          em.y += uy * em.speed * speedFactor;
        }

        // 碰撞結界判定 (dist <= 42)
        const hitDist = em.isBoss ? (38 + em.radius * 0.65) : 42;
        if (dist <= hitDist) {
          // 護盾或扣血
          const dmg = em.isBoss ? 25 : 10;
          if (siegeBarrierShieldCount > 0) {
            siegeBarrierShieldCount--;
          } else {
            siegeHp = Math.max(0, siegeHp - dmg);
          }
          // 普通怪獸碰撞後消散，Boss 彈回外圍
          if (!em.isBoss) {
            siegeEnemies.splice(i, 1);
          } else {
            const ang = getSecureRandom() * Math.PI * 2;
            em.x = cx + Math.cos(ang) * 280;
            em.y = cy + Math.sin(ang) * 280;
          }
          updateSiegeHUD();

          if (siegeHp <= 0) {
            onSiegeGameOver();
            if (siegeBgHeartbeatInterval) {
              clearInterval(siegeBgHeartbeatInterval);
              siegeBgHeartbeatInterval = null;
            }
            return;
          }
        }
      }
    }

    // 監聽網頁分頁切換與失焦事件
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          // 學生切換分頁：啟動背景每 100ms 物理心跳，怪獸持續進攻！
          if (siegeActive && siegeRunning && !siegeIsPaused && siegeHp > 0) {
            siegeLastFrameTimestamp = performance.now();
            if (!siegeBgHeartbeatInterval) {
              siegeBgHeartbeatInterval = setInterval(runSiegeBackgroundPhysics, 100);
            }
          }
        } else {
          // 學生切換回遊戲分頁：停止背景心跳，補償最後物理運算，恢復主動畫迴圈
          if (siegeBgHeartbeatInterval) {
            clearInterval(siegeBgHeartbeatInterval);
            siegeBgHeartbeatInterval = null;
          }
          if (siegeActive && siegeRunning && !siegeIsPaused) {
            runSiegeBackgroundPhysics();
            resumeSiegeLoop();
          }
        }
      });

      window.addEventListener('blur', function() {
        if (siegeActive && siegeRunning && !siegeIsPaused && siegeHp > 0) {
          siegeLastFrameTimestamp = performance.now();
          if (!siegeBgHeartbeatInterval) {
            siegeBgHeartbeatInterval = setInterval(runSiegeBackgroundPhysics, 100);
          }
        }
      });

      window.addEventListener('focus', function() {
        if (siegeBgHeartbeatInterval) {
          clearInterval(siegeBgHeartbeatInterval);
          siegeBgHeartbeatInterval = null;
        }
        if (siegeActive && siegeRunning && !siegeIsPaused) {
          runSiegeBackgroundPhysics();
          resumeSiegeLoop();
        }
      });
    }
