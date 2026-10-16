/**
 * Puti-AI | 研習課堂儀表板後端 Google Apps Script
 * 作者：屏東縣後庄國小黃朝榮老師
 */

const SHEET_NAME_CHECKIN = '研習簽到表';

function doGet(e) {
  // 提供手機端報到頁面或 API 查詢
  const action = e && e.parameter ? e.parameter.action : null;
  if (action === 'getCheckins') {
    return ContentService.createTextOutput(JSON.stringify(getCheckinList()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 預設渲染手機報到前端
  return HtmlService.createTemplateFromFile('checkin_mobile')
    .evaluate()
    .setTitle('Puti-AI | 研習課堂報到')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
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
    const result = saveCheckin(data);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 取得或建立簽到工作表
 */
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

/**
 * 儲存簽到資料
 */
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

/**
 * 取得所有簽到老師名冊（供儀表板同步）
 */
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
