const mvp = require('../../utils/mvp.js');

Page({
  data: { scenarios: [], expandedId: '' },

  onShow() {
    const sessions = mvp.getSessions();
    const scenarios = mvp.getScenarios().map(item => {
      const activeSession = sessions.find(session => session.scenarioId === item.id && session.status === 'in_progress');
      return Object.assign({}, item, { activeSession: activeSession || null, actionText: activeSession ? '继续训练' : '开始训练' });
    });
    this.setData({ scenarios });
  },

  toggleProfile(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  openTraining(e) {
    const { id, mode } = e.currentTarget.dataset;
    if (mode === 'continue') {
      const session = mvp.getInProgressSession(id);
      if (session) this.goTraining(session.id);
      return;
    }
    this.goTraining(mvp.createSession(id).id);
  },

  restartTraining(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '重新开始训练？',
      content: '当前未完成会话会标记为已放弃，历史记录仍会保留。',
      confirmText: '重新开始',
      success: result => {
        if (!result.confirm) return;
        const active = mvp.getInProgressSession(id);
        if (active) mvp.abandonSession(active.id);
        this.goTraining(mvp.createSession(id).id);
      }
    });
  },

  goTraining(sessionId) {
    wx.navigateTo({ url: `/pages/training/training?sessionId=${sessionId}` });
  }
});
