const mvp = require('../../utils/mvp.js');

Page({
  data: { sessions: [], expandedId: '' },

  onShow() {
    const sessions = mvp.getSessions().map(item => Object.assign({}, item, {
      statusText: item.status === 'in_progress' ? '进行中' : item.status === 'completed' ? '已完成' : '已放弃',
      statusClass: item.status,
      actionText: item.status === 'in_progress' ? '继续训练' : item.status === 'completed' ? '查看报告' : '查看对话'
    }));
    this.setData({ sessions });
  },

  handleAction(e) {
    const session = mvp.getSession(e.currentTarget.dataset.id);
    if (!session) return;
    if (session.status === 'in_progress') wx.navigateTo({ url: `/pages/training/training?sessionId=${session.id}` });
    else if (session.status === 'completed') wx.navigateTo({ url: `/pages/result/result?sessionId=${session.id}` });
    else this.toggleConversation({ currentTarget: { dataset: { id: session.id } } });
  },

  toggleConversation(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  }
});
