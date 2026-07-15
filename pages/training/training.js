// pages/training/training.js
const util = require('../../utils/util.js');

Page({
  data: {
    levelId: null,
    levelName: '',
    patientProfile: '',
    messages: [],
    inputValue: '',
    scrollToView: '',
    isTrainingEnd: false,
    sending: false,
    remainingTurns: 20
  },

  conversationId: null,
  currentTurn: 0,

  onLoad(options) {
    const levelId = parseInt(options.levelId);
    this.setData({ levelId });
    this.startTraining();
  },

  startTraining() {
    // 根据关卡ID设置不同的场景
    const levelConfig = this.getLevelConfig(this.data.levelId);
    
    this.conversationId = Date.now();
    this.setData({
      levelName: levelConfig.name,
      patientProfile: levelConfig.patientProfile,
      messages: [{
        id: Date.now(),
        role: 'ai',
        content: levelConfig.initMessage,
        timestamp: util.formatTime(new Date())
      }],
      remainingTurns: 20
    });
  },

  getLevelConfig(levelId) {
    const configs = {
      1: {
        name: '低价引流与羊毛党转化',
        patientProfile: '25岁女性，预算有限，只在乎价格，对口腔健康不重视',
        initMessage: '我就想洗个牙，别的什么都不想做，你们家9.9元的券能用吗？'
      },
      2: {
        name: '种植牙价格异议攻坚',
        patientProfile: '50岁中年女性，缺牙多年，对价格极度敏感，喜欢比价',
        initMessage: '你们种一颗牙要8000？别家才1999，太贵了！'
      },
      3: {
        name: '信任危机与安全焦虑',
        patientProfile: '40岁男性，有牙科恐惧症，极度不信任民营诊所',
        initMessage: '我听说种植牙会致癌，网上都这么说的，是真的吗？'
      },
      4: {
        name: '术后投诉与焦虑安抚',
        patientProfile: '35岁女性，刚做完拔牙手术，疼痛难忍，情绪崩溃',
        initMessage: '你们什么垃圾技术！我牙疼得一晚没睡，我要去工商投诉你们！'
      }
    };
    return configs[levelId] || configs[1];
  },

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  sendMessage() {
    const content = this.data.inputValue.trim();
    if (!content || this.data.isTrainingEnd) return;

    this.setData({ sending: true });

    // 添加用户消息
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: content,
      timestamp: util.formatTime(new Date())
    };
    const messages = [...this.data.messages, userMsg];
    this.setData({
      messages: messages,
      inputValue: '',
      scrollToView: 'msg-bottom'
    });

    this.currentTurn++;

    // 模拟AI回复（延迟）
    setTimeout(() => {
      const aiResponse = this.getAIResponse(content, this.data.levelId, this.currentTurn);
      
      const aiMsg = {
        id: Date.now() + 1,
        role: 'ai',
        content: aiResponse.reply,
        suggestedReply: aiResponse.suggestedReply,
        timestamp: util.formatTime(new Date())
      };
      
      const newMessages = [...this.data.messages, aiMsg];
      this.setData({
        messages: newMessages,
        scrollToView: 'msg-bottom',
        remainingTurns: 20 - this.currentTurn,
        sending: false
      });

      // 结束条件
      if (this.currentTurn >= 10 || 
          (content.includes('预约') || content.includes('到店') || content.includes('检查'))) {
        this.endTraining();
      }
    }, 800);
  },

  getAIResponse(userMsg, levelId, turn) {
    // 不同场景的AI回复和黄金话术
    const responses = {
      1: {
        replies: [
          '还是太贵了，我就只想洗个牙。',
          '你说的这些我都不懂，我就看价格。',
          '那我再考虑考虑吧。',
          '你们这个套餐都包含什么？'
        ],
        suggestion: '我理解您对价格的关心。我们的洗牙套餐虽然是9.9元，但包含全面的口腔检查，可以帮您了解牙齿健康状况。'
      },
      2: {
        replies: [
          '8000太贵了，别家才1999。',
          '你说的是进口的？有什么区别？',
          '我还是觉得太贵了，能便宜点吗？',
          '我先去别家看看。'
        ],
        suggestion: '我理解您对价格的关心。我们的种植体都是国际一线品牌，医生有10年以上经验，术后还有5年质保。算下来每天其实只要几块钱。'
      },
      3: {
        replies: [
          '网上说的那些案例是真的吗？',
          '我还是不放心，万一失败怎么办？',
          '你们用的材料是真的进口的吗？',
          '我感觉你们就是想要钱。'
        ],
        suggestion: '您有这样的担心很正常。种植体是医用纯钛材料，生物相容性极好，国内外几十年临床研究已证实其安全性。'
      },
      4: {
        replies: [
          '疼得我一晚没睡！你们必须负责！',
          '我要投诉你们！',
          '你们医生在哪里？让他来解释！',
          '退款！我要退款！'
        ],
        suggestion: '非常抱歉给您带来不好的体验。术后疼痛确实很难受，我马上帮您联系医生处理。您方便描述一下具体哪里疼吗？'
      }
    };

    const config = responses[levelId] || responses[1];
    const replyIndex = Math.min(turn - 1, config.replies.length - 1);
    
    return {
      reply: config.replies[replyIndex] || config.replies[0],
      suggestedReply: config.suggestion
    };
  },

  endTraining() {
    this.setData({ isTrainingEnd: true });

    // 计算模拟分数
    const score = Math.floor(Math.random() * 30) + 65;
    const empathyScore = Math.floor(Math.random() * 30) + 60;
    const demandScore = Math.floor(Math.random() * 30) + 55;
    const valueScore = Math.floor(Math.random() * 30) + 60;
    const appointmentScore = this.data.messages.some(m => 
      m.role === 'user' && (m.content.includes('预约') || m.content.includes('到店'))
    ) ? 100 : 50;

    setTimeout(() => {
      wx.redirectTo({
        url: `/pages/result/result?score=${score}&empathy=${empathyScore}&demand=${demandScore}&value=${valueScore}&appointment=${appointmentScore}&compliance=85`
      });
    }, 1500);
  }
});