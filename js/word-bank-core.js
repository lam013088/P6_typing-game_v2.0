/**
 * ==============================================================================
 * 📦 WORD-BANK-CORE.JS - 六年級倉頡字庫微服務核心驗證器與快取管理器
 * ==============================================================================
 */

(function(root) {
  'use strict';

  var P6WordBankCore = {
    CACHE_KEY: 'p6_word_bank_cache_v3',
    CACHE_META_KEY: 'p6_word_bank_meta_v3',
    validateBankPayload: function(payload) {
      if (!payload || typeof payload !== 'object') return false;
      if (!payload.weeklyBanks || typeof payload.weeklyBanks !== 'object') return false;
      var keys = Object.keys(payload.weeklyBanks);
      if (keys.length === 0) return false;
      for (var i = 0; i < Math.min(keys.length, 3); i++) {
        var bank = payload.weeklyBanks[keys[i]];
        if (!bank || !Array.isArray(bank.words) || bank.words.length === 0) {
          return false;
        }
        var firstWord = bank.words[0];
        if (!firstWord.char || !Array.isArray(firstWord.codes) || !Array.isArray(firstWord.keys)) {
          return false;
        }
      }
      return true;
    },
    loadFromLocalCache: function() {
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.getItem) {
          var raw = SafeStorage.getItem(this.CACHE_KEY);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (this.validateBankPayload(parsed)) {
              return parsed;
            }
          }
        }
      } catch (e) {
        console.warn('讀取本地字庫快取失敗:', e);
      }
      return null;
    },
    saveToLocalCache: function(payload) {
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
          SafeStorage.setItem(this.CACHE_KEY, JSON.stringify(payload));
          SafeStorage.setItem(this.CACHE_META_KEY, JSON.stringify({
            updatedAt: new Date().toISOString(),
            academicYear: payload.academicYear || '2026/2027',
            version: payload.version || 'v2'
          }));
        }
      } catch (e) {
        console.warn('寫入本地字庫快取失敗:', e);
      }
    }
  };

  root.P6WordBankCore = P6WordBankCore;
})(typeof window !== 'undefined' ? window : this);
