// MVP 本地演示数据层。
// 真实后端接入时，只需要将本文件中的读写和模型调用替换为 API 请求。

const STORAGE_KEY = 'oral_training_mvp_sessions';

const SCENARIOS = [
  {
    id: 'implant',
    name: '种植牙基础咨询',
    difficulty: '基础',
    summary: '患者缺失一颗后牙，想了解种植牙的流程、疼痛和大致时间。',
    patientAge: '52岁',
    patientConcern: '缺失一颗后牙，对种植牙了解较少',
    patientEmotion: '平静但谨慎',
    focus: ['基础信息解释', '需求挖掘', '回应担忧', '引导专业检查'],
    opening: '您好，我缺了一颗后牙，想问问种植牙大概怎么做，会不会很疼，要多久？',
    hidden: ['存在预算压力', '最担心手术疼痛'],
    initialState: { emotion: '平静', emotionLevel: 0, trustLevel: 50 }
  },
  {
    id: 'orthodontics',
    name: '正畸基础咨询',
    difficulty: '基础',
    summary: '患者牙齿不整齐，关注隐形矫正的周期、费用和是否需要拔牙。',
    patientAge: '22岁',
    patientConcern: '牙齿不整齐影响外观，正在考虑隐形矫正',
    patientEmotion: '期待但犹豫',
    focus: ['澄清外观与功能诉求', '说明检查流程', '避免越权判断', '不承诺固定周期'],
    opening: '我牙齿有点不整齐，想做隐形矫正。一般要多久，大概要多少钱，需要拔牙吗？',
    hidden: ['即将毕业，担心影响求职', '预算有限', '对“必须拔牙”非常敏感'],
    initialState: { emotion: '犹豫', emotionLevel: 0, trustLevel: 50 }
  },
  {
    id: 'comparison',
    name: '与其他诊所比价',
    difficulty: '进阶',
    summary: '患者已经咨询过多家诊所，认为当前报价较高，关注价格背后的差异。',
    patientAge: '45岁',
    patientConcern: '已咨询多家诊所，认为当前报价偏高',
    patientEmotion: '理性且警惕',
    focus: ['询问比较标准', '解释价格构成', '不贬低其他机构', '保持收费透明'],
    opening: '我已经问过好几家了，你们这里的报价明显更高，为什么要比别人贵这么多？',
    hidden: ['更关心医生经验和材料', '在意后续服务与收费透明度'],
    initialState: { emotion: '犹豫', emotionLevel: -1, trustLevel: 45 }
  },
  {
    id: 'aftercare',
    name: '术后不适咨询',
    difficulty: '进阶',
    summary: '患者治疗后出现疼痛或肿胀，焦虑地询问客服能否判断是否正常。',
    patientAge: '38岁',
    patientConcern: '治疗后出现不适，担心治疗失败',
    patientEmotion: '焦虑',
    focus: ['先安抚情绪', '追问症状信息', '识别风险信号', '及时联系医生'],
    opening: '我做完治疗后一直疼，还有点肿，我很担心是不是治疗失败了，你们能不能先帮我判断一下？',
    hidden: ['症状发生时间和程度尚不完整', '可能存在需要及时联系医生的风险信号'],
    initialState: { emotion: '焦虑', emotionLevel: -2, trustLevel: 35 }
  }
];

const nowText = () => {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const clone = value => JSON.parse(JSON.stringify(value));

const findScenario = id => SCENARIOS.find(item => item.id === id) || SCENARIOS[0];

const toPublicScenario = scenario => {
  const publicScenario = clone(scenario);
  delete publicScenario.hidden;
  delete publicScenario.initialState;
  return publicScenario;
};

const getScenarios = () => SCENARIOS.map(toPublicScenario);

const getScenario = id => toPublicScenario(findScenario(id));

const getSessions = () => {
  const sessions = wx.getStorageSync(STORAGE_KEY);
  if (!Array.isArray(sessions)) return [];
  return sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
};

const saveSessions = sessions => wx.setStorageSync(STORAGE_KEY, sessions);

const saveSession = session => {
  const sessions = getSessions();
  const index = sessions.findIndex(item => item.id === session.id);
  if (index === -1) sessions.push(session);
  else sessions[index] = session;
  saveSessions(sessions);
  return session;
};

const getSession = id => getSessions().find(item => item.id === id);

const getInProgressSession = scenarioId => getSessions().find(item => item.scenarioId === scenarioId && item.status === 'in_progress');

const createSession = scenarioId => {
  const scenario = findScenario(scenarioId);
  const state = {
    emotion: scenario.initialState.emotion,
    emotionLevel: scenario.initialState.emotionLevel,
    trustLevel: scenario.initialState.trustLevel,
    revealedInformation: [],
    riskTriggered: false
  };
  const timestamp = nowText();
  const session = {
    id: `session-${Date.now()}`,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    status: 'in_progress',
    currentRound: 0,
    maxRounds: 10,
    startedAt: timestamp,
    updatedAt: timestamp,
    endedAt: '',
    patientState: state,
    messages: [{
      id: `message-${Date.now()}`,
      role: 'patient',
      content: scenario.opening,
      round: 0,
      time: timestamp
    }],
    evaluation: null
  };
  return saveSession(session);
};

const abandonSession = id => {
  const session = getSession(id);
  if (!session || session.status !== 'in_progress') return session;
  session.status = 'abandoned';
  session.updatedAt = nowText();
  return saveSession(session);
};

const reveal = (state, text) => {
  const next = clone(state);
  const add = value => {
    if (next.revealedInformation.indexOf(value) === -1) next.revealedInformation.push(value);
  };
  if (/预算|费用|价格|多少钱|贵/.test(text)) add('患者存在预算压力或价格顾虑');
  if (/疼|痛|怕|担心|害怕/.test(text)) add('患者最担心疼痛或治疗风险');
  if (/毕业|工作|求职|外观|形象/.test(text)) add('患者担心正畸影响求职和日常形象');
  if (/医生|材料|品牌|服务|收费|明细|比较/.test(text)) add('患者更关心医生经验、材料和收费透明度');
  if (/多久|几天|什么时候|时间|程度|多严重|出血|发热|肿/.test(text)) add('患者补充了部分术后症状信息');
  return next;
};

const generatePatientReply = (scenarioId, userContent, round, patientState) => {
  const scenario = findScenario(scenarioId);
  const text = userContent.trim();
  let state = reveal(patientState, text);
  const empathic = /理解|担心|抱歉|辛苦|难受|不舒服|着急/.test(text);
  const asks = /请问|方便|能否|是否|有没有|什么|怎么|多久|多少|预算|顾虑|担心|症状|程度|时间|比较/.test(text);
  const risky = /保证|肯定|一定|绝对|无痛|不会有问题|不需要医生|肯定不用拔牙|肯定需要拔牙/.test(text);

  if (empathic) {
    state.trustLevel = Math.min(100, state.trustLevel + 8);
    state.emotionLevel = Math.min(2, state.emotionLevel + 1);
  }
  if (asks) state.trustLevel = Math.min(100, state.trustLevel + 4);
  if (risky) {
    state.trustLevel = Math.max(0, state.trustLevel - 15);
    state.emotionLevel = Math.max(-2, state.emotionLevel - 1);
    state.riskTriggered = true;
  }
  state.emotion = state.emotionLevel <= -2 ? '焦虑' : state.emotionLevel < 0 ? '犹豫' : state.emotionLevel > 0 ? '缓和' : '平静';

  if (risky) {
    return {
      reply: scenario.id === 'aftercare'
        ? '你先别直接说肯定正常，我现在还是很疼，万一有问题怎么办？我是不是应该马上联系医生？'
        : '你这样直接保证，我反而有点不放心。不是还要结合检查和医生判断吗？',
      state
    };
  }

  if (scenario.id === 'implant') {
    if (/疼|痛|麻醉/.test(text)) return { reply: '我最担心的就是手术疼不疼。如果需要检查，我也想先知道大概的费用范围。', state };
    if (/预算|费用|价格|多少钱|贵/.test(text)) return { reply: '价格确实是我需要考虑的，除了费用，我还想知道医生经验和后续复查是怎样安排的。', state };
    if (/检查|面诊|医生|方案/.test(text)) return { reply: '如果要面诊检查才能确定方案，我可以理解。那一般会先检查哪些情况，再由医生和我确认吗？', state };
    if (round >= 5) return { reply: '你刚才说明得比较清楚。我愿意先做检查，再和医生确认适合我的方案。', state };
    return { reply: '我主要还是担心疼痛和费用。客服这边能介绍基础流程吗？具体方案是不是要检查后才能知道？', state };
  }

  if (scenario.id === 'orthodontics') {
    if (/拔牙/.test(text)) return { reply: '我对拔牙这件事比较敏感，真的不能现在就判断一定要不要拔吗？我马上要毕业了，也担心影响形象。', state };
    if (/预算|费用|价格|多少钱|贵/.test(text)) return { reply: '我预算比较有限，除了总价之外，也想了解复诊和后续费用会不会另外计算。', state };
    if (/检查|面诊|医生|影像/.test(text)) return { reply: '如果要看检查结果才能判断，我愿意了解。那面诊和影像检查会重点看哪些方面？', state };
    if (round >= 5) return { reply: '我明白了，周期和是否拔牙都不能只凭聊天确定。我可以先预约评估，再决定方案。', state };
    return { reply: '我比较在意毕业求职时的外观，也担心预算超出。你们能先讲讲评估流程吗？', state };
  }

  if (scenario.id === 'comparison') {
    if (/医生|材料|品牌|服务|收费|明细/.test(text)) return { reply: '这些确实是我在比较的重点。你们能把医生经验、材料和后续服务的费用明细说清楚吗？', state };
    if (/便宜|价格|费用|贵|报价|比较/.test(text)) return { reply: '我不只是想找最低价，但希望知道价格差异具体来自哪里，后续有没有容易被忽略的收费？', state };
    if (round >= 5) return { reply: '如果能基于检查结果和完整方案透明比较，我愿意继续了解，不需要用贬低别家的方式说服我。', state };
    return { reply: '我已经咨询过几家了。除了价格，你们觉得患者比较时还应该重点看哪些内容？', state };
  }

  if (/时间|多久|几天|程度|多严重|出血|发热|肿|症状/.test(text)) {
    return { reply: '我是昨天做完治疗后开始不舒服的，现在有疼痛和肿胀，程度比刚做完时明显一些。我有点担心，想尽快知道下一步该怎么办。', state };
  }
  if (/医生|复查|联系|医院|面诊/.test(text)) return { reply: '如果你们不能直接判断，我希望尽快联系医生或安排复查。你能帮我记录一下情况吗？', state };
  if (round >= 5) return { reply: '谢谢你先问清楚我的症状。我愿意按你说的联系医生确认，不想只听一句“肯定正常”。', state };
  return { reply: '我现在比较焦虑，疼痛和肿胀到底持续了多久、什么程度才需要尽快联系医生？', state };
};

const findViolations = messages => {
  const violations = [];
  const patterns = [
    { regex: /保证(成功|有效|效果|疗效|不疼|无痛)|百分之百|100%/, type: '疗效或结果承诺', reason: '客服不能保证治疗效果、成功率或绝对无痛。', deduction: 35, rewrite: '可以说明一般流程和可能感受，并提示具体情况需要由医生检查后判断。' },
    { regex: /肯定(不用|需要)拔牙|一定(不用|需要)拔牙/, type: '越权判断治疗方案', reason: '是否拔牙需要结合面诊和影像检查，客服不应直接下结论。', deduction: 30, rewrite: '是否需要拔牙要由医生结合面诊和影像检查评估。' },
    { regex: /肯定正常|一定正常|不用联系医生|不用复查/, type: '术后风险处理不当', reason: '术后症状信息不完整时，不能直接判断正常或劝阻患者联系医生。', deduction: 40, rewrite: '先询问症状时间、程度和伴随表现，并建议及时联系医生评估。' },
    { regex: /(别家|其他诊所|同行).*(差|不行|坑人|不靠谱)|我们(家)?肯定最好/, type: '不当贬低或绝对化比较', reason: '不应贬低其他机构或作“最好”等绝对化承诺。', deduction: 20, rewrite: '可以客观解释本机构的服务内容、费用构成和差异，让患者基于完整信息比较。' }
  ];
  messages.filter(item => item.role === 'user').forEach(message => {
    patterns.forEach(pattern => {
      if (pattern.regex.test(message.content)) {
        violations.push({
          id: `violation-${message.id}-${violations.length}`,
          round: message.round,
          quote: message.content,
          type: pattern.type,
          reason: pattern.reason,
          deduction: pattern.deduction,
          rewrite: pattern.rewrite
        });
      }
    });
  });
  return violations;
};

const evaluateSession = session => {
  const userMessages = session.messages.filter(item => item.role === 'user');
  const text = userMessages.map(item => item.content).join(' ');
  const count = userMessages.length;
  const violations = findViolations(session.messages);
  const hasEmpathy = /理解|担心|抱歉|辛苦|难受|不舒服|着急/.test(text);
  const hasBoundary = /检查|面诊|影像|医生|复查|评估|不能确定|需要确认/.test(text);
  const hasQuestions = /请问|方便|顾虑|预算|症状|程度|时间|担心|需求|比较|在意|期望/.test(text);
  const polite = /您好|您|请|谢谢|理解|方便/.test(text);

  const dimensionScores = {
    knowledge: Math.min(100, 55 + (hasBoundary ? 20 : 0) + Math.min(15, count * 2)),
    compliance: Math.max(0, Math.min(100, 78 - violations.reduce((sum, item) => sum + item.deduction, 0))),
    empathy: Math.min(100, 55 + (hasEmpathy ? 25 : 0) + Math.min(10, count * 2)),
    demand: Math.min(100, 48 + (hasQuestions ? 25 : 0) + Math.min(15, count * 2)),
    etiquette: Math.min(100, 62 + (polite ? 24 : 0) + Math.min(10, count * 2))
  };
  const totalScore = Math.max(0, Math.round(
    dimensionScores.knowledge * 0.25 +
    dimensionScores.compliance * 0.25 +
    dimensionScores.empathy * 0.20 +
    dimensionScores.demand * 0.20 +
    dimensionScores.etiquette * 0.10
  ));
  const strengths = [];
  if (hasEmpathy) strengths.push('能先回应患者的担忧或不适，保持基本同理心。');
  if (hasQuestions) strengths.push('有意识追问患者的顾虑、预算或症状信息。');
  if (hasBoundary) strengths.push('能够提示面诊、检查或医生评估的重要性。');
  if (!strengths.length) strengths.push('完成了本次多轮对练，并保持了基本客服沟通。');

  const improvements = [];
  if (!hasEmpathy) improvements.push('先承接患者情绪，再补充流程或费用信息。');
  if (!hasQuestions) improvements.push('不要直接推方案，先询问患者的具体需求和顾虑。');
  if (!hasBoundary || violations.length) improvements.push('涉及治疗方案、效果或术后风险时，明确交由医生检查评估。');
  if (!improvements.length) improvements.push('继续保持结构化表达，并把关键下一步行动说得更具体。');

  const roundComments = userMessages.slice(0, 4).map(message => {
    const violation = violations.find(item => item.round === message.round);
    return {
      round: message.round,
      userQuote: message.content,
      comment: violation ? violation.reason : (hasEmpathy && /理解|担心|抱歉/.test(message.content) ? '这句话有助于先接住患者情绪，再继续沟通。' : '可以继续补充追问，让回应更贴合患者的具体情况。'),
      rewrite: violation ? violation.rewrite : '我理解您的顾虑，我们可以先了解具体情况，再由医生检查后确认适合的方案。'
    };
  });

  return {
    totalScore,
    dimensionScores,
    summary: totalScore >= 80 ? '整体沟通比较稳妥，能较好地兼顾患者感受与医疗边界。' : '完成了基本沟通，但在需求追问、情绪回应或医疗合规边界上还有提升空间。',
    strengths: strengths.slice(0, 3),
    improvements: improvements.slice(0, 3),
    violations,
    roundComments,
    modelVersion: 'mvp-demo-rule-v1'
  };
};

const finishSession = id => {
  const session = getSession(id);
  if (!session) return null;
  session.status = 'completed';
  session.endedAt = nowText();
  session.updatedAt = session.endedAt;
  session.evaluation = evaluateSession(session);
  return saveSession(session);
};

const getDashboard = () => {
  const sessions = getSessions();
  const validSessions = sessions.filter(item => item.status !== 'abandoned');
  const completedSessions = validSessions.filter(item => item.status === 'completed' && item.evaluation);
  const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const dimensionKeys = ['knowledge', 'compliance', 'empathy', 'demand', 'etiquette'];
  const sceneStats = SCENARIOS.map(scenario => {
    const count = validSessions.filter(item => item.scenarioId === scenario.id).length;
    return { id: scenario.id, name: scenario.name, count, barWidth: count > 0 ? 100 : 0 };
  });
  const dimensionAverages = dimensionKeys.map(key => ({
    key,
    name: { knowledge: '口腔知识准确性', compliance: '医疗合规', empathy: '情绪识别与同理心', demand: '需求挖掘', etiquette: '服务礼仪' }[key],
    value: average(completedSessions.map(item => item.evaluation.dimensionScores[key]))
  }));
  return {
    totalCount: validSessions.length,
    completedCount: completedSessions.length,
    averageScore: average(completedSessions.map(item => item.evaluation.totalScore)),
    sceneStats,
    dimensionAverages,
    recentSessions: validSessions.slice(0, 5)
  };
};

module.exports = {
  getScenarios,
  getScenario,
  getSessions,
  getSession,
  getInProgressSession,
  createSession,
  saveSession,
  abandonSession,
  generatePatientReply,
  finishSession,
  getDashboard,
  STORAGE_KEY
};
