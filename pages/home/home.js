Page({
  goTraining() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/report/report' });
  },

  goDashboard() {
    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
