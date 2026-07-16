const mvp = require('../../utils/mvp.js');

Page({
  data: {
    dashboard: { totalCount: 0, completedCount: 0, averageScore: 0 },
    demoUser: '固定演示账号'
  },

  onShow() {
    this.setData({ dashboard: mvp.getDashboard() });
  },

  startTraining() { wx.switchTab({ url: '/pages/index/index' }); },
  viewHistory() { wx.switchTab({ url: '/pages/report/report' }); },
  viewDashboard() { wx.switchTab({ url: '/pages/admin/admin' }); }
});
