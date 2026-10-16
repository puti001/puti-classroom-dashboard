/**
 * Puti-AI | 研習課堂儀表板後端 Google Apps Script
 * 作者：屏東縣後庄國小黃朝榮老師
 */

const SHEET_NAME_CHECKIN = '研習簽到表';
const CACHE_KEY_BUZZER = 'puti_buzzer_state';
const CACHE_KEY_KAHOOT = 'puti_kahoot_state';

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = p.action;

  // 1. 取得簽到名單
  if (action === 'getCheckins') {
    return jsonOutput(getCheckinList());
  }

  // 2. 搶答相關 API
  if (action === 'getBuzzerStatus') {
    return jsonOutput(getBuzzerState());
  }
  if (action === 'startBuzzer') {
    return jsonOutput(startBuzzerRound());
  }
  if (action === 'resetBuzzer') {
    return jsonOutput(resetBuzzerState());
  }
  if (action === 'buzz') {
    return jsonOutput(handleBuzz(p.name, p.school, p.roundId));
  }

  // 3. Kahoot 即時問答相關 API
  if (action === 'getKahootStatus') {
    return jsonOutput(getKahootState());
  }
  if (action === 'setKahootQuestion') {
    return jsonOutput(setKahootQuestionState(p.qIndex, p.status, p.correctOption));
  }
  if (action === 'submitKahootAnswer') {
    return jsonOutput(handleKahootAnswer(p.name, p.school, p.qIndex, p.option));
  }
  if (action === 'resetKahoot') {
    return jsonOutput(resetKahootState());
  }
  
  // 預設渲染手機端頁面（報到 + 搶答 + Kahoot 一體化介面）
  return HtmlService.createTemplateFromFile('checkin_mobile')
    .evaluate()
    .setTitle('Puti-AI | 研習課堂互動端')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      data = e.parameter;
    }
    
    const action = data.action;
    if (action === 'buzz') {
      return jsonOutput(handleBuzz(data.name, data.school, data.roundId));
    }
    if (action === 'startBuzzer') {
      return jsonOutput(startBuzzerRound());
    }
    if (action === 'resetBuzzer') {
      return jsonOutput(resetBuzzerState());
    }
    if (action === 'submitKahootAnswer') {
      return jsonOutput(handleKahootAnswer(data.name, data.school, data.qIndex, data.option));
    }
    if (action === 'setKahootQuestion') {
      return jsonOutput(setKahootQuestionState(data.qIndex, data.status, data.correctOption));
    }

    // 預設為儲存簽到
    const result = saveCheckin(data);
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ status: 'error', message: err.toString() });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================== Kahoot 即時互動問答引擎 (CacheService Kahoot Engine) ========================

function getKahootState() {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(CACHE_KEY_KAHOOT);
  if (!raw) {
    return {
      active: false,
      qIndex: 0,
      status: 'idle', // 'open', 'closed', 'idle'
      counts: { A: 0, B: 0, C: 0, D: 0 },
      voters: [],
      correctOption: ''
    };
  }
  try {
    return JSON.parse(raw);
  } catch(e) {
    return { active: false, qIndex: 0, status: 'idle', counts: { A: 0, B: 0, C: 0, D: 0 }, voters: [], correctOption: '' };
  }
}

function setKahootQuestionState(qIndex, status, correctOption) {
  const cache = CacheService.getScriptCache();
  let state = getKahootState();
  const parsedIndex = parseInt(qIndex || 0, 10);

  // 如果題目換了，重置計票
  if (state.qIndex !== parsedIndex) {
    state = {
      active: status === 'open',
      qIndex: parsedIndex,
      status: status || 'open',
      counts: { A: 0, B: 0, C: 0, D: 0 },
      voters: [],
      correctOption: correctOption || ''
    };
  } else {
    state.active = (status === 'open');
    state.status = status || state.status;
    if (correctOption) state.correctOption = correctOption;
  }

  cache.put(CACHE_KEY_KAHOOT, JSON.stringify(state), 600);
  return { status: 'success', state: state };
}

function handleKahootAnswer(name, school, qIndex, option) {
  if (!name || !option) return { status: 'error', message: '缺少姓名或選項' };
  
  const cache = CacheService.getScriptCache();
  const state = getKahootState();
  const opt = String(option).toUpperCase();

  if (state.status !== 'open') {
    return { status: 'closed', message: '目前非作答時間' };
  }

  const existingIdx = state.voters.findIndex(v => v.name === name);
  if (existingIdx !== -1) {
    // 更改作答
    const oldOpt = state.voters[existingIdx].option;
    if (state.counts[oldOpt] > 0) state.counts[oldOpt]--;
    state.voters[existingIdx].option = opt;
  } else {
    // 新作答
    state.voters.push({ name: name, school: school, option: opt, timestamp: Date.now() });
  }

  state.counts[opt] = (state.counts[opt] || 0) + 1;
  cache.put(CACHE_KEY_KAHOOT, JSON.stringify(state), 600);

  return { status: 'success', currentOption: opt, totalVoters: state.voters.length };
}

function resetKahootState() {
  const cache = CacheService.getScriptCache();
  const state = {
    active: false,
    qIndex: 0,
    status: 'idle',
    counts: { A: 0, B: 0, C: 0, D: 0 },
    voters: [],
    correctOption: ''
  };
  cache.put(CACHE_KEY_KAHOOT, JSON.stringify(state), 600);
  return { status: 'success', state: state };
}

// ======================== 快取搶答引擎 (CacheService Buzzer Engine) ========================

function getBuzzerCache() {
  return CacheService.getScriptCache();
}

function getBuzzerState() {
  const cache = getBuzzerCache();
  const raw = cache.get(CACHE_KEY_BUZZER);
  if (!raw) {
    return { active: false, roundId: 0, startTime: 0, list: [] };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { active: false, roundId: 0, startTime: 0, list: [] };
  }
}

function startBuzzerRound() {
  const cache = getBuzzerCache();
  const now = Date.now();
  const state = {
    active: true,
    roundId: now,
    startTime: now,
    list: []
  };
  cache.put(CACHE_KEY_BUZZER, JSON.stringify(state), 600);
  return { status: 'success', active: true, roundId: state.roundId };
}

function resetBuzzerState() {
  const cache = getBuzzerCache();
  const state = {
    active: false,
    roundId: 0,
    startTime: 0,
    list: []
  };
  cache.put(CACHE_KEY_BUZZER, JSON.stringify(state), 600);
  return { status: 'success', active: false };
}

function handleBuzz(name, school, roundId) {
  if (!name) return { status: 'error', message: '缺少姓名' };
  
  const cache = getBuzzerCache();
  const state = getBuzzerState();

  if (!state.active) {
    return { status: 'inactive', message: '搶答尚未開放或已結束！' };
  }
  if (roundId && String(state.roundId) !== String(roundId)) {
    return { status: 'expired', message: '非當前搶答回合' };
  }

  const existingIdx = state.list.findIndex(item => item.name === name);
  if (existingIdx !== -1) {
    return {
      status: 'success',
      rank: existingIdx + 1,
      timeDiff: state.list[existingIdx].timeDiff,
      already: true
    };
  }

  const now = Date.now();
  const diffSec = ((now - state.startTime) / 1000).toFixed(2);
  const record = {
    name: name,
    school: school || '研習夥伴',
    timeDiff: Math.max(0.01, diffSec),
    timestamp: now
  };

  state.list.push(record);
  cache.put(CACHE_KEY_BUZZER, JSON.stringify(state), 600);

  return {
    status: 'success',
    rank: state.list.length,
    timeDiff: record.timeDiff
  };
}

// ======================== 簽到名冊 (Google Sheets) ========================

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME_CHECKIN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_CHECKIN);
    const headers = [
      '簽到時間',
      '服務學校',
      '教師姓名',
      '教學年資',
      '教學痛點或困擾',
      '想用AI解決什麼問題？',
      '對於AI教學的擔憂？'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#4F46E5')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveCheckin(data) {
  if (!data.name || !data.school) {
    return { status: 'error', message: '學校與姓名為必填！' };
  }
  
  const sheet = getOrCreateSheet();
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  
  sheet.appendRow([
    timestamp,
    data.school,
    data.name,
    data.years || '未填寫',
    data.painPoints || '無',
    data.aiGoal || '無',
    data.aiConcern || '無'
  ]);
  
  return { status: 'success', message: '報到成功！歡迎參與研習。' };
}

function getCheckinList() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  return values.map((row, idx) => ({
    id: idx + 1,
    time: row[0],
    school: row[1],
    name: row[2],
    years: row[3],
    painPoints: row[4],
    aiGoal: row[5],
    aiConcern: row[6]
  }));
}
