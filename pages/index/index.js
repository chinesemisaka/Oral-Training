const api = require('../../utils/api.js');

Page({
  data: { scenarios: [], expandedId: '' },

  onShow() {
    api.getScenarios().then(data => {
      const scenarios = data.items.map(item => Object.assign({}, item, {
        difficulty: item.difficulty === 'advanced' ? '进阶' : '基础',
        patientAge: `${item.patientProfile.age}岁`,
        patientConcern: item.patientProfile.description,
        patientEmotion: '需通过对话了解',
        actionText: item.activeSession ? '继续训练' : '开始训练'
      }));
      this.setData({ scenarios });
    }).catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  },

  toggleProfile(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  openTraining(e) {
    const { id, mode } = e.currentTarget.dataset;
    if (mode === 'continue') {
      const scenario = this.data.scenarios.find(item => item.id === id);
      if (scenario && scenario.activeSession) this.goTraining(scenario.activeSession.id);
      return;
    }
    api.createSession(id).then(data => this.goTraining(data.session.id)).catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  },

  restartTraining(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '重新开始训练？',
      content: '当前未完成会话会标记为已放弃，历史记录仍会保留。',
      confirmText: '重新开始',
      success: result => {
        if (!result.confirm) return;
        const scenario = this.data.scenarios.find(item => item.id === id);
        if (!scenario || !scenario.activeSession) return;
        api.restartSession(scenario.activeSession.id).then(data => this.goTraining(data.session.id))
          .catch(error => wx.showToast({ title: error.message, icon: 'none' }));
      }
    });
  },

  goTraining(sessionId) {
    wx.navigateTo({ url: `/pages/training/training?sessionId=${sessionId}` });
  }
});
