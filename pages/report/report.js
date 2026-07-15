// pages/report/report.js
const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    loading: true,
    activeTab: 'overview',
    conversationId: null,
    viewType: 'history', // history or mistake
    stats: {
      totalTrainings: 0,
      avgScore: 0,
      bestScore: 0,
      totalHours: 0
    },
    scores: [],
    recentTrainings: [],
    mistakeList: [],
    redFlagStats: [],
    levelProgress: [],
    rankList: [],
    myRank: null
  },

  onLoad(options) {
    const conversationId = options.conversationId;
    const type = options.type || 'history';
    this.setData({ 
      conversationId: conversationId,
      viewType: type 
    });
    this.loadReportData();
  },

  // 加载报告数据
  async loadReportData() {
    util.showLoading('加载中...');

    try {
      let data;
      if (this.data.conversationId) {
        // 单次训练详情
        data = await request.get(`/report/detail/${this.data.conversationId}`);
      } else {
        // 个人汇总报告
        data = await request.get('/report/summary');
      }

      util.hideLoading();

      this.setData({
        loading: false,
        stats: data.stats || {},
        scores: data.scores || {},
        recentTrainings: data.recentTrainings || [],
        mistakeList: data.mistakeList || [],
        redFlagStats: data.redFlagStats || [],
        levelProgress: data.levelProgress || []
      });

      // 绘制趋势图
      if (data.recentTrainings && data.recentTrainings.length > 0) {
        this.drawTrendChart();
      }

    } catch (err) {
      util.hideLoading();
      console.error('加载报告失败', err);
      // 使用示范数据
      this.setData({
        loading: false,
        stats: {
          totalTrainings: 28,
          avgScore: 82.5,
          bestScore: 96,
          totalHours: 14.5
        },
        scores: [
          { name: '共情能力', value: 88, color: '#007aff' },
          { name: '需求挖掘', value: 75, color: '#52c41a' },
          { name: '价值传递', value: 82, color: '#fa8c16' },
          { name: '预约促成', value: 70, color: '#f5222d' },
          { name: '合规表达', value: 92, color: '#722ed1' }
        ],
        recentTrainings: [
          { id: 1, levelName: '种植牙咨询解答', time: '06-11 14:30', score: 92 },
          { id: 2, levelName: '价格异议攻坚', time: '06-10 16:20', score: 78 },
          { id: 3, levelName: '术后投诉安抚', time: '06-09 10:15', score: 85 },
          { id: 4, levelName: '隐形矫正推荐', time: '06-08 09:00', score: 96 },
          { id: 5, levelName: '9.9洗牙升单', time: '06-07 15:45', score: 71 },
          { id: 6, levelName: '分期付款引导', time: '06-06 11:30', score: 80 },
          { id: 7, levelName: '种植牙咨询解答', time: '06-05 14:00', score: 88 }
        ],
        mistakeList: [
          {
            id: 1,
            sceneType: '价格异议',
            time: '06-10 16:20',
            userMessage: '我们这个价格已经是最便宜的了，别的诊所更贵。',
            suggestedReply: '理解您的顾虑，价格确实是考虑因素之一。我们更看重的是长期效果和安全保障，我帮您对比一下不同方案的性价比？',
            levelId: 2
          },
          {
            id: 2,
            sceneType: '投诉安抚',
            time: '06-05 14:00',
            userMessage: '这不关我的事，是医生操作的问题。',
            suggestedReply: '非常抱歉给您带来了不好的体验，我完全理解您的心情。我会第一时间帮您反馈并安排复查，您看方便什么时候过来？',
            levelId: 3
          },
          {
            id: 3,
            sceneType: '预约促成',
            time: '06-04 10:30',
            userMessage: '我再考虑一下吧，到时候再说。',
            suggestedReply: '当然可以，考虑清楚很重要。目前我们有个限时优惠名额，我可以先帮您预留，您考虑好了随时联系我，您看怎样？',
            levelId: 4
          }
        ],
        redFlagStats: [
          { word: '最便宜', count: 2 },
          { word: '不关我的事', count: 1 },
          { word: '保证', count: 3 }
        ],
        levelProgress: [
          { id: 1, name: '种植牙咨询解答', progress: 100, status: '已通关', scenarioDescription: '专业解答种植牙流程与注意事项' },
          { id: 2, name: '价格异议攻坚', progress: 60, status: '进行中', scenarioDescription: '应对种植牙、正畸等价格异议' },
          { id: 3, name: '术后投诉安抚', progress: 80, status: '进行中', scenarioDescription: '术后不适投诉的专业安抚话术' },
          { id: 4, name: '隐形矫正推荐', progress: 40, status: '进行中', scenarioDescription: '从美观需求切入推荐隐形矫正' },
          { id: 5, name: '9.9洗牙升单', progress: 20, status: '进行中', scenarioDescription: '低价洗牙券客户升单洁治套餐' }
        ]
      });
      // 绘制趋势图
      this.drawTrendChart();
    }

    // 加载排行数据
    this.loadRankData();
  },

  // 加载排行榜数据
  async loadRankData() {
    try {
      const data = await request.get('/rank/list');
      this.setData({
        rankList: data.rankList || [],
        myRank: data.myRank || null
      });
    } catch (err) {
      console.error('加载排行榜失败', err);
      // 模拟排行榜数据
      const mockRankList = [
        { rank: 1, nickname: '张主任', avatar: '', title: '金牌客服', totalScore: 9680, avgScore: 96.8, trainings: 42, isMe: false },
        { rank: 2, nickname: '李医生', avatar: '', title: '资深客服', totalScore: 9320, avgScore: 93.2, trainings: 38, isMe: false },
        { rank: 3, nickname: '王护士', avatar: '', title: '金牌客服', totalScore: 9050, avgScore: 90.5, trainings: 35, isMe: false },
        { rank: 4, nickname: '赵顾问', avatar: '', title: '高级客服', totalScore: 8740, avgScore: 87.4, trainings: 33, isMe: false },
        { rank: 5, nickname: '测试客服', avatar: '', title: '金牌客服', totalScore: 8520, avgScore: 85.2, trainings: 30, isMe: true },
        { rank: 6, nickname: '周医生', avatar: '', title: '中级客服', totalScore: 8210, avgScore: 82.1, trainings: 28, isMe: false },
        { rank: 7, nickname: '吴护士', avatar: '', title: '高级客服', totalScore: 7960, avgScore: 79.6, trainings: 25, isMe: false },
        { rank: 8, nickname: '郑顾问', avatar: '', title: '中级客服', totalScore: 7680, avgScore: 76.8, trainings: 22, isMe: false },
        { rank: 9, nickname: '孙医生', avatar: '', title: '初级客服', totalScore: 7350, avgScore: 73.5, trainings: 20, isMe: false },
        { rank: 10, nickname: '钱护士', avatar: '', title: '中级客服', totalScore: 7020, avgScore: 70.2, trainings: 18, isMe: false }
      ];
      this.setData({
        rankList: mockRankList,
        myRank: { rank: 5, totalScore: 8520, avgScore: 85.2 }
      });
    }
  },

  // 切换标签页
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  // 绘制趋势图
  drawTrendChart() {
    const query = wx.createSelectorQuery();
    query.select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const width = res[0].width;
        const height = res[0].height;

        canvas.width = width;
        canvas.height = height;

        const data = this.data.recentTrainings.slice(-7);
        const scores = data.map(d => d.score);
        const maxScore = Math.max(...scores, 100);
        const stepX = width / (scores.length - 1 || 1);
        const stepY = (height - 60) / maxScore;

        // 清空
        ctx.clearRect(0, 0, width, height);

        // 绘制网格
        ctx.beginPath();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
          const y = 30 + (height - 60) * (1 - i / 5);
          ctx.moveTo(40, y);
          ctx.lineTo(width - 20, y);
          ctx.stroke();
          ctx.fillStyle = '#999';
          ctx.font = '10px sans-serif';
          ctx.fillText(Math.round(maxScore * i / 5), 10, y + 3);
        }

        // 绘制折线
        if (scores.length >= 2) {
          ctx.beginPath();
          ctx.strokeStyle = '#007aff';
          ctx.lineWidth = 3;
          for (let i = 0; i < scores.length; i++) {
            const x = 40 + i * stepX;
            const y = 30 + (height - 60) * (1 - scores[i] / maxScore);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // 绘制数据点
          for (let i = 0; i < scores.length; i++) {
            const x = 40 + i * stepX;
            const y = 30 + (height - 60) * (1 - scores[i] / maxScore);
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
        for (let i = 0; i < data.length; i++) {
          const x = 40 + i * stepX;
          ctx.fillText(data[i].date, x - 20, height - 10);
        }
      });
  },

  // 查看训练详情
  viewTrainingDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/result/result?conversationId=${id}`
    });
  },

  // 重新练习错题
  practiceMistake(e) {
    const mistake = e.currentTarget.dataset.mistake;
    wx.navigateTo({
      url: `/pages/training/training?levelId=${mistake.levelId}&mode=practice`
    });
  },

  // 导出报告
  exportReport() {
    wx.showModal({
      title: '导出报告',
      content: '报告将以图片形式保存到相册',
      success: async (res) => {
        if (res.confirm) {
          util.showLoading('生成中...');
          // 这里可以调用截图功能
          setTimeout(() => {
            util.hideLoading();
            util.showToast('已保存到相册', 'success');
          }, 1500);
        }
      }
    });
  }
});