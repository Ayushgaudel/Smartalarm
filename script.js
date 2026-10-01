// ================== CONFIG (tweak these to customize behavior) ==================
const MOTION_THRESHOLD = 25;       // pixel-change amount that counts as "movement" — raise if too sensitive
const STILLNESS_RESUME_MS = 3000;  // ms of no movement before the alarm sound resumes
const SAMPLE_WIDTH = 160;          // internal canvas size used for motion checking (small = fast)
const SAMPLE_HEIGHT = 120;

// ================== Element references ==================
const clockScreen = document.getElementById('clockScreen');
const mathScreen = document.getElementById('mathScreen');
const exerciseScreen = document.getElementById('exerciseScreen');

const clockEl = document.getElementById('clock');
const dateLine = document.getElementById('dateLine');
const secondsBar = document.getElementById('secondsBar');

const alarmTimeInput = document.getElementById('alarmTime');
const pushupsInput = document.getElementById('pushupsRequired');
const customSoundInput = document.getElementById('customSound');
const setAlarmBtn = document.getElementById('setAlarmBtn');
const cancelAlarmBtn = document.getElementById('cancelAlarmBtn');
const alarmStatus = document.getElementById('alarmStatus');

const mathQuestionEl = document.getElementById('mathQuestion');
const mathAnswerInput = document.getElementById('mathAnswer');
const submitMathBtn = document.getElementById('submitMathBtn');
const mathFeedback = document.getElementById('mathFeedback');

const exerciseStatus = document.getElementById('exerciseStatus');
const webcamVideo = document.getElementById('webcam');
const motionCanvas = document.getElementById('motionCanvas');
const motionCtx = motionCanvas.getContext('2d');
const progressBar = document.getElementById('progressBar');

const userAlarmAudio = document.getElementById('userAlarmAudio');

// ================== State ==================
let alarmTime = null;
let alarmTriggered = false;
let correctAnswer = 0;
let hasCustomSound = false;

let audioCtx = null;
let beepInterval = null;

let webcamStream = null;
let previousFrameData = null;
let motionState = 'resting';
let lastMotionTime = Date.now();
let currentPushups = 0;
let requiredPushups = 10;

// ================== Clock ==================
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${hh}:${mm}:${ss}`;

  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  dateLine.textContent = now.toLocaleDateString(undefined, options);
  secondsBar.style.width = (now.getSeconds() / 60 * 100) + '%';

  if (alarmTime && !alarmTriggered) {
    if (`${hh}:${mm}` === alarmTime) triggerAlarm();
  }
}
setInterval(updateClock, 1000);
updateClock();

// ================== Alarm setup ==================
customSoundInput.addEventListener('change', () => {
  const file = customSoundInput.files[0];
  if (file) {
    userAlarmAudio.src = URL.createObjectURL(file);
    hasCustomSound = true;
  }
});

setAlarmBtn.addEventListener('click', () => {
  initAudio();
  if (!alarmTimeInput.value) return;
  alarmTime = alarmTimeInput.value;
  alarmTriggered = false;
  alarmStatus.textContent = `Alarm set for ${alarmTime} — ${pushupsInput.value} pushups to stop it`;
});

cancelAlarmBtn.addEventListener('click', () => {
  alarmTime = null;
  alarmTriggered = false;
  alarmStatus.textContent = 'No alarm set';
});

// ================== Alarm sound (generated beep, or user file) ==================
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playBeep() {
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.2;
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.3);
}

function startAlarmSound() {
  if (hasCustomSound) {
    userAlarmAudio.currentTime = 0;
    userAlarmAudio.play();
  } else if (!beepInterval) {
    playBeep();
    beepInterval = setInterval(playBeep, 600);
  }
}

function stopAlarmSound() {
  if (hasCustomSound) {
    userAlarmAudio.pause();
    userAlarmAudio.currentTime = 0;
  }
  if (beepInterval) {
    clearInterval(beepInterval);
    beepInterval = null;
  }
}

// ================== Triggering the alarm ==================
function triggerAlarm() {
  alarmTriggered = true;
  requiredPushups = parseInt(pushupsInput.value) || 10;

  // Lock settings so they can't be changed mid-alarm
  pushupsInput.disabled = true;
  alarmTimeInput.disabled = true;

  startAlarmSound();
  showScreen(mathScreen);
  generateMathQuestion();
}

function showScreen(screenToShow) {
  [clockScreen, mathScreen, exerciseScreen].forEach(s => s.classList.add('hidden'));
  screenToShow.classList.remove('hidden');
}

// ================== Gate 1: Math problem ==================
function generateMathQuestion() {
  const operators = ['+', '-', '×'];
  const op = operators[Math.floor(Math.random() * operators.length)];
  let a, b;

  if (op === '+') {
    a = Math.floor(Math.random() * 40) + 1;
    b = Math.floor(Math.random() * 40) + 1;
    correctAnswer = a + b;
  } else if (op === '-') {
    a = Math.floor(Math.random() * 40) + 10;
    b = Math.floor(Math.random() * a); // keeps result positive
    correctAnswer = a - b;
  } else {
    a = Math.floor(Math.random() * 12) + 1;
    b = Math.floor(Math.random() * 12) + 1;
    correctAnswer = a * b;
  }

  mathQuestionEl.textContent = `${a} ${op} ${b} = ?`;
  mathAnswerInput.value = '';
  mathFeedback.textContent = '';
}

submitMathBtn.addEventListener('click', () => {
  const userAnswer = Number(mathAnswerInput.value);
  if (userAnswer === correctAnswer) {
    mathFeedback.textContent = '';
    startExercisePhase();
  } else {
    mathFeedback.textContent = 'Wrong! Try again.';
    generateMathQuestion();
  }
});

// ================== Gate 2: Pushups via webcam motion ==================
async function startExercisePhase() {
  showScreen(exerciseScreen);
  currentPushups = 0;
  motionState = 'resting';
  lastMotionTime = Date.now();
  updateProgressBar();
  exerciseStatus.textContent = `Do ${requiredPushups} pushups to stop the alarm`;

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamVideo.srcObject = webcamStream;
    motionCanvas.width = SAMPLE_WIDTH;
    motionCanvas.height = SAMPLE_HEIGHT;
    previousFrameData = null;
    requestAnimationFrame(analyzeMotion);
  } catch (err) {
    exerciseStatus.textContent = 'Camera access denied — allow camera access to continue.';
  }
}

function analyzeMotion() {
  if (exerciseScreen.classList.contains('hidden')) return; // stop loop once we've left this screen

  motionCtx.drawImage(webcamVideo, 0, 0, motionCanvas.width, motionCanvas.height);
  const currentFrame = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);

  if (previousFrameData) {
    const diff = getFrameDifference(previousFrameData, currentFrame);
    handleMotionSignal(diff);
  }

  previousFrameData = currentFrame;
  requestAnimationFrame(analyzeMotion);
}

function getFrameDifference(prev, curr) {
  let totalDiff = 0;
  const len = prev.data.length;
  for (let i = 0; i < len; i += 16) { // sample every 4th pixel for speed
    totalDiff += Math.abs(prev.data[i] - curr.data[i]);
  }
  return totalDiff / (len / 16);
}

function handleMotionSignal(diff) {
  const now = Date.now();

  if (diff > MOTION_THRESHOLD) {
    lastMotionTime = now;
    if (motionState === 'resting') motionState = 'moving';
    stopAlarmSound();
    exerciseStatus.textContent = `Keep going! ${currentPushups}/${requiredPushups}`;
  } else {
    if (motionState === 'moving') {
      motionState = 'resting';
      currentPushups++;
      updateProgressBar();
      if (currentPushups >= requiredPushups) {
        completeExercise();
        return;
      }
    }
    if (now - lastMotionTime > STILLNESS_RESUME_MS) {
      startAlarmSound();
      exerciseStatus.textContent = `Stopped moving! ${currentPushups}/${requiredPushups} — keep going`;
    }
  }
}

function updateProgressBar() {
  const percent = Math.min((currentPushups / requiredPushups) * 100, 100);
  progressBar.style.width = percent + '%';
}

function completeExercise() {
  stopAlarmSound();
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  alarmTriggered = false;
  alarmTime = null;
  pushupsInput.disabled = false;
  alarmTimeInput.disabled = false;
  alarmStatus.textContent = 'Alarm stopped. Great job! 💪';
  showScreen(clockScreen);
}




