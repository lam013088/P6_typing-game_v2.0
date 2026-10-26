/**
 * ==============================================================================
 * 🎮 MODES.JS - 六年級寶可夢倉頡打字聯賽 · 模式註冊表與每日階梯式解鎖鏈
 * ==============================================================================
 */

(function(root) {
  'use strict';

  var P6_MODES = [
    {
      id: 'connected',
      line: 'main',
      order: 1,
      circle: '1',
      icon: '⚔️',
      name: '連體字全碼突破',
      short: '連體突破',
      badge: '1~4碼連擊',
      color: '#2563EB',
      pool: 'connected_words',
      mult: 1.0,
      completeAt: 150,
      note: '【第 1 站】在野生原野捕捉精靈球發動進攻 · 每日得滿 150 分解鎖下一關'
    },
    {
      id: 'feature',
      line: 'main',
      order: 2,
      circle: '2',
      icon: '🕵️',
      name: '字形神探',
      short: '字形神探',
      badge: '字形特徵原則',
      color: '#0D9488',
      pool: 'feature_words',
      mult: 1.1,
      completeAt: 200,
      note: '【第 2 站】包含、交錯、連貫特徵原則特訓 · 每日得滿 200 分解鎖下一關'
    },
    {
      id: 'siege',
      line: 'main',
      order: 3,
      circle: '3',
      icon: '🧙',
      name: '逃出恐怖屋',
      short: '逃出恐怖屋',
      badge: '字靈倖存者',
      color: '#7C3AED',
      pool: 'abbrev_words',
      mult: 1.2,
      completeAt: 250,
      note: '【第 3 站】幽靈寶可夢字靈湧向中央法陣，敲出全碼擊破 · 每日得滿 250 分解鎖下一關'
    },
    {
      id: 'pet',
      line: 'main',
      order: 4,
      circle: '4',
      icon: '🐣',
      name: '倉頡寵物',
      short: '倉頡寵物',
      badge: '養成進化',
      color: '#EC4899',
      pool: 'omit_words',
      mult: 1.0,
      completeAt: 300,
      note: '【第 4 站】打對字餵食樹果累積 EXP，伴隨寶可夢進化 · 每日得滿 300 分解鎖下一關'
    },
    {
      id: 'survival',
      line: 'main',
      order: 5,
      circle: '5',
      icon: '💀',
      name: '倉頡生存挑戰',
      short: '生存挑戰',
      badge: '5條命 連擊倍率',
      color: '#DC2626',
      pool: 'connected_words',
      mult: 1.5,
      completeAt: 350,
      note: '【第 5 站】開局 5 條命，打錯扣命，連擊加倍 (最高3x) · 每日得滿 350 分解鎖下一關'
    },
    {
      id: 'special',
      line: 'main',
      order: 6,
      circle: '6',
      icon: '🔮',
      name: '難字與複合字特訓',
      short: '難字特訓',
      badge: 'X難字/複合',
      color: '#D97706',
      pool: 'special_words',
      mult: 1.3,
      completeAt: 400,
      note: '【第 6 站】官方三代倉頡 X 難字與 9 大複合字 · 每日得滿 400 分通關全主線'
    },
    {
      id: 'speed',
      line: 'challenge',
      order: 7,
      circle: '挑戰',
      icon: '⚡',
      name: '倉頡極速刷分手速賽',
      short: '手速賽',
      badge: '10字 極速秒數天梯',
      color: '#0284C7',
      pool: 'w7_hw1',
      mult: 1.0,
      completeAt: 0,
      note: '【挑戰天梯】純 10 字秒數競爭，二次方準確率加權罰時 · 常駐開放'
    }
  ];

  var P6Mode = {
    all: function() { return P6_MODES; },
    get: function(id) {
      for (var i = 0; i < P6_MODES.length; i++) {
        if (P6_MODES[i].id === id) return P6_MODES[i];
      }
      return P6_MODES[0];
    },
    mainSequence: function() {
      return P6_MODES.filter(function(m) { return m.line === 'main'; });
    },
    getTodayDateStr: function() {
      var d = new Date();
      var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      var nd = new Date(utc + (3600000 * 8));
      var y = nd.getFullYear();
      var m = ('0' + (nd.getMonth() + 1)).slice(-2);
      var day = ('0' + nd.getDate()).slice(-2);
      return y + '-' + m + '-' + day;
    },
                reconcileWithCloud: function(cls, num) {
      if (!cls || !num) return 0;
      var today = this.getTodayDateStr();
      var key = 'p6_daily_score_' + today + '_' + cls + '_' + num;
      var localScore = 0;
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.getItem) {
          var val = SafeStorage.getItem(key);
          if (val) localScore = parseInt(val, 10) || 0;
        }
      } catch(e) {}

      // 🛡️ 核心原則：只有在動態連線雲端 (isCloudOnline) 時才採信雲端下發之當日得分
      var isOnline = (typeof isCloudOnline !== 'undefined' && isCloudOnline);
      var cloudDailyScore = 0;
      var hasCloudData = false;
      try {
        var cloudList = null;
        if (typeof DATA !== 'undefined' && Array.isArray(DATA.benchmark_leaderboard) && DATA.benchmark_leaderboard.length > 0) {
          cloudList = DATA.benchmark_leaderboard;
        } else if (typeof window !== 'undefined' && window.DATA && Array.isArray(window.DATA.benchmark_leaderboard)) {
          cloudList = window.DATA.benchmark_leaderboard;
        }

        if (isOnline && cloudList && cloudList.length > 0) {
          var padNum = parseInt(num, 10);
          var match = cloudList.find(function(item) {
            return item.cls === cls && parseInt(item.num, 10) === padNum;
          });
          if (match && typeof match.todayScore === 'number') {
            cloudDailyScore = Math.max(0, match.todayScore);
            hasCloudData = true;
          }
        }
      } catch(e) {}

      var finalScore = localScore;
      if (hasCloudData) {
        // 檢查該生今日在本機是否有真實遊玩通關次數
        var localPlaysToday = 0;
        var modeIds = ['connected', 'detective', 'siege', 'pet', 'survival', 'difficult', 'speed'];
        for (var mi = 0; mi < modeIds.length; mi++) {
          localPlaysToday += this.getDailyStationPlayCount(modeIds[mi], cls, num);
        }

        // 若雲端確認今日為 0 分，且本機今日亦無任何遊玩記錄，則強制清除本地殘留污染歸零
        if (cloudDailyScore === 0 && localPlaysToday === 0) {
          finalScore = 0;
          try {
            if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
              SafeStorage.setItem(key, '0');
            }
          } catch(e) {}
        } else {
          finalScore = Math.max(localScore, cloudDailyScore);
          if (finalScore !== localScore) {
            try {
              if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
                SafeStorage.setItem(key, String(finalScore));
              }
            } catch(e) {}
          }
        }
      }
      return finalScore;
    },
    getDailyEarnedScore: function(cls, num) {
      return this.reconcileWithCloud(cls, num);
    },
    addDailyEarnedScore: function(cls, num, pts) {
      if (!cls || !num || !pts) return 0;
      var current = this.getDailyEarnedScore(cls, num);
      var updated = current + Math.max(0, parseInt(pts, 10) || 0);
      var today = this.getTodayDateStr();
      var key = 'p6_daily_score_' + today + '_' + cls + '_' + num;
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
          SafeStorage.setItem(key, String(updated));
        }
      } catch(e) {}
      return updated;
    },
    _isTeacherUnlocked: function(isTeacher) {
      return Boolean(
        isTeacher ||
        (typeof root !== "undefined" && (root.isTeacherMode || root.DEV_TEST_ALL_UNLOCKED)) ||
        (typeof window !== "undefined" && (window.isTeacherMode || window.DEV_TEST_ALL_UNLOCKED))
      );
    },
    isMainLineFullyUnlocked: function(cls, num, isTeacher) {
      isTeacher = this._isTeacherUnlocked(isTeacher);
      if (isTeacher) return true;
      var dailyPts = this.getDailyEarnedScore(cls, num);
      return dailyPts >= 400;
    },
    getCurrentHighestUnlockedOrder: function(cls, num, isTeacher) {
      isTeacher = this._isTeacherUnlocked(isTeacher);
      if (isTeacher) return 6;
      var dailyPts = this.getDailyEarnedScore(cls, num);
      var mainSeq = this.mainSequence();
      var highest = 1;
      for (var i = 0; i < mainSeq.length; i++) {
        if (i === 0 || dailyPts >= mainSeq[i - 1].completeAt) {
          highest = mainSeq[i].order;
        }
      }
      return highest;
    },
    getDailyStationPlayCount: function(modeId, cls, num) {
      if (!cls || !num) return 0;
      var today = this.getTodayDateStr();
      var key = 'p6_daily_cnt_' + today + '_' + cls + '_' + num + '_' + modeId;
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.getItem) {
          var val = SafeStorage.getItem(key);
          if (val) return parseInt(val, 10) || 0;
        }
      } catch(e) {}
      return 0;
    },
    incrementDailyStationPlayCount: function(modeId, cls, num) {
      if (!cls || !num) return 0;
      var current = this.getDailyStationPlayCount(modeId, cls, num);
      var updated = current + 1;
      var today = this.getTodayDateStr();
      var key = 'p6_daily_cnt_' + today + '_' + cls + '_' + num + '_' + modeId;
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
          SafeStorage.setItem(key, String(updated));
        }
      } catch(e) {}
      return updated;
    },
    getScoreDecayMultiplier: function(modeId, cls, num, isTeacher) {
      isTeacher = this._isTeacherUnlocked(isTeacher);
      if (modeId === 'speed') return 1.0;
      if (isTeacher) return 1.0;

      var isAllUnlocked = this.isMainLineFullyUnlocked(cls, num, isTeacher);

      // 當遊戲主線全解鎖時，只有站 3 (siege 逃出恐怖屋) 和站 5 (survival 生存挑戰) 能按原來設定無限獲取分數！
      if (isAllUnlocked) {
        if (modeId === 'siege' || modeId === 'survival') {
          return 1.0;
        }
        // 其他站次（站 1、2、4、6）維持每日次數衰減規則
        var count = this.getDailyStationPlayCount(modeId, cls, num);
        if (count === 0) return 1.0;
        if (count === 1) return 0.5;
        if (count === 2) return 0.25;
        return 0.0;
      }

      var targetMode = this.get(modeId);
      var highestOrder = this.getCurrentHighestUnlockedOrder(cls, num, isTeacher);

      // 當遊戲主線未全解時，當前關卡的前面所有關卡得分按此規則計算：第 1 次全額，第 2 次一半，第 3 次四分之一
      if (!isAllUnlocked && targetMode.order < highestOrder) {
        var count = this.getDailyStationPlayCount(modeId, cls, num);
        if (count === 0) return 1.0;
        if (count === 1) return 0.5;
        if (count === 2) return 0.25;
        return 0.0;
      }

      return 1.0;
    },
    getUnlockStatus: function(modeId, cls, num, isTeacher) {
      isTeacher = this._isTeacherUnlocked(isTeacher);
      if (isTeacher) {
        return { unlocked: true, currentDailyScore: 9999, neededScore: 0, completeAt: 0, isTeacher: true };
      }
      var targetMode = this.get(modeId);
      if (targetMode.line === 'challenge') {
        return { unlocked: true, currentDailyScore: 0, neededScore: 0, completeAt: 0 };
      }
      var mainSeq = this.mainSequence();
      if (modeId === mainSeq[0].id) {
        var dailyScore = this.getDailyEarnedScore(cls, num);
        return { unlocked: true, currentDailyScore: dailyScore, neededScore: 0, completeAt: mainSeq[0].completeAt };
      }
      var targetIdx = -1;
      for (var i = 0; i < mainSeq.length; i++) {
        if (mainSeq[i].id === modeId) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx <= 0) {
        return { unlocked: true, currentDailyScore: 0, neededScore: 0, completeAt: 0 };
      }
      var prevStation = mainSeq[targetIdx - 1];
      var threshold = prevStation.completeAt;
      var dailyPts = this.getDailyEarnedScore(cls, num);
      var isUnlocked = dailyPts >= threshold;
      var needed = Math.max(0, threshold - dailyPts);
      return {
        unlocked: isUnlocked,
        currentDailyScore: dailyPts,
        threshold: threshold,
        neededScore: needed,
        prevStationName: prevStation.name,
        completeAt: targetMode.completeAt
      };
    }
  };

  root.P6_MODES = P6_MODES;
  root.P6Mode = P6Mode;
})(typeof window !== 'undefined' ? window : this);
