const api = require('../../utils/api.js');

Page({
  data: { sessions: [], expandedId: '' },

  onShow() {
    api.getSessions({ status: 'all', limit: 50 }).then(data => {
      const sessions = data.items.map(item => Object.assign({}, item, {
        statusText: item.status === 'in_progress' ? '进行中' : item.status === 'completed' ? '已完成' : '已放弃',
        statusClass: item.status,
        actionText: item.status === 'in_progress' ? '继续训练' : item.status === 'completed' ? '查看报告' : '查看对话',
        evaluation: item.totalScore === null ? null : { totalScore: item.totalScore },
        messages: []
      }));
      this.setData({ sessions });
    }).catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  },

  handleAction(e) {
    const session = this.data.sessions.find(item => item.id === e.currentTarget.dataset.id);
    if (!session) return;
    if (session.status === 'in_progress') wx.navigateTo({ url: `/pages/training/training?sessionId=${session.id}` });
    else if (session.status === 'completed') wx.navigateTo({ url: `/pages/result/result?sessionId=${session.id}` });
    else this.toggleConversation({ currentTarget: { dataset: { id: session.id } } });
  },

  toggleConversation(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.expandedId === id) {
      this.setData({ expandedId: '' });
      return;
    }
    api.getSession(id).then(data => {
      const sessions = this.data.sessions.map(item => item.id === id ? Object.assign({}, item, { messages: data.messages }) : item);
      this.setData({ sessions, expandedId: id });
    }).catch(error => wx.showToast({ title: error.message, icon: 'none' }));
  }
});
