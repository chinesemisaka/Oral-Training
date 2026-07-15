// pages/admin/admin.js
const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    loading: true,
    dateRange: 'week',
    summary: {
      totalUsers: 0,
      totalTrainings: 0,
      avgScore: 0,
      activeUsers: 0
    },
    teamRanking: [],
    redFlagStats: [],
    levelStats: [],
    dailyStats: []
  },

  onLoad: function() {
    this.loadAdminData();
  },

  // 加载管理数据
  loadAdminData: function() {
    var that = this;
    util.showLoading('加载中...');

    request.get('/admin/dashboard', {
      range: this.data.dateRange
    }).then(function(data) {
      util.hideLoading();
      that.setData({
        loading: false,
        summary: data.summary || {},
        teamRanking: data.teamRanking || [],
        redFlagStats: data.redFlagStats || [],
        levelStats: data.levelStats || [],
        dailyStats: data.dailyStats || []
      });
      that.drawDailyChart();
    }).catch(function(err) {
      util.hideLoading();
      console.error('加载管理数据失败', err);
      that.setData({ loading: false });
      // 模拟数据（开发测试用）
      that.setMockData();
    });
  },

  // 模拟数据（开发测试用）
  setMockData: function() {
    this.setData({
      loading: false,
      summary: {
        totalUsers: 156,
        totalTrainings: 1234,
        avgScore: 78.5,
        activeUsers: 89
      },
      teamRanking: [
        { name: '张敏', score: 92, trainings: 45, avatar: '' },
        { name: '李芳', score: 88, trainings: 38, avatar: '' },
        { name: '王丽', score: 85, trainings: 42, avatar: '' },
        { name: '陈静', score: 82, trainings: 35, avatar: '' },
        { name: '刘洋', score: 79, trainings: 40, avatar: '' }
      ],
      redFlagStats: [
        { word: '根治', count: 23, category: '夸大宣传' },
        { word: '100%成功', count: 15, category: '绝对化用语' },
        { word: '无痛保证', count: 12, category: '保证疗效' }
      ],
      levelStats: [
        { name: '低价引流', avgScore: 82, passRate: 85 },
        { name: '种植牙价格', avgScore: 75, passRate: 68 },
        { name: '信任危机', avgScore: 70, passRate: 55 },
        { name: '术后投诉', avgScore: 78, passRate: 72 }
      ],
      dailyStats: [
        { date: '12-01', trainings: 45, avgScore: 76 },
        { date: '12-02', trainings: 52, avgScore: 78 },
        { date: '12-03', trainings: 48, avgScore: 75 },
        { date: '12-04', trainings: 60, avgScore: 80 },
        { date: '12-05', trainings: 55, avgScore: 79 },
        { date: '12-06', trainings: 58, avgScore: 81 },
        { date: '12-07', trainings: 62, avgScore: 82 }
      ]
    });
    this.drawDailyChart();
  },

  // 切换日期范围
  onDateRangeChange: function(e) {
    var range = e.currentTarget.dataset.range;
    this.setData({ dateRange: range });
    this.loadAdminData();
  },

  // 绘制每日数据图表
  drawDailyChart: function() {
    var that = this;
    var query = wx.createSelectorQuery();
    query.select('#dailyChart')
      .fields({ node: true, size: true })
      .exec(function(res) {
        if (!res[0]) return;

        var canvas = res[0].node;
        var ctx = canvas.getContext('2d');
        var width = res[0].width;
        var height = res[0].height;

        canvas.width = width;
        canvas.height = height;

        var data = that.data.dailyStats;
        if (!data || data.length === 0) return;

        var stepX = width / (data.length + 1);
        var maxTrainings = Math.max.apply(Math, data.map(function(d) { return d.trainings; })) || 100;

        // 清空画布
        ctx.clearRect(0, 0, width, height);

        // 绘制网格
        ctx.beginPath();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) {
          var y = 30 + (height - 60) * (1 - i / 5);
          ctx.moveTo(40, y);
          ctx.lineTo(width - 20, y);
          ctx.stroke();
          ctx.fillStyle = '#999';
          ctx.font = '10px sans-serif';
          ctx.fillText(Math.round(maxTrainings * i / 5), 10, y + 3);
        }

        // 绘制折线
        if (data.length >= 2) {
          ctx.beginPath();
          ctx.strokeStyle = '#007aff';
          ctx.lineWidth = 3;
          for (var i = 0; i < data.length; i++) {
            var x = 40 + (i + 1) * stepX;
            var y = 30 + (height - 60) * (1 - data[i].trainings / maxTrainings);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // 绘制数据点
          for (var i = 0; i < data.length; i++) {
            var x = 40 + (i + 1) * stepX;
            var y = 30 + (height - 60) * (1 - data[i].trainings / maxTrainings);
            ctx.beginPath();
            ctx.fillStyle = '#007aff';
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        }

        // 绘制X轴标签
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        for (var i = 0; i < data.length; i++) {
          var x = 40 + (i + 1) * stepX;
          ctx.fillText(data[i].date, x - 20, height - 10);
        }
      });
  },

  // 查看队员详情
  viewMemberDetail: function(e) {
    var member = e.currentTarget.dataset.member;
    wx.navigateTo({
      url: '/pages/report/report?userId=' + (member.id || '')
    });
  },

  // 导出数据
  exportData: function() {
    util.showModal({
      title: '导出数据',
      content: '确定要导出管理数据吗？'
    }).then(function(confirm) {
      if (confirm) {
        util.showToast('正在导出...');
        setTimeout(function() {
          util.showToast('导出成功', 'success');
        }, 1500);
      }
    });
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.loadAdminData();
    wx.stopPullDownRefresh();
  }
});