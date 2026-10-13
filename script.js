'use strict';

const CONFIG = {
  highscoreKey: 'vaultHeistHighscore',
  // scoring
  basePoints: 100,
  tryBonus: 20,
  timeBonus: 5,
  radarCost: 25,
  tickMs: 1000,
  nextLevelDelayMs: 2200,
  lowTimeWarning: 10,
  vaultNames: ['Rookie', 'Safecracker', 'Master Thief', 'Ghost'],
  minNumber: 1,
  firstMaxNumber: 10,
  rangeGrowth: 2, 
  extraTries: 3, 
  baseTime: 30,
  timePerLevel: 10,
  driftEvery: [0, 0, 5, 4],
  driftMinStep: 1,
  driftMaxStep: 3,
  hotColdTiers: [
    [0.05, '🔥 Burning hot!'],
    [0.15, '♨️ Hot'],
    [0.3, '🌤️ Warm'],
    [0.5, '❄️ Cold'],
  ],
  freezingLabel: '🧊 Freezing!',
};

function generateLevels() {
  const levels = [];
  const total = CONFIG.vaultNames.length;

  for (let i = 0; i < total; i++) {
    const max = CONFIG.firstMaxNumber * CONFIG.rangeGrowth ** i;
    const rangeSize = max - CONFIG.minNumber + 1;

    levels.push({
      name: `${CONFIG.vaultNames[i]} Vault`,
      min: CONFIG.minNumber,
      max,
      tries: Math.ceil(Math.log2(rangeSize)) + CONFIG.extraTries,
      time: CONFIG.baseTime + CONFIG.timePerLevel * i,
      driftEvery: CONFIG.driftEvery[i],
      showDirection: i < total - 1, 
    });
  }
  return levels;
}

const LEVELS = generateLevels();

// Cached Selectors
const bodyEl = document.body;
const screenEls = {
  menu: document.querySelector('#screen-menu'),
  how: document.querySelector('#screen-how'),
  game: document.querySelector('#screen-game'),
  results: document.querySelector('#screen-results'),
};
const messageEl = document.querySelector('.message');
const scoreEl = document.querySelector('.score');
const numberEl = document.querySelector('.number');
const highscoreEl = document.querySelector('.highscore');
const menuHighscoreEl = document.querySelector('.menu-highscore');
const guessInputEl = document.querySelector('.guess');
const checkBtnEl = document.querySelector('.check');
const radarBtnEl = document.querySelector('.radar');
const againBtnEl = document.querySelector('.again');
const levelNameEl = document.querySelector('.level-name');
const triesEl = document.querySelector('.tries');
const timerEl = document.querySelector('.timer');
const timerFillEl = document.querySelector('.timer-fill');
const rangeTextEl = document.querySelector('.range-text');
const historyEl = document.querySelector('.history');
const resultsTitleEl = document.querySelector('.results-title');
const resultsSummaryEl = document.querySelector('.results-summary');
const resultsBodyEl = document.querySelector('.results-body');
const resultsTotalEl = document.querySelector('.results-total');

// Game state
const state = {
  levelIndex: 0,
  secretNumber: 0,
  tries: 0,
  timeLeft: 0,
  timerId: null,
  wrongCount: 0,
  guesses: [],
  radarUsed: false,
  levelActive: false,
  score: 0,
  highscore: 0,
  stats: [],
};

// Storage helpers (wrapped so the game still works if storage is blocked)
function loadHighscore() {
  try {
    return Number(localStorage.getItem(CONFIG.highscoreKey)) || 0;
  } catch (err) {
    return 0;
  }
}

function saveHighscore(value) {
  try {
    localStorage.setItem(CONFIG.highscoreKey, value);
  } catch (err) {
    console.log('Could not save highscore');
  }
}

// UI Helpers
function showScreen(name) {
  Object.keys(screenEls).forEach(key => {
    screenEls[key].classList.toggle('hidden', key !== name);
  });
  setBackground('');
}

function setMessage(text) {
  messageEl.textContent = text;
}

function setNumber(value) {
  numberEl.textContent = value;
}

function setScore(value) {
  scoreEl.textContent = value;
}

function setHighscore(value) {
  highscoreEl.textContent = value;
  menuHighscoreEl.textContent = value;
}

function setBackground(color) {
  bodyEl.style.backgroundColor = color;
}

function disablePlay(disabled) {
  guessInputEl.disabled = disabled;
  checkBtnEl.disabled = disabled;
  radarBtnEl.disabled = disabled || state.radarUsed;
}

function clearInput() {
  guessInputEl.value = '';
}

function shakeNumber() {
  numberEl.classList.remove('shake');
  void numberEl.offsetWidth; // restart the CSS animation
  numberEl.classList.add('shake');
}

function renderTimer() {
  const level = LEVELS[state.levelIndex];
  timerEl.textContent = state.timeLeft;
  timerFillEl.style.width = `${(state.timeLeft / level.time) * 100}%`;
  timerFillEl.classList.toggle('low', state.timeLeft <= CONFIG.lowTimeWarning);
}

function renderGuesses() {
  historyEl.textContent = state.guesses.length ? state.guesses.join(', ') : '-';
}

function renderStats() {
  const level = LEVELS[state.levelIndex];
  levelNameEl.textContent = `Lv ${state.levelIndex + 1}: ${level.name}`;
  rangeTextEl.textContent = `${level.min} and ${level.max}`;
  triesEl.textContent = state.tries;
  setScore(state.score);
  renderTimer();
  renderGuesses();
}

// Game logic helpers
function randomInRange(min, max) {
  return Math.trunc(Math.random() * (max - min + 1)) + min;
}

function randomDirection() {
  return Math.random() < 0.5 ? -1 : 1;
}

function getHotCold(guess) {
  const level = LEVELS[state.levelIndex];
  const diff = Math.abs(guess - state.secretNumber);
  const ratio = diff / (level.max - level.min);

  const tier = CONFIG.hotColdTiers.find(([maxRatio]) => ratio <= maxRatio);
  return tier ? tier[1] : CONFIG.freezingLabel;
}

function driftSecret() {
  const level = LEVELS[state.levelIndex];
  const step =
    randomInRange(CONFIG.driftMinStep, CONFIG.driftMaxStep) * randomDirection();
  let next = state.secretNumber + step;
  if (next < level.min || next > level.max) next = state.secretNumber - step;
  state.secretNumber = Math.min(Math.max(next, level.min), level.max);
  console.log('The secret drifted to: ', state.secretNumber);
  shakeNumber();
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

function startTimer() {
  stopTimer();
  state.timerId = setInterval(function () {
    state.timeLeft--;
    renderTimer();
    if (state.timeLeft <= 0) endLevel(false, "⏰ Time's up!");
  }, CONFIG.tickMs);
}

// Level flow
function startLevel() {
  const level = LEVELS[state.levelIndex];
  state.secretNumber = randomInRange(level.min, level.max);
  console.log('Your secret number is: ', state.secretNumber);
  state.tries = level.tries;
  state.timeLeft = level.time;
  state.wrongCount = 0;
  state.guesses = [];
  state.radarUsed = false;
  state.levelActive = true;

  setNumber('?');
  setBackground('');
  setMessage('Start guessing...');
  clearInput();
  disablePlay(false);
  renderStats();
  startTimer();
  guessInputEl.focus();
}

function startGame() {
  clearTimeout(state.nextId);
  state.levelIndex = 0;
  state.score = 0;
  state.stats = [];
  showScreen('game');
  startLevel();
}

function endLevel(won, reason) {
  if (!state.levelActive) return;
  state.levelActive = false;
  stopTimer();
  disablePlay(true);
  clearInput();
  setNumber(state.secretNumber);

  const level = LEVELS[state.levelIndex];
  let points = 0;

  if (won) {
    points =
      CONFIG.basePoints +
      state.tries * CONFIG.tryBonus +
      state.timeLeft * CONFIG.timeBonus;
    if (state.radarUsed) points -= CONFIG.radarCost;
    state.score += points;
    setScore(state.score);
    setBackground('green');
    setMessage(`✅ Vault cracked! +${points}`);
  } else {
    setBackground('red');
    setMessage(reason);
  }

  state.stats.push({ name: level.name, won, points });

  if (state.score > state.highscore) {
    state.highscore = state.score;
    setHighscore(state.highscore);
    saveHighscore(state.highscore);
  }

  const isLastLevel = state.levelIndex === LEVELS.length - 1;
  state.nextId = setTimeout(function () {
    if (!won) return showResults(false);
    if (isLastLevel) return showResults(true);
    state.levelIndex++;
    startLevel();
  }, CONFIG.nextLevelDelayMs);
}

function showResults(victory) {
  resultsTitleEl.textContent = victory ? '🏆 Heist Complete!' : '😭 Game Over';
  const cleared = state.stats.filter(s => s.won).length;
  resultsSummaryEl.textContent = victory
    ? 'You cracked every vault!'
    : `You cracked ${cleared} of ${LEVELS.length} vaults.`;

  resultsBodyEl.innerHTML = '';
  state.stats.forEach(stat => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${stat.name}</td><td>${stat.won ? '✅' : '❌'}</td><td>${stat.points}</td>`;
    resultsBodyEl.appendChild(row);
  });

  resultsTotalEl.textContent = state.score;
  showScreen('results');
  setBackground(victory ? 'green' : '');
}

function leaveGame() {
  stopTimer();
  clearTimeout(state.nextId);
  state.levelActive = false;
  showScreen('menu');
}


function handleGuess() {
  if (!state.levelActive) return;

  const level = LEVELS[state.levelIndex];
  const guess = Number(guessInputEl.value);

  console.log('Check button clicked!');
  console.log('Players guessed: ', guess);

  // input validation
  if (!guess || !Number.isInteger(guess)) return setMessage('No number!');
  if (guess < level.min || guess > level.max)
    return setMessage(`Number must be between ${level.min} and ${level.max}!`);
  if (state.guesses.includes(guess)) {
    clearInput();
    return setMessage('Already tried that one!');
  }

  state.guesses.push(guess);
  clearInput();

  if (guess === state.secretNumber) {
    renderGuesses();
    return endLevel(true);
  }

  // wrong guess
  state.tries--;
  state.wrongCount++;
  triesEl.textContent = state.tries;
  renderGuesses();

  const hotCold = getHotCold(guess);
  const direction = guess > state.secretNumber ? '😲 Too high!' : '😐 Too low!';
  setMessage(level.showDirection ? `${direction} ${hotCold}` : hotCold);

  if (state.tries < 1) return endLevel(false, '😭 Out of tries!');

  // twist: the code moves
  if (level.driftEvery && state.wrongCount % level.driftEvery === 0) {
    driftSecret();
    // old guesses no longer count, so the player may try them again
    state.guesses = [];
    renderGuesses();
    setMessage(`🌀 The code shifted! ${hotCold}`);
  }
}

function useRadar() {
  if (!state.levelActive || state.radarUsed) return;
  state.radarUsed = true;
  radarBtnEl.disabled = true;
  const parity = state.secretNumber % 2 === 0 ? 'EVEN' : 'ODD';
  setMessage(`📡 Code is ${parity} (-${CONFIG.radarCost} pts)`);
}

// Event listeners
document.querySelector('#btn-start').addEventListener('click', startGame);
document
  .querySelector('#btn-how')
  .addEventListener('click', () => showScreen('how'));
document
  .querySelector('#btn-back')
  .addEventListener('click', () => showScreen('menu'));
document.querySelector('#btn-again').addEventListener('click', startGame);
document
  .querySelector('#btn-menu')
  .addEventListener('click', () => showScreen('menu'));
checkBtnEl.addEventListener('click', handleGuess);
radarBtnEl.addEventListener('click', useRadar);
againBtnEl.addEventListener('click', leaveGame);

window.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !checkBtnEl.disabled) {
    checkBtnEl.click();
  }
});

// Init
state.highscore = loadHighscore();
setHighscore(state.highscore);
showScreen('menu');