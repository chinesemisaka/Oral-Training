const api = require('../../utils/api.js');
/* 计划展示派生（进度 / 截止 / 状态 / 要求文案）统一走 utils/supervisor.js，
   本页不再维护副本，也避免与首页工作台各算一套。 */
const { normalizeSupervisorPlan } = require('../../utils/supervisor.js');

/* 培训计划派生：直接复用单一来源，progressText 仍是裸比值（'3/8'），
   页面自己拼「达标 3/8 人」这层措辞（与工作台统一） */
const normalizePlans = plans => (plans || []).map(item => normalizeSupervisorPlan(item));

Page({
  data: {
    loading: true,
    isAdmin: false,
    plans: [],
    trainingLoading: false,
    planStatus: 'all',
    planStatusFilters: [
      { id: 'all', name: '全部' },
      { id: 'active', name: '进行中' },
      { id: 'expired', name: '已到期' }
    ]
  },

  onShow() {
    /* 每次显示都同步 tabBar 角色列表：导航格与页面身份判定必须同源，
       否则会出现「底部写着培训、点进来却说你是学员」这种自相矛盾的场面。 */
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) {
      tabBar.applyRoleList();
      tabBar.setData({ selected: 1 });
    }
    /* 每次进入都重新拉取：从发布页 / 详情页返回后进度会自动更新。
       loading 只在首次鉴权时置位，避免来回切 Tab 时整页闪加载态。 */
    this.loadPage();
  },

  loadPage() {
    api.ensureAuthenticated().then(() => {
      const user = api.getCurrentUser();
      if (!(user && user.role === 'admin')) {
        this.setData({ loading: false, isAdmin: false });
        return;
      }
      this.setData({ loading: false, isAdmin: true }, () => this.loadTrainingPlans());
    }).catch(error => {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '登录状态获取失败', icon: 'none' });
    });
  },

  loadTrainingPlans() {
    this.setData({ trainingLoading: true });
    api.getSupervisorTrainingPlans({ status: this.data.planStatus }).then(data => {
      this.setData({
        plans: normalizePlans(data.plans || []),
        trainingLoading: false
      });
    }).catch(error => {
      this.setData({ trainingLoading: false });
      wx.showToast({ title: error.message || '培训计划加载失败', icon: 'none' });
    });
  },

  selectPlanStatus(e) {
    const planStatus = e.currentTarget.dataset.id;
    if (!planStatus || planStatus === this.data.planStatus) return;
    this.setData({ planStatus }, () => this.loadTrainingPlans());
  },

  openPlanCreate() {
    wx.navigateTo({ url: '/pages/admin-training-plan-create/admin-training-plan-create' });
  },

  openPlanDetail(e) {
    const planId = e.currentTarget.dataset.id;
    if (!planId) return;
    wx.navigateTo({ url: `/pages/admin-training-plan-detail/admin-training-plan-detail?id=${encodeURIComponent(planId)}` });
  },

  /* 无订阅消息通道，提醒动作降级为「复制未完成名单」，由主管自行触达 */
  copyPlanMembers(e) {
    const planId = e.currentTarget.dataset.id;
    if (!planId) return;
    wx.showLoading({ title: '整理名单…', mask: true });
    api.notifyTrainingPlan(planId).then(data => {
      wx.hideLoading();
      const pending = data.pendingLearners || [];
      if (!pending.length) {
        wx.showToast({ title: '该计划已全部完成', icon: 'none' });
        return;
      }
      const lines = pending.map((item, index) => `${index + 1}. ${item.displayName}`).join('\n');
      wx.setClipboardData({
        data: lines,
        success: () => wx.showToast({ title: `已复制 ${pending.length} 人名单`, icon: 'none' }),
        fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
      });
    }).catch(error => {
      wx.hideLoading();
      wx.showToast({ title: error.message || '名单获取失败', icon: 'none' });
    });
  },

  /* 学员身份误入时的退路 */
  goHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});
