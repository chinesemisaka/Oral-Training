// app.js
App({
  onLaunch: function() {
    // 获取本地存储的用户信息
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
    }
  },

  globalData: {
    userInfo: null,
    // 本地开发：使用本地服务器地址
    // 真机调试：使用电脑局域网IP，如 http://192.168.1.100:5000/api
    apiBaseUrl: 'http://10.98.250.60:5000/api'
  },

  // 设置登录信息
  setLoginInfo: function(userInfo) {
    wx.setStorageSync('userInfo', userInfo);
    this.globalData.userInfo = userInfo;
  },

  // 退出登录
  logout: function() {
    wx.clearStorageSync();
    this.globalData.userInfo = null;
  }
});