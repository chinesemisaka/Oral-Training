const request = require('../../static/api/request.js');

Page({
  data: {
    sessions: [],
    statusFilter: 'all',
    loading: true,
    errorMessage: ''
  },

  onLoad() {
    this.loadHistory();
  },

  onShow() {
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const data = await request.get('/sessions', {
        status: this.data.statusFilter,
        limit: 50
      });
      this.setData({
        sessions: data.items || [],
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: request.getErrorMessage(error, '历史记录加载失败')
      });
    }
  },

  changeFilter(e) {
    const statusFilter = e.currentTarget.dataset.status;
    this.setData({ statusFilter }, () => this.loadHistory());
  },

  viewSession(e) {
    const sessionId = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!sessionId) return;

    if (status === 'in_progress') {
      wx.navigateTo({
        url: `/pages/training/training?sessionId=${sessionId}`
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/result/result?sessionId=${sessionId}`
    });
  },

  onPullDownRefresh() {
    this.loadHistory().finally(() => wx.stopPullDownRefresh());
  },

  retryLoad() {
    this.loadHistory();
  }
});
