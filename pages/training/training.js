const mvp = require('../../utils/mvp.js');

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
    finishing: false
  },

  sessionId: '',

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    this.loadSession();
  },

  loadSession() {
    const session = mvp.getSession(this.sessionId);
    if (!session) {
      wx.showModal({ title: '会话不存在', content: '请从场景列表重新开始训练。', showCancel: false, success: () => wx.navigateBack() });
      return;
    }
    this.setData({
      session,
      scenario: mvp.getScenario(session.scenarioId),
      messages: session.messages || [],
      currentRound: session.currentRound || 0,
      maxRounds: session.maxRounds || 10,
      finishing: session.status === 'completed'
    }, () => this.scrollToBottom());
  },

  onInputChange(e) { this.setData({ inputValue: e.detail.value }); },

  sendMessage() {
    const content = this.data.inputValue.trim();
    if (!content || this.data.sending || this.data.finishing || this.data.currentRound >= this.data.maxRounds) return;

    const round = this.data.currentRound + 1;
    const userMessage = { id: `message-${Date.now()}`, role: 'user', content, round, time: this.timeText() };
    const messages = this.data.messages.concat(userMessage);
    const session = Object.assign({}, this.data.session, { messages, currentRound: round, updatedAt: this.timeText() });
    mvp.saveSession(session);
    this.setData({ session, messages, currentRound: round, inputValue: '', sending: true }, () => this.scrollToBottom());

    setTimeout(() => {
      const latest = mvp.getSession(this.sessionId);
      if (!latest || latest.status !== 'in_progress') return;
      const response = mvp.generatePatientReply(latest.scenarioId, content, round, latest.patientState);
      const patientMessage = { id: `message-${Date.now()}`, role: 'patient', content: response.reply, round, time: this.timeText() };
      const updatedMessages = latest.messages.concat(patientMessage);
      const updatedSession = Object.assign({}, latest, {
        messages: updatedMessages,
        currentRound: round,
        patientState: response.state,
        updatedAt: this.timeText()
      });
      mvp.saveSession(updatedSession);
      this.setData({ session: updatedSession, messages: updatedMessages, sending: false }, () => {
        this.scrollToBottom();
        if (round >= this.data.maxRounds) this.finishTraining(true);
      });
    }, 700);
  },

  finishTraining(autoFinish) {
    if (this.data.currentRound < 1 || this.data.sending || this.data.finishing) {
      if (!autoFinish && this.data.currentRound < 1) wx.showToast({ title: '至少完成1轮对话后才能评分', icon: 'none' });
      return;
    }
    if (autoFinish) {
      this.completeTraining();
      return;
    }
    wx.showModal({
      title: '结束本次训练？',
      content: '结束后将根据完整对话生成训练报告，结束后不能继续发送消息。',
      confirmText: '结束并评分',
      success: result => { if (result.confirm) this.completeTraining(); }
    });
  },

  completeTraining() {
    this.setData({ finishing: true });
    setTimeout(() => {
      mvp.finishSession(this.sessionId);
      wx.redirectTo({ url: `/pages/result/result?sessionId=${this.sessionId}` });
    }, 450);
  },

  leaveTraining() {
    if (this.data.sending || this.data.finishing) return;
    this.persistCurrentSession();
    wx.navigateBack();
  },

  persistCurrentSession() {
    if (!this.data.session || this.data.session.status !== 'in_progress') return;
    mvp.saveSession(Object.assign({}, this.data.session, {
      messages: this.data.messages,
      currentRound: this.data.currentRound,
      updatedAt: this.timeText()
    }));
  },

  onUnload() {
    if (!this.data.finishing) this.persistCurrentSession();
  },

  scrollToBottom() { this.setData({ scrollToView: 'message-bottom' }); },

  timeText() {
    const date = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
});
