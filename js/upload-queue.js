/**
 * ==============================================================================
 * 🚀 UPLOAD-QUEUE.JS - 六年級打字成績高韌性非同步上傳佇列與冪等防重試管理器
 * ==============================================================================
 */

(function(root) {
  'use strict';

  var P6UploadQueue = {
    QUEUE_KEY: 'p6_pending_upload_queue_v2',
    isProcessing: false,
    maxRetries: 5,
    generateRequestId: function(studentClass, studentNum) {
      var ts = Date.now();
      var rand = Math.random().toString(36).substring(2, 8);
      var cls = studentClass || 'p6';
      var num = studentNum || '00';
      return 'req_' + ts + '_' + cls.toLowerCase() + num + '_' + rand;
    },
    getQueue: function() {
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.getItem) {
          var raw = SafeStorage.getItem(this.QUEUE_KEY);
          if (raw) {
            var list = JSON.parse(raw);
            if (Array.isArray(list)) return list;
          }
        }
      } catch (e) {}
      return [];
    },
    saveQueue: function(queue) {
      try {
        if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem) {
          SafeStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
        }
      } catch (e) {}
    },
    enqueue: function(payload, onDone) {
      if (!payload || typeof payload !== 'object') return;
      if (!payload.requestId) {
        payload.requestId = this.generateRequestId(payload.studentClass, payload.studentNum || payload.num);
      }
      if (!payload.enqueuedAt) {
        payload.enqueuedAt = new Date().toISOString();
      }
      payload.retryCount = payload.retryCount || 0;

      var queue = this.getQueue();
      var exists = false;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].requestId === payload.requestId) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        queue.push(payload);
        this.saveQueue(queue);
      }
      this.processQueue(onDone);
    },
    processQueue: function(onDone) {
      var self = this;
      if (self.isProcessing) return;
      var queue = self.getQueue();
      if (queue.length === 0) {
        self.isProcessing = false;
        if (typeof onDone === 'function') onDone(true, 0);
        return;
      }
      var webhookUrl = (typeof CONFIG !== 'undefined' && CONFIG.GAS_WEBHOOK_URL) ? CONFIG.GAS_WEBHOOK_URL.trim() : '';
      if (!webhookUrl || webhookUrl.includes('YourDeploymentIdHere')) {
        console.warn('⚠️ Webhook 尚未配置，成績已安全暫存本地離線隊列');
        if (typeof onDone === 'function') onDone(false, queue.length);
        return;
      }
      self.isProcessing = true;
      var item = queue[0];
      var backoffDelay = Math.min(30000, Math.pow(2, item.retryCount) * 1000 + Math.random() * 300);

      var sendItem = function() {
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 9000) : null;

        fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item),
          signal: controller ? controller.signal : undefined
        })
        .then(function() {
          if (timeoutId) clearTimeout(timeoutId);
          var currentQ = self.getQueue();
          var updatedQ = currentQ.filter(function(qItem) {
            return qItem.requestId !== item.requestId;
          });
          self.saveQueue(updatedQ);
          self.isProcessing = false;
          if (updatedQ.length > 0) {
            setTimeout(function() { self.processQueue(onDone); }, 500);
          } else {
            if (typeof onDone === 'function') onDone(true, 0);
          }
        })
        .catch(function(err) {
          if (timeoutId) clearTimeout(timeoutId);
          console.warn('發送失敗，進入指數退避重試:', err);
          item.retryCount = (item.retryCount || 0) + 1;
          var currentQ = self.getQueue();
          for (var j = 0; j < currentQ.length; j++) {
            if (currentQ[j].requestId === item.requestId) {
              currentQ[j].retryCount = item.retryCount;
              break;
            }
          }
          self.saveQueue(currentQ);
          self.isProcessing = false;
          if (item.retryCount <= self.maxRetries) {
            setTimeout(function() { self.processQueue(onDone); }, backoffDelay);
          } else {
            if (typeof onDone === 'function') onDone(false, currentQ.length);
          }
        });
      };
      sendItem();
    }
  };

  root.P6UploadQueue = P6UploadQueue;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function() { P6UploadQueue.processQueue(); });
    window.addEventListener('focus', function() { P6UploadQueue.processQueue(); });
  }
})(typeof window !== 'undefined' ? window : this);
