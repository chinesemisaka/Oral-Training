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
    return this.data.scenarios.find(item => String(item.id) === String(id));
  },

  goToTraining(sessionId) {
    if (!sessionId) return;
    wx.navigateTo({
      url: `/pages/training/training?sessionId=${encodeURIComponent(sessionId)}`
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
      if (!data || !data.session || !data.session.id) {
        throw new Error('服务端未返回有效训练会话');
      }
      this.goToTraining(data.session.id);
    } catch (error) {
      util.hideLoading();
      const existingSessionId = error.data && (error.data.sessionId || error.data.id);
      if (error.code === 'SESSION_IN_PROGRESS' && existingSessionId) {
        this.goToTraining(existingSessionId);
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
        const data = await request.post(`/sessions/${encodeURIComponent(sessionId)}/restart`);
        util.hideLoading();
        if (!data || !data.session || !data.session.id) {
          throw new Error('服务端未返回有效训练会话');
        }
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
