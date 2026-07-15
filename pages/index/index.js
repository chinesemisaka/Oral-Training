// pages/index/index.js
const util = require('../../utils/util.js');

Page({
  data: {
    categories: [],
    expandedId: null,
    loading: true,
    userInfo: null
  },

  onLoad() {
    this.loadUserInfo();
    this.loadMockData();
  },

  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      const mockUserInfo = {
        nickname: '测试客服',
        level: 1,
        totalScore: 0
      };
      wx.setStorageSync('userInfo', mockUserInfo);
      this.setData({ userInfo: mockUserInfo });
    } else {
      this.setData({ userInfo });
    }
  },

  loadMockData() {
    setTimeout(() => {
      this.setData({
        categories: [
          {
            id: 'consult',
            name: '咨询解答',
            icon: '💬',
            color: '#007aff',
            description: '应对患者各类咨询，专业解答口腔问题',
            completedCount: 1,
            totalCount: 4,
            scenarios: [
              {
                id: 101,
                name: '种植牙咨询',
                difficulty: 'easy',
                scenarioDescription: '患者来电咨询种植牙流程和注意事项，需要专业且耐心的解答',
                passingScore: 70,
                isCompleted: true,
                bestScore: 82
              },
              {
                id: 102,
                name: '正畸方案咨询',
                difficulty: 'medium',
                scenarioDescription: '患者对牙齿矫正方案有疑问，需要对比不同方案优缺点',
                passingScore: 75,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 103,
                name: '儿牙早期干预',
                difficulty: 'medium',
                scenarioDescription: '家长咨询儿童牙齿是否需要早期矫治，需要判断并引导',
                passingScore: 75,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 104,
                name: ' Whitening 美白咨询',
                difficulty: 'easy',
                scenarioDescription: '患者询问牙齿美白方案，需要区分冷光/瓷贴面/家庭美白等方式',
                passingScore: 70,
                isCompleted: false,
                bestScore: null
              }
            ]
          },
          {
            id: 'price',
            name: '价格异议',
            icon: '💰',
            color: '#ff6b6b',
            description: '化解患者价格疑虑，用价值对比推动成交',
            completedCount: 0,
            totalCount: 4,
            scenarios: [
              {
                id: 201,
                name: '9.9洗牙券升单',
                difficulty: 'easy',
                scenarioDescription: '用户持有9.9元洗牙券，抗拒升单，你需要巧妙引出正畸/种植需求',
                passingScore: 70,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 202,
                name: '种植牙价格异议攻坚',
                difficulty: 'medium',
                scenarioDescription: '疯狂比价的患者，认为种植牙太贵，质疑民营诊所定价',
                passingScore: 75,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 203,
                name: '隐形矫正报价抗拒',
                difficulty: 'hard',
                scenarioDescription: '患者觉得隐形矫正3-5万太贵，需要拆解价值并制造紧迫感',
                passingScore: 80,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 204,
                name: '分期付款引导',
                difficulty: 'medium',
                scenarioDescription: '患者有意向但一次性支付困难，需要自然引导分期方案',
                passingScore: 75,
                isCompleted: false,
                bestScore: null
              }
            ]
          },
          {
            id: 'complaint',
            name: '投诉安抚',
            icon: '🛡️',
            color: '#fa8c16',
            description: '处理患者不满情绪，安抚投诉并化解危机',
            completedCount: 0,
            totalCount: 3,
            scenarios: [
              {
                id: 301,
                name: '术后肿痛投诉',
                difficulty: 'hard',
                scenarioDescription: '术后出现肿痛，患者情绪激动，扬言要投诉和退费',
                passingScore: 85,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 302,
                name: '等待时间过长抱怨',
                difficulty: 'medium',
                scenarioDescription: '候诊2小时后患者爆发不满，需要安抚并补偿',
                passingScore: 75,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 303,
                name: '效果不满意纠纷',
                difficulty: 'hard',
                scenarioDescription: '矫正后患者对效果不满意，威胁发差评和曝光',
                passingScore: 85,
                isCompleted: false,
                bestScore: null
              }
            ]
          },
          {
            id: 'recommend',
            name: '项目推荐',
            icon: '📈',
            color: '#52c41a',
            description: '精准推荐口腔项目，提升转化率和客单价',
            completedCount: 0,
            totalCount: 4,
            scenarios: [
              {
                id: 401,
                name: '洗牙升单洁治套餐',
                difficulty: 'easy',
                scenarioDescription: '患者只愿洗牙，如何自然推荐牙周治疗套餐',
                passingScore: 70,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 402,
                name: '种植牙全口方案推荐',
                difficulty: 'hard',
                scenarioDescription: '多颗缺失患者，如何推荐全口种植方案而非单颗修补',
                passingScore: 80,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 403,
                name: '隐形矫正推荐',
                difficulty: 'medium',
                scenarioDescription: '从牙齿美观需求切入，自然引导至隐形矫正方案',
                passingScore: 75,
                isCompleted: false,
                bestScore: null
              },
              {
                id: 404,
                name: '家庭护理产品连带',
                difficulty: 'easy',
                scenarioDescription: '治疗结束后推荐家用冲牙器/牙线等护理产品',
                passingScore: 70,
                isCompleted: false,
                bestScore: null
              }
            ]
          }
        ],
        loading: false
      });
    }, 500);
  },

  // 展开/收起分类
  toggleCategory(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      expandedId: this.data.expandedId === id ? null : id
    });
  },

  // 开始训练
  startTraining(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/training/training?levelId=${id}`
    });
  },

  onPullDownRefresh() {
    this.loadMockData();
    wx.stopPullDownRefresh();
  }
});