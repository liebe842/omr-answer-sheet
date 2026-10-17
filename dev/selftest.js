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
  if (demoMode) {
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
  test('perfect: 이 기기에 저장한 답이 있으면 그 답을 칸별로 쓴다', async function () {
    savedSubmission = { studentNumber: '1', studentName: '김하늘', examTitle: studentExamTitle, submittedAt: Date.now(), answers: { 1: ['1'], 2: ['3', '5'], 5: ['세종', '장영실'] } };
    var res = await serverCall('checkStudentResultStatus', { studentNumber: '1', studentName: '김하늘' });
    renderResult(res);
    assertEq(pressedOf(1), ['1']);
    assertEq(pressedOf(2), ['3', '5']);
    var reads = Array.prototype.map.call(document.querySelectorAll('#studentAfter tr[data-row="5"] .answer-read'), function (e) { return e.textContent; });
    assertEq(reads, ['세종', '장영실']);
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
