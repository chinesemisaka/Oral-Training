const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    scenarios: [],
    loading: true,
    errorMessage: ''
  },

  onLoad() {
    this.loadScenarios();
  },

  onShow() {
    if (this.data.scenarios.length > 0) {
      this.loadScenarios();
    }
  },

  async loadScenarios() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const data = await request.get('/scenarios');
      this.setData({
        scenarios: data.items || [],
        loading: false
      });
    } catch (error) {
      console.error('加载场景失败', error);
      this.setData({
        loading: false,
        errorMessage: request.getErrorMessage(error, '场景加载失败，请检查网络后重试')
      });
    }
  },

  findScenario(id) {
    return this.data.scenarios.find(item => item.id === id);
  },

  goToTraining(sessionId) {
    wx.navigateTo({
      url: `/pages/training/training?sessionId=${sessionId}`
    });
  },

  async startTraining(e) {
    const scenarioId = e.currentTarget.dataset.id;
    const scenario = this.findScenario(scenarioId);
    if (!scenario) return;

    if (scenario.activeSession) {
      this.goToTraining(scenario.activeSession.id);
      return;
    }

    util.showLoading('创建训练中...');
    try {
      const data = await request.post('/sessions', { scenarioId });
      util.hideLoading();
      this.goToTraining(data.session.id);
    } catch (error) {
      util.hideLoading();
      if (error.code === 'SESSION_IN_PROGRESS' && error.data && error.data.sessionId) {
        this.goToTraining(error.data.sessionId);
        return;
      }
      util.showToast(request.getErrorMessage(error, '创建训练失败'));
    }
  },

  continueTraining(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (sessionId) this.goToTraining(sessionId);
  },

  restartTraining(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (!sessionId) return;

    util.showModal({
      title: '重新开始训练',
      content: '当前进行中的会话将标记为已放弃，确定重新开始吗？'
    }).then(async (confirmed) => {
      if (!confirmed) return;
      util.showLoading('重新创建中...');
      try {
        const data = await request.post(`/sessions/${sessionId}/restart`);
        util.hideLoading();
        this.goToTraining(data.session.id);
      } catch (error) {
        util.hideLoading();
        util.showToast(request.getErrorMessage(error, '重新开始失败'));
      }
    });
  },

  onPullDownRefresh() {
    this.loadScenarios().finally(() => wx.stopPullDownRefresh());
  }
});
