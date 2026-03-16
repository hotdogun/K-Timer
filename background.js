chrome.commands.onCommand.addListener((command) => {
  if (command === "trigger-timer") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) return;

      try {
        // 1. 영상 탐색 및 즉시 뮤트 실행
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: findAndMuteVideo
        });

        const validResult = results.find(r => r.result && r.result.found);
        const initialSeconds = validResult ? validResult.result.seconds : null;

        // 2. 타이머 입력창 띄우기
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: displayTimerPrompt,
          args: [initialSeconds]
        }, (promptResults) => {
          if (promptResults && promptResults[0].result) {
            const secondsToWait = promptResults[0].result;
            chrome.alarms.create(`closeTab_${tab.id}`, {
              delayInMinutes: secondsToWait / 60
            });
          }
        });
      } catch (e) {
        console.error("오류 발생:", e);
      }
    });
  }
});

// 타이머 종료 시 알림음 재생 후 탭 닫기
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("closeTab_")) {
    const tabId = parseInt(alarm.name.split("_")[1], 10);
    
    // 알림음 재생 스크립트 먼저 실행
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: playAlertSound
    }).then(() => {
      // 소리가 들릴 시간을 잠시 준 뒤 탭 종료 (10초 후)
      setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => {});
      }, 10000);
    }).catch(() => {
      // 페이지가 이미 닫혔거나 오류 시 바로 종료 시도
      chrome.tabs.remove(tabId).catch(() => {});
    });
  }
});

// --- [기능 1] 영상 찾기 및 음소거 함수 ---
function findAndMuteVideo() {
  let found = false;
  let seconds = 0;

  // 일반 비디오 태그 탐색 및 뮤트
  const videos = document.querySelectorAll('video');
  videos.forEach(v => {
    v.muted = true; // 자동 뮤트
    if (!isNaN(v.duration) && v.duration > 0) {
      found = true;
      seconds = Math.floor(v.duration - v.currentTime);
    }
  });

  // 분석된 학습창 전역 객체(controller) 대응
  if (window.controller) {
    try {
      if (typeof window.controller.setMute === 'function') {
        window.controller.setMute(true);
      }
      const d = window.controller.getDuration();
      const c = window.controller.getCurrentTime();
      if (d > 0) {
        found = true;
        seconds = Math.floor(d - c);
      }
    } catch(e) {}
  }

  return { found, seconds };
}

// --- [기능 2] 종료 알림음 생성 함수 (비프음) ---
function playAlertSound() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.type = 'sine'; // 부드러운 알림음
  oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 음역대
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 1);
  
  // 브라우저 알림창 병행 (소리를 못 들을 경우 대비)
  console.log("타이머가 종료되어 곧 탭이 닫힙니다.");
}

// --- 타이머 입력창 (이전과 동일) ---
function displayTimerPrompt(initialSeconds) {
  let defaultVal = "00:00";
  if (initialSeconds && initialSeconds > 0) {
    const m = Math.floor(initialSeconds / 60).toString().padStart(2, '0');
    const s = (initialSeconds % 60).toString().padStart(2, '0');
    defaultVal = `${m}:${s}`;
  }

  const userInput = window.prompt(
    `🕒 공무원 자유시간 타이머\n'분:초' (예: 10:30) 또는 '분초' (예: 1030) 형식으로 입력하세요.\n(영상이 자동으로 음소거되었습니다)`, 
    defaultVal
  );

  if (!userInput) return null;

  // 1. mm:ss 형식 체크 (기존 방식 유지 및 강화)
  if (userInput.includes(':')) {
    const parts = userInput.split(':').map(v => parseInt(v, 10));
    if (parts.length === 2 && !parts.some(isNaN)) {
      return (parts[0] * 60) + parts[1];
    }
  }

  // 2. mmss 형식 체크 (숫자만 3~4자리 입력된 경우)
  // 예: 1030 -> 10분 30초 / 520 -> 5분 20초
  const numOnly = userInput.replace(/\D/g, ''); // 숫자 외 문자 제거
  if (numOnly.length >= 3 && numOnly.length <= 4) {
    const s = parseInt(numOnly.slice(-2), 10); // 뒤의 2자리 (초)
    const m = parseInt(numOnly.slice(0, -2), 10); // 나머지 앞자리 (분)
    return (m * 60) + s;
  }
  
  // 3. 단순 숫자만 입력한 경우 (분 단위로 간주하거나 초 단위로 간주 - 여기선 분으로 처리 예시)
  const singleNum = parseInt(numOnly, 10);
  if (!isNaN(singleNum) && numOnly.length < 3) {
    return singleNum * 60; 
  }

  return null;
}