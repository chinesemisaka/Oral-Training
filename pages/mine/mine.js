// pages/mine/mine.js
const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    userInfo: null,
    stats: {
      totalTrainings: 0,
      totalScore: 0,
      rank: 0,
      continuousDays: 0
    },
    menuItems: [
      { icon: '📊', name: '我的报告', url: '/pages/report/report', arrow: true },
      { icon: '📖', name: '错题本', url: '/pages/report/report?type=mistake', arrow: true },
      { icon: '⚙️', name: '设置', url: '', arrow: true },
      { icon: '📞', name: '联系客服', url: '', arrow: true }
    ],
    showVersion: true,
    calendar: {
      year: 0,
      month: 0,
      days: [],
      checkedDates: []
    },
    todayChecked: false
  },

  onLoad() {
    this.loadUserInfo();
    this.loadStats();
    this.initCalendar();
  },

  onShow() {
    this.loadUserInfo();
  },

  // 加载用户信息
  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    } else {
      // 模拟登录数据（实际需要对接登录接口）
      const mockUserInfo = {
        nickname: '口腔客服',
        avatar: '/static/images/default-avatar.png',
        level: 3,
        totalScore: 2850,
        title: '金牌客服'
      };
      this.setData({ userInfo: mockUserInfo });
    }
  },

  // 加载统计数据
  async loadStats() {
    try {
      const stats = await request.get('/user/stats');
      this.setData({ stats });
    } catch (err) {
      console.error('加载统计失败', err);
      // 模拟数据
      this.setData({
        stats: {
          totalTrainings: 28,
          totalScore: 2850,
          rank: 5,
          continuousDays: 7
        }
      });
    }
  },

  // 编辑资料
  editProfile() {
    wx.showModal({
      title: '编辑资料',
      content: '该功能开发中',
      showCancel: false
    });
  },

  // 菜单点击
  onMenuTap(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.navigateTo({ url });
    } else {
      util.showToast('功能开发中');
    }
  },

  // 联系客服
  contactService() {
    wx.showModal({
      title: '联系客服',
      content: '客服电话：400-123-4567\n服务时间：9:00-18:00',
      confirmText: '拨打',
      success: (res) => {
        if (res.confirm) {
          wx.makePhoneCall({ phoneNumber: '4001234567' });
        }
      }
    });
  },

  // 关于我们
  aboutUs() {
    wx.showModal({
      title: '关于我们',
      content: 'AI口腔客服陪练系统\n版本：v1.0.0\n© 2024 版权所有',
      showCancel: false
    });
  },

  // 退出登录
  logout() {
    util.showModal({
      title: '提示',
      content: '确定要退出登录吗？'
    }).then(confirm => {
      if (confirm) {
        wx.clearStorageSync();
        const app = getApp();
        app.logout();
        this.setData({ userInfo: null });
        util.showToast('已退出登录', 'success');
      }
    });
  },

  // ========== 打卡日历 ==========

  // 从打卡记录中计算连续打卡天数
  calcContinuousDays(checkedDates) {
    if (!checkedDates || checkedDates.length === 0) return 0;
    const set = new Set(checkedDates);
    const now = new Date();
    let count = 0;
    // 从今天开始往前数，遇到未打卡的日期就停止
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (set.has(dateStr)) {
        count++;
      } else {
        break;
      }
    }
    return count;
  },

  // 初始化日历
  initCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    // 从本地存储读取已打卡日期
    let checkedDates = wx.getStorageSync('checkedDates') || [];
    // 兼容：确保是数组
    if (typeof checkedDates === 'string') checkedDates = [];
    const today = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayChecked = checkedDates.indexOf(today) !== -1;
    // 从实际打卡记录计算连续天数，不再依赖模拟数据
    const continuousDays = this.calcContinuousDays(checkedDates);
    this.setData({
      calendar: { year, month, days: [], checkedDates },
      todayChecked,
      'stats.continuousDays': continuousDays
    });
    this.generateDays(year, month, checkedDates);
  },

  // 生成日历天数
  generateDays(year, month, checkedDates) {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 本月1号星期几 (0=日)
    const daysInMonth = new Date(year, month, 0).getDate();
    const now = new Date();
    const todayDate = now.getDate();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const days = [];

    // 前置空白
    for (let i = 0; i < firstDay; i++) {
      days.push({ day: '', checked: false, isToday: false, isEmpty: true });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        day: d,
        checked: checkedDates.indexOf(dateStr) !== -1,
        isToday: isCurrentMonth && d === todayDate,
        isEmpty: false
      });
    }

    this.setData({ 'calendar.days': days });
  },

  // 切换月份
  prevMonth() {
    let { year, month, checkedDates } = this.data.calendar;
    month--;
    if (month < 1) { month = 12; year--; }
    this.setData({ 'calendar.year': year, 'calendar.month': month });
    this.generateDays(year, month, checkedDates);
  },

  nextMonth() {
    let { year, month, checkedDates } = this.data.calendar;
    month++;
    if (month > 12) { month = 1; year++; }
    this.setData({ 'calendar.year': year, 'calendar.month': month });
    this.generateDays(year, month, checkedDates);
  },

  // 打卡
  doCheckIn() {
    if (this.data.todayChecked) {
      util.showToast('今日已打卡');
      return;
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let checkedDates = this.data.calendar.checkedDates.slice();
    checkedDates.push(today);
    wx.setStorageSync('checkedDates', checkedDates);

    // 重新计算连续天数（而非简单 +1）
    const continuousDays = this.calcContinuousDays(checkedDates);
    this.setData({
      todayChecked: true,
      'calendar.checkedDates': checkedDates,
      'stats.continuousDays': continuousDays
    });
    this.generateDays(this.data.calendar.year, this.data.calendar.month, checkedDates);
    util.showToast('打卡成功！', 'success');
  }
});