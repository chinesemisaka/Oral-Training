const mvp = require('../../utils/mvp.js');

Page({
  data: { dashboard: { totalCount: 0, completedCount: 0, averageScore: 0, sceneStats: [], dimensionAverages: [], recentSessions: [] } },
  onShow() { this.setData({ dashboard: mvp.getDashboard() }); }
});
