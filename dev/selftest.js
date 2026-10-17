// 로컬 셀프테스트 러너 (?selftest=1 일 때만 동작). 앱 스크립트 뒤에 로드된다.
// 사용: test(name, fn, {scenario}) / assertEq / assertTrue. 결과는 window.__selftest 와 #selftest-result 에 기록.
(function () {
  var params = new URLSearchParams(location.search);
  var enabled = params.get('selftest') === '1';
  var pageScenario = params.get('scenario') || 'fresh';
  var tests = [];

  function fmt(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  window.assertEq = function (actual, expected, msg) {
    if (fmt(actual) !== fmt(expected)) {
      throw new Error((msg ? msg + ' - ' : '') + '기대 ' + fmt(expected) + ' / 실제 ' + fmt(actual));
    }
  };
  window.assertTrue = function (v, msg) {
    if (!v) throw new Error(msg || '참이어야 하는데 ' + fmt(v));
  };
  // 시나리오가 일치하는 페이지에서만 실행 (기본 fresh)
  window.test = function (name, fn, opts) {
    var scenario = (opts && opts.scenario) || 'fresh';
    tests.push({ name: name, fn: fn, scenario: scenario });
  };
  // 비동기 테스트용 짧은 대기
  window.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  if (!enabled) return;

  // ===== Task 1: 공용 헬퍼 =====
  test('escapeHtml은 & < > " \' 를 이스케이프한다', function () {
    assertEq(escapeHtml('<b>"민\'수"</b>'), '&lt;b&gt;&quot;민&#39;수&quot;&lt;/b&gt;');
    assertEq(escapeHtml('a&b'), 'a&amp;b');
    assertEq(escapeHtml(null), '');
  });
  test('getBubbleOptionsForType 기존 값 유지', function () {
    assertEq(getBubbleOptionsForType('OX퀴즈'), ['O', 'X']);
    assertEq(getBubbleOptionsForType('객관식'), ['1', '2', '3', '4', '5']);
    assertEq(getBubbleOptionsForType('기호(ㄱ,ㄴ,ㄷ)'), ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ']);
    assertEq(getBubbleOptionsForType('기호(가,나,다)'), ['가', '나', '다', '라', '마', '바']);
  });
  test('isChoiceType', function () {
    assertEq(isChoiceType('단답식'), false);
    assertEq(isChoiceType('서술형'), false);
    assertEq(isChoiceType('OX퀴즈'), true);
    assertEq(isChoiceType('객관식'), true);
  });
  test('showToast는 #toast에 문구를 보이고 2500ms 뒤 사라진다', async function () {
    var el = document.getElementById('toast');
    assertEq(el.getAttribute('role'), 'status');
    showToast('저장했어요');
    assertEq(el.textContent, '저장했어요');
    assertTrue(el.classList.contains('show'), 'show 클래스');
    await sleep(2700);
    assertTrue(!el.classList.contains('show'), '사라짐');
  });
  test('setMode는 학생/선생님 화면을 토글한다', function () {
    setMode('teacher');
    assertTrue(document.getElementById('studentView').hidden, '학생 숨김');
    assertTrue(!document.getElementById('teacherView').hidden, '선생님 보임');
    setMode('student');
    assertTrue(!document.getElementById('studentView').hidden, '학생 보임');
    assertTrue(document.getElementById('teacherView').hidden, '선생님 숨김');
  });

  // ===== Task 1: 스텁 서버 =====
  test('fresh: getStudentInitData 문항 6개와 호출 기록', async function () {
    var r = await serverCall('getStudentInitData');
    assertEq(r.questions.length, 6);
    assertEq(r.questions.map(function (q) { return q.qType; }),
      ['객관식', '객관식', '기호(ㄱ,ㄴ,ㄷ)', 'OX퀴즈', '단답식', '서술형']);
    assertEq(r.questions[1].blankCount, 2);
    assertEq(window.__gasCalls[window.__gasCalls.length - 1].fn, 'getStudentInitData');
  });
  test('serverCall은 실패 핸들러에서 reject한다', async function () {
    var failed = false;
    try { await serverCall('noSuchServerFn'); } catch (e) { failed = true; }
    assertTrue(failed, 'reject 되어야 함');
  });
  test('empty: 문항 0개', async function () {
    var r = await serverCall('getStudentInitData');
    assertEq(r.questions.length, 0);
  }, { scenario: 'empty' });
  test('teacher: 제출 5명(완료 2/대기 3), 위험 문자 이름', async function () {
    var r = await serverCall('verifyTeacherAndGetData', '1234');
    assertTrue(r.success);
    assertEq(r.submissions.length, 5);
    assertEq(r.submissions.filter(function (s) { return s.isCompleted; }).length, 2);
    assertTrue(r.submissions.some(function (s) { return s.studentName === '<b>"민\'수"</b>'; }));
    var bad = await serverCall('verifyTeacherAndGetData', 'x');
    assertEq(bad.success, false);
  }, { scenario: 'teacher' });
  test('teacher: 채점 저장 규칙(isCompleted)', async function () {
    if (params.get('fail')) return; // fail 모드에서는 다음 테스트가 검증
    var d = await serverCall('verifyTeacherAndGetData', '1234');
    var s = d.submissions.filter(function (x) { return !x.isCompleted; })[0];
    var r = await serverCall('updateStudentQuestionGrade', {
      authPassword: '1234', rowIndex: s.rowIndex, rowKey: s.rowKey,
      updatedQuestions: { 6: { status: 'O', earnedPoints: 10, maxPoints: 10 } }
    });
    assertTrue(r.success);
    assertTrue(typeof r.newTotalScore === 'number');
    assertEq(typeof r.isCompleted, 'boolean');
    var r2 = await serverCall('updateStudentQuestionGrade', {
      authPassword: '1234', rowIndex: s.rowIndex, rowKey: s.rowKey, forceComplete: false
    });
    assertEq(r2.isCompleted, false);
  }, { scenario: 'teacher' });
  test('teacher: ?fail=updateStudentQuestionGrade', async function () {
    if (!params.get('fail')) return; // fail 모드가 아니면 건너뜀
    var r = await serverCall('updateStudentQuestionGrade', { authPassword: '1234', rowIndex: 2, rowKey: 'x' });
    assertEq(r.success, false);
    assertEq(r.message, '권한이 없습니다.');
  }, { scenario: 'teacher' });
  test('perfect: 만점 결과가 즉시 공개된다', async function () {
    var r = await serverCall('checkStudentResultStatus', { studentNumber: '1', studentName: '김하늘' });
    assertEq(r.published, true);
    assertEq(r.isPerfectScore, true);
    assertEq(r.showScore, true);
    assertEq(r.showCorrectAnswers, true);
  }, { scenario: 'perfect' });

  // ===== 실행 =====
  async function runAll() {
    var result = { pass: 0, fail: 0, failures: [] };
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      if (t.scenario !== pageScenario) continue;
      try {
        await t.fn();
        result.pass++;
        console.log('PASS ' + t.name);
      } catch (e) {
        result.fail++;
        result.failures.push({ name: t.name, message: String(e && e.message || e) });
        console.log('FAIL ' + t.name + ' : ' + (e && e.message));
      }
    }
    window.__selftest = result;
    var pre = document.createElement('pre');
    pre.id = 'selftest-result';
    pre.textContent = JSON.stringify(result);
    document.body.appendChild(pre);
  }
  // 앱 첫 로딩(스텁 비동기 응답)이 끝난 뒤 실행
  window.addEventListener('load', function () { setTimeout(runAll, 100); });
})();
