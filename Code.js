/**
 * 우리들의 답안지 (v4.0 최종 업그레이드) - Google Apps Script 서버 코드 (코드.gs)
 * 핵심 기능:
 * 1. 정답설정 시트 B열 드롭다운(객관식/기호(ㄱ,ㄴ,ㄷ)/기호(가,나,다)/OX퀴즈/단답식/서술형), C열 쉼표 자동계산 수식, F열 체크박스 자동 적용
 * 2. D열 쉼표(,)는 다중 빈칸 생성, 슬래시(/)는 각 빈칸별 유사 정답 인정
 * 3. 서술형 문항 학생별/문항별 수동 채점(만점/부분점수/0점 원클릭 자동 합산) 및 선생님 한 줄 피드백 코멘트
 * 4. 학생 실시간 채점 대기 화면 및 만점 폭죽 효과
 */

function doGet(e) {
  initialSetup();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('우리들의 답안지')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// index.html 등에서 <?!= include('파일명') ?> 로 다른 html 파일 내용을 끼워 넣을 때 사용
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// 초기 시트 세팅 함수
function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // (1) 환경설정 시트
  let configSheet = ss.getSheetByName('환경설정');
  if (!configSheet) {
    configSheet = ss.insertSheet('환경설정');
    const configData = [
      ['설정항목', '설정값', '설명'],
      ['examTitle', '1학기 단원평가', '시험지 제목'],
      ['teacherPassword', '1234', '선생님 모드 접속 비밀번호'],
      ['showScore', 'TRUE', '학생 제출 후 총점 및 O/X 공개 여부'],
      ['showCorrectAnswers', 'FALSE', '학생 제출 후 실제 정답 공개 여부'],
      ['ignoreSpaces', 'TRUE', '단답형 채점 시 띄어쓰기 무시 여부'],
      ['allowResubmit', 'FALSE', '동일 번호+이름 학생의 중복 제출(재제출) 허용 여부'],
      ['omrTheme', 'blue', 'OMR 카드 색상 테마 (blue, green, navy, orange, pink)'],
      ['publishResults', 'FALSE', '선생님이 채점을 마치고 결과를 학생들에게 일괄 공개할지 여부']
    ];
    configSheet.getRange(1, 1, configData.length, 3).setValues(configData);
    configSheet.getRange(1, 1, 1, 3).setBackground('#2d5a27').setFontColor('#ffffff').setFontWeight('bold');
    configSheet.setColumnWidths(1, 3, 200);
  } else {
    const data = configSheet.getDataRange().getValues();
    const keys = data.map(r => String(r[0]).trim());
    if (!keys.includes('omrTheme')) {
      configSheet.appendRow(['omrTheme', 'blue', 'OMR 카드 색상 테마 (blue, green, navy, orange, pink)']);
    }
    if (!keys.includes('publishResults')) {
      configSheet.appendRow(['publishResults', 'FALSE', '선생님이 채점을 마치고 결과를 학생들에게 일괄 공개할지 여부']);
    }
  }

  // (2) 정답설정 시트
  let answerSheet = ss.getSheetByName('정답설정');
  if (!answerSheet) {
    answerSheet = ss.insertSheet('정답설정');
    const headers = [['문항번호', '문제유형', '정답칸수(자동)', '정답목록 (쉼표=빈칸추가, /=유사정답)', '배점', '부분점수허용']];
    answerSheet.getRange(1, 1, 1, 6).setValues(headers);
    
    const sampleRows = [
      [1, '객관식', '', '3', 20, false],
      [2, '기호(ㄱ,ㄴ,ㄷ)', '', 'ㄱ, ㄷ', 20, true],
      [3, '단답식', '', '훈민정음/한글', 20, false],
      [4, '단답식', '', '세종대왕/세종, 장영실', 20, true],
      [5, '서술형', '', '백성을 가르치는 바른 소리라는 뜻이다', 20, false]
    ];
    answerSheet.getRange(2, 1, sampleRows.length, 6).setValues(sampleRows);
    applySheetFormattingAndFormulas();
  }

  // (3) 제출결과 시트
  let resultSheet = ss.getSheetByName('제출결과');
  if (!resultSheet) {
    resultSheet = ss.insertSheet('제출결과');
    const resultHeaders = [['제출일시', '번호', '이름', '총점', '상세채점결과', '채점완료여부', '선생님코멘트', '문항별점수JSON', '1번답', '2번답', '3번답', '4번답', '5번답']];
    resultSheet.getRange(1, 1, 1, resultHeaders[0].length).setValues(resultHeaders);
    resultSheet.getRange(1, 1, 1, resultHeaders[0].length).setBackground('#2d5a27').setFontColor('#ffffff').setFontWeight('bold');
  }
}

// ★ 정답설정 시트에 B열 드롭다운, C열 쉼표 자동계산 수식, F열 체크박스를 입히는 함수
function applySheetFormattingAndFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let answerSheet = ss.getSheetByName('정답설정');
  if (!answerSheet) return;

  const headers = [['문항번호', '문제유형', '정답칸수(자동)', '정답목록 (쉼표=빈칸추가, /=유사정답)', '배점', '부분점수허용']];
  answerSheet.getRange(1, 1, 1, 6).setValues(headers).setBackground('#2d5a27').setFontColor('#ffffff').setFontWeight('bold');

  const maxRows = 50; // 2행부터 51행까지 50문항 분량 서식 미리 적용

  // 1) B열 문제유형 드롭다운 (데이터 확인)
  const typeList = ['객관식', '기호(ㄱ,ㄴ,ㄷ)', '기호(가,나,다)', 'OX퀴즈', '단답식', '서술형'];
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(typeList, true)
    .setAllowInvalid(true)
    .build();
  answerSheet.getRange(2, 2, maxRows, 1).setDataValidation(typeRule);

  // 2) C열 정답칸수 자동 계산 수식 (서술형이면 1, 아니면 D열의 쉼표 개수 + 1)
  const formulas = [];
  for (let r = 2; r <= maxRows + 1; r++) {
    formulas.push([`=IF(D${r}="", IF(B${r}="서술형", 1, ""), IF(B${r}="서술형", 1, LEN(D${r})-LEN(SUBSTITUTE(D${r}, ",", ""))+1))`]);
  }
  answerSheet.getRange(2, 3, maxRows, 1).setFormulas(formulas);
  answerSheet.getRange(2, 3, maxRows, 1).setBackground('#f1f8e9').setHorizontalAlignment('center');

  // 3) D열 정답목록은 숫자 '2, 4' 등이 날짜나 숫자로 자동 변환되지 않도록 텍스트 서식(@) 지정
  answerSheet.getRange(2, 4, maxRows, 1).setNumberFormat('@');

  // 4) F열 부분점수허용 체크박스 적용
  const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  answerSheet.getRange(2, 6, maxRows, 1).setDataValidation(checkboxRule);

  // 열 너비 보기 좋게 조정
  answerSheet.setColumnWidth(1, 80);
  answerSheet.setColumnWidth(2, 140);
  answerSheet.setColumnWidth(3, 120);
  answerSheet.setColumnWidth(4, 280);
  answerSheet.setColumnWidth(5, 80);
  answerSheet.setColumnWidth(6, 110);
}

// 문제유형 문자열 정규화 보조 함수
function normalizeQuestionType(rawType) {
  const t = String(rawType || '').trim();
  if (t.includes('서술형')) return '서술형';
  if (t.includes('ㄱ') || t.includes('기호(ㄱ')) return '기호(ㄱ,ㄴ,ㄷ)';
  if (t.includes('가') || t.includes('기호(가')) return '기호(가,나,다)';
  if (t.toUpperCase().includes('OX')) return 'OX퀴즈';
  if (t.includes('단답') || t.includes('주관')) return '단답식';
  return '객관식';
}

// D열 정답 문자열 파싱: 쉼표(,)로 빈칸 슬롯을 나누고, 각 슬롯 안에서는 슬래시(/)로 유사 정답을 나눔
// 반환 형태: [ ['세종대왕', '세종'], ['장영실'] ] (길이 = 빈칸 개수)
function parseAnswerSlots(rawStr, qType) {
  const normType = normalizeQuestionType(qType);
  const str = String(rawStr || '').trim();
  if (normType === '서술형') {
    return [[str]]; // 서술형은 쉼표가 있어도 무조건 빈칸 1개(모범답안 참고용)
  }
  if (!str) return [['']];

  // 쉼표(,) 또는 기존 호환용(|)으로 빈칸 구분
  const rawSlots = str.split(/[,|]/).map(s => s.trim()).filter(s => s !== '');
  if (rawSlots.length === 0) return [['']];

  return rawSlots.map(slotStr => {
    const synonyms = slotStr.split('/').map(syn => syn.trim()).filter(syn => syn !== '');
    return synonyms.length > 0 ? synonyms : [slotStr];
  });
}

function getSettingsMap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('환경설정');
  const data = configSheet.getDataRange().getValues();
  const settings = {
    examTitle: '우리들의 답안지',
    teacherPassword: '1234',
    showScore: true,
    showCorrectAnswers: false,
    ignoreSpaces: true,
    allowResubmit: false,
    omrTheme: 'blue',
    publishResults: false
  };
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0]).trim();
    const val = data[i][1];
    if (key) {
      if (val === true || String(val).toUpperCase() === 'TRUE') {
        settings[key] = true;
      } else if (val === false || String(val).toUpperCase() === 'FALSE') {
        settings[key] = false;
      } else {
        settings[key] = String(val).trim();
      }
    }
  }
  return settings;
}

// 학생 화면용 초기 데이터 불러오기
function getStudentInitData() {
  // 시트 초기화는 doGet()에서 이미 수행됨
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSettingsMap();
  const answerSheet = ss.getSheetByName('정답설정');
  const rows = answerSheet.getDataRange().getValues();
  
  const questions = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][1] && !rows[i][3]) continue;
    const qNum = Number(rows[i][0]) || (questions.length + 1); // 빈 문항번호는 유효 문항 순번으로 통일
    const qType = normalizeQuestionType(rows[i][1]);
    const rawAnsStr = String(rows[i][3] || '');
    const slots = parseAnswerSlots(rawAnsStr, qType);
    // D열의 쉼표 개수로 자동 계산된 슬롯 수를 우선 사용
    const blankCount = qType === '서술형' ? 1 : Math.max(1, slots.length);

    questions.push({
      qNum: qNum,
      qType: qType,
      blankCount: blankCount,
      points: Number(rows[i][4]) || 0,
      partialCredit: rows[i][5] === true || String(rows[i][5]).toUpperCase() === 'TRUE'
    });
  }
  
  return {
    examTitle: settings.examTitle || '우리들의 답안지',
    omrTheme: settings.omrTheme || 'blue',
    allowResubmit: settings.allowResubmit === true,
    questions: questions
  };
}

// 단일 문항 자동 채점 함수
function evaluateSingleQuestion(qRow, userArrRaw, ignoreSpaces) {
  const normalize = (str) => {
    let s = String(str || '').trim();
    if (ignoreSpaces) s = s.replace(/\s+/g, '');
    // 원문자 기호 호환 처리
    const circleMap = {
      '①':'1','②':'2','③':'3','④':'4','⑤':'5',
      '㉠':'ㄱ','㉡':'ㄴ','㉢':'ㄷ','㉣':'ㄹ','㉤':'ㅁ','㉥':'ㅂ',
      '◯':'o','○':'o','⭕':'o','✕':'x','✖':'x','❌':'x'
    };
    s = s.split('').map(ch => circleMap[ch] || ch).join('');
    return s.toLowerCase();
  };

  const qNum = Number(qRow[0]);
  const qType = normalizeQuestionType(qRow[1]);
  const rawAnswerStr = String(qRow[3] || '');
  const points = Number(qRow[4]) || 0;
  const partialCredit = qRow[5] === true || String(qRow[5]).toUpperCase() === 'TRUE';

  const slots = parseAnswerSlots(rawAnswerStr, qType); // [ ['정답1', '유사1'], ['정답2'] ]
  const blankCount = qType === '서술형' ? 1 : Math.max(1, slots.length);

  const userSlots = [];
  for (let b = 0; b < blankCount; b++) {
    userSlots.push(String((userArrRaw && userArrRaw[b]) || '').trim());
  }

  // 표시용 정답 문자열
  const displayCorrectStr = slots.map(synArr => synArr.join('/')).join(', ');

  if (qType === '서술형') {
    return {
      qNum: qNum,
      qType: qType,
      points: points,
      earnedPoints: 0,
      status: '보류', // 선생님 수동 채점 대기
      displayCorrectStr: displayCorrectStr || '(선생님 채점)',
      userDisplayStr: userSlots[0] || '(미입력)'
    };
  }

  const isChoiceType = ['객관식', '기호(ㄱ,ㄴ,ㄷ)', '기호(가,나,다)', 'OX퀴즈'].includes(qType);
  let earnedPoints = 0;
  let status = 'X';

  if (isChoiceType) {
    if (blankCount === 1) {
      const uNorm = normalize(userSlots[0]);
      const validNorms = slots[0].map(s => normalize(s));
      if (uNorm !== '' && validNorms.includes(uNorm)) {
        earnedPoints = points;
        status = 'O';
      }
    } else {
      // 복수 정답 객관식/기호형: 순서 상관없이 맞힌 개수 비교
      const nonEmptyUser = userSlots.map(u => normalize(u)).filter(u => u !== '');
      const uniqueUser = [...new Set(nonEmptyUser)];
      const matchedSlotIndices = new Set();
      let wrongCount = 0;

      uniqueUser.forEach(uNorm => {
        let found = false;
        for (let sIdx = 0; sIdx < slots.length; sIdx++) {
          if (!matchedSlotIndices.has(sIdx)) {
            const validNorms = slots[sIdx].map(s => normalize(s));
            if (validNorms.includes(uNorm)) {
              matchedSlotIndices.add(sIdx);
              found = true;
              break;
            }
          }
        }
        if (!found) wrongCount++;
      });

      const matchCount = matchedSlotIndices.size;
      if (matchCount === blankCount && wrongCount === 0 && uniqueUser.length === blankCount) {
        earnedPoints = points;
        status = 'O';
      } else if (partialCredit && matchCount > 0 && wrongCount === 0) {
        earnedPoints = Math.round((points * (matchCount / blankCount)) * 10) / 10;
        status = '△';
      }
    }
  } else {
    // 단답식 (빈칸 1개 또는 빈칸 여러 개)
    if (blankCount === 1) {
      const uNorm = normalize(userSlots[0]);
      const validNorms = slots[0].map(s => normalize(s));
      if (uNorm !== '' && validNorms.includes(uNorm)) {
        earnedPoints = points;
        status = 'O';
      }
    } else {
      // 다중 빈칸 단답식: 각 빈칸별로 해당하는 정답(또는 유사정답)과 일치하는지 확인
      let matchCount = 0;
      for (let b = 0; b < blankCount; b++) {
        const uNorm = normalize(userSlots[b]);
        const validNorms = slots[b].map(s => normalize(s));
        if (uNorm !== '' && validNorms.includes(uNorm)) {
          matchCount++;
        }
      }
      if (matchCount === blankCount) {
        earnedPoints = points;
        status = 'O';
      } else if (partialCredit && matchCount > 0) {
        earnedPoints = Math.round((points * (matchCount / blankCount)) * 10) / 10;
        status = '△';
      }
    }
  }

  const userDisplay = userSlots.filter(s => s !== '').length > 0 ? userSlots.join(', ') : '(미입력)';

  return {
    qNum: qNum,
    qType: qType,
    points: points,
    earnedPoints: earnedPoints,
    status: status,
    displayCorrectStr: displayCorrectStr,
    userDisplayStr: userDisplay
  };
}

// 학생 답안 제출 함수
function submitStudentAnswers(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = getSettingsMap();
    const answerSheet = ss.getSheetByName('정답설정');
    const resultSheet = ss.getSheetByName('제출결과');
    
    const studentNumber = String(payload.studentNumber || '').trim();
    const studentName = String(payload.studentName || '').trim();
    const studentAnswers = payload.answers || {};
    
    if (!studentNumber || !studentName) {
      return { success: false, message: '출석번호와 이름을 모두 입력해 주세요!' };
    }
    
    if (!settings.allowResubmit) {
      const resultData = resultSheet.getDataRange().getValues();
      for (let i = 1; i < resultData.length; i++) {
        if (String(resultData[i][1]).trim() === studentNumber && String(resultData[i][2]).trim() === studentName) {
          return { success: false, message: `${studentNumber}번 ${studentName} 학생은 이미 답안지를 제출했습니다!` };
        }
      }
    }
    
    const qRows = answerSheet.getDataRange().getValues();
    let totalScore = 0;
    const summaryTextParts = [];
    const answerColumns = [];
    const perQuestionMap = {}; // { qNum: { status, earnedPoints, maxPoints } }
    const ignoreSpaces = settings.ignoreSpaces === true;
    let hasEssay = false;
    const validQNums = [];
    
    for (let i = 1; i < qRows.length; i++) {
      if (!qRows[i][0] && !qRows[i][1] && !qRows[i][3]) continue;
      const qNum = Number(qRows[i][0]) || (validQNums.length + 1);
      validQNums.push(qNum);
      const userArrRaw = Array.isArray(studentAnswers[qNum]) ? studentAnswers[qNum] : [studentAnswers[qNum] || ''];
      
      const evalRes = evaluateSingleQuestion(qRows[i], userArrRaw, ignoreSpaces);
      
      totalScore += evalRes.earnedPoints;
      if (evalRes.qType === '서술형') hasEssay = true;
      
      answerColumns.push(evalRes.userDisplayStr);
      summaryTextParts.push(`${qNum}번:${evalRes.status}(${evalRes.earnedPoints}점)`);
      perQuestionMap[qNum] = {
        status: evalRes.status,
        earnedPoints: evalRes.earnedPoints,
        maxPoints: evalRes.points
      };
    }
    
    totalScore = Math.round(totalScore * 10) / 10;
    const isCompleted = !hasEssay; // 서술형 문항이 없으면 즉시 채점 완료 상태로 기록
    
    // 제출결과 시트 헤더 구성 (앞 8개 고정 열 + 문항별 답안 열)
    // [제출일시(0), 번호(1), 이름(2), 총점(3), 상세채점결과(4), 채점완료여부(5), 선생님코멘트(6), 문항별점수JSON(7), 1번답(8)...]
    const baseHeaders = ['제출일시', '번호', '이름', '총점', '상세채점결과', '채점완료여부', '선생님코멘트', '문항별점수JSON'];
    validQNums.forEach(num => baseHeaders.push(`${num}번답`));

    resultSheet.getRange(1, 1, 1, baseHeaders.length).setValues([baseHeaders]);
    resultSheet.getRange(1, 1, 1, baseHeaders.length).setBackground('#2d5a27').setFontColor('#ffffff').setFontWeight('bold');
    
    const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const newRow = [
      nowStr,
      studentNumber,
      studentName,
      totalScore,
      summaryTextParts.join(' / '),
      isCompleted ? 'TRUE' : 'FALSE',
      '', // 선생님 코멘트 초기값
      JSON.stringify(perQuestionMap),
      ...answerColumns
    ];
    resultSheet.appendRow(newRow);
    
    return { success: true };
  } catch (err) {
    return { success: false, message: '제출 중 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// 학생 대기 화면에서 실시간으로 채점 완료 여부 및 결과 조회
function checkStudentResultStatus(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSettingsMap();
  const resultSheet = ss.getSheetByName('제출결과');
  const answerSheet = ss.getSheetByName('정답설정');
  
  const studentNumber = String(payload.studentNumber || '').trim();
  const studentName = String(payload.studentName || '').trim();
  
  if (!settings.publishResults) {
    return { published: false };
  }
  
  const rRows = resultSheet.getDataRange().getValues();
  let studentRow = null;
  
  // 가장 최근 제출 기록 찾기 (아래에서 위로 탐색)
  for (let i = rRows.length - 1; i >= 1; i--) {
    if (String(rRows[i][1]).trim() === studentNumber && String(rRows[i][2]).trim() === studentName) {
      studentRow = rRows[i];
      break;
    }
  }
  
  if (!studentRow) {
    return { published: false };
  }
  
  const isCompleted = String(studentRow[5]).toUpperCase() === 'TRUE';
  if (!isCompleted) {
    return { published: false }; // 아직 선생님이 서술형 채점 중
  }
  
  let perQMap = {};
  try {
    if (studentRow[7]) perQMap = JSON.parse(String(studentRow[7]));
  } catch (e) {}

  const qRows = answerSheet.getDataRange().getValues();
  const gradingDetails = [];
  let maxScore = 0;
  let totalScore = 0;
  let colOffset = 0;
  
  for (let i = 1; i < qRows.length; i++) {
    if (!qRows[i][0] && !qRows[i][1] && !qRows[i][3]) continue;
    const qNum = Number(qRows[i][0]) || (gradingDetails.length + 1);
    const qType = normalizeQuestionType(qRows[i][1]);
    const maxPts = Number(qRows[i][4]) || 0;
    maxScore += maxPts;
    
    const userAns = String(studentRow[8 + colOffset] || '(미입력)');
    colOffset++;

    const slots = parseAnswerSlots(qRows[i][3], qType);
    const displayCorrect = slots.map(s => s.join('/')).join(', ');

    // 제출 이후 추가된 문항 등 채점 기록이 없으면 미응답(0점)으로 처리
    const qRecord = perQMap[qNum] || { status: 'X', earnedPoints: 0 };
    const earned = Number(qRecord.earnedPoints) || 0;
    totalScore += earned;
    
    gradingDetails.push({
      qNum: qNum,
      qType: qType,
      userAnswer: userAns,
      status: qRecord.status || 'O',
      earnedPoints: earned,
      maxPoints: maxPts,
      correctAnswer: settings.showCorrectAnswers ? displayCorrect : null
    });
  }
  
  // 만약 수동으로 총점만 바꾼 경우 시트의 총점을 우선 반영
  const sheetTotal = Number(studentRow[3]);
  if (!isNaN(sheetTotal)) totalScore = sheetTotal;
  
  const isPerfectScore = (maxScore > 0 && totalScore >= maxScore);
  
  return {
    published: true,
    studentNumber: studentNumber,
    studentName: studentName,
    showScore: settings.showScore === true,
    showCorrectAnswers: settings.showCorrectAnswers === true,
    totalScore: totalScore,
    maxScore: maxScore,
    isPerfectScore: isPerfectScore,
    teacherComment: String(studentRow[6] || '').trim(),
    details: gradingDetails
  };
}

// 선생님 모드 접속 및 전체 데이터 조회
function verifyTeacherAndGetData(passwordInput) {
  // 시트 초기화는 doGet()에서 이미 수행됨 (새로고침마다 반복 호출되므로 생략)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSettingsMap();
  
  if (String(passwordInput).trim() !== String(settings.teacherPassword).trim()) {
    return { success: false, message: '비밀번호가 일치하지 않습니다.' };
  }
  
  const answerSheet = ss.getSheetByName('정답설정');
  const qRows = answerSheet.getDataRange().getValues();
  const questions = [];
  const validQRows = [];
  
  for (let i = 1; i < qRows.length; i++) {
    if (!qRows[i][0] && !qRows[i][1] && !qRows[i][3]) continue;
    validQRows.push(qRows[i]);
    const qNum = Number(qRows[i][0]) || (questions.length + 1);
    const qType = normalizeQuestionType(qRows[i][1]);
    const rawAnsStr = String(qRows[i][3] || '');
    const slots = parseAnswerSlots(rawAnsStr, qType);
    const blankCount = qType === '서술형' ? 1 : Math.max(1, slots.length);

    questions.push({
      qNum: qNum,
      qType: qType,
      blankCount: blankCount,
      rawAnswerStr: rawAnsStr,
      points: Number(qRows[i][4]) || 0,
      partialCredit: qRows[i][5] === true || String(qRows[i][5]).toUpperCase() === 'TRUE'
    });
  }
  
  const resultSheet = ss.getSheetByName('제출결과');
  const rRows = resultSheet.getDataRange().getValues();
  const submissions = [];
  const ignoreSpaces = settings.ignoreSpaces === true;

  const statsTrack = questions.map((q) => ({
    qNum: q.qNum,
    qType: q.qType,
    correctAnswerStr: q.rawAnswerStr,
    totalCount: 0,
    wrongCount: 0,
    wrongAnswerFreq: {}
  }));

  for (let i = 1; i < rRows.length; i++) {
    if (!rRows[i][0] && !rRows[i][2]) continue;
    let timeVal = rRows[i][0];
    if (timeVal instanceof Date) {
      timeVal = Utilities.formatDate(timeVal, Session.getScriptTimeZone(), 'MM-dd HH:mm');
    }

    let perQMap = {};
    try {
      if (rRows[i][7]) perQMap = JSON.parse(String(rRows[i][7]));
    } catch (e) {}

    const studentAnswersByQ = {};
    validQRows.forEach((qRow, qIdx) => {
      const qNum = Number(qRow[0]) || (qIdx + 1);
      const ansText = String(rRows[i][8 + qIdx] || '(미입력)').trim();
      studentAnswersByQ[qNum] = ansText;

      // 문항별 초기 점수 정보가 없으면 재계산하여 채움
      if (!perQMap[qNum]) {
        const evalRes = evaluateSingleQuestion(qRow, ansText === '(미입력)' ? [] : ansText.split(','), ignoreSpaces);
        perQMap[qNum] = {
          status: evalRes.status,
          earnedPoints: evalRes.earnedPoints,
          maxPoints: evalRes.points
        };
      }

      const qStat = perQMap[qNum];
      if (qStat.status !== '보류') {
        statsTrack[qIdx].totalCount++;
        if (qStat.status !== 'O') {
          statsTrack[qIdx].wrongCount++;
          const wrongKey = ansText || '(미입력)';
          statsTrack[qIdx].wrongAnswerFreq[wrongKey] = (statsTrack[qIdx].wrongAnswerFreq[wrongKey] || 0) + 1;
        }
      }
    });

    submissions.push({
      rowIndex: i + 1,
      rowKey: getSubmissionRowKey(rRows[i]),
      time: String(timeVal),
      studentNumber: String(rRows[i][1]),
      studentName: String(rRows[i][2]),
      totalScore: Number(rRows[i][3]) || 0,
      summary: String(rRows[i][4]),
      isCompleted: String(rRows[i][5]).toUpperCase() === 'TRUE',
      teacherComment: String(rRows[i][6] || ''),
      perQuestionMap: perQMap,
      answersByQ: studentAnswersByQ
    });
  }

  const questionStats = statsTrack.map(st => {
    const errorRate = st.totalCount > 0 ? Math.round((st.wrongCount / st.totalCount) * 1000) / 10 : 0;
    let topWrongAnswer = '-';
    let topWrongCount = 0;
    Object.keys(st.wrongAnswerFreq).forEach(ansKey => {
      if (st.wrongAnswerFreq[ansKey] > topWrongCount) {
        topWrongCount = st.wrongAnswerFreq[ansKey];
        topWrongAnswer = ansKey;
      }
    });
    return {
      qNum: st.qNum,
      qType: st.qType,
      correctAnswerStr: st.correctAnswerStr,
      totalCount: st.totalCount,
      wrongCount: st.wrongCount,
      errorRate: errorRate,
      topWrongAnswer: topWrongCount > 0 ? `${topWrongAnswer} (${topWrongCount}명)` : '오답 없음'
    };
  });
  
  return {
    success: true,
    settings: settings,
    questions: questions,
    submissions: submissions.reverse(),
    questionStats: questionStats
  };
}

// 제출결과 행 식별값 (제출일시|번호|이름): 채점 저장 시 행 번호가 같은 학생을 가리키는지 확인용
function getSubmissionRowKey(row) {
  const ts = row[0] instanceof Date ? row[0].getTime() : String(row[0]);
  return [ts, String(row[1]).trim(), String(row[2]).trim()].join('|');
}

// ★ 선생님 수동 채점 (서술형 및 개별 문항 점수 변경 시 총점 자동 합산 + 코멘트 저장)
function updateStudentQuestionGrade(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = getSettingsMap();
    if (String(payload.authPassword).trim() !== String(settings.teacherPassword).trim()) {
      return { success: false, message: '권한이 없습니다.' };
    }
    
    const resultSheet = ss.getSheetByName('제출결과');
    const rowIndex = Number(payload.rowIndex);
    if (!(rowIndex >= 2 && rowIndex <= resultSheet.getLastRow())) {
      return { success: false, message: '제출 기록을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.' };
    }
    const rowValues = resultSheet.getRange(rowIndex, 1, 1, resultSheet.getLastColumn()).getValues()[0];

    // 화면을 불러온 뒤 기록 초기화/삭제로 행이 바뀌었으면 다른 학생 행에 저장되지 않도록 차단
    if (getSubmissionRowKey(rowValues) !== String(payload.rowKey)) {
      return { success: false, message: '제출 기록이 변경되었습니다. 새로고침 후 다시 채점해 주세요.' };
    }

    let perQMap = {};
    try {
      if (rowValues[7]) perQMap = JSON.parse(String(rowValues[7]));
    } catch (e) {}

    // 업데이트할 문항 점수 반영 (payload.updatedQuestions: { qNum: { status, earnedPoints, maxPoints } })
    if (payload.updatedQuestions) {
      Object.keys(payload.updatedQuestions).forEach(qNum => {
        perQMap[qNum] = payload.updatedQuestions[qNum];
      });
    }

    // 총점 및 요약 텍스트 자동 재계산
    let newTotalScore = 0;
    let hasPending = false;
    const summaryParts = [];

    const sortedQNums = Object.keys(perQMap).map(Number).sort((a, b) => a - b);
    sortedQNums.forEach(qNum => {
      const item = perQMap[qNum];
      const pts = Number(item.earnedPoints) || 0;
      newTotalScore += pts;
      if (item.status === '보류') hasPending = true;
      summaryParts.push(`${qNum}번:${item.status}(${pts}점)`);
    });

    newTotalScore = Math.round(newTotalScore * 10) / 10;
    const isCompleted = payload.forceComplete !== undefined ? payload.forceComplete : !hasPending;
    const teacherComment = payload.teacherComment !== undefined ? String(payload.teacherComment).trim() : String(rowValues[6] || '');

    resultSheet.getRange(rowIndex, 4).setValue(newTotalScore);
    resultSheet.getRange(rowIndex, 5).setValue(summaryParts.join(' / '));
    resultSheet.getRange(rowIndex, 6).setValue(isCompleted ? 'TRUE' : 'FALSE');
    resultSheet.getRange(rowIndex, 7).setValue(teacherComment);
    resultSheet.getRange(rowIndex, 8).setValue(JSON.stringify(perQMap));

    return {
      success: true,
      newTotalScore: newTotalScore,
      isCompleted: isCompleted,
      message: '채점 내역과 총점이 자동으로 합산되어 저장되었습니다!'
    };
  } catch (err) {
    return { success: false, message: '채점 저장 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// 결과 일괄 공개 스위치 제어 (켤 때 미완료 학생들도 일괄 완료 처리할지 선택 가능)
function setPublishResultsStatus(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = getSettingsMap();
  
    if (String(payload.authPassword).trim() !== String(settings.teacherPassword).trim()) {
      return { success: false, message: '권한이 없습니다.' };
    }
  
    const configSheet = ss.getSheetByName('환경설정');
    const data = configSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'publishResults') {
        configSheet.getRange(i + 1, 2).setValue(payload.publish ? 'TRUE' : 'FALSE');
        break;
      }
    }

    // 일괄 공개를 켤 때 모든 제출 학생의 채점완료여부를 TRUE로 활성화
    if (payload.publish && payload.markAllCompleted) {
      const resultSheet = ss.getSheetByName('제출결과');
      const lastRow = resultSheet.getLastRow();
      if (lastRow > 1) {
        const completeRange = resultSheet.getRange(2, 6, lastRow - 1, 1);
        const vals = completeRange.getValues().map(() => ['TRUE']);
        completeRange.setValues(vals);
      }
    }
  
    return { success: true };
  } catch (err) {
    return { success: false, message: '공개 설정 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// 선생님 모드에서 정답 및 설정 저장 (시트 드롭다운 및 C열 자동계산 수식 유지!)
function saveTeacherConfig(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = getSettingsMap();
    
    if (String(payload.authPassword).trim() !== String(settings.teacherPassword).trim()) {
      return { success: false, message: '권한이 없습니다.' };
    }
    
    const newSettings = payload.settings;
    const configSheet = ss.getSheetByName('환경설정');
    const configData = [
      ['설정항목', '설정값', '설명'],
      ['examTitle', newSettings.examTitle || '우리들의 답안지', '시험지 제목'],
      ['teacherPassword', newSettings.teacherPassword || '1234', '선생님 모드 접속 비밀번호'],
      ['showScore', newSettings.showScore ? 'TRUE' : 'FALSE', '학생 제출 후 총점 및 O/X 공개 여부'],
      ['showCorrectAnswers', newSettings.showCorrectAnswers ? 'TRUE' : 'FALSE', '학생 제출 후 실제 정답 공개 여부'],
      ['ignoreSpaces', newSettings.ignoreSpaces ? 'TRUE' : 'FALSE', '단답형 채점 시 띄어쓰기 무시 여부'],
      ['allowResubmit', newSettings.allowResubmit ? 'TRUE' : 'FALSE', '동일 번호+이름 학생의 중복 제출 허용 여부'],
      ['omrTheme', newSettings.omrTheme || 'blue', 'OMR 카드 색상 테마'],
      ['publishResults', newSettings.publishResults ? 'TRUE' : 'FALSE', '결과 일괄 공개 여부']
    ];
    configSheet.clearContents();
    // 설정값(B열)을 텍스트로 지정해 '0123' 같은 비밀번호가 숫자 123으로 바뀌지 않도록 함
    configSheet.getRange(2, 2, configData.length - 1, 1).setNumberFormat('@');
    configSheet.getRange(1, 1, configData.length, 3).setValues(configData);
    
    const answerSheet = ss.getSheetByName('정답설정');
    answerSheet.clearContents();
    
    const questions = payload.questions || [];
    const rowsToWrite = [];
    
    questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const qType = normalizeQuestionType(q.qType);
      const rawAns = String(q.rawAnswerStr || '').trim();
      const points = Number(q.points) || 0;
      const partialCredit = q.partialCredit === true;
      // C열은 applySheetFormattingAndFormulas()에서 수식으로 채워짐
      rowsToWrite.push([qNum, qType, '', rawAns, points, partialCredit]);
    });
    
    if (rowsToWrite.length > 0) {
      // 이전 버전에서 A~F열 전체에 걸어둔 텍스트 서식(@)을 지워 번호/배점은 숫자, 부분점수는 체크박스(불리언)로 저장
      // (서식만 지우며 B열 드롭다운·F열 체크박스 같은 데이터 확인 규칙은 유지됨)
      const dataRowCount = Math.max(rowsToWrite.length, answerSheet.getMaxRows() - 1);
      answerSheet.getRange(2, 1, dataRowCount, 6).clearFormat();
      // D열 정답목록만 텍스트로 유지해 '2, 4' 등이 숫자/날짜로 바뀌지 않도록 함 (값 쓰기 전에 적용)
      answerSheet.getRange(2, 4, rowsToWrite.length, 1).setNumberFormat('@');
      answerSheet.getRange(2, 1, rowsToWrite.length, 6).setValues(rowsToWrite);
    }

    // 드롭다운, C열 쉼표 자동계산 수식, 체크박스 재적용
    applySheetFormattingAndFormulas();

    // 문항 삭제/순서 변경/추가 시 기존 제출 답안과 채점 기록을 새 문항 번호에 맞게 이동
    remapSubmissionsToQuestions(questions, rowsToWrite);

    return { success: true, message: '설정과 정답지가 구글 시트(드롭다운 및 C열 자동 계산 수식 포함)에 완벽히 반영되었습니다!' };
  } catch (err) {
    return { success: false, message: '저장 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// 문항 편집 후 제출결과 시트의 문항별 답안 열(I열~)과 문항별점수JSON을 새 문항 번호 기준으로 재배치
// questions[idx].origQNum: 편집 전 문항 번호 (null이면 새로 추가된 문항), rowsToWrite[idx]: 새 정답설정 행
function remapSubmissionsToQuestions(questions, rowsToWrite) {
  // 이전 버전 화면에서 저장한 경우(원래 번호 정보 없음)에는 기존 동작대로 건드리지 않음
  if (rowsToWrite.length === 0 || questions.some(q => q.origQNum === undefined)) return;

  const resultSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('제출결과');
  const rRows = resultSheet.getDataRange().getValues();
  if (rRows.length < 2) return;

  // 기존 헤더의 'N번답' 열 위치를 문항 번호로 찾음
  const oldColByQNum = {};
  rRows[0].forEach((h, c) => {
    const m = String(h).trim().match(/^(\d+)번답$/);
    if (m && c >= 8) oldColByQNum[Number(m[1])] = c;
  });

  const origNums = questions.map(q => (q.origQNum === null || q.origQNum === '') ? null : Number(q.origQNum));
  const isUnchanged = origNums.length === Object.keys(oldColByQNum).length &&
    origNums.every((n, idx) => n === idx + 1 && oldColByQNum[n] === 8 + idx);
  if (isUnchanged) return;

  const ignoreSpaces = getSettingsMap().ignoreSpaces === true;
  const width = Math.max(rRows[0].length, 8 + rowsToWrite.length);
  const pad = (arr) => arr.concat(new Array(width - arr.length).fill(''));

  const headers = ['제출일시', '번호', '이름', '총점', '상세채점결과', '채점완료여부', '선생님코멘트', '문항별점수JSON'];
  rowsToWrite.forEach(r => headers.push(`${r[0]}번답`));
  const output = [pad(headers).slice(3)];

  for (let i = 1; i < rRows.length; i++) {
    const row = rRows[i];
    if (!row[0] && !row[2]) {
      output.push(pad(row.slice()).slice(3));
      continue;
    }

    let oldPerQ = {};
    try {
      if (row[7]) oldPerQ = JSON.parse(String(row[7]));
    } catch (e) {}

    const newPerQ = {};
    const newAnswers = [];
    let total = 0;
    let hasPending = false;
    const summaryParts = [];

    rowsToWrite.forEach((qRow, idx) => {
      const newQNum = qRow[0];
      const maxPoints = Number(qRow[4]) || 0;
      const orig = origNums[idx];
      let ans = '(미입력)';
      let rec;

      if (orig === null) {
        // 제출 이후 새로 추가된 문항: 미응답 0점
        rec = { status: 'X', earnedPoints: 0, maxPoints: maxPoints };
      } else {
        const col = oldColByQNum[orig];
        if (col !== undefined && String(row[col]).trim() !== '') ans = String(row[col]).trim();
        if (oldPerQ[orig]) {
          rec = Object.assign({}, oldPerQ[orig], { maxPoints: maxPoints });
        } else {
          const evalRes = evaluateSingleQuestion(qRow, ans === '(미입력)' ? [] : ans.split(','), ignoreSpaces);
          rec = { status: evalRes.status, earnedPoints: evalRes.earnedPoints, maxPoints: evalRes.points };
        }
      }

      newPerQ[newQNum] = rec;
      newAnswers.push(ans);
      const pts = Number(rec.earnedPoints) || 0;
      total += pts;
      if (rec.status === '보류') hasPending = true;
      summaryParts.push(`${newQNum}번:${rec.status}(${pts}점)`);
    });

    const wasCompleted = String(row[5]).toUpperCase() === 'TRUE';
    output.push(pad([
      '', '', '', // A~C열(제출일시/번호/이름)은 다시 쓰지 않음 (slice(3)으로 제외)
      Math.round(total * 10) / 10,
      summaryParts.join(' / '),
      (wasCompleted || !hasPending) ? 'TRUE' : 'FALSE',
      row[6],
      JSON.stringify(newPerQ),
      ...newAnswers
    ]).slice(3));
  }

  // 답안 열이 숫자/날짜로 자동 변환되지 않도록 텍스트 서식 지정 후 D열부터 일괄 기록
  resultSheet.getRange(2, 9, rRows.length - 1, width - 8).setNumberFormat('@');
  resultSheet.getRange(1, 4, output.length, width - 3).setValues(output);
  resultSheet.getRange(1, 1, 1, width).setBackground('#2d5a27').setFontColor('#ffffff').setFontWeight('bold');
}

function clearSubmissionRecords(passwordInput) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = getSettingsMap();
    if (String(passwordInput).trim() !== String(settings.teacherPassword).trim()) {
      return { success: false, message: '비밀번호가 일치하지 않습니다.' };
    }
    const resultSheet = ss.getSheetByName('제출결과');
    const lastRow = resultSheet.getLastRow();
    if (lastRow > 1) {
      resultSheet.deleteRows(2, lastRow - 1);
    }
    return { success: true, message: '모든 제출 기록이 초기화되었습니다.' };
  } catch (err) {
    return { success: false, message: '초기화 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}