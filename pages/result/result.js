// pages/result/result.js
const request = require('../../static/api/request.js');
const util = require('../../utils/util.js');

Page({
  data: {
    conversationId: null,
    loading: true,
    score: 0,
    totalScore: 0,
    empathyScore: 0,
    demandScore: 0,
    valueScore: 0,
    appointmentScore: 0,
    complianceScore: 100,
    passed: false,
    evaluation: '',
    levelInfo: {},
    radarData: []
  },

  onLoad(options) {
    const conversationId = options.conversationId;
    this.setData({ conversationId });
    this.loadResult();
  },

  // 加载结果
  async loadResult() {
    util.showLoading('分析中...');

    try {
      const res = await request.get(`/result/${this.data.conversationId}`);
      
      util.hideLoading();
      
      const score = res.totalScore || 0;
      const passed = score >= 60;
      
      let evaluation = '';
      if (score >= 85) {
        evaluation = '🎉 太棒了！你的表现非常出色，话术专业，应对自如，已经具备了高级客服的素质！';
      } else if (score >= 70) {
        evaluation = '👍 表现不错！基本掌握了应对技巧，但在价值塑造和邀约转化上还有提升空间。';
      } else if (score >= 60) {
        evaluation = '📝 刚刚及格，建议多练习价格异议和需求挖掘的话术，多看看黄金话术示例。';
      } else {
        evaluation = '💪 再接再厉！本次训练暴露了一些薄弱环节，建议反复练习，认真学习黄金话术。';
      }

      this.setData({
        loading: false,
        score: score,
        totalScore: score,
        empathyScore: res.empathyScore || 0,
        demandScore: res.demandScore || 0,
        valueScore: res.valueScore || 0,
        appointmentScore: res.appointmentScore || 0,
        complianceScore: res.complianceScore || 100,
        passed: passed,
        evaluation: evaluation,
        levelInfo: res.levelInfo || {},
        radarData: [
          { name: '同理心', value: res.empathyScore || 0, max: 100 },
          { name: '需求挖掘', value: res.demandScore || 0, max: 100 },
          { name: '价值塑造', value: res.valueScore || 0, max: 100 },
          { name: '邀约转化', value: res.appointmentScore || 0, max: 100 },
          { name: '合规意识', value: res.complianceScore || 100, max: 100 }
        ]
      });

      // 绘制雷达图
      this.drawRadarChart();

    } catch (err) {
      util.hideLoading();
      console.error('加载结果失败', err);
      util.showToast(err || '加载失败');
      this.setData({ loading: false });
    }
  },

  // 绘制雷达图
  drawRadarChart() {
    const query = wx.createSelectorQuery();
    query.select('#radarCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const width = res[0].width;
        const height = res[0].height;
        
        canvas.width = width;
        canvas.height = height;
        
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 2 - 40;
        
        const data = this.data.radarData;
        const dimensions = data.length;
        const angleStep = (Math.PI * 2) / dimensions;
        
        // 清空画布
        ctx.clearRect(0, 0, width, height);
        
        // 绘制背景网格
        const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
        ctx.strokeStyle = '#ddd';
        ctx.fillStyle = '#ddd';
        ctx.font = '12px sans-serif';
        
        for (let i = 0; i < levels.length; i++) {
          ctx.beginPath();
          const r = radius * levels[i];
          for (let j = 0; j <= dimensions; j++) {
            const angle = j * angleStep - Math.PI / 2;
            const x = centerX + r * Math.cos(angle);
            const y = centerY + r * Math.sin(angle);
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
        
        // 绘制轴线
        for (let i = 0; i < dimensions; i++) {
          const angle = i * angleStep - Math.PI / 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(x, y);
          ctx.stroke();
          
          // 绘制标签
          const labelX = centerX + (radius + 20) * Math.cos(angle);
          const labelY = centerY + (radius + 20) * Math.sin(angle);
          ctx.fillStyle = '#666';
          ctx.fillText(data[i].name, labelX - 15, labelY);
        }
        
        // 绘制数据区域
        ctx.beginPath();
        for (let i = 0; i < dimensions; i++) {
          const value = data[i].value / data[i].max;
          const r = radius * Math.min(value, 1);
          const angle = i * angleStep - Math.PI / 2;
          const x = centerX + r * Math.cos(angle);
          const y = centerY + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 122, 255, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#007aff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
  },

  // 重新挑战
  retry() {
    wx.navigateBack();
  },

  // 下一关
  nextLevel() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  // 查看详细报告
  viewDetailReport() {
    wx.navigateTo({
      url: `/pages/report/report?conversationId=${this.data.conversationId}`
    });
  },

  // 分享成绩
  onShareAppMessage() {
    return {
      title: `我获得了${this.data.score}分！AI口腔客服陪练挑战成功`,
      path: `/pages/index/index`
    };
  }
});