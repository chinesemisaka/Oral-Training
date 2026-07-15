const request = require('../../static/api/request.js');

Page({
  data: {
    summary: null,
    loading: true,
    errorMessage: ''
  },

  onLoad() {
    this.loadDashboard();
  },

  onShow() {
    this.loadDashboard();
  },

  async loadDashboard() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const data = await request.get('/dashboard/summary');
      const dimensionAverages = data.dimensionAverages || {};
      this.setData({
        summary: {
          ...data,
          scenarioStats: data.scenarioStats || [],
          recentSessions: data.recentSessions || [],
          dimensions: [
            { name: '口腔知识准确性', value: dimensionAverages.knowledgeAccuracy || 0 },
            { name: '医疗合规', value: dimensionAverages.medicalCompliance || 0 },
            { name: '情绪识别与同理心', value: dimensionAverages.empathy || 0 },
            { name: '需求挖掘', value: dimensionAverages.needsDiscovery || 0 },
            { name: '服务礼仪', value: dimensionAverages.serviceEtiquette || 0 }
          ]
        },
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: request.getErrorMessage(error, '演示数据加载失败')
      });
    }
  },

  goTraining() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/report/report' });
  }
});
