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


  // 스크린샷용 상태 만들기: ?demo=waiting | result (result 는 fresh 에서 일부 오답을 내고 공개, perfect 시나리오는 바로 결과)
  var demoMode = params.get('demo');
  if (demoMode === 'waiting' || demoMode === 'result') {
    window.addEventListener('load', function () {
      setTimeout(async function () {
        if (pageScenario !== 'perfect') {
          document.getElementById('studentNumber').value = '7';
          document.getElementById('studentName').value = '홍길동';
          document.querySelector('.bubble[data-q="1"][data-v="3"]').click();
          document.querySelector('.bubble[data-q="2"][data-b="0"][data-v="2"]').click();
          document.querySelector('.bubble[data-q="2"][data-b="1"][data-v="4"]').click();
          document.querySelector('.bubble[data-q="3"][data-v="' + (demoMode === 'result' ? 'ㄷ' : 'ㄴ') + '"]').click();
          document.querySelector('.bubble[data-q="4"][data-v="O"]').click();
          var inputs = document.querySelectorAll('input[data-q="5"]');
          inputs[0].value = '세종'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
          if (demoMode === 'result') {
            await submitAnswers({ skipEmptyCheck: true });
          } else {
            inputs[1].value = '장영실'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
            var ta = document.querySelector('textarea[data-q="6"]');
            ta.value = '길이 넓어지고 건물이 높아졌다.'; ta.dispatchEvent(new Event('input', { bubbles: true }));
            await submitAnswers();
          }
        }
        if (demoMode === 'result') {
          if (pageScenario !== 'perfect') {
            await serverCall('setPublishResultsStatus', { authPassword: '1234', publish: true, markAllCompleted: true });
            var res = await serverCall('checkStudentResultStatus', { studentNumber: '7', studentName: '홍길동' });
            res.teacherComment = '공공 기관 이름을 정확히 알고 있네요. 잘했어요!';
            renderResult(res);
          } else {
            document.getElementById('answerForm').hidden = true;
            renderResult(await serverCall('checkStudentResultStatus', { studentNumber: '1', studentName: '김하늘' }));
          }
        }
      }, 200);
    });
  }

  // 스크린샷용: ?demo=teacher[&tab=results] 로그인된 선생님 화면, ?demo=modal 비밀번호 쪽지
  if (demoMode === 'teacher' || demoMode === 'modal') {
    window.addEventListener('load', function () {
      setTimeout(async function () {
        if (demoMode === 'modal') { openTeacherLogin(); return; }
        openTeacherLogin();
        document.getElementById('teacherPwInput').value = '1234';
        await confirmTeacherLogin();
        var t = params.get('tab');
        if (t) switchTab(t);
        // 채점 탭 보기: &gview=byStudent
        var gv = params.get('gview');
        if (gv) { teacherState.gradeView = gv; renderGradePanel(); }
      }, 300);
    });
  }

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

  // ===== Task 2: 시각 체계 (임시 요소를 만들고 지운다) =====
  function withTemp(html, fn) {
    var host = document.createElement('div');
    host.id = '__tmp_style_test';
    host.innerHTML = html;
    document.body.appendChild(host);
    try { return fn(host); } finally { host.remove(); }
  }
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function findRule(sel) {
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules; try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; } // 외부 폰트 시트는 건너뜀
      for (var j = 0; j < rules.length; j++) if (rules[j].selectorText === sel) return rules[j];
    }
    return null;
  }
  test('style: body는 책상 바탕색', function () {
    assertEq(getComputedStyle(document.body).backgroundColor, 'rgb(185, 191, 179)');
  });
  test('style: .bubble 터치 영역 >= 44, 눌림은 잉크 채움', function () {
    withTemp('<span class="bubble-group"><button type="button" class="bubble" aria-pressed="false">1</button><button type="button" class="bubble" aria-pressed="true">2</button></span>', function (h) {
      var b = h.querySelectorAll('.bubble');
      var r = b[0].getBoundingClientRect();
      assertTrue(r.width >= 44 && r.height >= 44, 'bubble ' + r.width + 'x' + r.height);
      assertEq(getComputedStyle(b[1]).backgroundColor, 'rgb(31, 31, 29)');
      assertEq(getComputedStyle(b[0]).backgroundColor === 'rgb(31, 31, 29)', false);
      // OS가 동작 줄이기면 전환이 꺼진다. 그때는 규칙 자체로 확인한다
      var tr = parseFloat(getComputedStyle(b[1]).transitionDuration) * 1000;
      if (reduceMotion) assertEq(tr, 0);
      else assertTrue(tr > 0 && tr <= 120, 'transition ' + tr);
      var rule = findRule('.bubble');
      assertTrue(rule && parseFloat(rule.style.transitionDuration) * 1000 <= 120 && parseFloat(rule.style.transitionDuration) > 0, 'rule transition');
    });
  });
  test('style: .paper 폭/질감, .paper--wide', function () {
    withTemp('<div class="paper"></div><div class="paper paper--wide"></div>', function (h) {
      var p = h.querySelectorAll('.paper');
      assertEq(getComputedStyle(p[0]).maxWidth, '760px');
      assertEq(getComputedStyle(p[1]).maxWidth, '1180px');
      assertEq(getComputedStyle(p[0]).backgroundColor, 'rgb(235, 230, 214)');
      assertTrue(getComputedStyle(p[0]).backgroundImage.indexOf('radial-gradient') >= 0, 'texture');
    });
  });
  test('style: .sheet-table 검은 선, th 음영', function () {
    withTemp('<table class="sheet-table"><tr><th>a</th><td>b</td></tr></table>', function (h) {
      var th = h.querySelector('th'), td = h.querySelector('td');
      assertEq(getComputedStyle(td).borderTopColor, 'rgb(31, 31, 29)');
      assertEq(getComputedStyle(td).borderTopWidth, '1px');
      assertEq(getComputedStyle(th).backgroundColor, 'rgba(0, 0, 0, 0.05)');
    });
  });
  test('style: .mark-cell 눌림은 빨간 펜 바탕', function () {
    withTemp('<span class="mark-cells"><button type="button" class="mark-cell" aria-pressed="true">o</button><button type="button" class="mark-cell" aria-pressed="false">x</button></span>', function (h) {
      var c = h.querySelectorAll('.mark-cell');
      assertEq(getComputedStyle(c[0]).backgroundColor, 'rgb(214, 38, 43)');
      assertEq(getComputedStyle(c[0]).color, 'rgb(235, 230, 214)');
      assertEq(getComputedStyle(c[1]).backgroundColor === 'rgb(214, 38, 43)', false);
    });
  });
  test('style: .index-tab 선택 탭은 종이색, 나머지는 더 어둡다', function () {
    withTemp('<div class="index-tabs"><button type="button" class="index-tab" aria-selected="true">a</button><button type="button" class="index-tab" aria-selected="false">b</button></div>', function (h) {
      var t = h.querySelectorAll('.index-tab');
      assertEq(getComputedStyle(t[0]).backgroundColor, 'rgb(235, 230, 214)');
      assertEq(getComputedStyle(t[1]).backgroundColor, 'rgb(217, 211, 192)');
    });
  });
  test('style: .btn-ink / .btn-quiet / .red-pen / .dim / .visually-hidden', function () {
    withTemp('<button class="btn-ink">a</button><button class="btn-quiet">b</button><span class="red-pen">c</span><span class="dim">d</span><span class="visually-hidden">e</span>', function (h) {
      var s = function (sel) { return getComputedStyle(h.querySelector(sel)); };
      assertEq(s('.btn-ink').backgroundColor, 'rgb(31, 31, 29)');
      assertEq(s('.btn-ink').color, 'rgb(235, 230, 214)');
      assertEq(s('.btn-quiet').backgroundColor, 'rgba(0, 0, 0, 0)');
      assertEq(s('.red-pen').color, 'rgb(214, 38, 43)');
      assertTrue(s('.red-pen').fontFamily.indexOf('Nanum Pen Script') >= 0, 'pen font');
      assertEq(s('.dim').opacity, '0.55');
      assertTrue(h.querySelector('.visually-hidden').getBoundingClientRect().width <= 1, 'hidden');
      assertTrue(parseFloat(s('.btn-ink').height) >= 44, 'btn height');
    });
  });
  test('style: .ink-switch 체크 시 트랙이 잉크색', function () {
    withTemp('<label class="ink-switch"><input type="checkbox" checked><span class="ink-switch__track"></span><span>on</span></label><label class="ink-switch"><input type="checkbox"><span class="ink-switch__track"></span><span>off</span></label>', function (h) {
      var t = h.querySelectorAll('.ink-switch__track');
      assertEq(getComputedStyle(t[0]).backgroundColor, 'rgb(31, 31, 29)');
      assertEq(getComputedStyle(t[1]).backgroundColor, 'rgb(235, 230, 214)');
    });
  });
  test('style: .stamp--hit 모션과 reduced-motion 규칙', function () {
    withTemp('<svg class="stamp stamp--hit"></svg>', function (h) {
      var cs = getComputedStyle(h.querySelector('.stamp'));
      if (reduceMotion) assertEq(cs.animationName, 'none');
      else assertTrue(cs.animationName !== 'none', 'animation ' + cs.animationName);
      var rule = findRule('.stamp--hit');
      assertTrue(rule && rule.style.animationName === 'stamp-hit', 'rule animation');
      assertTrue(parseFloat(rule.style.animationDuration) * 1000 <= 400, 'dur ' + rule.style.animationDuration);
    });
    var found = false;
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules; try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
      for (var j = 0; j < rules.length; j++) {
        if (rules[j].conditionText && rules[j].conditionText.indexOf('prefers-reduced-motion') >= 0 && rules[j].cssText.indexOf('stamp') >= 0) found = true;
      }
    }
    assertTrue(found, 'reduced-motion rule for .stamp');
  });
  test('style: .inline-note 점선, .inline-error 빨강 아님, .line-input 밑줄', function () {
    withTemp('<div class="inline-note">n</div><div class="inline-error">e</div><input class="line-input">', function (h) {
      assertEq(getComputedStyle(h.querySelector('.inline-note')).borderTopStyle, 'dashed');
      assertEq(getComputedStyle(h.querySelector('.inline-error')).color === 'rgb(214, 38, 43)', false);
      var li = getComputedStyle(h.querySelector('.line-input'));
      assertEq(li.borderBottomStyle, 'solid');
      assertEq(li.borderTopStyle, 'none');
    });
  });
  test('style: 360px 기준 .table-wrap은 가로 스크롤 가능', function () {
    withTemp('<div class="table-wrap"></div>', function (h) {
      assertEq(getComputedStyle(h.firstChild).overflowX, 'auto');
    });
  });

  // ===== Task 3: 학생 답안지 (작성 중) =====
  function pressBubble(q, b, v) {
    document.querySelector('.bubble[data-q="' + q + '"][data-b="' + b + '"][data-v="' + v + '"]').click();
  }
  function typeInto(el, v) {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function fillInfo(num, name) {
    document.getElementById('studentNumber').value = num;
    document.getElementById('studentName').value = name;
  }
  function answerAll() {
    pressBubble(1, 0, '3'); pressBubble(2, 0, '2'); pressBubble(2, 1, '4'); pressBubble(3, 0, 'ㄴ'); pressBubble(4, 0, 'O');
    var t = document.querySelectorAll('input[data-q="5"]');
    typeInto(t[0], '세종'); typeInto(t[1], '장영실');
    typeInto(document.querySelector('textarea[data-q="6"]'), '서술');
  }
  // 저장된 제출 기록을 지우고 빈 답안지로 다시 불러온다 (앞 테스트의 복귀 상태 차단)
  async function freshLoad() {
    clearSavedSubmission();
    savedSubmission = null;
    await loadStudentScreen();
  }
  function lastSubmitCall() {
    return window.__gasCalls.filter(function (c) { return c.fn === 'submitStudentAnswers'; }).pop();
  }
  test('student: 문항 6개 행, 제목, 라벨 연결, 배점 열', async function () {
    await freshLoad();
    assertEq(document.getElementById('examTitle').textContent, '사회 2단원 평가 답안지');
    assertEq(document.querySelectorAll('#answerTable tr[data-row]').length, 6);
    assertEq(document.querySelector('label[for="studentNumber"]').textContent, '번호');
    assertEq(document.querySelector('label[for="studentName"]').textContent, '이름');
    assertEq(Array.prototype.map.call(document.querySelectorAll('#answerTable thead th'), function (t) { return t.textContent; }), ['번호', '답', '배점']);
    assertEq(studentQuestions.length, 6);
  });
  test('student: 2번 문항에 (1)(2) 버블 그룹 두 개, 그룹 aria-label', async function () {
    await freshLoad();
    var g = document.querySelectorAll('tr[data-row="2"] [role="group"]');
    assertEq(g.length, 2);
    assertEq(g[0].getAttribute('aria-label'), '2번 (1)');
    assertEq(document.querySelectorAll('tr[data-row="1"] [role="group"]').length, 1);
  });
  test('student: 버블 클릭으로 선택, 다시 클릭하면 해제', async function () {
    await freshLoad();
    pressBubble(1, 0, '3');
    assertEq(studentAnswers[1][0], '3');
    assertEq(document.querySelector('.bubble[data-q="1"][data-v="3"]').getAttribute('aria-pressed'), 'true');
    pressBubble(1, 0, '3');
    assertEq(studentAnswers[1][0], '');
    assertEq(document.querySelector('.bubble[data-q="1"][data-v="3"]').getAttribute('aria-pressed'), 'false');
  });
  test('student: 객관식 다른 번호 입력과 버블 동기화', async function () {
    await freshLoad();
    var inp = document.querySelector('input.other-num[data-q="1"]');
    assertEq(inp.getAttribute('aria-label'), '1번 다른 번호');
    typeInto(inp, '4');
    assertEq(studentAnswers[1][0], '4');
    assertEq(document.querySelector('.bubble[data-q="1"][data-v="4"]').getAttribute('aria-pressed'), 'true');
    typeInto(inp, '9');
    assertEq(studentAnswers[1][0], '9');
    assertEq(document.querySelectorAll('tr[data-row="1"] .bubble[aria-pressed="true"]').length, 0);
    pressBubble(1, 0, '2');
    assertEq(inp.value, '2');
  });
  test('student: findEmptyQuestions', function () {
    var qs = [{ qNum: 1, blankCount: 1 }, { qNum: 2, blankCount: 2 }, { qNum: 3, blankCount: 1 }];
    assertEq(findEmptyQuestions(qs, { 1: ['3'], 2: ['1', ''], 3: ['  '] }), [2, 3]);
    assertEq(findEmptyQuestions(qs, { 1: ['3'], 2: ['1', '2'], 3: ['a'] }), []);
  });
  test('student: 번호·이름이 비면 서버 호출 없이 인라인 오류', async function () {
    await freshLoad();
    fillInfo('', '');
    var n = window.__gasCalls.length;
    await submitAnswers({ skipEmptyCheck: true });
    assertEq(window.__gasCalls.length, n);
    assertEq(document.getElementById('submitError').textContent, '번호와 이름을 써주세요.');
    assertEq(document.activeElement.id, 'studentNumber');
  });
  test('student: 빈 문항이 있으면 #emptyCheck 안내, 다시 보기는 첫 빈 문항으로', async function () {
    await freshLoad();
    fillInfo('7', '홍길동');
    pressBubble(1, 0, '3');
    var n = window.__gasCalls.length;
    await submitAnswers();
    var box = document.getElementById('emptyCheck');
    assertTrue(!box.hidden, '안내 보임');
    assertTrue(box.textContent.indexOf('아직 안 쓴 문항이 있어요: 2번, 3번, 4번, 5번, 6번') >= 0, box.textContent);
    assertEq(window.__gasCalls.length, n);
    var btns = Array.prototype.map.call(box.querySelectorAll('button'), function (b) { return b.textContent; });
    assertEq(btns, ['그래도 내기', '다시 보기']);
    box.querySelector('[data-action="review"]').click();
    assertTrue(box.hidden, '안내 닫힘');
    assertEq(document.activeElement.getAttribute('data-q'), '2');
  });
  test('student: 모두 답하고 제출하면 payload의 5번은 길이 2 배열', async function () {
    await freshLoad();
    fillInfo('7', '홍길동');
    answerAll();
    await submitAnswers();
    var call = lastSubmitCall();
    assertEq(call.payload.studentNumber, '7');
    assertEq(call.payload.studentName, '홍길동');
    assertEq(call.payload.answers[5], ['세종', '장영실']);
    assertEq(call.payload.answers[2], ['2', '4']);
    assertTrue(document.getElementById('answerForm').hidden, '폼 숨김');
    assertEq(savedSubmission.examTitle, '사회 2단원 평가 답안지');
    assertEq(savedSubmission.studentName, '홍길동');
    assertTrue(typeof savedSubmission.submittedAt === 'number');
  });
  test('student: 위험 문자 이름은 DOM 요소가 되지 않는다', async function () {
    await freshLoad();
    fillInfo('8', '<b>"민\'수"</b>');
    answerAll();
    await submitAnswers();
    assertEq(lastSubmitCall().payload.studentName, '<b>"민\'수"</b>');
    assertEq(document.querySelectorAll('#studentView b:not(#waitingNote b)').length, 0);
  });
  test('student: 서버 실패 메시지는 .inline-error로, 버튼은 되돌아온다', async function () {
    await freshLoad();
    fillInfo('7', '홍길동'); // 앞 테스트에서 이미 제출한 학생이라 스텁이 거절
    answerAll();
    await submitAnswers();
    var err = document.getElementById('submitError');
    assertTrue(!err.hidden && err.textContent.length > 0, '오류 문구');
    assertTrue(err.classList.contains('inline-error'), 'inline-error');
    assertEq(document.getElementById('submitBtn').disabled, false);
    assertEq(document.getElementById('submitBtn').textContent, '답안지 내기');
    assertTrue(!document.getElementById('answerForm').hidden, '폼 유지');
  });
  test('student: 가로 스크롤 없음', async function () {
    await freshLoad();
    assertTrue(document.documentElement.scrollWidth <= window.innerWidth,
      'scrollWidth ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth);
  });
  test('student: 빈 시나리오는 안내 문구', async function () {
    await freshLoad();
    assertTrue(document.getElementById('studentStatus').textContent.indexOf('등록된 문항이 없어요.') >= 0);
    assertTrue(document.getElementById('answerForm').hidden, '폼 숨김');
  }, { scenario: 'empty' });

  // ===== Task 4: 대기 / 복귀 / 결과 =====
  function callsOf(fn) {
    return window.__gasCalls.filter(function (c) { return c.fn === fn; });
  }
  function glyphsOf() {
    return Array.prototype.map.call(document.querySelectorAll('#studentAfter td.mark'), function (td) {
      var g = td.querySelector('.grade-glyph');
      return g ? g.textContent : '';
    });
  }
  test('student: readSavedSubmission 저장 직후, 다른 제목, 12시간 초과, 스토리지 예외', function () {
    var s = { studentNumber: '3', studentName: '가나', answers: { 1: ['3'] }, examTitle: '시험A', submittedAt: 1000000 };
    saveSubmission(s);
    assertEq(readSavedSubmission('시험A', 1000000).studentName, '가나');
    assertEq(readSavedSubmission('시험B', 1000000), null);
    assertEq(localStorage.getItem(SAVED_KEY), null, '불일치는 삭제');
    saveSubmission(s);
    assertEq(readSavedSubmission('시험A', s.submittedAt + SAVED_TTL_MS), s);
    assertEq(readSavedSubmission('시험A', s.submittedAt + SAVED_TTL_MS + 1), null);
    assertEq(localStorage.getItem(SAVED_KEY), null, '초과는 삭제');
    localStorage.setItem(SAVED_KEY, '{깨진 json');
    assertEq(readSavedSubmission('시험A', 1), null);
    assertEq(localStorage.getItem(SAVED_KEY), null, '깨진 값은 삭제');
    var origGet = Storage.prototype.getItem, origSet = Storage.prototype.setItem;
    try {
      Storage.prototype.getItem = function () { throw new Error('막힘'); };
      Storage.prototype.setItem = function () { throw new Error('막힘'); };
      assertEq(readSavedSubmission('시험A', 1), null);
      saveSubmission(s); // 예외 없이 지나가야 한다
      clearSavedSubmission();
    } finally {
      Storage.prototype.getItem = origGet;
      Storage.prototype.setItem = origSet;
    }
    clearSavedSubmission();
  });
  test('student: markGlyph', function () {
    assertEq(markGlyph('O'), '○');
    assertEq(markGlyph('X'), '/');
    assertEq(markGlyph('△'), '△');
    assertEq(markGlyph('보류'), '');
    assertEq(markGlyph(undefined), '');
  });
  test('student: 제출하면 대기 화면, 폼은 숨김, 저장됨', async function () {
    await freshLoad();
    fillInfo('11', '대기생');
    answerAll();
    await submitAnswers();
    var note = document.getElementById('waitingNote');
    assertTrue(note !== null && note.offsetParent !== null, '대기 안내 보임');
    assertEq(note.getAttribute('role'), 'status');
    assertEq(document.activeElement, note, '포커스가 안내로');
    assertTrue(note.textContent.indexOf('답안지를 냈어요.') >= 0);
    assertTrue(note.textContent.indexOf('선생님이 채점하시면 이 화면에 바로 나와요.') >= 0);
    assertTrue(document.getElementById('answerForm').hidden, '폼 숨김');
    assertEq(document.getElementById('studentNumber').readOnly, true);
    assertEq(document.querySelector('#studentAfter th:nth-child(3)').textContent, '채점');
    assertEq(document.querySelectorAll('#studentAfter .bubble:not(:disabled)').length, 0, '읽기 전용');
    assertEq(JSON.parse(localStorage.getItem(SAVED_KEY)).studentName, '대기생');
    await sleep(100);
    assertTrue(/^마지막 확인 \d\d:\d\d$/.test(document.getElementById('pollTime').textContent), '마지막 확인 ' + document.getElementById('pollTime').textContent);
  });
  test('student: 새로고침 시뮬레이션(loadStudentScreen 재호출) 후에도 대기 화면', async function () {
    await loadStudentScreen(); // 앞 테스트가 저장한 기록이 남아 있다
    assertTrue(document.getElementById('waitingNote') !== null && document.getElementById('answerForm').hidden, '대기 복귀');
    assertEq(document.getElementById('studentName').value, '대기생');
    assertEq(document.getElementById('waitingNote').getAttribute('role'), 'status');
    assertEq(document.querySelector('#studentAfter tr[data-row="2"] .bubble[aria-pressed="true"][data-b="1"]').getAttribute('data-v'), '4');
    await sleep(100);
    assertEq(callsOf('checkStudentResultStatus').pop().payload, { studentNumber: '11', studentName: '대기생' });
  });
  test('student: 확인 간격 5초 -> 7.5초(x1.5), 선생님 화면에서는 멈추고 돌아오면 이어간다', async function () {
    await loadStudentScreen();
    await sleep(100);
    assertEq(pollDelay, 7500);
    var n = callsOf('checkStudentResultStatus').length;
    setMode('teacher');
    assertEq(pollTimer, null, '타이머 해제');
    await sleep(100);
    assertEq(callsOf('checkStudentResultStatus').length, n, '멈춤');
    setMode('student');
    await sleep(100);
    assertEq(callsOf('checkStudentResultStatus').length, n + 1, '재개');
    assertEq(pollDelay, 7500, '재개하면 간격 처음부터');
  });
  test('student: 다른 학생이 새로 쓰기 -> 저장 삭제, 확인 중지, 빈 답안지', async function () {
    await loadStudentScreen();
    var link = document.getElementById('newStudentLink');
    assertEq(link.textContent, '다른 학생이 새로 쓰기');
    assertTrue(link.classList.contains('link-quiet'));
    link.click();
    await sleep(100);
    assertEq(localStorage.getItem(SAVED_KEY), null);
    assertEq(pollTimer, null);
    assertTrue(!document.getElementById('answerForm').hidden, '답안지 보임');
    assertEq(document.getElementById('studentNumber').value, '');
    assertEq(document.getElementById('studentNumber').readOnly, false);
    assertEq(document.getElementById('waitingNote'), null);
    assertEq(document.querySelectorAll('.bubble[aria-pressed="true"]').length, 0);
  });
  test('student: 제출 요청의 통신 실패(reject)는 인라인 오류, 버튼 복귀, 저장 없음', async function () {
    await freshLoad();
    fillInfo('12', '실패생');
    answerAll();
    window.__stubReject.submitStudentAnswers = true;
    try { await submitAnswers(); } finally { window.__stubReject = {}; }
    var err = document.getElementById('submitError');
    assertTrue(!err.hidden && err.textContent.indexOf('답안지를 내지 못했어요') >= 0, '오류 문구');
    assertEq(document.getElementById('submitBtn').disabled, false);
    assertEq(localStorage.getItem(SAVED_KEY), null);
    assertTrue(!document.getElementById('answerForm').hidden, '폼 유지');
  });
  test('student: 제출 중 다시 눌러도 서버 요청은 한 번', async function () {
    await freshLoad();
    fillInfo('13', '연타생');
    answerAll();
    var n = callsOf('submitStudentAnswers').length;
    var p1 = submitAnswers();
    var p2 = submitAnswers();
    await Promise.all([p1, p2]);
    assertEq(callsOf('submitStudentAnswers').length, n + 1);
  });
  test('student: localStorage가 막혀도 제출 -> 대기가 동작한다', async function () {
    await freshLoad();
    fillInfo('14', '막힘생');
    answerAll();
    var origGet = Storage.prototype.getItem, origSet = Storage.prototype.setItem;
    try {
      Storage.prototype.getItem = function () { throw new Error('막힘'); };
      Storage.prototype.setItem = function () { throw new Error('막힘'); };
      await submitAnswers();
    } finally {
      Storage.prototype.getItem = origGet;
      Storage.prototype.setItem = origSet;
    }
    assertTrue(document.getElementById('waitingNote') !== null, '대기 화면');
    assertEq(document.getElementById('submitError').hidden, true);
  });
  test('student: 공개되면 채점 결과(표시·총점), 정답 숨김이면 정답 줄 없음', async function () {
    await freshLoad();
    fillInfo('15', '결과생');
    pressBubble(1, 0, '3'); pressBubble(2, 0, '2'); pressBubble(2, 1, '4'); pressBubble(3, 0, 'ㄷ'); pressBubble(4, 0, 'O');
    var t = document.querySelectorAll('input[data-q="5"]');
    typeInto(t[0], '세종');
    typeInto(document.querySelector('textarea[data-q="6"]'), '서술');
    await submitAnswers({ skipEmptyCheck: true });
    await serverCall('setPublishResultsStatus', { authPassword: '1234', publish: true, markAllCompleted: true });
    await checkNow();
    assertEq(studentPhase, 'result');
    assertEq(pollTimer, null, '확인 중지');
    assertEq(document.querySelector('#studentAfter th:nth-child(3)').textContent, '채점');
    assertEq(glyphsOf(), ['○', '○', '/', '○', '△', '']);
    assertEq(document.querySelector('#studentAfter tr[data-row="5"] .grade-score').textContent, '5');
    assertEq(document.querySelector('#resultTotal .red-circle').textContent, '25');
    assertEq(document.querySelectorAll('.stamp').length, 0, '만점 아님');
    assertEq(document.querySelectorAll('.correct-note').length, 0);
    assertTrue(document.querySelector('.result-comment') === null, '한 말씀 없음');
    assertTrue(!!document.querySelector('[data-action="go-start"]'));
  });
  test('student: 결과의 처음으로는 저장 삭제 후 빈 답안지', async function () {
    // 앞 테스트의 결과 화면이 그대로 남아 있다
    document.querySelector('[data-action="go-start"]').click();
    await sleep(100);
    assertEq(localStorage.getItem(SAVED_KEY), null);
    assertTrue(!document.getElementById('answerForm').hidden, '답안지 보임');
    assertEq(document.getElementById('resultTotal').hidden, true);
    assertEq(document.getElementById('studentPaper').classList.contains('paper--result'), false);
    assertEq(document.getElementById('studentAfter').innerHTML, '');
  });

  function pressedOf(row) {
    return Array.prototype.map.call(document.querySelectorAll('#studentAfter tr[data-row="' + row + '"] .bubble[aria-pressed="true"]'), function (b) {
      return b.getAttribute('data-v');
    });
  }
  test('perfect: 결과에 .stamp(+--hit), 총점 동그라미, 다빈칸 칸별 표시', async function () {
    var res = await serverCall('checkStudentResultStatus', { studentNumber: '1', studentName: '김하늘' });
    renderResult(res);
    var stamp = document.querySelector('#studentAfter .stamp');
    assertTrue(!!stamp && stamp.classList.contains('stamp--hit'), '.stamp.stamp--hit');
    assertTrue(stamp.textContent.replace(/\s/g, '').indexOf('참잘했어요') >= 0, '도장 글자');
    assertEq(document.querySelector('#resultTotal .red-circle').textContent, '45');
    assertEq(glyphsOf(), ['○', '○', '○', '○', '○', '○']);
    assertEq(pressedOf(2), ['2', '4'], '2번 칸별 버블');
    var reads = Array.prototype.map.call(document.querySelectorAll('#studentAfter tr[data-row="5"] .answer-read'), function (e) { return e.textContent; });
    assertEq(reads, ['세종대왕/세종', '장영실'], '5번 칸별 답(서버 문자열 분해)');
    assertEq(document.querySelector('.result-comment').textContent, '정말 잘했어요.');
    var cs = getComputedStyle(stamp);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) assertEq(cs.animationName, 'none');
    else assertTrue(cs.animationName !== 'none', 'animation ' + cs.animationName);
  }, { scenario: 'perfect' });
  test('perfect: 이 기기에 저장한 답은 서버 답과 같을 때만 칸별로 쓴다', async function () {
    // 스텁 서버 답: 1번 '3', 2번 '2, 4', 5번 '세종대왕/세종, 장영실'
    savedSubmission = { studentNumber: '1', studentName: '김하늘', examTitle: studentExamTitle, submittedAt: Date.now(), answers: { 1: ['1'], 2: ['2', '4'], 5: ['세종대왕/세종', ' 장영실 '] } };
    var res = await serverCall('checkStudentResultStatus', { studentNumber: '1', studentName: '김하늘' });
    renderResult(res);
    assertEq(pressedOf(1), ['3'], '다르면 서버 답');
    assertEq(pressedOf(2), ['2', '4']);
    var reads = Array.prototype.map.call(document.querySelectorAll('#studentAfter tr[data-row="5"] .answer-read'), function (e) { return e.textContent; });
    assertEq(reads, ['세종대왕/세종', '장영실']);
    savedSubmission = null;
  }, { scenario: 'perfect' });
  test('perfect: 틀린 행에 정답(빨간 펜), 위험 문자는 글자 그대로', async function () {
    var evil = '<img src=x onerror=alert(1)>';
    renderResult({
      published: true, studentNumber: '1', studentName: '김하늘', showScore: true, showCorrectAnswers: true,
      totalScore: 10, maxScore: 45, isPerfectScore: false, teacherComment: evil + '"\'',
      details: [
        { qNum: 1, qType: '객관식', userAnswer: '2', status: 'X', earnedPoints: 0, maxPoints: 5, correctAnswer: '3' },
        { qNum: 5, qType: '단답식', userAnswer: evil + ', 장영실', status: '△', earnedPoints: 7.5, maxPoints: 10, correctAnswer: evil },
        { qNum: 6, qType: '서술형', userAnswer: evil, status: '보류', earnedPoints: 0, maxPoints: 10, correctAnswer: null }
      ]
    });
    var notes = Array.prototype.map.call(document.querySelectorAll('.correct-note'), function (e) { return e.textContent; });
    assertEq(notes, ['→ 3', '→ ' + evil]);
    assertEq(document.querySelectorAll('#studentView img').length, 0, '요소가 되지 않는다');
    assertEq(document.querySelector('.result-comment').textContent, evil + '"\'');
    assertEq(glyphsOf(), ['/', '△', '']);
    assertEq(document.querySelector('tr[data-row="5"] .grade-score').textContent, '7.5');
    assertEq(document.querySelectorAll('.stamp').length, 0);
    assertEq(getComputedStyle(document.querySelector('.correct-note')).color, 'rgb(214, 38, 43)');
  }, { scenario: 'perfect' });
  test('perfect: 보류·알 수 없는 상태에는 정답 줄이 없다', async function () {
    renderResult({
      published: true, studentNumber: '1', studentName: '김하늘', showScore: true, showCorrectAnswers: true,
      totalScore: 0, maxScore: 10, isPerfectScore: false, teacherComment: '',
      details: [
        { qNum: 5, qType: '단답식', userAnswer: '세종', status: 'O', earnedPoints: 5, maxPoints: 5, correctAnswer: '세종' },
        { qNum: 6, qType: '서술형', userAnswer: '답', status: '보류', earnedPoints: 0, maxPoints: 10, correctAnswer: '채점 기준' },
        { qNum: 1, qType: '객관식', userAnswer: '2', status: '?', earnedPoints: 0, maxPoints: 5, correctAnswer: '3' }
      ]
    });
    assertEq(document.querySelectorAll('.correct-note').length, 0);
  }, { scenario: 'perfect' });
  test('perfect: showScore가 false면 표시·총점 없이 안내와 한 말씀', async function () {
    renderResult({
      published: true, studentNumber: '1', studentName: '김하늘', showScore: false, showCorrectAnswers: true,
      totalScore: 45, maxScore: 45, isPerfectScore: true, teacherComment: '수고했어요.',
      details: [{ qNum: 1, qType: '객관식', userAnswer: '3', status: 'O', earnedPoints: 5, maxPoints: 5, correctAnswer: '3' }]
    });
    assertEq(document.getElementById('resultTotal').hidden, true);
    assertEq(document.querySelectorAll('.grade-glyph, .stamp, .correct-note').length, 0);
    assertTrue(document.getElementById('studentAfter').textContent.indexOf('선생님이 채점을 마쳤어요.') >= 0);
    assertEq(document.querySelector('.result-comment').textContent, '수고했어요.');
  }, { scenario: 'perfect' });

  // ===== Task 5: 선생님 껍데기 =====
  function tById(id) { return document.getElementById(id); }
  async function teacherLogin(pw) {
    if (!tById('teacherView').hidden) tById('toStudentBtn').click();
    openTeacherLogin();
    tById('teacherPwInput').value = pw === undefined ? '1234' : pw;
    await confirmTeacherLogin();
  }
  function visiblePanels() {
    return ['panelGrade', 'panelResults', 'panelSetup'].filter(function (id) { return !tById(id).hidden; });
  }
  test('teacher: 틀린 비밀번호는 모달 안에 문구를 보이고 모달이 남는다', async function () {
    openTeacherLogin();
    assertEq(tById('passwordModal').hidden, false);
    assertEq(document.activeElement.id, 'teacherPwInput');
    tById('teacherPwInput').value = '9999';
    await confirmTeacherLogin();
    assertEq(tById('pwError').textContent, '비밀번호가 일치하지 않습니다.');
    assertEq(tById('pwError').hidden, false);
    assertEq(tById('pwError').getAttribute('role'), 'alert');
    assertEq(tById('passwordModal').hidden, false);
    assertEq(tById('teacherView').hidden, true);
    assertEq(tById('pwOkBtn').disabled, false);
    assertEq(teacherState.pw, '');
  }, { scenario: 'teacher' });
  test('teacher: 빈 비밀번호는 서버를 부르지 않고 안내한다', async function () {
    var before = window.__gasCalls.length;
    tById('teacherPwInput').value = '';
    await confirmTeacherLogin();
    assertEq(tById('pwError').textContent, '비밀번호를 입력해 주세요.');
    assertEq(window.__gasCalls.length, before);
  }, { scenario: 'teacher' });
  test('teacher: 통신 실패는 안내하고 들어가기를 다시 켠다', async function () {
    window.__stubReject.verifyTeacherAndGetData = true;
    tById('teacherPwInput').value = '1234';
    await confirmTeacherLogin();
    window.__stubReject.verifyTeacherAndGetData = false;
    assertTrue(tById('pwError').textContent.length > 0 && !tById('pwError').hidden);
    assertEq(tById('pwOkBtn').disabled, false);
    assertEq(tById('teacherView').hidden, true);
  }, { scenario: 'teacher' });
  test('teacher: 맞는 비밀번호로 들어가면 상단 줄과 첫 탭(채점)이 보인다', async function () {
    tById('teacherPwInput').value = '1234';
    var p = confirmTeacherLogin();
    assertEq(tById('pwOkBtn').disabled, true, '확인 중에는 들어가기 비활성');
    await p;
    assertEq(tById('passwordModal').hidden, true);
    assertEq(tById('teacherView').hidden, false);
    assertEq(tById('studentView').hidden, true);
    var counts = tById('tCounts').textContent;
    assertTrue(counts.indexOf('제출 5명') >= 0, counts);
    assertTrue(counts.indexOf('채점 대기 3명') >= 0, counts);
    assertEq(tById('tExamTitle').textContent, '사회 2단원 평가 답안지');
    assertEq(teacherState.tab, 'grade');
    assertEq(teacherState.gradeView, 'byQuestion');
    assertEq(teacherState.selectedQNum, 6); // Task 6: 채점 탭이 첫 채점 순서 문항을 고른다
    assertEq(teacherState.selectedRowIndex, null);
    assertEq(teacherState.pw, '1234');
    assertEq(teacherState.submissions.length, 5);
    assertEq(teacherState.questions.length, 6);
    assertEq(teacherState.stats.length, 6);
    assertEq(visiblePanels(), ['panelGrade']);
    assertEq(tById('publishSwitch').checked, false);
    assertEq(tById('publishState').textContent, '꺼짐');
  }, { scenario: 'teacher' });
  test('teacher: countWaiting 은 완료되지 않은 제출만 센다', async function () {
    assertEq(countWaiting([]), 0);
    assertEq(countWaiting(null), 0);
    assertEq(countWaiting([{ isCompleted: true }, { isCompleted: false }, {}, { isCompleted: false }]), 3);
  }, { scenario: 'teacher' });
  test('teacher: 탭 클릭은 해당 패널만 보이고 aria 를 갱신한다', async function () {
    var tabs = ['tabGrade', 'tabResults', 'tabSetup'], panels = ['panelGrade', 'panelResults', 'panelSetup'];
    assertEq(tById('tabGrade').parentNode.getAttribute('role'), 'tablist');
    for (var i = 0; i < 3; i++) {
      tById(tabs[i]).click();
      assertEq(visiblePanels(), [panels[i]]);
      assertEq(tabs.map(function (t) { return tById(t).getAttribute('aria-selected'); }), tabs.map(function (t, j) { return j === i ? 'true' : 'false'; }));
      assertEq(tabs.map(function (t) { return tById(t).tabIndex; }), tabs.map(function (t, j) { return j === i ? 0 : -1; }));
      assertEq(tById(tabs[i]).getAttribute('aria-controls'), panels[i]);
      assertEq(tById(panels[i]).getAttribute('aria-labelledby'), tabs[i]);
      assertEq(tById(panels[i]).getAttribute('role'), 'tabpanel');
    }
    assertEq(teacherState.tab, 'setup');
    tById('tabGrade').click();
  }, { scenario: 'teacher' });
  test('teacher: 좌우 화살표로 탭을 옮기고 끝에서는 돌아간다', async function () {
    tById('tabGrade').focus();
    function key(k) { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }
    key('ArrowRight');
    assertEq(document.activeElement.id, 'tabResults');
    assertEq(teacherState.tab, 'results');
    assertEq(visiblePanels(), ['panelResults']);
    key('ArrowRight');
    key('ArrowRight');
    assertEq(document.activeElement.id, 'tabGrade');
    key('ArrowLeft');
    assertEq(document.activeElement.id, 'tabSetup');
    assertEq(teacherState.tab, 'setup');
    tById('tabGrade').click();
  }, { scenario: 'teacher' });
  test('teacher: 새로고침은 스크롤을 유지하고 현재 탭만 다시 그린다', async function () {
    await sleep(60); // 앞 테스트에서 탭을 옮기며 보낸 새로고침 응답이 먼저 끝나게
    var calls = { grade: 0, results: 0, setup: 0 };
    var orig = { g: window.renderGradePanel, r: window.renderResultsPanel, s: window.renderSetupPanel };
    window.renderGradePanel = function () { calls.grade++; return orig.g.apply(this, arguments); };
    window.renderResultsPanel = function () { calls.results++; return orig.r.apply(this, arguments); };
    window.renderSetupPanel = function () { calls.setup++; return orig.s.apply(this, arguments); };
    document.body.style.minHeight = '4000px';
    window.scrollTo(0, 300);
    var y0 = window.scrollY;
    await refreshTeacherData();
    var y1 = window.scrollY;
    document.body.style.minHeight = '';
    window.renderGradePanel = orig.g; window.renderResultsPanel = orig.r; window.renderSetupPanel = orig.s;
    assertTrue(y0 > 0, '스크롤이 먼저 움직여야 함 ' + y0);
    assertEq(y1, y0);
    assertEq(calls, { grade: 1, results: 0, setup: 0 });
    assertEq(window.__gasCalls[window.__gasCalls.length - 1].fn, 'verifyTeacherAndGetData');
  }, { scenario: 'teacher' });
  test('teacher: 공개 스위치를 켜면 서버에 알리고 토스트를 띄운다', async function () {
    tById('publishSwitch').click();
    await sleep(80);
    var last = window.__gasCalls.filter(function (c) { return c.fn === 'setPublishResultsStatus'; }).pop();
    assertEq(last.payload, { authPassword: '1234', publish: true, markAllCompleted: false });
    assertEq(tById('publishState').textContent, '켜짐');
    assertEq(tById('toast').textContent, '결과를 보여주기 시작했어요');
    assertEq(teacherState.settings.publishResults, true);
    assertEq(tById('publishSwitch').disabled, false);
    tById('publishSwitch').click();
    await sleep(80);
    assertEq(tById('toast').textContent, '결과를 다시 가렸어요');
    assertEq(tById('publishState').textContent, '꺼짐');
  }, { scenario: 'teacher' });
  test('teacher: 공개 설정이 실패하면 스위치가 되돌아오고 오류 토스트', async function () {
    window.__stubReject.setPublishResultsStatus = true;
    tById('publishSwitch').click();
    await sleep(80);
    window.__stubReject.setPublishResultsStatus = false;
    assertEq(tById('publishSwitch').checked, false);
    assertEq(tById('publishState').textContent, '꺼짐');
    assertEq(tById('toast').classList.contains('error'), true);
    assertEq(teacherState.settings.publishResults, false);
    assertEq(tById('publishSwitch').disabled, false);
  }, { scenario: 'teacher' });
  test('teacher: 학생 화면으로 돌아가면 비밀번호와 데이터를 지운다', async function () {
    tById('tabResults').click();
    tById('toStudentBtn').click();
    assertEq(tById('teacherView').hidden, true);
    assertEq(tById('studentView').hidden, false);
    assertEq(teacherState.pw, '');
    assertEq(teacherState.submissions, []);
    assertEq(teacherState.tab, 'grade');
    assertEq(tById('teacherPwInput').value, '');
  }, { scenario: 'teacher' });
  test('teacher: Escape 는 취소하고 포커스를 선생님 버튼으로 돌린다', async function () {
    tById('teacherEntryBtn').click();
    assertEq(tById('passwordModal').hidden, false);
    assertEq(document.activeElement.id, 'teacherPwInput');
    var dlg = tById('passwordModal').querySelector('[role="dialog"]');
    assertEq(dlg.getAttribute('aria-modal'), 'true');
    assertTrue(!!dlg.getAttribute('aria-labelledby'));
    assertEq(tById('teacherPwInput').labels.length, 1);
    tById('teacherPwInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assertEq(tById('passwordModal').hidden, true);
    assertEq(document.activeElement.id, 'teacherEntryBtn');
    tById('teacherEntryBtn').click();
    tById('pwCancelBtn').click();
    assertEq(tById('passwordModal').hidden, true);
  }, { scenario: 'teacher' });
  test('teacher: Enter 로 들어가고, 다시 열면 비밀번호 칸과 오류가 비어 있다', async function () {
    tById('teacherEntryBtn').click();
    assertEq(tById('teacherPwInput').value, '');
    assertEq(tById('pwError').hidden, true);
    tById('teacherPwInput').value = '1234';
    tById('teacherPwInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(100);
    assertEq(tById('teacherView').hidden, false);
    assertEq(tById('passwordModal').hidden, true);
  }, { scenario: 'teacher' });
  test('teacher: 시험 제목의 위험 문자는 상단에서도 글자 그대로', async function () {
    teacherState.settings.examTitle = '<img src=x onerror=alert(1)> 평가';
    renderTopBar();
    assertEq(tById('tExamTitle').textContent, '<img src=x onerror=alert(1)> 평가');
    assertEq(tById('teacherView').querySelectorAll('img').length, 0);
  }, { scenario: 'teacher' });

  test('teacher: 새로고침 응답이 늦게 와도 학생 화면으로 나간 뒤에는 반영하지 않는다', async function () {
    await teacherLogin('1234');
    var rendered = 0, orig = window.renderTopBar;
    window.renderTopBar = function () { rendered++; return orig.apply(this, arguments); };
    var p = refreshTeacherData();
    tById('toStudentBtn').click();
    await p;
    window.renderTopBar = orig;
    assertEq(teacherState.submissions, []);
    assertEq(teacherState.questions, []);
    assertEq(teacherState.pw, '');
    assertEq(rendered, 0);
  }, { scenario: 'teacher' });
  test('teacher: 공개 스위치 응답이 늦게 와도 나간 뒤에는 토스트가 없다', async function () {
    await teacherLogin('1234');
    tById('toast').textContent = '';
    tById('publishSwitch').click();
    tById('toStudentBtn').click();
    await sleep(80);
    assertEq(tById('toast').textContent, '');
    assertEq(teacherState.settings, {});
  }, { scenario: 'teacher' });
  test('teacher: Enter 를 두 번 눌러도 확인 요청은 한 번만 간다', async function () {
    if (!tById('teacherView').hidden) tById('toStudentBtn').click();
    openTeacherLogin();
    var before = window.__gasCalls.filter(function (c) { return c.fn === 'verifyTeacherAndGetData'; }).length;
    tById('teacherPwInput').value = '1234';
    var ev = function () { tById('teacherPwInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
    ev(); ev();
    await sleep(100);
    var after = window.__gasCalls.filter(function (c) { return c.fn === 'verifyTeacherAndGetData'; }).length;
    assertEq(after - before, 1);
    assertEq(tById('teacherView').hidden, false);
  }, { scenario: 'teacher' });
  test('teacher: 확인 중에 취소하면 학생 화면에 남는다', async function () {
    if (!tById('teacherView').hidden) tById('toStudentBtn').click();
    openTeacherLogin();
    tById('teacherPwInput').value = '1234';
    var p = confirmTeacherLogin();
    tById('pwCancelBtn').click();
    await p;
    assertEq(tById('teacherView').hidden, true);
    assertEq(tById('studentView').hidden, false);
    assertEq(teacherState.pw, '');
    assertEq(tById('pwOkBtn').disabled, false);
  }, { scenario: 'teacher' });
  test('teacher: 공개 스위치를 누른 뒤에도 포커스가 스위치에 남는다', async function () {
    await teacherLogin('1234');
    tById('publishSwitch').focus();
    tById('publishSwitch').click();
    await sleep(80);
    assertEq(document.activeElement.id, 'publishSwitch');
    tById('publishSwitch').click();
    await sleep(80);
    assertEq(document.activeElement.id, 'publishSwitch');
    assertEq(tById('publishSwitch').hasAttribute('aria-busy') && tById('publishSwitch').getAttribute('aria-busy') === 'true', false);
  }, { scenario: 'teacher' });
  test('teacher: 틀린 비밀번호는 글자가 선택되어 바로 다시 쓸 수 있다', async function () {
    if (!tById('teacherView').hidden) tById('toStudentBtn').click();
    openTeacherLogin();
    tById('teacherPwInput').value = '9999';
    await confirmTeacherLogin();
    var el = tById('teacherPwInput');
    assertEq([el.selectionStart, el.selectionEnd], [0, 4]);
    assertEq(document.activeElement.id, 'teacherPwInput');
    closeTeacherLogin();
  }, { scenario: 'teacher' });

  // ===== Task 6: 채점 탭 =====
  var FAIL_MODE = !!params.get('fail');
  // 스텁을 처음 상태로 되돌리고(앞 테스트의 채점 흔적 제거) 응답 지연을 0으로 고정한 뒤 로그인
  async function gradeLogin() {
    window.__stubReset();
    window.__stubDelay = 0;
    window.__stubFailQueue = {};
    await teacherLogin('1234');
  }
  function gradeCellEl(row, q) {
    return document.querySelector('#panelGrade .grade-cell[data-row="' + row + '"][data-q="' + q + '"]');
  }
  function markBtn(row, q, mark) {
    return gradeCellEl(row, q).querySelector('.mark-cell[data-mark="' + mark + '"]');
  }
  function pressedMarks(row, q) {
    return Array.prototype.map.call(gradeCellEl(row, q).querySelectorAll('.mark-cell[aria-pressed="true"]'), function (b) { return b.getAttribute('data-mark'); });
  }
  function gradeCalls() { return window.__gasCalls.filter(function (c) { return c.fn === 'updateStudentQuestionGrade'; }); }
  function subOf(row) { return teacherState.submissions.filter(function (s) { return s.rowIndex === row; })[0]; }
  function textsOf(sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent.trim(); }); }
  function enterOn(el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }

  test('grade: orderQuestionsForGrading 은 보류 서술형이 먼저, countPendingForQuestion = 3', async function () {
    await gradeLogin();
    var order = orderQuestionsForGrading(teacherState.questions, teacherState.submissions);
    assertEq(order[0], 6);
    assertEq(order, [6, 1, 2, 3, 4, 5]);
    assertEq(countPendingForQuestion(teacherState.submissions, 6), 3);
    assertEq(countPendingForQuestion(teacherState.submissions, 1), 0);
    // 그룹 규칙: 보류 남은 서술형 -> 다른 서술형 -> 나머지 (각 그룹 qNum 오름차순)
    var qs = [{ qNum: 1, qType: '서술형' }, { qNum: 2, qType: '객관식' }, { qNum: 3, qType: '서술형' }, { qNum: 4, qType: '서술형' }];
    var subs = [{ perQuestionMap: { 1: { status: 'O' }, 3: { status: '보류' }, 4: { status: '보류' } } }];
    assertEq(orderQuestionsForGrading(qs, subs), [3, 4, 1, 2]);
  }, { scenario: 'teacher' });

  test('grade: 기본은 문항별 보기, 선택기·머리·표', async function () {
    await gradeLogin();
    assertEq(teacherState.gradeView, 'byQuestion');
    assertEq(tById('gvByQuestion').getAttribute('aria-pressed'), 'true');
    assertEq(tById('gvByStudent').getAttribute('aria-pressed'), 'false');
    assertEq(teacherState.selectedQNum, 6);
    var picks = document.querySelectorAll('#qPicker button[data-qnum]');
    assertEq(Array.prototype.map.call(picks, function (b) { return b.getAttribute('data-qnum'); }), ['6', '1', '2', '3', '4', '5']);
    assertEq(Array.prototype.map.call(picks, function (b) { return b.getAttribute('aria-pressed'); }), ['true', 'false', 'false', 'false', 'false', 'false']);
    assertEq(Array.prototype.map.call(picks, function (b) { return b.classList.contains('q-pick--pending'); }), [true, false, false, false, false, false]);
    var head = tById('gradeQHead').textContent;
    assertTrue(head.indexOf('6번 · 서술형 · 10점 · 채점 기준') >= 0, head);
    assertTrue(head.indexOf('우리 고장의 옛 모습이 달라진 까닭을 쓴다') >= 0, head);
    assertEq(tById('gradeRemain').textContent, '3명 남음');
    assertEq(tById('gradeAfterNote').hidden, true);
    assertEq(textsOf('#panelGrade .grade-table thead th'), ['학생', '답', '채점']);
    assertEq(textsOf('#panelGrade .grade-table tbody td.who'), ['1 김하늘', '2 이도윤', '3 박서연', '4 <b>"민\'수"</b>', '5 정우진']);
    assertTrue(gradeCellEl(4, 6).closest('.table-wrap') !== null, '표는 .table-wrap 안');
    // 자동 채점 문항
    document.querySelector('#qPicker button[data-qnum="1"]').click();
    assertEq(teacherState.selectedQNum, 1);
    assertTrue(tById('gradeQHead').textContent.indexOf('자동 채점 문항') >= 0, tById('gradeQHead').textContent);
    assertEq(document.querySelector('#qPicker button[data-qnum="1"]').getAttribute('aria-pressed'), 'true');
  }, { scenario: 'teacher' });

  test('grade: 빈 답은 (빈칸), 다빈칸 답은 쉼표로', async function () {
    await gradeLogin();
    var s = subOf(4);
    s.answersByQ[6] = '(미입력)';
    s.answersByQ[5] = '세종대왕,장영실';
    teacherState.selectedQNum = 6;
    renderGradePanel();
    var cell = gradeCellEl(4, 6).closest('tr').querySelector('td.answer');
    assertEq(cell.textContent.trim(), '(빈칸)');
    assertTrue(cell.querySelector('.answer-empty') !== null);
    document.querySelector('#qPicker button[data-qnum="5"]').click();
    assertEq(gradeCellEl(4, 5).closest('tr').querySelector('td.answer').textContent.trim(), '세종대왕, 장영실');
  }, { scenario: 'teacher' });

  test('grade: parsePartialScore', function () {
    var msg = '0에서 20점 사이 숫자를 써주세요';
    ['', '-1', '21', 'abc', '  '].forEach(function (v) {
      assertEq(parsePartialScore(v, 20), { ok: false, message: msg }, JSON.stringify(v));
    });
    assertEq(parsePartialScore('7.5', 20), { ok: true, value: 7.5 });
    assertEq(parsePartialScore('20', 20), { ok: true, value: 20 });
    assertEq(parsePartialScore('0', 20), { ok: true, value: 0 });
    assertEq(parsePartialScore(' 3 ', 10), { ok: true, value: 3 });
  }, { scenario: 'teacher' });

  test('grade: buildGradePayload 는 그 행의 완료 상태를 그대로 보낸다', async function () {
    await gradeLogin();
    var done = subOf(2), wait = subOf(4);
    var p = buildGradePayload(wait, 6, 'O', 10, 10);
    assertEq(p, { authPassword: '1234', rowIndex: 4, rowKey: wait.rowKey, updatedQuestions: { 6: { status: 'O', earnedPoints: 10, maxPoints: 10 } }, forceComplete: false });
    assertEq(buildGradePayload(done, 1, 'X', 0, 5).forceComplete, true);
    assertEq('teacherComment' in p, false);
  }, { scenario: 'teacher' });

  test('grade: 위험 문자 이름과 답은 두 보기 모두 글자 그대로', async function () {
    await gradeLogin();
    var panel = tById('panelGrade');
    document.querySelector('#qPicker button[data-qnum="1"]').click();
    assertEq(panel.querySelectorAll('b, img').length, 0, '문항별');
    var row = gradeCellEl(5, 1).closest('tr');
    assertEq(row.querySelector('td.who').textContent.trim(), '4 <b>"민\'수"</b>');
    assertEq(row.querySelector('td.answer').textContent.trim(), '<img src=x onerror=alert(1)>');
    assertEq(row.querySelector('.score-input').getAttribute('aria-label'), '1번 <b>"민\'수"</b> 부분점수');
    tById('gvByStudent').click();
    assertEq(teacherState.gradeView, 'byStudent');
    assertEq(panel.querySelectorAll('b, img').length, 0, '학생별 명렬표');
    document.querySelector('#gradeRoster button[data-pick-row="5"]').click();
    assertEq(panel.querySelectorAll('b, img').length, 0, '학생별 답안지');
    assertEq(tById('gradeStudentName').textContent, '4번 <b>"민\'수"</b>');
  }, { scenario: 'teacher' });

  test('grade: 대기 학생의 마지막 보류를 매겨도 완료되지 않는다, 스크롤·포커스 유지', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    document.body.style.minHeight = '4000px';
    window.scrollTo(0, 250);
    var y0 = window.scrollY;
    var btn = markBtn(4, 6, 'O');
    btn.focus();
    var n0 = gradeCalls().length;
    btn.click();
    assertEq(pressedMarks(4, 6), ['O'], '낙관적 표시');
    await sleep(40);
    var y1 = window.scrollY;
    document.body.style.minHeight = '';
    var calls = gradeCalls();
    assertEq(calls.length - n0, 1);
    var p = calls[calls.length - 1].payload;
    assertEq(p.forceComplete, false);
    assertEq('teacherComment' in p, false, '채점 칸 저장은 한 말씀을 보내지 않는다');
    assertEq(p.updatedQuestions, { 6: { status: 'O', earnedPoints: 10, maxPoints: 10 } });
    var s = subOf(4);
    assertEq(s.isCompleted, false);
    assertEq(s.totalScore, 45);
    assertEq(s.perQuestionMap[6].status, 'O');
    assertTrue(tById('tCounts').textContent.indexOf('채점 대기 3명') >= 0, tById('tCounts').textContent);
    assertEq(tById('gradeRemain').textContent, '2명 남음');
    assertTrue(y0 > 0, '먼저 스크롤 ' + y0);
    assertEq(y1, y0);
    assertTrue(btn.isConnected, '단추가 다시 그려지지 않는다');
    assertEq(document.activeElement, btn);
    assertEq(pressedMarks(4, 6), ['O']);
  }, { scenario: 'teacher' });

  test('grade: 보류를 모두 매기면 학생별로 가서 채점 끝을 누르라는 안내', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    [4, 5, 6].forEach(function (r) { markBtn(r, 6, 'X').click(); });
    await sleep(60);
    assertEq(tById('gradeRemain').textContent, '0명 남음');
    assertEq(tById('gradeAfterNote').hidden, false);
    assertEq(tById('gradeAfterNote').textContent, "학생별로에서 한 말씀을 쓰고 '채점 끝'을 누르면 학생에게 보여요.");
    assertEq(document.querySelector('#qPicker button[data-qnum="6"]').classList.contains('q-pick--pending'), false);
    assertTrue(tById('tCounts').textContent.indexOf('채점 대기 3명') >= 0);
  }, { scenario: 'teacher' });

  test('grade: 완료된 학생을 / 로 다시 매겨도 완료가 유지된다', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    document.querySelector('#qPicker button[data-qnum="1"]').click();
    await gradeCell(2, 1, 'X');
    var p = gradeCalls().pop().payload;
    assertEq(p.forceComplete, true);
    var s = subOf(2);
    assertEq(s.isCompleted, true);
    assertEq(s.totalScore, 40);
    assertEq(pressedMarks(2, 1), ['X']);
    assertTrue(tById('tCounts').textContent.indexOf('채점 대기 3명') >= 0);
  }, { scenario: 'teacher' });

  test('grade: ?fail 이면 칸이 원래대로, 오류 토스트, 다른 행은 그대로', async function () {
    if (!FAIL_MODE) return;
    await gradeLogin();
    var before4 = pressedMarks(4, 6);
    var b = markBtn(5, 6, 'O');
    b.click();
    assertEq(pressedMarks(5, 6), ['O']);
    await sleep(40);
    assertEq(b.getAttribute('aria-pressed'), 'false');
    assertEq(pressedMarks(5, 6), []);
    assertEq(pressedMarks(4, 6), before4);
    assertTrue(tById('toast').classList.contains('error'), '오류 토스트');
    assertEq(subOf(5).perQuestionMap[6].status, '보류');
  }, { scenario: 'teacher' });

  test('grade: 한 행만 실패하면 그 행만 되돌리고 다른 행은 저장된 대로', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    window.__stubFailQueue = { updateStudentQuestionGrade: [false, true] };
    markBtn(4, 6, 'X').click();
    markBtn(5, 6, 'O').click();
    await sleep(60);
    assertEq(pressedMarks(4, 6), ['X']);
    assertEq(subOf(4).perQuestionMap[6].status, 'X');
    assertEq(pressedMarks(5, 6), []);
    assertEq(subOf(5).perQuestionMap[6].status, '보류');
    assertTrue(tById('toast').classList.contains('error'));
  }, { scenario: 'teacher' });

  test('grade: 같은 칸을 빠르게 두 번 누르면 나중 것이 이긴다(차례대로 저장)', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    var n0 = gradeCalls().length;
    function sentStatuses() { return gradeCalls().slice(n0).map(function (c) { return c.payload.updatedQuestions[6].status; }); }
    // 보내기 전에 연달아 누르면 마지막 것만 보낸다
    markBtn(6, 6, 'O').click();
    markBtn(6, 6, '△').click();
    markBtn(6, 6, 'X').click();
    assertEq(pressedMarks(6, 6), ['X']);
    await sleep(60);
    assertEq(sentStatuses(), ['X']);
    // 앞 저장이 서버에 가 있는 동안 누르면 그 응답을 기다렸다가 보낸다
    n0 = gradeCalls().length;
    markBtn(6, 6, 'O').click();
    await null; await null;
    assertEq(sentStatuses(), ['O'], '첫 저장은 바로 간다');
    markBtn(6, 6, 'X').click();
    assertEq(sentStatuses(), ['O'], '앞 응답 전에는 다음 것을 보내지 않는다');
    assertEq(pressedMarks(6, 6), ['X']);
    await sleep(60);
    assertEq(sentStatuses(), ['O', 'X']);
    assertEq(pressedMarks(6, 6), ['X']);
    assertEq(subOf(6).perQuestionMap[6].status, 'X');
    assertEq(subOf(6).totalScore, 35);
    // 앞 것이 실패해도 더 새로 누른 것이 있으면 되돌리지 않는다
    window.__stubFailQueue = { updateStudentQuestionGrade: [true, false] };
    markBtn(5, 6, 'O').click();
    await null; await null;
    markBtn(5, 6, 'X').click();
    await sleep(60);
    assertEq(pressedMarks(5, 6), ['X']);
    assertEq(subOf(5).perQuestionMap[6].status, 'X');
  }, { scenario: 'teacher' });

  test('grade: △ 는 점수 칸에 절반을 넣고 Enter 로 저장, 잘못된 점수는 인라인 오류', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    var cell = gradeCellEl(4, 6);
    var input = cell.querySelector('.score-input');
    assertEq(input.getAttribute('aria-label'), '6번 박서연 부분점수');
    assertEq(input.getAttribute('placeholder'), '점');
    assertEq(input.getAttribute('type'), 'text');
    assertEq(input.getAttribute('inputmode'), 'decimal');
    var n0 = gradeCalls().length;
    markBtn(4, 6, '△').click();
    assertEq(document.activeElement, input);
    assertEq(input.value, '5');
    assertEq(gradeCalls().length - n0, 0, '△ 만 눌러서는 저장하지 않는다');
    input.value = '7.5';
    enterOn(input);
    await sleep(40);
    var p = gradeCalls().pop().payload;
    assertEq(p.updatedQuestions[6], { status: '△', earnedPoints: 7.5, maxPoints: 10 });
    assertEq(pressedMarks(4, 6), ['△']);
    assertEq(subOf(4).totalScore, 42.5);
    var n1 = gradeCalls().length;
    input.value = '21';
    enterOn(input);
    await sleep(20);
    var err = cell.querySelector('.inline-error');
    assertEq(err.hidden, false);
    assertEq(err.textContent, '0에서 10점 사이 숫자를 써주세요');
    assertEq(gradeCalls().length, n1, '잘못된 점수는 저장하지 않는다');
    input.value = '10';
    input.dispatchEvent(new Event('blur'));
    await sleep(40);
    assertEq(gradeCalls().pop().payload.updatedQuestions[6].status, 'O');
    assertEq(err.hidden, true);
    assertEq(pressedMarks(4, 6), ['O']);
    // 바뀐 것이 없으면 blur 에 다시 저장하지 않는다
    var n2 = gradeCalls().length;
    input.dispatchEvent(new Event('blur'));
    await sleep(20);
    assertEq(gradeCalls().length, n2);
  }, { scenario: 'teacher' });

  test('grade: 학생별 보기 명렬표(번호순)와 답안지 표', async function () {
    await gradeLogin();
    tById('gvByStudent').click();
    assertEq(tById('gvByStudent').getAttribute('aria-pressed'), 'true');
    assertEq(textsOf('#gradeRoster thead th'), ['번호', '이름', '점수']);
    assertEq(textsOf('#gradeRoster tbody td.num'), ['1', '2', '3', '4', '5']);
    assertEq(textsOf('#gradeRoster tbody td.score'), ['45', '35', '대기', '대기', '대기']);
    // 처음 고르는 학생 = 아직 대기인 첫 학생
    assertEq(teacherState.selectedRowIndex, 4);
    assertEq(document.querySelector('#gradeRoster button[data-pick-row="4"]').getAttribute('aria-pressed'), 'true');
    assertEq(tById('gradeStudentName').textContent, '3번 박서연');
    assertEq(textsOf('#gradeSheet thead th'), ['번호', '학생 답', '정답', '채점']);
    assertEq(document.querySelectorAll('#gradeSheet tbody tr').length, 6);
    assertEq(tById('commentInput').tagName, 'INPUT');
    assertTrue(document.querySelector('label[for="commentInput"]') !== null, '한 말씀 라벨');
    assertEq(tById('prevStudentBtn').textContent, '이전 학생');
    assertEq(tById('finishStudentBtn').textContent, '채점 끝, 다음 학생');
    // 학생별 보기에서 채점하면 머리 총점과 명렬표 점수만 갱신
    if (FAIL_MODE) return;
    var total = tById('gradeStudentTotal');
    assertEq(total.textContent, '35점');
    markBtn(4, 6, 'O').click();
    await sleep(40);
    assertEq(total.textContent, '45점');
    assertTrue(total.isConnected);
    assertEq(document.querySelector('#gradeRoster tr[data-row="4"] td.score').textContent.trim(), '대기');
  }, { scenario: 'teacher' });

  test('grade: 보류가 남았는데 채점 끝(auto)은 서버 호출 없이 안내와 버튼 2개', async function () {
    await gradeLogin();
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="5"]').click();
    var n0 = window.__gasCalls.length;
    await finishStudent(5, 'auto');
    assertEq(window.__gasCalls.length, n0, '서버 호출 없음');
    var area = tById('finishArea');
    assertEq(area.querySelector('.inline-note').textContent.indexOf('아직 안 매긴 서술형이 있어요(6번). 완료하면 0점으로 보여요.') >= 0, true, area.textContent);
    assertEq(textsOf('#finishArea button'), ['한 말씀만 저장', '그래도 완료']);
    assertEq(teacherState.selectedRowIndex, 5);
  }, { scenario: 'teacher' });

  test('grade: 한 말씀만 저장은 지금 완료 상태(false)를 보내고 다음 학생으로', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="5"]').click();
    tById('commentInput').value = '조금만 더 써 봐요.';
    tById('finishStudentBtn').click();
    await sleep(20);
    var n0 = gradeCalls().length;
    document.querySelector('#finishArea button[data-finish="commentOnly"]').click();
    await sleep(40);
    var calls = gradeCalls();
    assertEq(calls.length - n0, 1);
    var p = calls[calls.length - 1].payload;
    assertEq(p.forceComplete, false, 'R11: 한 말씀만 저장은 지금 완료 상태를 그대로 보낸다');
    assertEq(p.teacherComment, '조금만 더 써 봐요.');
    assertEq(p.rowIndex, 5);
    assertEq(subOf(5).isCompleted, false);
    assertEq(subOf(5).teacherComment, '조금만 더 써 봐요.');
    assertEq(tById('toast').textContent, '한 말씀을 저장했어요');
    assertEq(teacherState.selectedRowIndex, 6);
    assertEq(tById('gradeStudentName').textContent, '5번 정우진');
    assertEq(tById('commentInput').value, '');
  }, { scenario: 'teacher' });

  test('grade: 마지막 보류 저장이 실패하면 뒤따른 채점 끝은 완료하지 않고 안내를 띄운다', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="5"]').click();
    window.__stubFailQueue = { updateStudentQuestionGrade: [true] };
    var n0 = gradeCalls().length;
    markBtn(5, 6, 'O').click();
    tById('finishStudentBtn').click(); // 낙관적 표시로는 보류가 없어 보인다
    await sleep(60);
    var mine = gradeCalls().slice(n0);
    assertEq(mine.length, 1, '채점 칸 저장만 갔다');
    assertEq(mine.some(function (c) { return c.payload.forceComplete === true; }), false);
    assertEq(subOf(5).isCompleted, false);
    assertEq(pressedMarks(5, 6), []);
    var warn = document.querySelector('#finishArea .finish-warn');
    assertTrue(warn !== null, '안내가 보여야 함');
    assertEq(warn.textContent, '아직 안 매긴 서술형이 있어요(6번). 완료하면 0점으로 보여요.');
    assertEq(textsOf('#finishArea button'), ['한 말씀만 저장', '그래도 완료']);
    assertTrue(tById('toast').classList.contains('error'), '오류 토스트가 덮이지 않는다');
    assertEq(teacherState.selectedRowIndex, 5);
  }, { scenario: 'teacher' });

  test('grade: 완료된 학생에게 보류가 있어도 한 말씀만 저장은 완료를 유지한다', async function () {
    if (FAIL_MODE) return;
    window.__stubReset();
    window.__stubDelay = 0;
    window.__stubFailQueue = {};
    var d = await serverCall('verifyTeacherAndGetData', '1234');
    var s2 = d.submissions.filter(function (x) { return x.rowIndex === 2; })[0];
    await serverCall('updateStudentQuestionGrade', { authPassword: '1234', rowIndex: 2, rowKey: s2.rowKey,
      updatedQuestions: { 6: { status: '보류', earnedPoints: 0, maxPoints: 10 } }, forceComplete: true });
    await teacherLogin('1234');
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="2"]').click();
    await finishStudent(2, 'auto');
    assertTrue(document.querySelector('#finishArea .finish-warn') !== null);
    document.querySelector('#finishArea button[data-finish="commentOnly"]').click();
    await sleep(40);
    var p = gradeCalls().pop().payload;
    assertEq(p.forceComplete, true);
    assertEq(subOf(2).isCompleted, true);
    assertTrue(tById('tCounts').textContent.indexOf('채점 대기 3명') >= 0, tById('tCounts').textContent);
  }, { scenario: 'teacher' });

  test('grade: 안내 뒤 마지막 보류를 매기고 바로 한 말씀만 저장하면 forceComplete false', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="5"]').click();
    await finishStudent(5, 'auto');
    assertTrue(document.querySelector('#finishArea .finish-warn') !== null);
    markBtn(5, 6, 'O').click();
    assertEq(document.querySelector('#finishArea .finish-warn'), null, '매기면 안내가 원래 단추로 돌아간다');
    assertEq(textsOf('#finishArea button'), ['이전 학생', '채점 끝, 다음 학생']);
    var n0 = gradeCalls().length;
    var pr = finishStudent(5, 'commentOnly');
    await pr;
    var mine = gradeCalls().slice(n0);
    assertEq(mine.length, 2);
    assertEq(mine[0].payload.updatedQuestions[6].status, 'O');
    assertEq('forceComplete' in mine[1].payload, true);
    assertEq(mine[1].payload.forceComplete, false);
    assertEq(subOf(5).isCompleted, false);
  }, { scenario: 'teacher' });

  test('grade: 저장 뒤 기록이 바뀌었으면 고정 문구로 알리고 새로고침한다', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    var n0 = window.__gasCalls.filter(function (c) { return c.fn === 'verifyTeacherAndGetData'; }).length;
    markBtn(4, 6, 'O').click();
    subOf(4).rowKey = 'other'; // 응답 전에 기록이 바뀐 것처럼
    await sleep(60);
    assertEq(tById('toast').textContent, '다른 곳에서 바뀐 기록이에요. 새로고침했어요.');
    var n1 = window.__gasCalls.filter(function (c) { return c.fn === 'verifyTeacherAndGetData'; }).length;
    assertEq(n1 - n0, 1);
  }, { scenario: 'teacher' });

  test('grade: 그래도 완료는 forceComplete true, 마지막 학생이면 멈춘다', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="6"]').click();
    await finishStudent(6, 'auto');
    document.querySelector('#finishArea button[data-finish="complete"]').click();
    await sleep(40);
    var p = gradeCalls().pop().payload;
    assertEq(p.forceComplete, true);
    assertEq(p.teacherComment, '');
    assertEq(subOf(6).isCompleted, true);
    assertTrue(tById('tCounts').textContent.indexOf('채점 대기 2명') >= 0, tById('tCounts').textContent);
    assertEq(document.querySelector('#gradeRoster tr[data-row="6"] td.score').textContent.trim(), '35');
    assertEq(tById('toast').textContent, '채점을 끝냈어요. 마지막 학생이에요');
    assertEq(teacherState.selectedRowIndex, 6);
  }, { scenario: 'teacher' });

  test('grade: 보류가 없으면 채점 끝은 바로 완료하고 다음 학생, 이전 학생은 뒤로', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    tById('gvByStudent').click();
    document.querySelector('#gradeRoster button[data-pick-row="4"]').click();
    markBtn(4, 6, 'O').click();
    tById('commentInput').value = '잘 썼어요.';
    tById('finishStudentBtn').click(); // 앞 저장이 끝난 뒤에 보낸다
    await sleep(60);
    var calls = gradeCalls();
    var last = calls[calls.length - 1].payload, prev = calls[calls.length - 2].payload;
    assertEq(prev.updatedQuestions[6].status, 'O');
    assertEq(last.forceComplete, true);
    assertEq(last.teacherComment, '잘 썼어요.');
    assertEq(subOf(4).isCompleted, true);
    assertEq(subOf(4).totalScore, 45);
    assertEq(tById('toast').textContent, '채점을 끝냈어요');
    assertEq(teacherState.selectedRowIndex, 5);
    tById('prevStudentBtn').click();
    assertEq(teacherState.selectedRowIndex, 4);
    assertEq(tById('commentInput').value, '잘 썼어요.', '저장된 한 말씀을 다시 보여준다');
    document.querySelector('#gradeRoster button[data-pick-row="2"]').click();
    document.querySelector('#gradeRoster button[data-pick-row="2"]').click();
    tById('prevStudentBtn').click();
    assertEq(teacherState.selectedRowIndex, 2);
    tById('prevStudentBtn').click();
    assertEq(teacherState.selectedRowIndex, 2, '첫 학생에서 멈춘다');
  }, { scenario: 'teacher' });

  test('grade: 채점 중 선생님 화면을 나가면 늦은 응답은 무시', async function () {
    if (FAIL_MODE) return;
    await gradeLogin();
    window.__stubDelay = 20;
    tById('toast').textContent = '';
    markBtn(4, 6, 'O').click();
    tById('toStudentBtn').click();
    await sleep(60);
    window.__stubDelay = 0;
    assertEq(teacherState.submissions, []);
    assertEq(tById('toast').textContent, '');
    assertEq(tById('panelGrade').innerHTML, '');
  }, { scenario: 'teacher' });

  test('grade: 900px 미만이면 학생별 보기가 1단, 가로 스크롤 없음', async function () {
    await gradeLogin();
    assertTrue(document.documentElement.scrollWidth <= window.innerWidth, '문항별 ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth);
    tById('gvByStudent').click();
    var cols = getComputedStyle(document.querySelector('.grade-split')).gridTemplateColumns.split(' ').length;
    assertEq(cols, window.innerWidth < 900 ? 1 : 2, 'width ' + window.innerWidth);
    assertTrue(document.documentElement.scrollWidth <= window.innerWidth, '학생별 ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth);
    assertTrue(document.querySelector('#gradeSheet').closest('.table-wrap') !== null);
  }, { scenario: 'teacher' });

  // ===== Task 7: 결과 보기 / 정답과 설정 =====
  async function freshTeacher() {
    window.__stubReset();
    window.__stubFailQueue = {};
    window.__gasCalls.length = 0;
    await teacherLogin();
  }
  function callsOf(fn) { return window.__gasCalls.filter(function (c) { return c.fn === fn; }); }
  function setVal(el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }

  test('results: 잉크 막대 수는 서술형이 아닌 문항 수와 같다', async function () {
    await freshTeacher();
    switchTab('results');
    var nonEssay = teacherState.stats.filter(function (s) { return s.qType !== '서술형'; }).length;
    assertTrue(nonEssay > 0 && nonEssay < teacherState.stats.length);
    assertEq(document.querySelectorAll('#panelResults .ink-bar').length, nonEssay);
    assertTrue(document.querySelector('#panelResults .table-wrap .stat-table') !== null, '오답 표는 .table-wrap 안');
    assertTrue(/\d+명 \(\d+(\.\d)?%\)/.test(document.querySelector('#panelResults .stat-table tbody tr').textContent));
    assertTrue(document.querySelector('#panelResults .table-wrap .roster-all') !== null, '제출 명렬표');
  }, { scenario: 'teacher' });
  test('results: 제출이 없으면 안내 문장을 보인다', async function () {
    await freshTeacher();
    teacherState.stats = teacherState.stats.map(function (s) { return Object.assign({}, s, { totalCount: 0, wrongCount: 0, errorRate: 0 }); });
    teacherState.submissions = [];
    switchTab('results');
    assertTrue(document.getElementById('panelResults').textContent.indexOf('제출이 쌓이면 문항별로 틀린 학생 수가 나와요.') >= 0);
    assertEq(document.querySelectorAll('#panelResults .ink-bar').length, 0);
  }, { scenario: 'teacher' });
  test('results: 이름의 꺾쇠와 따옴표는 글자 그대로 보인다', async function () {
    await freshTeacher();
    teacherState.submissions[0].studentName = '<img src=x onerror=alert(1)>"\'';
    teacherState.submissions[0].summary = '<b>요약</b>';
    switchTab('results');
    renderResultsPanel();
    assertEq(document.querySelectorAll('#panelResults img, #panelResults b').length, 0);
    assertTrue(document.getElementById('panelResults').textContent.indexOf('<img src=x onerror=alert(1)>"\'') >= 0);
  }, { scenario: 'teacher' });
  test('results: 기록 지우기는 첫 클릭에 서버 호출이 없고 두 번째에 호출한다', async function () {
    await freshTeacher();
    switchTab('results');
    document.getElementById('clearRecordsBtn').click();
    assertEq(callsOf('clearSubmissionRecords').length, 0);
    assertTrue(document.getElementById('panelResults').textContent.indexOf('정말 지울까요? 되돌릴 수 없어요.') >= 0);
    var cancel = document.getElementById('clearCancelBtn');
    assertTrue(cancel !== null);
    cancel.click();
    assertEq(callsOf('clearSubmissionRecords').length, 0);
    assertTrue(document.getElementById('clearRecordsBtn') !== null);
    document.getElementById('clearRecordsBtn').click();
    document.getElementById('clearConfirmBtn').click();
    await sleep(150);
    assertEq(callsOf('clearSubmissionRecords').length, 1);
    assertEq(callsOf('clearSubmissionRecords')[0].payload, '1234');
    assertEq(teacherState.submissions.length, 0);
    assertEq(document.getElementById('toast').textContent, '제출 기록을 모두 지웠어요.');
  }, { scenario: 'teacher' });
  test('results: 기록 지우기 실패는 오류 토스트를 보이고 기록이 남는다', async function () {
    await freshTeacher();
    var n = teacherState.submissions.length;
    switchTab('results');
    window.__stubFailQueue = { clearSubmissionRecords: [true] };
    document.getElementById('clearRecordsBtn').click();
    document.getElementById('clearConfirmBtn').click();
    await sleep(150);
    assertEq(teacherState.submissions.length, n);
    assertTrue(document.getElementById('toast').classList.contains('error'));
  }, { scenario: 'teacher' });

  test('setup: 저장 payload 는 omrTheme blue, 새 문항 origQNum null, 기존 문항 origQNum 유지', async function () {
    await freshTeacher();
    switchTab('setup');
    var n = teacherState.questions.length;
    document.getElementById('addQuestionBtn').click();
    assertEq(document.querySelectorAll('#setupRows tr').length, n + 1);
    document.getElementById('setupSaveBtn').click();
    await sleep(200);
    var call = callsOf('saveTeacherConfig')[0];
    assertTrue(!!call, 'saveTeacherConfig 호출');
    assertEq(call.payload.settings.omrTheme, 'blue');
    assertEq(call.payload.authPassword, '1234');
    assertEq(call.payload.settings.teacherPassword, '1234');
    assertEq(call.payload.questions.length, n + 1);
    assertEq(call.payload.questions[n].origQNum, null);
    assertEq(call.payload.questions[n].qType, '객관식');
    assertEq(call.payload.questions[n].rawAnswerStr, '1');
    assertEq(call.payload.questions[n].points, 20);
    assertEq(call.payload.questions[0].origQNum, 1);
    assertEq(call.payload.questions[2].qNum, 3);
    assertEq(document.getElementById('toast').textContent, '저장했어요');
    assertEq(teacherState.questions.length, n + 1);
    assertEq(document.querySelectorAll('#setupRows tr').length, n + 1);
    assertEq(document.getElementById('setupDirty').hidden, true);
  }, { scenario: 'teacher' });
  test('setup: 테마 칩이 없다', async function () {
    await freshTeacher();
    switchTab('setup');
    var p = document.getElementById('panelSetup');
    assertEq(p.querySelectorAll('[data-theme], .theme-chip, .theme-btn').length, 0);
    assertEq(p.textContent.indexOf('테마'), -1);
  }, { scenario: 'teacher' });
  test('setup: 정답 입력 중 칸 수 셀만 갱신하고 입력 포커스를 유지한다', async function () {
    await freshTeacher();
    switchTab('setup');
    var row = document.querySelector('#setupRows tr[data-idx="0"]');
    var input = row.querySelector('[data-f="answer"]');
    input.focus();
    setVal(input, '2, 4');
    assertEq(row.querySelector('.blank-count').textContent.trim(), '2칸');
    assertTrue(document.activeElement === input, '포커스 유지');
    assertTrue(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]') === input, '같은 입력 요소');
    setVal(input, '2, 4, 5');
    assertEq(row.querySelector('.blank-count').textContent.trim(), '3칸');
    assertEq(document.getElementById('setupDirty').hidden, false);
  }, { scenario: 'teacher' });
  test('setup: 유형을 바꾸면 그 행만 다시 그리고 선택 상자에 포커스가 남는다', async function () {
    await freshTeacher();
    switchTab('setup');
    var other = document.querySelector('#setupRows tr[data-idx="1"]');
    var sel = document.querySelector('#setupRows tr[data-idx="0"] [data-f="type"]');
    sel.focus();
    setVal(sel, '서술형');
    assertTrue(document.querySelector('#setupRows tr[data-idx="1"]') === other, '다른 행은 그대로');
    assertEq(document.querySelector('#setupRows tr[data-idx="0"] .blank-count').textContent.trim(), '1칸');
    assertEq(document.activeElement.getAttribute('data-f'), 'type');
    assertEq(document.activeElement.value, '서술형');
  }, { scenario: 'teacher' });
  test('setup: 저장하지 않은 편집은 다른 곳의 새로고침에도 남는다', async function () {
    await freshTeacher();
    switchTab('setup');
    setVal(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]'), '5');
    await refreshTeacherData();
    assertEq(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]').value, '5');
    assertEq(document.getElementById('setupDirty').hidden, false);
    assertTrue(document.getElementById('setupDirty').textContent.indexOf('저장하지 않은 변경이 있어요') >= 0);
    switchTab('results');
    switchTab('setup');
    assertEq(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]').value, '5');
  }, { scenario: 'teacher' });
  test('setup: 마지막 한 문항은 지울 수 없고 인라인 안내를 보인다', async function () {
    await freshTeacher();
    switchTab('setup');
    var n = teacherState.questions.length;
    for (var i = 0; i < n - 1; i++) document.querySelector('#setupRows [data-del]').click();
    assertEq(document.querySelectorAll('#setupRows tr').length, 1);
    document.querySelector('#setupRows [data-del]').click();
    assertEq(document.querySelectorAll('#setupRows tr').length, 1);
    assertTrue(document.getElementById('panelSetup').textContent.indexOf('문항은 하나 이상 있어야 해요.') >= 0);
  }, { scenario: 'teacher' });
  test('setup: 문항을 지우면 번호가 위치대로 매겨지고 저장 payload 에 origQNum 이 남는다', async function () {
    await freshTeacher();
    switchTab('setup');
    document.querySelector('#setupRows tr[data-idx="1"] [data-del]').click();
    document.getElementById('setupSaveBtn').click();
    await sleep(200);
    var qs = callsOf('saveTeacherConfig')[0].payload.questions;
    assertEq(qs.map(function (q) { return q.qNum; }), [1, 2, 3, 4, 5]);
    assertEq(qs.map(function (q) { return q.origQNum; }), [1, 3, 4, 5, 6]);
  }, { scenario: 'teacher' });
  test('setup: 비밀번호를 비워 두면 현재 비밀번호를 유지하고, 새로 적으면 반영한다', async function () {
    await freshTeacher();
    switchTab('setup');
    setVal(document.getElementById('cfgTeacherPw'), '');
    document.getElementById('setupSaveBtn').click();
    await sleep(200);
    assertEq(callsOf('saveTeacherConfig')[0].payload.settings.teacherPassword, '1234');
    switchTab('setup');
    setVal(document.getElementById('cfgTeacherPw'), '5678');
    document.getElementById('setupSaveBtn').click();
    await sleep(200);
    assertEq(callsOf('saveTeacherConfig')[1].payload.settings.teacherPassword, '5678');
    assertEq(teacherState.pw, '5678');
    assertEq(callsOf('verifyTeacherAndGetData').pop().payload, '5678');
    window.__stubReset();
  }, { scenario: 'teacher' });
  test('setup: 스위치 4개와 규칙 두 줄, 시험 제목을 비우면 기본 제목', async function () {
    await freshTeacher();
    switchTab('setup');
    var labels = Array.prototype.map.call(document.querySelectorAll('#panelSetup .ink-switch'), function (l) { return l.textContent.replace(/\s+/g, ' ').trim(); });
    assertEq(labels.length, 4);
    ['점수와 ○/ 보여주기', '틀린 문제 정답 보여주기', '띄어쓰기 무시하고 채점', '다시 내기 허용'].forEach(function (t, i) {
      assertTrue(labels[i].indexOf(t) >= 0, t + ' / ' + labels[i]);
    });
    var text = document.getElementById('panelSetup').textContent;
    assertTrue(text.indexOf('쉼표(,)로 나누면 빈칸이 늘어나요. 예: 2, 4') >= 0);
    assertTrue(text.indexOf('빗금(/)으로 묶으면 둘 다 정답이에요. 예: 훈민정음/한글') >= 0);
    setVal(document.getElementById('cfgExamTitle'), '  ');
    document.getElementById('setupSaveBtn').click();
    await sleep(200);
    assertEq(callsOf('saveTeacherConfig')[0].payload.settings.examTitle, '우리들의 답안지');
    assertEq(callsOf('saveTeacherConfig')[0].payload.settings.publishResults, false);
  }, { scenario: 'teacher' });
  test('setup: 저장 실패는 오류 토스트를 보이고 편집이 남는다', async function () {
    await freshTeacher();
    switchTab('setup');
    setVal(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]'), '4');
    window.__stubFailQueue = { saveTeacherConfig: [true] };
    document.getElementById('setupSaveBtn').click();
    await sleep(200);
    assertTrue(document.getElementById('toast').classList.contains('error'));
    assertEq(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]').value, '4');
    assertEq(document.getElementById('setupDirty').hidden, false);
    assertEq(document.getElementById('setupSaveBtn').disabled, false);
  }, { scenario: 'teacher' });
  test('setup: 배점을 비우면 저장하지 않고 그 행에 인라인 오류를 보인다', async function () {
    await freshTeacher();
    switchTab('setup');
    setVal(document.querySelector('#setupRows tr[data-idx="0"] [data-f="points"]'), '');
    document.getElementById('setupSaveBtn').click();
    await sleep(80);
    assertEq(callsOf('saveTeacherConfig').length, 0);
    assertTrue(document.querySelector('#setupRows tr[data-idx="0"] .inline-error') !== null);
  }, { scenario: 'teacher' });

  test('results/setup: 가로 스크롤이 페이지에 생기지 않는다', async function () {
    await freshTeacher();
    ['results', 'setup'].forEach(function (t) {
      switchTab(t);
      assertTrue(document.documentElement.scrollWidth <= window.innerWidth, t + ' ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth);
    });
  }, { scenario: 'teacher' });

  test('clear: 쓰던 한 말씀은 기록을 지운 뒤 새 학생에게 남지 않는다', async function () {
    await freshTeacher();
    teacherState.gradeView = 'byStudent';
    switchTab('grade');
    var sub = teacherState.submissions.filter(function (s) { return Number(s.rowIndex) === 2; })[0];
    document.querySelector('[data-pick-row="' + sub.rowIndex + '"]').click();
    setVal(document.getElementById('commentInput'), '지워질 말');
    switchTab('results');
    document.getElementById('clearRecordsBtn').click();
    document.getElementById('clearConfirmBtn').click();
    await sleep(200);
    assertEq(teacherState.submissions.length, 0);
    await serverCall('submitStudentAnswers', { studentNumber: '9', studentName: '새학생', answers: {} });
    await refreshTeacherData();
    teacherState.gradeView = 'byStudent';
    switchTab('grade');
    var inp = document.getElementById('commentInput');
    assertTrue(inp !== null);
    assertEq(inp.value, '');
    assertEq(commentDrafts[teacherState.selectedRowIndex], undefined);
  }, { scenario: 'teacher' });
  test('clear/setup: 채점 저장이 진행 중이면 서버에 보내지 않고 안내한다', async function () {
    await freshTeacher();
    window.__stubDelay = 120;
    switchTab('grade');
    document.querySelector('.mark-cell[data-mark="O"]').click();
    assertTrue(gradeInflight > 0, '저장 진행 중');
    switchTab('setup');
    setVal(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]'), '4');
    document.getElementById('setupSaveBtn').click();
    await sleep(10);
    assertEq(callsOf('saveTeacherConfig').length, 0);
    assertEq(document.getElementById('setupError').textContent, '채점 저장이 끝난 뒤에 다시 눌러주세요.');
    switchTab('results');
    document.getElementById('clearRecordsBtn').click();
    document.getElementById('clearConfirmBtn').click();
    assertEq(callsOf('clearSubmissionRecords').length, 0);
    assertTrue(document.getElementById('clearArea').textContent.indexOf('채점 저장이 끝난 뒤에 다시 눌러주세요.') >= 0);
    await sleep(400);
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });

  // ===== 최종 검토 수정 =====
  function toastOff() { var t = document.getElementById('toast'); t.classList.remove('show', 'error'); t.textContent = ''; }
  test('final: 상단 줄 새로고침 단추로 새 제출이 보인다(성공 토스트 없음)', async function () {
    await freshTeacher();
    window.__stubDelay = 0;
    var btn = document.querySelector('.t-top #refreshBtn');
    assertTrue(!!btn, '#refreshBtn 이 .t-top 안에 있어야 함');
    assertTrue(btn.classList.contains('btn-quiet'), 'btn-quiet');
    assertEq(btn.textContent.trim(), '새로고침');
    var n = teacherState.submissions.length;
    await serverCall('submitStudentAnswers', { studentNumber: '9', studentName: '새학생', answers: {} });
    assertEq(teacherState.submissions.length, n, '누르기 전에는 그대로');
    toastOff();
    btn.click();
    await sleep(60);
    assertEq(teacherState.submissions.length, n + 1);
    assertTrue(tById('tCounts').textContent.indexOf('제출 ' + (n + 1) + '명') >= 0, tById('tCounts').textContent);
    assertTrue(textsOf('#panelGrade .grade-table tbody td.who').indexOf('9 새학생') >= 0, '채점 표에 새 학생');
    assertEq(tById('toast').classList.contains('show'), false, '성공 토스트 없음');
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });
  test('final: 새로고침이 실패하면 오류 토스트', async function () {
    await freshTeacher();
    toastOff();
    window.__stubReject.verifyTeacherAndGetData = true;
    tById('refreshBtn').click();
    await sleep(60);
    window.__stubReject.verifyTeacherAndGetData = false;
    assertEq(tById('toast').classList.contains('error'), true);
    assertEq(tById('toast').textContent, '새로고침하지 못했어요. 연결을 확인해 주세요.');
  }, { scenario: 'teacher' });
  test('final: 탭을 누르면 새로고침해서 새 제출이 보인다', async function () {
    await freshTeacher();
    window.__stubDelay = 0;
    var n = teacherState.submissions.length;
    await serverCall('submitStudentAnswers', { studentNumber: '8', studentName: '탭학생', answers: {} });
    var c0 = callsOf('verifyTeacherAndGetData').length;
    tById('tabResults').click();
    await sleep(60);
    assertEq(callsOf('verifyTeacherAndGetData').length, c0 + 1);
    assertEq(teacherState.submissions.length, n + 1);
    assertTrue(tById('panelResults').textContent.indexOf('탭학생') >= 0, '명렬표에 새 학생');
    tById('tabGrade').click();
    await sleep(60);
    assertTrue(textsOf('#panelGrade .grade-table tbody td.who').indexOf('8 탭학생') >= 0);
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });
  test('final: 부분점수 칸은 글자 입력이고 abc 는 인라인 오류', async function () {
    await freshTeacher();
    window.__stubDelay = 0;
    var cell = document.querySelector('#panelGrade .grade-cell');
    var input = cell.querySelector('.score-input');
    assertEq(input.getAttribute('type'), 'text');
    assertEq(input.getAttribute('inputmode'), 'decimal');
    var n = callsOf('updateStudentQuestionGrade').length;
    input.focus();
    input.value = 'abc';
    enterOn(input);
    await sleep(20);
    var err = cell.querySelector('.score-error');
    assertEq(err.hidden, false);
    assertTrue(/^0에서 \d+(\.\d+)?점 사이 숫자를 써주세요$/.test(err.textContent), err.textContent);
    assertEq(callsOf('updateStudentQuestionGrade').length, n);
    input.value = '';
    input.blur();
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });
  test('final: 결과 공개 저장 중에는 설정 저장을 막고, 설정 저장 중에는 공개 스위치를 막는다', async function () {
    await freshTeacher();
    window.__stubDelay = 120;
    switchTab('setup');
    setVal(document.querySelector('#setupRows tr[data-idx="0"] [data-f="answer"]'), '4');
    tById('publishSwitch').click();
    assertTrue(publishing, '공개 저장 중');
    document.getElementById('setupSaveBtn').click();
    await sleep(10);
    assertEq(callsOf('saveTeacherConfig').length, 0);
    assertEq(document.getElementById('setupError').hidden, false);
    assertEq(document.getElementById('setupError').textContent, '결과 공개 저장이 끝난 뒤에 다시 눌러주세요.');
    await sleep(250);
    assertEq(publishing, false);
    // 반대 방향: 설정 저장 중 공개 스위치
    document.getElementById('setupSaveBtn').click();
    await sleep(10);
    assertEq(callsOf('saveTeacherConfig').length, 1);
    var p0 = callsOf('setPublishResultsStatus').length;
    var before = tById('publishSwitch').checked;
    tById('publishSwitch').click();
    await sleep(10);
    assertEq(callsOf('setPublishResultsStatus').length, p0, '설정 저장 중에는 공개를 보내지 않는다');
    assertEq(tById('publishSwitch').checked, before, '스위치 되돌림');
    await sleep(400);
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });
  test('final: 설정을 저장하고 학생 화면으로 가면 쓰는 중인 답안지를 다시 불러온다', async function () {
    await freshTeacher();
    window.__stubDelay = 0;
    // 저장 없이 나가면 다시 부르지 않는다
    var g0 = callsOf('getStudentInitData').length;
    tById('toStudentBtn').click();
    await sleep(40);
    assertEq(callsOf('getStudentInitData').length, g0);
    await teacherLogin();
    switchTab('setup');
    document.getElementById('addQuestionBtn').click();
    document.getElementById('setupSaveBtn').click();
    await sleep(80);
    assertEq(callsOf('saveTeacherConfig').length, 1);
    assertEq(studentPhase, 'writing');
    tById('toStudentBtn').click();
    await sleep(80);
    assertEq(callsOf('getStudentInitData').length, g0 + 1);
    assertEq(document.querySelectorAll('#answerTable tbody tr').length, 7);
    // 한 번 다시 불렀으면 다음 나가기에서는 부르지 않는다
    await teacherLogin();
    tById('toStudentBtn').click();
    await sleep(40);
    assertEq(callsOf('getStudentInitData').length, g0 + 1);
    window.__stubReset();
    await loadStudentScreen();
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });
  test('final: 선생님 화면 글자는 13px 이상', async function () {
    await freshTeacher();
    window.__stubDelay = 0;
    var small = [];
    function scan(root) {
      Array.prototype.forEach.call(root.querySelectorAll('*'), function (el) {
        if (el.closest('.visually-hidden')) return;
        var own = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
        if (!own || !el.getClientRects().length) return;
        var fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 13) small.push((el.className || el.tagName) + ':' + fs);
      });
    }
    document.querySelector('#qPicker button[data-qnum="1"]').click();
    scan(tById('teacherView'));
    teacherState.gradeView = 'byStudent';
    renderGradePanel();
    scan(tById('teacherView'));
    ['results', 'setup'].forEach(function (t) { switchTab(t); scan(tById('teacherView')); });
    var keys = {};
    small = small.filter(function (s) { if (keys[s]) return false; keys[s] = 1; return true; });
    assertEq(small, []);
    assertTrue(parseFloat(getComputedStyle(document.querySelector('.pw-label')).fontSize) >= 13, '.pw-label');
    window.__stubDelay = undefined;
  }, { scenario: 'teacher' });
  function readsOf(row) {
    return Array.prototype.map.call(document.querySelectorAll('#studentAfter tr[data-row="' + row + '"] .answer-read'), function (e) { return e.textContent; });
  }
  test('final: 저장한 답은 서버 답과 같을 때만 칸별로 쓰고, 다르면 서버 답을 쓴다', async function () {
    savedSubmission = { studentNumber: '1', studentName: '김하늘', examTitle: studentExamTitle, submittedAt: Date.now(),
      answers: { 1: ['1'], 2: ['4', '2'], 5: ['세종, 대왕', '장영실'], 6: ['  서술 답  '] } };
    function det(qNum, qType, ua, max) { return { qNum: qNum, qType: qType, userAnswer: ua, status: 'O', earnedPoints: max, maxPoints: max, correctAnswer: null }; }
    renderResult({
      published: true, studentNumber: '1', studentName: '김하늘', showScore: true, showCorrectAnswers: false,
      totalScore: 0, maxScore: 30, isPerfectScore: false, teacherComment: '',
      details: [det(1, '객관식', '4', 5), det(2, '객관식', '4, 2', 10), det(5, '단답식', '세종, 대왕, 장영실', 10), det(6, '서술형', '서술 답', 10)]
    });
    assertEq(pressedOf(1), ['4'], '1번: 저장한 답(1)과 서버 답(4)이 다르면 서버 답');
    assertEq(pressedOf(2), ['4', '2'], '2번: 같으면 저장한 칸 순서');
    assertEq(readsOf(5), ['세종, 대왕', '장영실'], '5번: 같으면 칸 안의 쉼표도 그대로');
    assertEq(readsOf(6), ['서술 답'], '6번 서술형');
    // 빈칸 자리: 저장한 ['', '장영실'] 과 서버 ', 장영실' 은 같다
    savedSubmission.answers = { 5: ['', '장영실'], 2: ['', ''] };
    renderResult({
      published: true, studentNumber: '1', studentName: '김하늘', showScore: true, showCorrectAnswers: false,
      totalScore: 0, maxScore: 20, isPerfectScore: false, teacherComment: '',
      details: [det(2, '객관식', '(미입력)', 10), det(5, '단답식', ', 장영실', 10)]
    });
    assertEq(pressedOf(2), [], '2번 모두 빈칸');
    assertEq(readsOf(5), ['', '장영실'], '빈칸 자리 유지');
    // 다르면 서버 문자열을 나눈다
    savedSubmission.answers = { 5: ['세종', '장영실'] };
    renderResult({
      published: true, studentNumber: '1', studentName: '김하늘', showScore: true, showCorrectAnswers: false,
      totalScore: 0, maxScore: 10, isPerfectScore: false, teacherComment: '',
      details: [det(5, '단답식', '훈민정음, 한글', 10)]
    });
    assertEq(readsOf(5), ['훈민정음', '한글'], '다르면 서버 문자열을 나눈다');
    savedSubmission = null;
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
    try { if (window.parent !== window) window.parent.postMessage({ __selftest: result }, '*'); } catch (e) {}
    var pre = document.createElement('pre');
    pre.id = 'selftest-result';
    pre.textContent = JSON.stringify(result);
    document.body.appendChild(pre);
  }
  // 앱 첫 로딩(스텁 비동기 응답)이 끝난 뒤 실행
  window.addEventListener('load', function () { setTimeout(runAll, 100); });
})();
