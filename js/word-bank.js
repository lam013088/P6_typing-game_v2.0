/**
 * ==============================================================================
 * 🌐 WORD-BANK.JS - 六年級字庫微服務客戶端載入器 (零代碼發布連接器)
 * ==============================================================================
 */

(function(root) {
  'use strict';

  var P6WordBank = {
    isLoaded: false,
    currentVersion: '',
    init: function() { this.load(); },
    load: function(callback) {
      var self = this;
      var statusEl = document.getElementById('word-bank-status');
      if (statusEl) {
        statusEl.textContent = '🔄 正在同步雲端最新字庫...';
        statusEl.style.color = '#F59E0B';
      }
      var wordBankUrl = (typeof CONFIG !== 'undefined' && CONFIG.WORD_BANK_URL) ? CONFIG.WORD_BANK_URL.trim() : '';
      if (!wordBankUrl || wordBankUrl.includes('YourWordBankDeploymentIdHere')) {
        self.applyFallback(callback, '🟡 離線字庫模式 (未配置雲端端點)');
        return;
      }
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 7000) : null;

      fetch(wordBankUrl, {
        method: 'GET',
        signal: controller ? controller.signal : undefined
      })
      .then(function(res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (root.P6WordBankCore && root.P6WordBankCore.validateBankPayload(data)) {
          root.P6WordBankCore.saveToLocalCache(data);
          // 動態同步排程與當前開放周次 (SSOT)
          if (data.schedules && Array.isArray(data.schedules)) {
            window.DYNAMIC_SCHEDULES = data.schedules;
            window.SPEED_WEEK_SCHEDULES = data.schedules.map(function(s) {
              return {
                week: s.week,
                name: s.weekName,
                title: s.title,
                start: s.start ? new Date(s.start) : null,
                end: s.end ? new Date(s.end) : null
              };
            });
          }
          if (data.currentActiveWeek) {
            window.DYNAMIC_ACTIVE_WEEK = data.currentActiveWeek;
          }
          self.applyWordBanks(data.weeklyBanks);
          self.isLoaded = true;
          self.currentVersion = data.version || '';
          if (statusEl) {
            var activeName = data.currentActiveWeekName ? ('【' + data.currentActiveWeekName + '】進行中 · ') : '';
            statusEl.textContent = '🟢 雲端字庫已同步 (' + activeName + '共 ' + Object.keys(data.weeklyBanks).length + ' 組)';
            statusEl.style.color = '#10B981';
          }
          if (typeof callback === 'function') callback(true, data);
        } else {
          throw new Error('字庫結構校驗未通過');
        }
      })
      .catch(function(err) {
        if (timeoutId) clearTimeout(timeoutId);
        console.warn('雲端字庫獲取異常，切換至備用快取:', err);
        self.applyFallback(callback, '🟡 已載入備用字庫 (' + (err.message || '連線逾時') + ')');
      });
    },
    applyFallback: function(callback, statusMsg) {
      var statusEl = document.getElementById('word-bank-status');
      var cached = (root.P6WordBankCore) ? root.P6WordBankCore.loadFromLocalCache() : null;
      if (cached && cached.weeklyBanks) {
        this.applyWordBanks(cached.weeklyBanks);
        this.isLoaded = true;
        if (statusEl) {
          statusEl.textContent = statusMsg || '🟢 已載入本地最新字庫快取';
          statusEl.style.color = '#38BDF8';
        }
        if (typeof callback === 'function') callback(true, cached);
      } else {
        if (statusEl) {
          statusEl.textContent = statusMsg || '🟡 使用內建基準字庫';
          statusEl.style.color = '#F59E0B';
        }
        if (typeof callback === 'function') callback(false, null);
      }
    },
        applyWordBanks: function(weeklyBanks) {
      if (!weeklyBanks || typeof weeklyBanks !== 'object') return;
      var ssotMap = {};
      Object.values(weeklyBanks).forEach(function(b) {
        if (b && Array.isArray(b.words)) {
          b.words.forEach(function(w) {
            if (w && w.char) {
              ssotMap[w.char] = w;
            }
          });
        }
      });
      root.WORD_BANK_SSOT_MAP = ssotMap;
      window.WORD_BANK_SSOT_MAP = ssotMap;

      // ★ 核心原則：字庫表第 F 欄為真值，題目的字碼判定以字庫表答案為最高優先
      if (typeof DATA !== 'undefined') {
        var wordArrays = [
          DATA.connected_words, DATA.split_words, DATA.feature_words,
          DATA.special_words, DATA.abbrev_words, DATA.omit_words,
          DATA.difficult_words, DATA.cangjie_words
        ];
        wordArrays.forEach(function(arr) {
          if (Array.isArray(arr)) {
            arr.forEach(function(item) {
              if (item && item.char && ssotMap[item.char]) {
                var canon = ssotMap[item.char];
                if (canon.codes) item.codes = canon.codes.slice();
                if (canon.keys) item.keys = canon.keys.slice();
                if (canon.full) item.full = canon.full;
                if (canon.secret) item.secret = canon.secret;
                if (canon.quickCode) item.quickCode = canon.quickCode;
              }
            });
          }
        });
      }

      root.MODE2_WEEKLY_BANKS = weeklyBanks;
      window.MODE2_WEEKLY_BANKS = weeklyBanks;
      if (typeof root.initSpeedWeekDropdown === 'function') {
        root.initSpeedWeekDropdown();
      }
    }
  };

  root.P6WordBank = P6WordBank;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { P6WordBank.init(); });
    } else {
      P6WordBank.init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
