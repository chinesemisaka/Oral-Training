const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    sessionId: '',
    scenarioId: '',
    scenarioName: '',
    loading: true,
    status: 'generating',
    retryable: false,
    timedOut: false,
    evaluation: null,
    score: 0,
    passed: false,
    radarData: [],
    dimensions: [],
    errorMessage: ''
  },

  pollTimer: null,
  pollCount: 0,

  onLoad(options) {
    const sessionId = options.sessionId || options.conversationId || '';
    this.setData({ sessionId });
    if (!sessionId) {
      this.setData({ loading: false, errorMessage: '缺少训练会话 ID' });
      return;
    }

    this.loadSessionMeta();
    this.loadEvaluation();
  },

  onUnload() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  },

  async loadSessionMeta() {
    try {
      const data = await request.get(`/sessions/${this.data.sessionId}`);
      if (!data || !data.session) return;
      this.setData({
        scenarioId: data.session.scenarioId || '',
        scenarioName: data.session.scenarioName || ''
      });
    } catch (error) {
      console.warn('加载训练元数据失败', error);
    }
  },

  async loadEvaluation() {
    try {
      const data = await request.get(`/sessions/${this.data.sessionId}/evaluation`);
      const status = data.status || 'generating';

      if (status === 'ready' && data.evaluation) {
        this.applyEvaluation(data.evaluation);
        return;
      }

      if (status === 'failed') {
        this.setData({
          loading: false,
          status,
          retryable: data.retryable !== false,
          evaluation: null
        });
        return;
      }

      this.pollCount += 1;
      if (this.pollCount >= 15) {
        this.setData({
          loading: false,
          status: 'generating',
          timedOut: true,
          retryable: true
        });
        return;
      }

      this.setData({ status: 'generating', loading: true });
      this.pollTimer = setTimeout(() => this.loadEvaluation(), 2000);
    } catch (error) {
      this.setData({
        loading: false,
        status: 'failed',
        retryable: true,
        errorMessage: request.getErrorMessage(error, '评分报告加载失败')
      });
    }
  },

  applyEvaluation(evaluation) {
    evaluation = {
      ...evaluation,
      strengths: Array.isArray(evaluation.strengths) ? evaluation.strengths : [],
      improvements: Array.isArray(evaluation.improvements) ? evaluation.improvements : [],
      violations: Array.isArray(evaluation.violations) ? evaluation.violations : [],
      roundComments: Array.isArray(evaluation.roundComments) ? evaluation.roundComments : []
    };
    const scores = evaluation.dimensionScores || {};
    const dimensions = [
      { name: '口腔知识准确性', value: scores.knowledgeAccuracy || 0, color: '#1677e8' },
      { name: '医疗合规', value: scores.medicalCompliance || 0, color: '#722ed1' },
      { name: '情绪识别与同理心', value: scores.empathy || 0, color: '#52c41a' },
      { name: '需求挖掘', value: scores.needsDiscovery || 0, color: '#fa8c16' },
      { name: '服务礼仪', value: scores.serviceEtiquette || 0, color: '#eb2f96' }
    ];

    this.setData({
      loading: false,
      status: 'ready',
      retryable: false,
      timedOut: false,
      evaluation,
      score: evaluation.totalScore || 0,
      passed: (evaluation.totalScore || 0) >= 60,
      dimensions,
      radarData: dimensions.map(item => ({
        name: item.name,
        value: item.value,
        max: 100
      }))
    }, () => {
      this.drawRadarChart();
    });
  },

  drawRadarChart() {
    const query = wx.createSelectorQuery();
    query.select('#radarCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res[0]) return;

      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const width = res[0].width;
      const height = res[0].height;
      canvas.width = width;
      canvas.height = height;

      const data = this.data.radarData;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 2 - 48;
      const angleStep = (Math.PI * 2) / data.length;

      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '#dbe4ef';
      ctx.lineWidth = 1;

      [0.2, 0.4, 0.6, 0.8, 1].forEach(level => {
        ctx.beginPath();
        for (let i = 0; i <= data.length; i++) {
          const angle = i * angleStep - Math.PI / 2;
          const r = radius * level;
          const x = centerX + r * Math.cos(angle);
          const y = centerY + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      ctx.beginPath();
      data.forEach((item, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      data.forEach((item, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const r = radius * Math.min(item.value / 100, 1);
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(22, 119, 232, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#1677e8';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  },

  async retryEvaluation() {
    try {
      await request.post(`/sessions/${this.data.sessionId}/evaluation/retry`);
      this.pollCount = 0;
      this.setData({
        loading: true,
        status: 'generating',
        retryable: false,
        timedOut: false,
        errorMessage: ''
      });
      this.loadEvaluation();
    } catch (error) {
      util.showToast(request.getErrorMessage(error, '重新生成评分失败'));
    }
  },

  refreshEvaluation() {
    this.pollCount = 0;
    this.setData({
      loading: true,
      status: 'generating',
      timedOut: false,
      errorMessage: ''
    });
    this.loadEvaluation();
  },

  retryTraining() {
    if (!this.data.scenarioId) {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
    wx.navigateTo({
      url: `/pages/training/training?scenarioId=${this.data.scenarioId}`
    });
  },

  viewHistory() {
    wx.switchTab({ url: '/pages/report/report' });
  },

  backToScenarios() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
