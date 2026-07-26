const api = require('../../utils/api.js');

const normalizeScenario = item => Object.assign({}, item, {
  patientAge: `${item.patientProfile.age}岁`,
  patientConcern: item.patientProfile.description,
  patientEmotion: '需通过对话了解'
});

const normalizeMessages = messages => messages.map(message => Object.assign({}, message, {
  time: message.createdAt || ''
}));

Page({
  data: {
    session: null,
    scenario: null,
    messages: [],
    inputValue: '',
    currentRound: 0,
    maxRounds: 10,
    scrollToView: '',
    sending: false,
    finishing: false,
    pendingClientMessageId: ''
  },

  sessionId: '',
  pendingPollTimer: null,

  onUnload() { if (this.pendingPollTimer) clearTimeout(this.pendingPollTimer); },

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    this.loadSession();
  },

  loadSession() {
    if (!this.sessionId) return;
    Promise.all([api.getSession(this.sessionId), api.getScenarios()]).then(([detail, scenarioData]) => {
      const scenario = scenarioData.items.find(item => item.id === detail.session.scenarioId);
      if (!scenario) throw new Error('训练场景不存在');
      const pendingMessage = detail.pendingMessage || null;
      this.setData({
        session: detail.session,
        scenario: normalizeScenario(scenario),
        messages: normalizeMessages(detail.messages),
        pendingClientMessageId: pendingMessage ? pendingMessage.clientMessageId : '',
        inputValue: pendingMessage ? pendingMessage.content : this.data.inputValue,
        currentRound: detail.session.currentRound,
        maxRounds: detail.session.maxRounds,
        finishing: detail.session.status === 'completed'
      }, () => {
        this.scrollToBottom();
        if (pendingMessage && pendingMessage.replyStatus === 'generating') {
          this.pollPendingReply(pendingMessage.clientMessageId, pendingMessage.content, Date.now());
        }
      });
    }).catch(error => {
      wx.showModal({ title: '会话加载失败', content: error.message || '请从场景列表重新开始训练。', showCancel: false, success: () => wx.navigateBack() });
    });
  },

  onInputChange(e) { this.setData({ inputValue: e.detail.value }); },

  sendMessage() {
    const content = this.data.inputValue.trim();
    if (!content || this.data.sending || this.data.finishing || this.data.currentRound >= this.data.maxRounds) return;
    const clientMessageId = this.data.pendingClientMessageId || `client-msg-${Date.now()}`;
    this.setData({ sending: true });
    api.sendMessage(this.sessionId, clientMessageId, content).then(data => {
      this.setData({ pendingClientMessageId: '', inputValue: '', sending: false });
      if (data.session.shouldFinish) {
        this.setData({ finishing: true });
        wx.redirectTo({ url: `/pages/result/result?sessionId=${this.sessionId}` });
        return;
      }
      this.loadSession();
    }).catch(error => {
      this.setData({ pendingClientMessageId: clientMessageId, inputValue: content });
      if (error.code === 'SESSION_RESPONSE_PENDING') {
        this.pollPendingReply(clientMessageId, content, Date.now());
        return;
      }
      this.setData({ sending: false });
      this.loadSession();
      wx.showToast({ title: error.message || '患者回复生成失败，可再次发送重试', icon: 'none' });
    });
  },

  pollPendingReply(clientMessageId, content, startedAt) {
    if (this.pendingPollTimer) clearTimeout(this.pendingPollTimer);
    this.setData({ sending: true, pendingClientMessageId: clientMessageId, inputValue: content });
    api.getSession(this.sessionId).then(detail => {
      const pending = detail.pendingMessage || null;
      this.setData({
        session: detail.session,
        messages: normalizeMessages(detail.messages || []),
        currentRound: detail.session.currentRound,
        maxRounds: detail.session.maxRounds
      }, () => this.scrollToBottom());
      if (detail.session.status === 'completed') {
        this.setData({ sending: false, finishing: true, pendingClientMessageId: '', inputValue: '' });
        wx.redirectTo({ url: `/pages/result/result?sessionId=${this.sessionId}` });
        return;
      }
      if (!pending) {
        this.setData({ sending: false, pendingClientMessageId: '', inputValue: '' });
        return;
      }
      if (pending.replyStatus === 'failed') {
        this.setData({ sending: false, pendingClientMessageId: clientMessageId, inputValue: content });
        wx.showToast({ title: '回复生成失败，可使用原消息安全重试', icon: 'none' });
        return;
      }
      if (Date.now() - startedAt >= 30000) {
        this.setData({ sending: false, pendingClientMessageId: clientMessageId, inputValue: content });
        wx.showToast({ title: '回复仍在生成，原消息已保留', icon: 'none' });
        return;
      }
      this.pendingPollTimer = setTimeout(
        () => this.pollPendingReply(clientMessageId, content, startedAt), 1000);
    }).catch(() => {
      if (Date.now() - startedAt >= 30000) {
        this.setData({ sending: false, pendingClientMessageId: clientMessageId, inputValue: content });
        wx.showToast({ title: '网络异常，原消息已保留', icon: 'none' });
        return;
      }
      this.pendingPollTimer = setTimeout(
        () => this.pollPendingReply(clientMessageId, content, startedAt), 1000);
    });
  },

  finishTraining() {
    if (this.data.currentRound < 1) {
      wx.showToast({ title: '至少完成1轮对话后才能评分', icon: 'none' });
      return;
    }
    if (this.data.sending) {
      wx.showToast({ title: '患者正在回复，请稍候', icon: 'none' });
      return;
    }
    if (this.data.pendingClientMessageId) {
      wx.showToast({ title: '请先重试尚未生成回复的原消息', icon: 'none' });
      return;
    }
    if (this.data.finishing) {
      wx.showToast({ title: '正在生成报告，请稍候', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '结束本次训练？',
      content: '结束后将根据完整对话生成训练报告，结束后不能继续发送消息。',
      confirmText: '结束评分',
      success: result => { if (result.confirm) this.completeTraining(); },
      fail: () => wx.showToast({ title: '确认框打开失败，请重试', icon: 'none' })
    });
  },

  completeTraining() {
    this.setData({ finishing: true });
    api.finishSession(this.sessionId).then(() => {
      wx.redirectTo({ url: `/pages/result/result?sessionId=${this.sessionId}` });
    }).catch(error => {
      this.setData({ finishing: false });
      wx.showToast({ title: error.message || '结束训练失败', icon: 'none' });
    });
  },

  leaveTraining() {
    if (!this.data.sending && !this.data.finishing) wx.navigateBack();
  },

  scrollToBottom() { this.setData({ scrollToView: 'message-bottom' }); }
});
