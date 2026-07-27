const api = require('../../utils/api.js');

const dimensionsFrom = score => [
  { key: 'empathy', name: '情绪识别与同理心', score: score.empathy, color: '#667eea' },
  { key: 'knowledgeAccuracy', name: '口腔知识准确性', score: score.knowledgeAccuracy, color: '#52a67a' },
  { key: 'needsDiscovery', name: '需求挖掘', score: score.needsDiscovery, color: '#f0a34b' },
  { key: 'serviceEtiquette', name: '服务礼仪', score: score.serviceEtiquette, color: '#6b9de8' },
  { key: 'medicalCompliance', name: '医疗合规', score: score.medicalCompliance, color: '#8b75c9' }
];

const normalizeEvaluation = evaluation => Object.assign({}, evaluation, {
  strengths: (evaluation.strengths || []).map(item => item.content || item.evidence || item),
  improvements: (evaluation.improvements || []).map(item => item.content || item),
  violations: (evaluation.violations || []).map((item, index) => Object.assign({}, item, {
    id: item.id || `violation-${index}`,
    quote: item.originalQuote || item.quote || '',
    rewrite: item.recommendedRewrite || item.rewrite || ''
  })),
  roundComments: (evaluation.roundComments || []).map(item => Object.assign({}, item, {
    userQuote: item.userMessage || item.userQuote || '',
    rewrite: item.recommendedRewrite || item.rewrite || ''
  })),
  recommendedPhrases: (evaluation.recommendedPhrases || []).map(item => Object.assign({}, item, {
    patientSays: item.patientSays || '',
    csReply: item.csReply || item.recommendedRewrite || '',
    reason: item.reason || item.comment || ''
  }))
});

Page({
  data: {
    session: null,
    scenario: null,
    evaluation: null,
    dimensions: [],
    loading: true,
    loadingText: '正在生成训练报告…',
    retryable: false,
    timedOut: false
  },

  sessionId: '',
  pollTimer: null,
  waitStartedAt: 0,
  networkRetryIndex: 0,

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    this.waitStartedAt = Date.now();
    this.loadInitialData();
  },

  onUnload() { if (this.pollTimer) clearTimeout(this.pollTimer); },

  loadInitialData() {
    if (!this.sessionId) return;
    Promise.all([api.getSession(this.sessionId), api.getScenarios()]).then(([detail, scenarioData]) => {
      const scenario = scenarioData.items.find(item => item.id === detail.session.scenarioId) || { name: detail.session.scenarioName };
      this.setData({ session: detail.session, scenario });
      this.networkRetryIndex = 0;
      this.pollReport();
    }).catch(error => this.handleNetworkError(error, () => this.loadInitialData()));
  },

  pollReport() {
    if (!this.sessionId || !this.data.session) return;
    api.getEvaluation(this.sessionId).then(report => {
      this.networkRetryIndex = 0;
      if (report.status === 'ready' && report.evaluation) {
        const evaluation = normalizeEvaluation(report.evaluation);
        this.setData({ evaluation, dimensions: dimensionsFrom(evaluation.dimensionScores), loading: false,
          retryable: false, timedOut: false });
        return;
      }
      if (report.status === 'failed') {
        this.setData({ loading: true, loadingText: '报告生成失败，可重新评分', retryable: true, timedOut: false });
        return;
      }
      if (this.waitExpired()) {
        this.showWaitActions('报告仍在生成，你可以继续等待或返回历史记录。');
        return;
      }
      this.setData({ loading: true, loadingText: '正在生成训练报告…', retryable: false, timedOut: false });
      this.schedule(() => this.pollReport(), 2000);
    }).catch(error => this.handleNetworkError(error, () => this.pollReport()));
  },

  handleNetworkError(error, retry) {
    if (this.waitExpired()) {
      this.showWaitActions('网络暂时不可用，你可以继续等待或返回历史记录。');
      return;
    }
    const delays = [1000, 2000, 4000];
    const delay = delays[Math.min(this.networkRetryIndex, delays.length - 1)];
    this.networkRetryIndex += 1;
    this.setData({ loading: true, loadingText: error.message || '网络异常，正在重试…', retryable: false });
    this.schedule(retry, delay);
  },

  schedule(callback, delay) {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(callback, delay);
  },

  waitExpired() { return Date.now() - this.waitStartedAt >= 30000; },

  showWaitActions(message) {
    this.setData({ loading: true, loadingText: message, retryable: false, timedOut: true });
  },

  continueWaiting() {
    this.waitStartedAt = Date.now();
    this.networkRetryIndex = 0;
    this.setData({ timedOut: false, loadingText: '继续等待训练报告…' });
    if (this.data.session) this.pollReport();
    else this.loadInitialData();
  },

  retryEvaluation() {
    api.retryEvaluation(this.sessionId).then(() => {
      this.waitStartedAt = Date.now();
      this.networkRetryIndex = 0;
      this.setData({ retryable: false, timedOut: false, loadingText: '正在重新生成报告…' });
      this.pollReport();
    }).catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  },

  restartTraining() { wx.switchTab({ url: '/pages/index/index' }); },
  viewScenes() { wx.switchTab({ url: '/pages/index/index' }); },
  viewHistory() { wx.switchTab({ url: '/pages/report/report' }); },
  viewPhrases() { wx.navigateTo({ url: '/pages/phrases/phrases' }); },
  viewMistakes() { wx.navigateTo({ url: '/pages/mistakes/mistakes' }); },
  viewProfile() { wx.navigateTo({ url: '/pages/profile/profile' }); }
});
