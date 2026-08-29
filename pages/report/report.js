const api = require('../../utils/api.js');

Page({
  data: { sessions: [], expandedId: '', historyMode: 'customer_service' },

  onShow() { this.loadSessions(); },

  loadSessions() {
    this.historyRequestVersion = (this.historyRequestVersion || 0) + 1;
    const requestVersion = this.historyRequestVersion;
    const requestedMode = this.data.historyMode;
    const isRoleplay = requestedMode === 'patient_simulation';
    const request = isRoleplay ? api.getRoleplaySessions({ status: 'all', limit: 50 }) : api.getSessions({ status: 'all', limit: 50 });
    request.then(data => {
      if (requestVersion !== this.historyRequestVersion || requestedMode !== this.data.historyMode) return;
      const sessions = data.items.map(item => Object.assign({}, item, {
        statusText: item.status === 'in_progress' ? '进行中' : item.status === 'completed' ? '已完成' : '已放弃',
        statusClass: item.status,
        actionText: item.status === 'in_progress'
          ? (isRoleplay ? '继续模拟' : '继续训练')
          : item.status === 'completed'
            ? (isRoleplay ? '查看复盘' : '查看报告')
            : '查看对话',
        evaluation: !isRoleplay && item.totalScore !== null ? { totalScore: item.totalScore } : null,
        isRoleplay,
        messages: []
      }));
      this.setData({ sessions, expandedId: '' });
    }).catch(error => {
      if (requestVersion !== this.historyRequestVersion || requestedMode !== this.data.historyMode) return;
      wx.showToast({ title: error.message || '历史记录加载失败', icon: 'none' });
    });
  },

  switchHistoryMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.historyMode) return;
    this.setData({ historyMode: mode, sessions: [], expandedId: '' }, () => this.loadSessions());
  },

  handleAction(e) {
    const session = this.data.sessions.find(item => item.id === e.currentTarget.dataset.id);
    if (!session) return;
    if (session.status === 'in_progress') {
      const page = session.isRoleplay ? 'roleplay/roleplay' : 'training/training';
      wx.navigateTo({ url: `/pages/${page}?sessionId=${session.id}` });
    } else if (session.status === 'completed') {
      const page = session.isRoleplay ? 'roleplay-result/roleplay-result' : 'result/result';
      wx.navigateTo({ url: `/pages/${page}?sessionId=${session.id}` });
    } else {
      this.toggleConversation({ currentTarget: { dataset: { id: session.id } } });
    }
  },

  toggleConversation(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.expandedId === id) {
      this.setData({ expandedId: '' });
      return;
    }
    const session = this.data.sessions.find(item => item.id === id);
    if (!session) return;
    const requestedMode = this.data.historyMode;
    this.conversationRequestVersion = (this.conversationRequestVersion || 0) + 1;
    const requestVersion = this.conversationRequestVersion;
    const request = session.isRoleplay ? api.getRoleplaySession(id) : api.getSession(id);
    request.then(data => {
      if (requestVersion !== this.conversationRequestVersion || requestedMode !== this.data.historyMode) return;
      const messages = (data.messages || []).map(message => Object.assign({}, message, {
        learningPoints: message.learningPoints || []
      }));
      const sessions = this.data.sessions.map(item => item.id === id
        ? Object.assign({}, item, { messages })
        : item);
      this.setData({ sessions, expandedId: id });
    }).catch(error => {
      if (requestVersion !== this.conversationRequestVersion || requestedMode !== this.data.historyMode) return;
      wx.showToast({ title: error.message, icon: 'none' });
    });
  }
});
