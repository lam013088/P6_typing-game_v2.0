/**
 * ==============================================================================
 * 🌐 WORD-BANK.JS - 字庫微服務客戶端載入器 (v3.0 防舊快取覆蓋增強版)
 * ==============================================================================
 */

(function(root) {
  'use strict';

  function safeParseScheduleDate(val) {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    var d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    var m = String(val).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i);
    if (m) {
      var day = parseInt(m[1], 10);
      var mon = parseInt(m[2], 10) - 1;
      var yr = parseInt(m[3], 10);
      var hr = m[4] ? parseInt(m[4], 10) : 0;
      var min = m[5] ? parseInt(m[5], 10) : 0;
      var ampm = m[6] ? m[6].toUpperCase() : '';
      if (ampm === 'PM' && hr < 12) hr += 12;
      if (ampm === 'AM' && hr === 12) hr = 0;
      return new Date(yr, mon, day, hr, min, 0);
    }
    return null;
  }

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
        self.applyFallback(callback, '🟢 已啟用內建第8/10周完整字庫');
        return;
      }
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 15000) : null;

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
          if (data.schedules && Array.isArray(data.schedules)) {
            window.DYNAMIC_SCHEDULES = data.schedules;
            var parsedScheds = [];
            data.schedules.forEach(function(s) {
              var st = safeParseScheduleDate(s.start);
              var ed = safeParseScheduleDate(s.end);
              if (s && s.week && st && ed) {
                parsedScheds.push({
                  week: s.week,
                  name: s.weekName || s.name || s.week,
                  weekName: s.weekName || s.name || s.week,
                  title: s.title || '',
                  start: st,
                  end: ed
                });
              }
            });
            if (parsedScheds.length > 0) {
              var builtinScheds = window.SPEED_WEEK_SCHEDULES || [];
              builtinScheds.forEach(function(bs) {
                if (bs && (bs.week === 'w8' || bs.week === 'w10') && !parsedScheds.some(function(ps) { return ps.week === bs.week; })) {
                  parsedScheds.push(bs);
                }
              });
              window.SPEED_WEEK_SCHEDULES = parsedScheds;
            }
          }
          if (data.currentActiveWeek) {
            window.DYNAMIC_ACTIVE_WEEK = data.currentActiveWeek;
          }
          self.applyWordBanks(data.weeklyBanks);
          self.isLoaded = true;
          self.currentVersion = data.version || '';
          if (statusEl) {
            var totalGroups = Object.keys(window.MODE2_WEEKLY_BANKS || data.weeklyBanks).length;
            statusEl.textContent = '🟢 雲端字庫已同步 (含第8周/第10周 · 共 ' + totalGroups + ' 組)';
            statusEl.style.color = '#10B981';
          }
          if (typeof callback === 'function') callback(true, data);
        } else {
          throw new Error('字庫結構校驗未通過');
        }
      })
      .catch(function(err) {
        if (timeoutId) clearTimeout(timeoutId);
        console.warn('雲端字庫獲取異常，切換至內建與本地快取融合字庫:', err);
        self.applyFallback(callback, '🟢 已啟用內建第8/10周完整字庫');
      });
    },
    applyFallback: function(callback, statusMsg) {
      var statusEl = document.getElementById('word-bank-status');
      var cached = (root.P6WordBankCore) ? root.P6WordBankCore.loadFromLocalCache() : null;
      var builtin = (typeof window !== 'undefined' && window.MODE2_WEEKLY_BANKS) ? window.MODE2_WEEKLY_BANKS : (typeof MODE2_WEEKLY_BANKS !== 'undefined' ? MODE2_WEEKLY_BANKS : {});
      var merged = Object.assign({}, cached && cached.weeklyBanks ? cached.weeklyBanks : {}, builtin);
      this.applyWordBanks(merged);
      this.isLoaded = true;
      if (statusEl) {
        statusEl.textContent = statusMsg || '🟢 已載入最新第8/10周完整字庫';
        statusEl.style.color = '#10B981';
      }
      if (typeof callback === 'function') callback(true, { weeklyBanks: merged });
    },
    applyWordBanks: function(weeklyBanks) {
      if (!weeklyBanks || typeof weeklyBanks !== 'object') return;
      var builtin = (typeof window !== 'undefined' && window.MODE2_WEEKLY_BANKS) ? window.MODE2_WEEKLY_BANKS : (typeof MODE2_WEEKLY_BANKS !== 'undefined' ? MODE2_WEEKLY_BANKS : {});
      var mergedBanks = Object.assign({}, builtin, weeklyBanks);
      Object.keys(builtin).forEach(function(k) {
        if (k.indexOf('w8_') === 0 || k.indexOf('w10_') === 0) {
          if (!mergedBanks[k] || !Array.isArray(mergedBanks[k].words) || mergedBanks[k].words.length === 0) {
            mergedBanks[k] = builtin[k];
          } else if (builtin[k] && builtin[k].title && (!mergedBanks[k].title || mergedBanks[k].title.indexOf('(') === -1)) {
            mergedBanks[k].title = builtin[k].title;
          }
        }
      });

      // 🛡️ 校本三代倉頡權威覆寫防護盾 (防止雲端舊快取或五代異體碼污染)
      var CANONICAL_FIXES = {
        "起": { char: "起", codes: ["土", "人", "口", "山"], keys: ["G", "O", "R", "U"], full: "土人口山 (GORU)", secret: "起：土人口山 (GORU)", quickCode: "GU" },
        "藝": { char: "藝", codes: ["廿", "土", "戈", "戈"], keys: ["T", "G", "I", "I"], full: "廿土戈戈 (TGII)", secret: "藝：廿土戈戈 (TGII)", quickCode: "TI" },
        "熱": { char: "熱", codes: ["土", "戈", "火"], keys: ["G", "I", "F"], full: "土戈火 (GIF)", secret: "熱：土戈火 (GIF)", quickCode: "GF" },
        "進": { char: "進", codes: ["卜", "人", "土"], keys: ["Y", "O", "G"], full: "卜人土 (YOG)", secret: "進：卜人土 (YOG)", quickCode: "YG" },
        "陰": { char: "陰", codes: ["弓", "中", "人", "戈", "戈"], keys: ["N", "L", "O", "I", "I"], full: "弓中人戈戈 (NLOII)", secret: "陰：弓中人戈戈 (NLOII)", quickCode: "NI" },
        "屬": { char: "屬", codes: ["尸", "卜", "卜", "戈"], keys: ["S", "Y", "Y", "I"], full: "尸卜卜戈 (SYYI)", secret: "屬：尸卜卜戈 (SYYI)", quickCode: "SI" }
      };
      Object.values(mergedBanks).forEach(function(b) {
        if (b && Array.isArray(b.words)) {
          b.words.forEach(function(w) {
            if (w && w.char && CANONICAL_FIXES[w.char]) {
              var fix = CANONICAL_FIXES[w.char];
              if (w.codes && w.codes.length === 2 && w.first_key) {
                w.cj_full = fix.full;
              } else {
                w.codes = fix.codes.slice();
                w.keys = fix.keys.slice();
                w.full = fix.full;
                w.secret = fix.secret;
                w.quickCode = fix.quickCode;
              }
            }
          });
        }
      });

      var ssotMap = {};
      Object.values(mergedBanks).forEach(function(b) {
        if (b && Array.isArray(b.words)) {
          b.words.forEach(function(w) {
            if (w && w.char) ssotMap[w.char] = w;
          });
        }
      });
      var ovMap = (typeof P4_MASTER_QUICK_OVERRIDES !== 'undefined') ? P4_MASTER_QUICK_OVERRIDES : (typeof window !== 'undefined' ? window.P4_MASTER_QUICK_OVERRIDES : null);
      if (ovMap) {
        Object.keys(ovMap).forEach(function(charKey) {
          ssotMap[charKey] = ovMap[charKey];
        });
      }
      root.WORD_BANK_SSOT_MAP = ssotMap;
      window.WORD_BANK_SSOT_MAP = ssotMap;

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

      root.MODE2_WEEKLY_BANKS = mergedBanks;
      window.MODE2_WEEKLY_BANKS = mergedBanks;
      if (typeof root.initSpeedWeekDropdown === 'function') {
        root.initSpeedWeekDropdown();
      }
    }
  };

  root.P6WordBank = P6WordBank;
  root.P6WordBank = P6WordBank;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { P6WordBank.init(); });
    } else {
      P6WordBank.init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
