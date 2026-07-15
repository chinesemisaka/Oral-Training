// pages/home/home.js
Page({
  data: {
    allHotScripts: [],
    hotScripts: [],
    searchKey: '',
    loading: true,
    showAll: false,
    expandedIds: {}
  },

  onLoad() {
    this.loadMockData();
  },

  loadMockData() {
    setTimeout(() => {
      this.setData({
        banners: [
          { id: 1, title: '如何应对价格异议？', subtitle: '3分钟掌握黄金话术', tag: '热门' },
          { id: 2, title: '种植牙升单技巧', subtitle: '从咨询到成交的全流程', tag: '新课' },
          { id: 3, title: '术后回访标准话术', subtitle: '提升患者满意度的秘诀', tag: '推荐' }
        ],
        categories: [
          { id: 1, name: '咨询解答', icon: '💬', count: 4, color: '#007aff' },
          { id: 2, name: '价格异议', icon: '💰', count: 4, color: '#ff6b6b' },
          { id: 3, name: '投诉安抚', icon: '🛡️', count: 3, color: '#fa8c16' },
          { id: 4, name: '项目推荐', icon: '📈', count: 4, color: '#52c41a' }
        ],
        allHotScripts: [
          {
            id: 1,
            title: '种植牙咨询专业解答',
            category: '咨询解答',
            difficulty: 'easy',
            summary: '患者来电咨询种植牙流程和注意事项，专业且耐心的标准解答话术。',
            score: 96,
            usageCount: 1280,
            tags: ['种植牙', '咨询', '专业解答'],
            dialogues: [
              { role: 'patient', text: '你好，我想了解一下种植牙大概是什么流程？' },
              { role: 'service', text: '您好！种植牙一般分为三个阶段：首先进行术前检查和方案设计，然后植入种植体，最后安装牙冠。整个过程大约需要3-6个月，我们会全程跟进您的恢复情况。' },
              { role: 'patient', text: '那术后有什么需要注意的吗？' },
              { role: 'service', text: '术后当天避免剧烈运动，饮食以温凉软食为主，不要用手术侧咀嚼。按时服用消炎药，一周后回来复查。如有明显出血或肿痛加重，请及时联系我们。' },
              { role: 'patient', text: '好的，我明白了，谢谢你的详细解答！' }
            ]
          },
          {
            id: 2,
            title: '种植牙价格太贵应对',
            category: '价格异议',
            difficulty: 'hard',
            summary: '面对"种植牙怎么这么贵"的灵魂拷问，用价值对比法打消患者疑虑。',
            score: 92,
            usageCount: 950,
            tags: ['种植牙', '价格异议', '价值对比'],
            dialogues: [
              { role: 'patient', text: '种植牙怎么这么贵？我看别的地方才几千块。' },
              { role: 'service', text: '理解您的顾虑！价格的差异主要在材料和医生技术上。我们使用的是进口钛合金种植体，生物相容性更好，使用寿命可达20年以上。而且我们的医生有上千例成功经验，术后保障也更完善。相比反复修复的传统假牙，种植牙其实更经济长远。' },
              { role: 'patient', text: '能用医保吗？' },
              { role: 'service', text: '种植牙目前不在医保范围内，但我们可以提供分期付款方案，每月只需几百元，不会给您造成太大压力。您方便的话可以来院做个免费检查，医生会根据您的口腔情况给出最合适的方案和报价。' },
              { role: 'patient', text: '分期的话压力确实小不少，那我先来做个检查看看吧。' }
            ]
          },
          {
            id: 3,
            title: '术后肿痛投诉安抚',
            category: '投诉安抚',
            difficulty: 'medium',
            summary: '术后出现肿痛患者情绪激动，三步法安抚并转化为复诊机会。',
            score: 88,
            usageCount: 680,
            tags: ['术后', '投诉', '安抚'],
            dialogues: [
              { role: 'patient', text: '我拔完智齿都三天了，还是肿得厉害，特别疼！你们是不是没弄好？' },
              { role: 'service', text: '非常抱歉给您带来不适！术后肿痛3-5天属于正常恢复过程，智齿拔除创伤较大，恢复确实需要一些时间。请问您有按时服药和冰敷吗？' },
              { role: 'patient', text: '吃了药还是疼啊，我有点担心。' },
              { role: 'service', text: '我理解您的担心，这样吧，我帮您预约明天主任的复诊，让医生再仔细检查一下恢复情况，确保没有感染。如果一切正常您也更放心，您看可以吗？' },
              { role: 'patient', text: '行，那帮我约明天的吧，谢谢你了。' }
            ]
          },
          {
            id: 4,
            title: '隐形矫正项目推荐',
            category: '项目推荐',
            difficulty: 'easy',
            summary: '从牙齿美观需求切入，自然引导至隐形矫正方案的推荐话术。',
            score: 85,
            usageCount: 560,
            tags: ['隐形矫正', '项目推荐', '美观'],
            dialogues: [
              { role: 'patient', text: '我觉得我牙齿不太整齐，想看看有什么办法。' },
              { role: 'service', text: '牙齿整齐度确实会影响笑容自信呢！现在很流行隐形矫正，透明牙套几乎看不出来，吃饭刷牙还能摘下来，特别方便。您有兴趣的话可以先做个免费的3D口扫，看看矫正后的模拟效果。' },
              { role: 'patient', text: '大概需要多久能矫正完？' },
              { role: 'service', text: '根据您的牙齿情况，一般6-18个月就能完成。我们的正畸医生会为您定制专属方案，每6-8周复诊一次调整进度。现在还有新客优惠活动，您可以来院详细了解哦！' },
              { role: 'patient', text: '听起来挺不错的，那我周末过来看看吧。' }
            ]
          }
        ],
        hotScripts: [],
        loading: false
      });
      this.setData({ hotScripts: this.data.allHotScripts.slice(0, 2) });
    }, 400);
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value });
  },

  onSearch() {
    const key = this.data.searchKey.trim();
    if (!key) return;
    wx.showToast({ title: `搜索: ${key}`, icon: 'none' });
  },

  onCategoryTap(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showToast({ title: `进入分类: ${name}`, icon: 'none' });
  },

  onScriptTap(e) {
    const { id } = e.currentTarget.dataset;
    const expandedIds = this.data.expandedIds;
    expandedIds[id] = !expandedIds[id];
    this.setData({ expandedIds });
  },

  onBannerTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.showToast({ title: '查看详情', icon: 'none' });
  },

  goTraining() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  viewAllScripts() {
    if (this.data.showAll) {
      this.setData({
        hotScripts: this.data.allHotScripts.slice(0, 2),
        showAll: false
      });
    } else {
      this.setData({
        hotScripts: this.data.allHotScripts,
        showAll: true
      });
    }
  },

  onPullDownRefresh() {
    this.loadMockData();
    wx.stopPullDownRefresh();
  }
});