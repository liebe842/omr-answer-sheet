// 로컬 미리보기용 가짜 Apps Script 서버. google.script.run 을 흉내 내고 호출을 window.__gasCalls 에 기록한다.
// URL 쿼리: ?scenario=fresh|empty|teacher|perfect, ?fail=<서버함수명> (해당 함수는 실패 응답)
(function () {
  var params = new URLSearchParams(location.search);
  var scenario = params.get('scenario') || 'fresh';
  var failFn = params.get('fail') || '';
  var show = params.get('show') || ''; // correct: 정답 보이기 / noscore: 점수 숨기기
  window.__stubReject = {}; // {서버함수명: true} 이면 통신 실패(실패 핸들러 호출)
  var TEACHER_PW = '1234';
  window.__gasCalls = [];
  window.__stubScenario = scenario;

  // ===== 시나리오 데이터 =====
  function baseQuestions() {
    return [
      { qNum: 1, qType: '객관식', rawAnswerStr: '3', points: 5, partialCredit: false },
      { qNum: 2, qType: '객관식', rawAnswerStr: '2, 4', points: 10, partialCredit: true },
      { qNum: 3, qType: '기호(ㄱ,ㄴ,ㄷ)', rawAnswerStr: 'ㄴ', points: 5, partialCredit: false },
      { qNum: 4, qType: 'OX퀴즈', rawAnswerStr: 'O', points: 5, partialCredit: false },
      { qNum: 5, qType: '단답식', rawAnswerStr: '세종대왕/세종, 장영실', points: 10, partialCredit: true },
      { qNum: 6, qType: '서술형', rawAnswerStr: '우리 고장의 옛 모습이 달라진 까닭을 쓴다', points: 10, partialCredit: false }
    ];
  }
  function splitSlots(raw, qType) {
    if (qType === '서술형') return [[String(raw || '').trim()]];
    var parts = String(raw || '').split(/[,|]/).map(function (s) { return s.trim(); });
    return parts.map(function (p) { return p.split('/').map(function (s) { return s.trim(); }); });
  }
  function blankCountOf(q) {
    return q.qType === '서술형' ? 1 : Math.max(1, splitSlots(q.rawAnswerStr, q.qType).length);
  }
  function isChoice(t) { return ['객관식', '기호(ㄱ,ㄴ,ㄷ)', '기호(가,나,다)', 'OX퀴즈'].indexOf(t) >= 0; }
  function displayCorrect(q) {
    return splitSlots(q.rawAnswerStr, q.qType).map(function (s) { return s.join('/'); }).join(', ');
  }

  var state = {
    settings: {
      examTitle: '사회 2단원 평가 답안지', teacherPassword: TEACHER_PW, showScore: show !== 'noscore', showCorrectAnswers: show === 'correct',
      ignoreSpaces: true, allowResubmit: false, omrTheme: 'blue', publishResults: false
    },
    questions: scenario === 'empty' ? [] : baseQuestions(),
    rows: []
  };

  // 단일 문항 채점 (서버 evaluateSingleQuestion 의 핵심 규칙)
  function norm(s) { return String(s || '').trim().replace(/\s+/g, '').toLowerCase(); }
  function evaluate(q, user) {
    var slots = splitSlots(q.rawAnswerStr, q.qType);
    var n = blankCountOf(q);
    var u = [];
    for (var b = 0; b < n; b++) u.push(String((user && user[b]) || '').trim());
    if (q.qType === '서술형') {
      return { status: '보류', earned: 0, display: u[0] || '(미입력)' };
    }
    var matched = 0, wrong = 0, all, part, i;
    if (isChoice(q.qType) && n > 1) {
      var used = {}, seen = {};
      u.map(norm).filter(Boolean).forEach(function (x) {
        if (seen[x]) return;
        seen[x] = true;
        var found = false;
        for (i = 0; i < slots.length; i++) {
          if (!used[i] && slots[i].map(norm).indexOf(x) >= 0) { used[i] = true; found = true; break; }
        }
        if (found) matched++; else wrong++;
      });
      all = matched === n && wrong === 0;
      part = q.partialCredit && matched > 0 && wrong === 0;
    } else {
      for (i = 0; i < n; i++) if (norm(u[i]) && slots[i].map(norm).indexOf(norm(u[i])) >= 0) matched++;
      all = matched === n;
      part = q.partialCredit && matched > 0;
    }
    var earned = 0, status = 'X';
    if (all) { earned = q.points; status = 'O'; }
    else if (part) { earned = Math.round(q.points * (matched / n) * 10) / 10; status = '△'; }
    return { status: status, earned: earned, display: u.filter(Boolean).length ? u.join(', ') : '(미입력)' };
  }

  function rowKeyOf(r) { return [r.time, r.number, r.name].join('|'); }
  function summaryOf(perQ) {
    return Object.keys(perQ).map(Number).sort(function (a, b) { return a - b; })
      .map(function (k) { return k + '번:' + perQ[k].status + '(' + (Number(perQ[k].earnedPoints) || 0) + '점)'; }).join(' / ');
  }

  // teacher 시나리오: 제출 5명 (완료 2, 대기 3). 이름 하나는 HTML/따옴표 포함
  function seedTeacherRows() {
    var names = [
      ['1', '김하늘', true], ['2', '이도윤', true], ['3', '박서연', false],
      ['4', '<b>"민\'수"</b>', false], ['5', '정우진', false]
    ];
    names.forEach(function (n, idx) {
      var answers = { 1: '3', 2: '2, 4', 3: 'ㄴ', 4: 'O', 5: '세종대왕, 장영실', 6: '길이 넓어지고 건물이 높아졌다.' };
      if (idx === 1) { answers[1] = '2'; answers[5] = '세종, 이순신'; }
      if (idx === 3) { answers[1] = '<img src=x onerror=alert(1)>'; }
      var perQ = {};
      state.questions.forEach(function (q) {
        var a = answers[q.qNum];
        var ev = evaluate(q, q.qType === '서술형' ? [a] : String(a).split(/,\s*/));
        perQ[q.qNum] = { status: ev.status, earnedPoints: ev.earned, maxPoints: q.points };
      });
      var complete = n[2];
      if (complete) perQ[6] = { status: 'O', earnedPoints: 10, maxPoints: 10 };
      var total = 0;
      Object.keys(perQ).forEach(function (k) { total += perQ[k].earnedPoints; });
      state.rows.push({
        time: '2026-10-1' + idx + ' 09:1' + idx + ':00', number: n[0], name: n[1],
        total: Math.round(total * 10) / 10, complete: complete, comment: complete ? '잘했어요.' : '',
        perQ: perQ, answers: answers
      });
    });
  }
  if (scenario === 'teacher') seedTeacherRows();

  // ===== 서버 함수 (반환 형태는 Code.js 와 동일) =====
  var server = {
    getStudentInitData: function () {
      return {
        examTitle: state.settings.examTitle, omrTheme: state.settings.omrTheme, allowResubmit: state.settings.allowResubmit === true,
        questions: state.questions.map(function (q) {
          return { qNum: q.qNum, qType: q.qType, blankCount: blankCountOf(q), points: q.points, partialCredit: q.partialCredit };
        })
      };
    },
    submitStudentAnswers: function (p) {
      var number = String(p.studentNumber || '').trim(), name = String(p.studentName || '').trim();
      if (!number || !name) return { success: false, message: '출석번호와 이름을 모두 입력해 주세요!' };
      if (!state.settings.allowResubmit) {
        for (var i = 0; i < state.rows.length; i++) {
          if (state.rows[i].number === number && state.rows[i].name === name) {
            return { success: false, message: number + '번 ' + name + ' 학생은 이미 답안지를 제출했습니다!' };
          }
        }
      }
      var perQ = {}, answers = {}, total = 0, hasEssay = false;
      state.questions.forEach(function (q) {
        var raw = (p.answers || {})[q.qNum];
        var ev = evaluate(q, Array.isArray(raw) ? raw : [raw || '']);
        if (q.qType === '서술형') hasEssay = true;
        total += ev.earned;
        answers[q.qNum] = ev.display;
        perQ[q.qNum] = { status: ev.status, earnedPoints: ev.earned, maxPoints: q.points };
      });
      state.rows.push({
        time: '2026-10-17 10:00:0' + state.rows.length, number: number, name: name,
        total: Math.round(total * 10) / 10, complete: !hasEssay, comment: '', perQ: perQ, answers: answers
      });
      return { success: true };
    },
    checkStudentResultStatus: function (p) {
      var number = String(p.studentNumber || '').trim(), name = String(p.studentName || '').trim();
      if (scenario === 'perfect') {
        var det = state.questions.map(function (q) {
          return {
            qNum: q.qNum, qType: q.qType, userAnswer: displayCorrect(q), status: 'O', earnedPoints: q.points,
            maxPoints: q.points, correctAnswer: displayCorrect(q)
          };
        });
        var max = state.questions.reduce(function (a, q) { return a + q.points; }, 0);
        return {
          published: true, studentNumber: number || '1', studentName: name || '김하늘', showScore: true, showCorrectAnswers: true,
          totalScore: max, maxScore: max, isPerfectScore: true, teacherComment: '정말 잘했어요.', details: det
        };
      }
      if (!state.settings.publishResults) return { published: false };
      var row = null;
      for (var i = state.rows.length - 1; i >= 0; i--) {
        if (state.rows[i].number === number && state.rows[i].name === name) { row = state.rows[i]; break; }
      }
      if (!row || !row.complete) return { published: false };
      var maxScore = 0;
      var details = state.questions.map(function (q) {
        maxScore += q.points;
        var rec = row.perQ[q.qNum] || { status: 'X', earnedPoints: 0 };
        return {
          qNum: q.qNum, qType: q.qType, userAnswer: row.answers[q.qNum] || '(미입력)', status: rec.status || 'O',
          earnedPoints: Number(rec.earnedPoints) || 0, maxPoints: q.points,
          correctAnswer: state.settings.showCorrectAnswers ? displayCorrect(q) : null
        };
      });
      return {
        published: true, studentNumber: number, studentName: name, showScore: state.settings.showScore === true,
        showCorrectAnswers: state.settings.showCorrectAnswers === true, totalScore: row.total, maxScore: maxScore,
        isPerfectScore: maxScore > 0 && row.total >= maxScore, teacherComment: row.comment, details: details
      };
    },
    verifyTeacherAndGetData: function (pw) {
      if (String(pw).trim() !== TEACHER_PW) return { success: false, message: '비밀번호가 일치하지 않습니다.' };
      var stats = state.questions.map(function (q) {
        var total = 0, wrong = 0, freq = {};
        state.rows.forEach(function (r) {
          var rec = r.perQ[q.qNum];
          if (!rec || rec.status === '보류') return;
          total++;
          if (rec.status !== 'O') {
            wrong++;
            var k = r.answers[q.qNum] || '(미입력)';
            freq[k] = (freq[k] || 0) + 1;
          }
        });
        var top = '', topN = 0;
        Object.keys(freq).forEach(function (k) { if (freq[k] > topN) { topN = freq[k]; top = k; } });
        return {
          qNum: q.qNum, qType: q.qType, correctAnswerStr: q.rawAnswerStr, totalCount: total, wrongCount: wrong,
          errorRate: total > 0 ? Math.round(wrong / total * 1000) / 10 : 0,
          topWrongAnswer: topN > 0 ? top + ' (' + topN + '명)' : '오답 없음'
        };
      });
      var subs = state.rows.map(function (r, idx) {
        return {
          rowIndex: idx + 2, rowKey: rowKeyOf(r), time: r.time.slice(5, 16), studentNumber: r.number, studentName: r.name,
          totalScore: r.total, summary: summaryOf(r.perQ), isCompleted: r.complete, teacherComment: r.comment,
          perQuestionMap: JSON.parse(JSON.stringify(r.perQ)), answersByQ: JSON.parse(JSON.stringify(r.answers))
        };
      }).reverse(); // 실제 서버처럼 최신 제출이 먼저
      return {
        success: true, settings: JSON.parse(JSON.stringify(state.settings)),
        questions: state.questions.map(function (q) {
          return { qNum: q.qNum, qType: q.qType, blankCount: blankCountOf(q), rawAnswerStr: q.rawAnswerStr, points: q.points, partialCredit: q.partialCredit };
        }),
        submissions: subs, questionStats: stats
      };
    },
    updateStudentQuestionGrade: function (p) {
      if (String(p.authPassword).trim() !== TEACHER_PW) return { success: false, message: '권한이 없습니다.' };
      var row = state.rows[Number(p.rowIndex) - 2];
      if (!row) return { success: false, message: '제출 기록을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.' };
      if (rowKeyOf(row) !== String(p.rowKey)) return { success: false, message: '제출 기록이 변경되었습니다. 새로고침 후 다시 채점해 주세요.' };
      if (p.updatedQuestions) {
        Object.keys(p.updatedQuestions).forEach(function (k) { row.perQ[k] = p.updatedQuestions[k]; });
      }
      var total = 0, hasPending = false;
      Object.keys(row.perQ).forEach(function (k) {
        total += Number(row.perQ[k].earnedPoints) || 0;
        if (row.perQ[k].status === '보류') hasPending = true;
      });
      total = Math.round(total * 10) / 10;
      // 실제 서버와 같은 완료 규칙
      var isCompleted = p.forceComplete !== undefined ? p.forceComplete : !hasPending;
      row.total = total;
      row.complete = isCompleted;
      if (p.teacherComment !== undefined) row.comment = String(p.teacherComment).trim();
      return { success: true, newTotalScore: total, isCompleted: isCompleted, message: '채점 내역과 총점이 자동으로 합산되어 저장되었습니다!' };
    },
    setPublishResultsStatus: function (p) {
      if (String(p.authPassword).trim() !== TEACHER_PW) return { success: false, message: '권한이 없습니다.' };
      state.settings.publishResults = !!p.publish;
      if (p.publish && p.markAllCompleted) state.rows.forEach(function (r) { r.complete = true; });
      return { success: true };
    },
    saveTeacherConfig: function (p) {
      if (String(p.authPassword).trim() !== TEACHER_PW) return { success: false, message: '권한이 없습니다.' };
      var s = p.settings || {};
      state.settings = {
        examTitle: s.examTitle || '우리들의 답안지', teacherPassword: s.teacherPassword || '1234', showScore: !!s.showScore,
        showCorrectAnswers: !!s.showCorrectAnswers, ignoreSpaces: !!s.ignoreSpaces, allowResubmit: !!s.allowResubmit,
        omrTheme: s.omrTheme || 'blue', publishResults: !!s.publishResults
      };
      state.questions = (p.questions || []).map(function (q, idx) {
        return { qNum: idx + 1, qType: q.qType, rawAnswerStr: String(q.rawAnswerStr || '').trim(), points: Number(q.points) || 0, partialCredit: q.partialCredit === true };
      });
      return { success: true, message: '설정과 정답지가 구글 시트(드롭다운 및 C열 자동 계산 수식 포함)에 완벽히 반영되었습니다!' };
    },
    clearSubmissionRecords: function (pw) {
      if (String(pw).trim() !== TEACHER_PW) return { success: false, message: '비밀번호가 일치하지 않습니다.' };
      state.rows = [];
      return { success: true, message: '모든 제출 기록이 초기화되었습니다.' };
    }
  };

  // ===== google.script.run 흉내 (접근할 때마다 새 러너, 핸들러는 체인으로 누적) =====
  function makeRunner(onOk, onFail) {
    var runner = {
      withSuccessHandler: function (fn) { return makeRunner(fn, onFail); },
      withFailureHandler: function (fn) { return makeRunner(onOk, fn); }
    };
    Object.keys(server).forEach(function (name) {
      runner[name] = function (payload) {
        window.__gasCalls.push({ fn: name, payload: payload });
        setTimeout(function () {
          var result;
          try {
            if (window.__stubReject[name]) { if (onFail) onFail(new Error('통신 실패(테스트)')); return; }
            if (failFn === name) {
              // 지정한 함수는 서버가 돌려주는 실패 응답 형태로 대체
              result = name === 'updateStudentQuestionGrade' ? { success: false, message: '권한이 없습니다.' }
                : { success: false, message: '서버 오류(테스트)' };
            } else {
              result = JSON.parse(JSON.stringify(server[name](payload)));
            }
          } catch (e) {
            if (onFail) onFail(e);
            return;
          }
          if (onOk) onOk(result);
        }, Math.floor(Math.random() * 20));
      };
    });
    // 서버에 없는 함수를 호출하면 실패 핸들러로 전달
    return new Proxy(runner, {
      get: function (t, prop) {
        if (prop in t || typeof prop !== 'string') return t[prop];
        return function (payload) {
          window.__gasCalls.push({ fn: prop, payload: payload });
          setTimeout(function () { if (onFail) onFail(new Error(prop + ' is not a function')); }, 0);
        };
      }
    });
  }
  window.google = window.google || {};
  Object.defineProperty(window.google, 'script', {
    configurable: true,
    get: function () {
      return { get run() { return makeRunner(null, null); }, host: { close: function () {}, setHeight: function () {} } };
    }
  });
})();
