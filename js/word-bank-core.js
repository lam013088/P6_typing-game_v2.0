/**
 * ==============================================================================
 * 📦 WORD-BANK-CORE.JS - 字庫微服務核心驗證器與快取管理器 (v3.0)
 * ==============================================================================
 */

(function(root) {
  'use strict';

  var P6WordBankCore = {
    CACHE_KEY: 'p6_word_bank_cache_v8_w10',
    CACHE_META_KEY: 'p6_word_bank_meta_v8_w10',
    LEGACY_KEYS: ['p6_word_bank_cache_v1', 'p6_word_bank_cache_v2', 'p6_word_bank_cache_v3', 'p6_word_bank_meta_v2'],
    purgeLegacyCache: function() {
      try {
        if (typeof localStorage !== 'undefined') {
          this.LEGACY_KEYS.forEach(function(k) { localStorage.removeItem(k); });
        }
      } catch (e) {}
    },
    validateBankPayload: function(payload) {
      if (!payload || typeof payload !== 'object') return false;
      if (!payload.weeklyBanks || typeof payload.weeklyBanks !== 'object') return false;
      var keys = Object.keys(payload.weeklyBanks);
      if (keys.length === 0) return false;
      for (var i = 0; i < Math.min(keys.length, 3); i++) {
        var bank = payload.weeklyBanks[keys[i]];
        if (!bank || !Array.isArray(bank.words) || bank.words.length === 0) return false;
        var firstWord = bank.words[0];
        if (!firstWord.char || !Array.isArray(firstWord.codes) || !Array.isArray(firstWord.keys)) return false;
      }
      return true;
    },
    loadFromLocalCache: function() {
      this.purgeLegacyCache();
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.getItem) {
          var raw = SafeStorage.getItem(this.CACHE_KEY);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (this.validateBankPayload(parsed)) return parsed;
          }
        }
      } catch (e) {}
      return null;
    },
    saveToLocalCache: function(payload) {
      this.purgeLegacyCache();
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
          SafeStorage.setItem(this.CACHE_KEY, JSON.stringify(payload));
          SafeStorage.setItem(this.CACHE_META_KEY, JSON.stringify({
            updatedAt: new Date().toISOString(),
            academicYear: payload.academicYear || '2026/2027',
            version: payload.version || 'v8_w10'
          }));
        }
      } catch (e) {}
    }
  };

  P6WordBankCore.purgeLegacyCache();
  root.P6WordBankCore = P6WordBankCore;
  root.P6WordBankCore = P6WordBankCore;
})(typeof window !== 'undefined' ? window : this);
