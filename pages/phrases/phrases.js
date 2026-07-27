const api = require('../../utils/api.js');

Page({
  data: {
    loading: true,
    keyword: '',
    phrases: [],
    scenarioFilters: [{ id: '', name: '全部场景' }],
    selectedScenarioId: ''
  },

  onLoad(options) {
    this.setData({ keyword: options.search || '' });
    this.loadScenarioFilters();
    this.loadPhrases();
  },

  loadScenarioFilters() {
    api.getScenarios().then(data => {
      const scenarioFilters = [{ id: '', name: '全部场景' }].concat((data.items || []).map(item => ({
        id: item.id,
        name: item.name
      })));
      this.setData({ scenarioFilters });
    }).catch(() => {});
  },

  onSearchInput(e) { this.setData({ keyword: e.detail.value }); },

  onSearchConfirm() { this.loadPhrases(); },

  clearSearch() { this.setData({ keyword: '' }, () => this.loadPhrases()); },

  selectScenario(e) {
    const selectedScenarioId = e.currentTarget.dataset.id || '';
    this.setData({ selectedScenarioId }, () => this.loadPhrases());
  },

  loadPhrases() {
    this.setData({ loading: true });
    api.getLearningPhrases({
      search: this.data.keyword.trim(),
      scenarioId: this.data.selectedScenarioId,
      limit: 50
    }).then(data => {
      this.setData({ phrases: data.items || [], loading: false });
    }).catch(error => {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '话术加载失败', icon: 'none' });
    });
  },

  copyPhrase(e) {
    const phrase = e.currentTarget.dataset.phrase;
    if (!phrase) return;
    wx.setClipboardData({ data: phrase, success: () => wx.showToast({ title: '已复制话术', icon: 'success' }) });
  },

  startScenario(e) {
    const scenarioId = e.currentTarget.dataset.id;
    if (!scenarioId) return;
    api.getScenarios().then(data => {
      const scenario = (data.items || []).find(item => item.id === scenarioId);
      if (scenario && scenario.activeSession) {
        wx.navigateTo({ url: `/pages/training/training?sessionId=${scenario.activeSession.id}` });
        return null;
      }
      return api.createSession(scenarioId);
    }).then(data => {
      if (data && data.session) {
        wx.navigateTo({ url: `/pages/training/training?sessionId=${data.session.id}` });
      }
    }).catch(error => wx.showToast({ title: error.message || '创建训练失败', icon: 'none' }));
  },

  goProfile() { wx.navigateTo({ url: '/pages/profile/profile' }); },

  goMistakes() { wx.navigateTo({ url: '/pages/mistakes/mistakes' }); }
});
