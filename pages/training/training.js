const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    sessionId: '',
    scenarioId: '',
    scenarioName: 'AI 模拟患者',
    patientProfile: '',
    messages: [],
    currentRound: 0,
    maxRounds: 10,
    remainingRounds: 10,
    inputValue: '',
    scrollToView: '',
    loading: true,
    sending: false,
    finishing: false,
    isTrainingEnd: false,
    errorMessage: ''
  },

  pendingMessage: null,

  onLoad(options) {
    const sessionId = options.sessionId || '';
    const scenarioId = options.scenarioId || '';
    this.setData({ sessionId, scenarioId });

    if (sessionId) {
      this.loadSession();
    } else if (scenarioId) {
      this.createSession();
    } else {
      this.setData({ loading: false, errorMessage: '缺少训练会话信息' });
    }
  },

  async createSession() {
    try {
      const data = await request.post('/sessions', {
        scenarioId: this.data.scenarioId
      });
      this.setData({ sessionId: data.session.id });
      this.applySessionData(data);
      this.loadScenarioProfile(this.data.scenarioId);
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: request.getErrorMessage(error, '创建训练失败')
      });
    }
  },

  async loadSession() {
    try {
      const data = await request.get(`/sessions/${this.data.sessionId}`);
      this.applySessionData(data);
      this.loadScenarioProfile(data.session.scenarioId);
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: request.getErrorMessage(error, '训练会话加载失败')
      });
    }
  },

  async loadScenarioProfile(scenarioId) {
    try {
      const data = await request.get('/scenarios');
      const scenario = (data.items || []).find(item => item.id === scenarioId);
      if (scenario) {
        this.setData({
          scenarioName: scenario.name,
          patientProfile: `${scenario.patientProfile.age}岁 · ${scenario.patientProfile.description}`
        });
      }
    } catch (error) {
      console.warn('加载场景公开信息失败', error);
    }
  },

  applySessionData(data) {
    const session = data.session || {};
    const messages = data.messages || [];
    const currentRound = session.currentRound || 0;
    const maxRounds = session.maxRounds || 10;

    this.setData({
      loading: false,
      scenarioId: session.scenarioId || this.data.scenarioId,
      scenarioName: session.scenarioName || this.data.scenarioName,
      messages,
      currentRound,
      maxRounds,
      remainingRounds: Math.max(maxRounds - currentRound, 0),
      isTrainingEnd: session.status !== 'in_progress',
      errorMessage: ''
    }, () => {
      this.setData({ scrollToView: 'msg-bottom' });
    });
  },

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  async sendMessage() {
    if (this.data.sending || this.data.finishing || this.data.isTrainingEnd) return;

    const content = this.data.inputValue.trim();
    if (!content) return;

    const pending = this.pendingMessage && this.pendingMessage.content === content
      ? this.pendingMessage
      : { clientMessageId: `client-${Date.now()}`, content };

    this.pendingMessage = pending;
    this.setData({ sending: true, inputValue: '' });

    try {
      const data = await request.post(`/sessions/${this.data.sessionId}/messages`, {
        clientMessageId: pending.clientMessageId,
        content: pending.content
      });
      const messages = [
        ...this.data.messages,
        data.userMessage,
        data.patientMessage
      ];
      const session = data.session || {};

      this.pendingMessage = null;
      this.setData({
        messages,
        currentRound: session.currentRound || this.data.currentRound + 1,
        remainingRounds: session.remainingRounds || 0,
        sending: false,
        scrollToView: 'msg-bottom'
      });

      if (session.shouldFinish || session.currentRound >= this.data.maxRounds) {
        this.finishTraining('max_rounds');
      }
    } catch (error) {
      this.setData({
        sending: false,
        inputValue: pending.content
      });
      util.showToast(request.getErrorMessage(error, '患者回复失败，可重试'));
    }
  },

  async finishTraining(reasonOrEvent) {
    if (reasonOrEvent && reasonOrEvent.currentTarget) {
      reasonOrEvent = reasonOrEvent.currentTarget.dataset.reason || 'manual';
    }
    const reason = reasonOrEvent || 'manual';

    if (this.data.finishing || this.data.isTrainingEnd) return;
    if (this.data.currentRound < 1) {
      util.showToast('至少完成 1 轮对话后才能结束训练');
      return;
    }

    const confirmed = reason === 'max_rounds'
      ? true
      : await util.showModal({
        title: '结束训练',
        content: '确定结束本次训练并生成评分吗？'
      });
    if (!confirmed) return;

    this.setData({ finishing: true, isTrainingEnd: true });
    try {
      await request.post(`/sessions/${this.data.sessionId}/finish`, { reason });
      wx.redirectTo({
        url: `/pages/result/result?sessionId=${this.data.sessionId}`
      });
    } catch (error) {
      this.setData({ finishing: false, isTrainingEnd: false });
      util.showToast(request.getErrorMessage(error, '结束训练失败，请重试'));
    }
  }
});
