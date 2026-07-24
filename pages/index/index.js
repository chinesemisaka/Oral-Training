const api = require('../../utils/api.js');

Page({
  data: {
    scenarios: [],
    expandedId: '',
    trainingMode: 'customer_service'
  },

  onShow() { this.loadScenarios(); },

  loadScenarios() {
    const isRoleplay = this.data.trainingMode === 'patient_simulation';
    const request = isRoleplay ? api.getRoleplayScenarios() : api.getScenarios();
    request.then(data => {
      const scenarios = data.items.map(item => Object.assign({}, item, {
        difficulty: item.difficulty === 'advanced' ? '进阶' : '基础',
        patientAge: `${item.patientProfile.age}岁`,
        patientConcern: item.patientProfile.description,
        patientEmotion: isRoleplay ? '由你自由提问' : '需通过对话了解',
        actionText: item.activeSession
          ? (isRoleplay ? '继续模拟' : '继续训练')
          : (isRoleplay ? '开始模拟' : '开始训练'),
        suggestedQuestions: item.suggestedQuestions || []
      }));
      this.setData({ scenarios, expandedId: '' });
    }).catch(error => wx.showToast({ title: error.message || '场景加载失败', icon: 'none' }));
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.trainingMode) return;
    this.setData({ trainingMode: mode, scenarios: [], expandedId: '' }, () => this.loadScenarios());
  },

  toggleProfile(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  openTraining(e) {
    const { id, mode } = e.currentTarget.dataset;
    const scenario = this.data.scenarios.find(item => item.id === id);
    if (!scenario) return;
    if (this.data.trainingMode === 'patient_simulation') {
      this.openRoleplay(scenario, mode, '');
      return;
    }
    if (mode === 'continue' && scenario.activeSession) {
      this.goTraining(scenario.activeSession.id);
      return;
    }
    api.createSession(id).then(data => this.goTraining(data.session.id))
      .catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  },

  openSuggestion(e) {
    const scenario = this.data.scenarios.find(item => item.id === e.currentTarget.dataset.id);
    if (!scenario) return;
    this.openRoleplay(scenario, scenario.activeSession ? 'continue' : 'new', e.currentTarget.dataset.prompt || '');
  },

  openRoleplay(scenario, mode, prompt) {
    if (mode === 'continue' && scenario.activeSession) {
      this.goRoleplay(scenario.activeSession.id, prompt);
      return;
    }
    api.createRoleplaySession(scenario.id).then(data => this.goRoleplay(data.session.id, prompt))
      .catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  },

  restartTraining(e) {
    const id = e.currentTarget.dataset.id;
    const isRoleplay = this.data.trainingMode === 'patient_simulation';
    wx.showModal({
      title: isRoleplay ? '重新开始患者模拟？' : '重新开始训练？',
      content: '当前未完成会话会标记为已放弃，历史记录仍会保留。',
      confirmText: '重新开始',
      success: result => {
        if (!result.confirm) return;
        const scenario = this.data.scenarios.find(item => item.id === id);
        if (!scenario || !scenario.activeSession) return;
        const request = isRoleplay
          ? api.restartRoleplaySession(scenario.activeSession.id)
          : api.restartSession(scenario.activeSession.id);
        request.then(data => {
          if (isRoleplay) this.goRoleplay(data.session.id, '');
          else this.goTraining(data.session.id);
        }).catch(error => wx.showToast({ title: error.message, icon: 'none' }));
      }
    });
  },

  goTraining(sessionId) {
    wx.navigateTo({ url: `/pages/training/training?sessionId=${sessionId}` });
  },

  goRoleplay(sessionId, prompt) {
    const suffix = prompt ? `&prompt=${encodeURIComponent(prompt)}` : '';
    wx.navigateTo({ url: `/pages/roleplay/roleplay?sessionId=${sessionId}${suffix}` });
  }
});
