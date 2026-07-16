const mvp = require('../../utils/mvp.js');

Page({
  data: {
    session: null,
    scenario: null,
    evaluation: null,
    dimensions: [],
    loading: true
  },

  onLoad(options) {
    const session = mvp.getSession(options.sessionId);
    if (!session || !session.evaluation) {
      wx.showModal({ title: '报告生成中', content: '暂时没有找到可查看的评分报告。', showCancel: false, success: () => wx.navigateBack() });
      return;
    }
    const score = session.evaluation.dimensionScores;
    const dimensions = [
      { key: 'empathy', name: '情绪识别与同理心', score: score.empathy, color: '#667eea' },
      { key: 'knowledge', name: '口腔知识准确性', score: score.knowledge, color: '#52a67a' },
      { key: 'demand', name: '需求挖掘', score: score.demand, color: '#f0a34b' },
      { key: 'etiquette', name: '服务礼仪', score: score.etiquette, color: '#6b9de8' },
      { key: 'compliance', name: '医疗合规', score: score.compliance, color: '#8b75c9' }
    ];
    this.setData({ session, scenario: mvp.getScenario(session.scenarioId), evaluation: session.evaluation, dimensions, loading: false });
  },

  restartTraining() { wx.switchTab({ url: '/pages/index/index' }); },
  viewScenes() { wx.switchTab({ url: '/pages/index/index' }); },
  viewHistory() { wx.switchTab({ url: '/pages/report/report' }); }
});
