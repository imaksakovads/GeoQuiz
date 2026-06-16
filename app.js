"use strict";

lucide.createIcons();

const savedTheme = localStorage.getItem('geoquiz_theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('geoquiz_theme', newTheme); } catch(e) {}
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const iconEl = document.getElementById('theme-icon');
    iconEl.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun');
    lucide.createIcons();
}

function getStorageList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; } }
function saveStorageList(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); } catch(e) {} }

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioCtx = AudioContextClass ? new AudioContextClass() : null;
let soundEnabled = true;

function playSound(type) {
    try {
        if (!soundEnabled || !audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(), gainNode = audioCtx.createGain();
        osc.connect(gainNode); gainNode.connect(audioCtx.destination);

        if (type === 'correct') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.08);
            gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
            osc.start(); osc.stop(audioCtx.currentTime + 0.25);
        } else if (type === 'wrong') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(200, audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.25);
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
        } else if (type === 'finish') {
            gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
                const o = audioCtx.createOscillator(), g = audioCtx.createGain();
                o.connect(g); g.connect(audioCtx.destination); o.frequency.value = f;
                g.gain.setValueAtTime(0.15, audioCtx.currentTime + i*0.08); g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i*0.08 + 0.2);
                o.start(audioCtx.currentTime + i*0.08); o.stop(audioCtx.currentTime + i*0.08 + 0.2);
            });
        }
    } catch(e) {}
}

function toggleSound() { soundEnabled = !soundEnabled; document.getElementById('sound-icon').setAttribute('data-lucide', soundEnabled ? 'volume-2' : 'volume-x'); lucide.createIcons(); }

const contColors = { all: '#f0f4f8', mistakes: '#fff1f2', guessed_only: '#f0fdf4', europe: '#e0f2fe', asia: '#fef2f2', americas: '#f0fdf4', africa: '#fffbeb', oceania: '#f5f3ff' };

function updateBgColor() {
    const cont = document.getElementById('filter-continent').value;
    document.body.style.background = contColors[cont] || contColors.all;
    if (cont === 'guessed_only' && gameMode !== 'sprint' && gameMode !== 'survival') {
        selectMode('capitals', document.querySelectorAll(".mode-btn")[1]);
    }
}

// --- СОСТОЯНИЕ ИГРЫ ---
let gameMode = 'flags';
let currentQuestionIdx = 0, score = 0, currentStreak = 0, maxStreak = 0;
let gameQuestions = [], totalQuestionsCount = 30;
let timerDuration = 15, timerInterval = null, timeLeft = 15;
let sprintTimerInterval = null, sprintTimeLeft = 60, SPRINT_MAX_TIME = 60;
let gameStartTime = null;

// ⚡ НОВОЕ: Жизни для режима Выживание
let lives = 3; 

document.addEventListener("DOMContentLoaded", () => { updateLocalStoresUI(); updateBgColor(); });

function updateLocalStoresUI() {
    document.getElementById('guessed-count').innerText = getStorageList('guessedCountries').length;
    document.getElementById('mistakes-count').innerText = getStorageList('wrongCountries').length;
}

function resetHistory(key) { localStorage.removeItem(key); updateLocalStoresUI(); }

function selectMode(mode, btn) { 
    gameMode = mode; 
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected')); 
    btn.classList.add('selected'); 
}

function switchScreen(screenId, direction = 'forward') { 
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active', 'forward', 'backward'); });
    document.getElementById(screenId).classList.add('active', direction); 
}

function shuffleArray(array) { let arr = [...array]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

function generateFilteredPool() {
    const cont = document.getElementById('filter-continent').value;
    const diff = document.getElementById('filter-difficulty').value;
    const hComm = document.getElementById('hide-common').checked;
    const hGuess = document.getElementById('hide-guessed').checked;

    const guessedList = getStorageList('guessedCountries');
    const mistakesList = getStorageList('wrongCountries');

    return countriesDataset.filter(c => {
        if (cont === 'mistakes') { if (!mistakesList.includes(c.code)) return false; } 
        else if (cont === 'guessed_only') { if (!guessedList.includes(c.code)) return false; } 
        else { if (cont !== 'all' && c.continent !== cont) return false; }
        
        if (diff !== 'all' && c.difficulty !== diff) return false;
        if (hComm && c.isCommon) return false;
        if (cont !== 'guessed_only' && hGuess && guessedList.includes(c.code)) return false;
        return true;
    });
}

function preloadFlags(questionsPool) {
    if (gameMode === 'capitals') return; 
    questionsPool.forEach(q => { const img = new Image(); img.src = `https://flagcdn.com/w320/${q.code}.png`; });
}

function startGame() {
    const err = document.getElementById('error-message'); err.style.display = 'none';
    let pool = generateFilteredPool();

    clearInterval(timerInterval); clearInterval(sprintTimerInterval);

    if (pool.length < 4) {
        err.innerText = `Мало стран (${pool.length}). Смягчите фильтры.`;
        err.style.display = 'block'; return;
    }

    currentQuestionIdx = 0; score = 0; currentStreak = 0; maxStreak = 0; gameStartTime = Date.now();
    
    // Скрываем/показываем блок жизней
    const livesContainer = document.getElementById('lives-container');
    
    if (gameMode === 'sprint') {
        livesContainer.style.display = 'none';
        sprintTimeLeft = SPRINT_MAX_TIME;
        totalQuestionsCount = pool.length; 
        document.getElementById('result-total').innerText = "∞";
        const line = document.getElementById('timer-line');
        line.style.width = '100%'; line.style.transition = 'width 0.1s linear';
        
        sprintTimerInterval = setInterval(() => {
            sprintTimeLeft -= 0.1;
            line.style.width = `${(sprintTimeLeft / SPRINT_MAX_TIME) * 100}%`;
            document.getElementById('progress-txt').innerHTML = `<i data-lucide="clock" style="width:14px; margin-bottom:-2px;"></i> <span style="color:var(--danger)">${Math.ceil(sprintTimeLeft)}с</span>`;
            lucide.createIcons();
            if (sprintTimeLeft <= 0) { clearInterval(sprintTimerInterval); finishGame(); }
        }, 100);

    } else if (gameMode === 'survival') {
        // ⚡ ЛОГИКА ВЫЖИВАНИЯ
        lives = 3;
        livesContainer.style.display = 'block';
        livesContainer.innerHTML = '<span id="life-1" class="heart-icon">❤️</span><span id="life-2" class="heart-icon">❤️</span><span id="life-3" class="heart-icon">❤️</span>';
        totalQuestionsCount = pool.length; // Бесконечно (пока не кончится база)
        document.getElementById('result-total').innerText = "∞";
        document.getElementById('progress-txt').innerHTML = `<span style="color:var(--danger)">Хардкор</span>`;
        
    } else {
        livesContainer.style.display = 'none';
        totalQuestionsCount = Math.min(pool.length, 30);
        document.getElementById('result-total').innerText = totalQuestionsCount;
    }

    gameQuestions = shuffleArray(pool).slice(0, totalQuestionsCount);
    preloadFlags(gameQuestions);
    switchScreen('game-screen', 'forward'); 
    loadQuestion();
}

function loadQuestion() {
    clearInterval(timerInterval);
    document.getElementById('hint-box').style.display = 'none';
    
    if (currentQuestionIdx >= gameQuestions.length) { finishGame(); return; }

    const q = gameQuestions[currentQuestionIdx];
    let progressPercent = ((currentQuestionIdx + 1) / totalQuestionsCount) * 100;
    
    if (gameMode !== 'sprint' && gameMode !== 'survival') {
        document.getElementById('progress-txt').innerText = `Вопрос ${currentQuestionIdx + 1} из ${totalQuestionsCount}`;
        document.getElementById('game-progress').style.width = `${progressPercent}%`;
        const globe = document.getElementById('progress-globe'); if (globe) globe.style.left = `${progressPercent}%`;
    } else {
        document.getElementById('game-progress').style.width = '100%'; 
        const globe = document.getElementById('progress-globe'); if (globe) globe.style.left = '100%'; 
    }

    document.getElementById('streak-num').innerText = currentStreak;
    
    const flagImg = document.getElementById('question-flag'), flagSkeleton = document.getElementById('flag-skeleton'), txt = document.getElementById('question-text'), grid = document.getElementById('options-grid'), mascot = document.getElementById('mascot');
    grid.innerHTML = '';

    if (flagImg) flagImg.classList.remove('flag-pride', 'flag-sorrow');
    if (mascot) mascot.innerText = '🦉';
    
    // В Выживании и Спринте по умолчанию флаги (но если пользователь выбрал столицы, то они работают)
    let correctText = (gameMode === 'capitals') ? q.capital : q.name;

    if (gameMode !== 'capitals') {
        document.getElementById('flag-container').style.display = 'block';
        flagImg.classList.remove('loaded'); flagSkeleton.style.display = 'block';
        flagImg.onload = () => { flagSkeleton.style.display = 'none'; flagImg.classList.add('loaded'); };
        flagImg.src = `https://flagcdn.com/w320/${q.code}.png`;
        txt.innerText = "Флаг какой страны перед вами?";
    } else {
        document.getElementById('flag-container').style.display = 'none';
        txt.innerText = `Назовите столицу: ${q.name}`;
    }

    let wrPool = countriesDataset.filter(c => c.name !== q.name);
    let options = shuffleArray(wrPool).slice(0, 3).map(c => gameMode === 'capitals' ? c.capital : c.name);
    options.push(correctText); options = shuffleArray(options);

    options.forEach(opt => {
        const btn = document.createElement('button'); btn.className = 'option-btn'; btn.innerText = opt;
        btn.onclick = () => handleAnswer(opt, btn, correctText, q); grid.appendChild(btn);
    });

    startTimer(correctText, q);
}

function startTimer(corr, q) {
    if (gameMode === 'sprint') return; 

    timeLeft = timerDuration; const line = document.getElementById('timer-line'); 
    line.style.transition = 'width 0.3s ease'; line.style.width = '100%';
    
    timerInterval = setInterval(() => {
        timeLeft -= 0.1; line.style.width = `${(timeLeft / timerDuration) * 100}%`;
        if (timeLeft <= 0) { clearInterval(timerInterval); handleAnswer(null, null, corr, q); }
    }, 100);
}

function handleAnswer(sel, btn, corr, q) {
    if (gameMode !== 'sprint') clearInterval(timerInterval);
    document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
    
    const qB = document.getElementById('question-box'), flagImg = document.getElementById('question-flag'), mascot = document.getElementById('mascot');
    const isMistakesMode = (document.getElementById('filter-continent').value === 'mistakes');
    let delay = 1400; 

    if (sel === corr) {
        if (btn) btn.classList.add('correct'); playSound('correct');
        if (navigator.vibrate) navigator.vibrate(40);
        if (flagImg) { flagImg.classList.remove('flag-sorrow'); flagImg.classList.add('flag-pride'); }
        if (mascot) { mascot.innerText = '🥳'; mascot.classList.remove('mascot-bounce'); void mascot.offsetWidth; mascot.classList.add('mascot-bounce'); }

        score++; currentStreak++; if (currentStreak > maxStreak) maxStreak = currentStreak;
        
        let g = getStorageList('guessedCountries');
        if (!g.includes(q.code)) { g.push(q.code); saveStorageList('guessedCountries', g); }
        if (isMistakesMode) { let m = getStorageList('wrongCountries').filter(item => item !== q.code); saveStorageList('wrongCountries', m); }
        
        document.getElementById('streak-num').innerText = currentStreak;
        const streakBadge = document.getElementById('streak-badge-container');
        streakBadge.classList.remove('streak-bounce'); void streakBadge.offsetWidth; streakBadge.classList.add('streak-bounce');

        if (currentStreak === 3 || currentStreak === 5 || currentStreak === 10) {
            if(typeof confetti === 'function') {
                confetti({ particleCount: 80, spread: 100, origin: { y: 0.5 }, shapes: ['star'], colors: ['#FBBF24', '#F59E0B', '#D97706'], zIndex: 10000 });
            }
            if (mascot) mascot.innerText = '🔥';
        }

        updateLocalStoresUI();
        if (gameMode === 'sprint' || gameMode === 'survival') delay = 400; // В Выживании при правильном тоже быстро идем дальше

        setTimeout(() => {
            if (gameMode === 'sprint' && sprintTimeLeft <= 0) return;
            currentQuestionIdx++;
            if (currentQuestionIdx < totalQuestionsCount) loadQuestion(); else finishGame();
        }, delay);

    } else {
        if (btn) btn.classList.add('wrong'); playSound('wrong'); qB.classList.add('shake'); currentStreak = 0;
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
        if (flagImg) { flagImg.classList.remove('flag-pride'); flagImg.classList.add('flag-sorrow'); }
        if (mascot) { mascot.innerText = '🤦‍♂️'; mascot.classList.remove('mascot-bounce'); void mascot.offsetWidth; mascot.classList.add('mascot-bounce'); }

        document.querySelectorAll('.option-btn').forEach(b => { if (b.innerText === corr) b.classList.add('correct'); });
        
        let m = getStorageList('wrongCountries');
        if (!m.includes(q.code)) { m.push(q.code); saveStorageList('wrongCountries', m); }

        document.getElementById('streak-num').innerText = currentStreak;
        updateLocalStoresUI();
        setTimeout(() => qB.classList.remove('shake'), 400);

        // ⚡ ЛОГИКА ПОТЕРИ ЖИЗНИ
        if (gameMode === 'survival') {
            const heart = document.getElementById('life-' + lives);
            if (heart) {
                heart.classList.add('heart-broken');
                setTimeout(() => heart.innerText = '💔', 200);
            }
            lives--;
        }

        if (gameMode === 'sprint') {
            delay = 800; 
            setTimeout(() => {
                if (sprintTimeLeft <= 0) return;
                currentQuestionIdx++;
                if (currentQuestionIdx < totalQuestionsCount) loadQuestion(); else finishGame();
            }, delay);
        } else {
            const hintBox = document.getElementById('hint-box');
            let currentHint = (gameMode === 'capitals') ? q.hintCapital : q.hintFlag;
            
            let richHTML = `
                <div class="fact-header">
                    <h3>${q.name}</h3>
                    <span class="fact-emoji">${q.emoji || '🌍'}</span>
                </div>
                <div class="fact-body">
                    <div class="fact-item"><i data-lucide="lightbulb"></i><span><b>Запоминаем:</b> ${currentHint}</span></div>
                    ${q.wowFact ? `<div class="fact-item"><i data-lucide="zap"></i><span><b>Факт:</b> ${q.wowFact}</span></div>` : ''}
                    ${q.dish ? `<div class="fact-item"><i data-lucide="utensils"></i><span><b>Еда:</b> ${q.dish}</span></div>` : ''}
                    ${q.localDont ? `<div class="fact-item"><i data-lucide="alert-triangle"></i><span><b>Не стоит:</b> ${q.localDont}</span></div>` : ''}
                </div>
                <button id="next-question-btn" class="btn-main" style="margin-top: 20px; padding: 12px; font-size: 1rem; border-radius: 12px;">Понятно, дальше ➔</button>
            `;
            
            hintBox.innerHTML = richHTML;
            lucide.createIcons();
            hintBox.style.display = 'block';

            document.getElementById('next-question-btn').onclick = () => {
                hintBox.style.display = 'none';
                
                // Проверяем смерть в Выживании
                if (gameMode === 'survival' && lives <= 0) {
                    finishGame();
                    return;
                }
                
                currentQuestionIdx++;
                if (currentQuestionIdx < totalQuestionsCount) loadQuestion(); else finishGame();
            };
        }
    }
}

function finishGame() {
    clearInterval(timerInterval); clearInterval(sprintTimerInterval);
    switchScreen('results-screen', 'forward'); 
    playSound('finish'); animateScore(score);
    
    let title = "";
    
    if (gameMode === 'sprint') {
        document.getElementById('result-total').innerText = "60с";
        if (score >= 25) title = "Кибер-Географ ⚡"; else if (score >= 15) title = "Спидранер 🏎️"; else title = "Турист на пробежке 🏃‍♂️";
        if (score >= 15) fireConfetti();
    } else if (gameMode === 'survival') {
        document.getElementById('result-total').innerText = "💀"; // Бесконечный режим закончился смертью
        if (score >= 50) title = "Легенда Выживания 👑"; else if (score >= 20) title = "Крепкий Орешек 🛡️"; else title = "Первая Кровь 🩸";
        if (score >= 20) fireConfetti();
    } else {
        document.getElementById('result-total').innerText = totalQuestionsCount;
        let ratio = score / totalQuestionsCount;
        if (ratio === 1) title = "Гео-Бог!"; else if (ratio >= 0.8) title = "Магистр Географии"; else if (ratio >= 0.5) title = "Опытный Скаут"; else title = "Начинающий Турист";
        if (ratio >= 0.8) fireConfetti();
    }
    
    document.getElementById('result-title').innerText = title;
    document.getElementById('stat-max-streak').innerText = maxStreak;
    document.getElementById('stat-time').innerText = `${Math.floor((Date.now() - gameStartTime) / 1000)}с`;
}

function fireConfetti() { if (typeof confetti === 'function') { confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'], zIndex: 10000 }); } }

function animateScore(finalScore) {
    const scoreEl = document.getElementById('result-score-animate'); let current = 0;
    if (finalScore === 0) { scoreEl.innerText = 0; return; }
    let stepTime = Math.abs(Math.floor(800 / finalScore));
    let timer = setInterval(() => { current++; scoreEl.innerText = current; if (current == finalScore) clearInterval(timer); }, stepTime);
}

function toStartScreen() { clearInterval(timerInterval); clearInterval(sprintTimerInterval); switchScreen('start-screen', 'backward'); }

// ⚡ --- ЛОГИКА АТЛАСА (ЭНЦИКЛОПЕДИИ) ---
function openAtlas() {
    switchScreen('atlas-screen', 'forward');
    renderAtlas();
}

function renderAtlas() {
    const grid = document.getElementById('atlas-grid');
    grid.innerHTML = '';
    const guessed = getStorageList('guessedCountries');
    document.getElementById('atlas-progress').innerText = `${guessed.length}/${countriesDataset.length}`;

    // Сортируем: сначала угаданные, потом заблокированные (опционально, но так удобнее)
    const sortedCountries = [...countriesDataset].sort((a, b) => {
        const aUnl = guessed.includes(a.code);
        const bUnl = guessed.includes(b.code);
        if (aUnl && !bUnl) return -1;
        if (!aUnl && bUnl) return 1;
        return a.name.localeCompare(b.name);
    });

    sortedCountries.forEach(c => {
        const isUnlocked = guessed.includes(c.code);
        const img = document.createElement('img');
        img.src = `https://flagcdn.com/w320/${c.code}.png`;
        img.className = `atlas-card ${isUnlocked ? 'unlocked' : 'locked'}`;
        img.title = isUnlocked ? c.name : 'Неизвестная страна (Угадайте в игре)';
        
        if (isUnlocked) {
            img.onclick = () => showAtlasFact(c);
        }
        grid.appendChild(img);
    });
}

function showAtlasFact(q) {
    const modal = document.getElementById('atlas-modal');
    const content = document.getElementById('atlas-modal-content');
    
    let richHTML = `
        <i data-lucide="x" class="close-modal" onclick="closeAtlasFact()"></i>
        <div class="fact-header" style="margin-top: 10px;">
            <div style="display:flex; align-items:center; gap:12px;">
                <img src="https://flagcdn.com/w80/${q.code}.png" style="width: 40px; border-radius: 4px; border: 1px solid var(--border-color); object-fit: contain;">
                <h3 style="font-size: 1.1rem;">${q.name}</h3>
            </div>
            <span class="fact-emoji">${q.emoji || '🌍'}</span>
        </div>
        <div class="fact-body">
            <div class="fact-item"><i data-lucide="map-pin"></i><span><b>Столица:</b> ${q.capital}</span></div>
            ${q.hintFlag ? `<div class="fact-item"><i data-lucide="flag"></i><span><b>Флаг:</b> ${q.hintFlag}</span></div>` : ''}
            ${q.wowFact ? `<div class="fact-item"><i data-lucide="zap"></i><span><b>Факт:</b> ${q.wowFact}</span></div>` : ''}
            ${q.dish ? `<div class="fact-item"><i data-lucide="utensils"></i><span><b>Еда:</b> ${q.dish}</span></div>` : ''}
            ${q.localDont ? `<div class="fact-item"><i data-lucide="alert-triangle"></i><span><b>Не стоит:</b> ${q.localDont}</span></div>` : ''}
        </div>
    `;
    
    content.innerHTML = richHTML;
    lucide.createIcons();
    modal.classList.add('active');
}

function closeAtlasFact() {
    document.getElementById('atlas-modal').classList.remove('active');
}