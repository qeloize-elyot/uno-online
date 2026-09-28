const socket = io();

let token = localStorage.getItem('uno_token');
let username = localStorage.getItem('uno_user');
let myHand = [];
let currentRoom = null;
let isMyTurn = false;
let justDrew = false;
let pendingWildCard = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('login-form').style.display = tab.dataset.tab === 'login' ? 'flex' : 'none';
    document.getElementById('register-form').style.display = tab.dataset.tab === 'register' ? 'flex' : 'none';
    document.getElementById('auth-error').textContent = '';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveAuth(data);
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = document.getElementById('reg-user').value.trim();
  const pass = document.getElementById('reg-pass').value;
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveAuth(data);
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
  }
});

// JOGAR COMO CONVIDADO
document.getElementById('btn-guest').addEventListener('click', () => {
  let name = document.getElementById('guest-name').value.trim();
  if (!name) name = 'Convidado' + Math.floor(Math.random() * 9000 + 1000);
  if (name.length < 2) {
    document.getElementById('auth-error').textContent = 'Digite um nome com pelo menos 2 letras';
    return;
  }
  token = null;
  username = name;
  localStorage.setItem('uno_user', username);
  localStorage.removeItem('uno_token');
  document.getElementById('lobby-username').textContent = username + ' (convidado)';
  document.getElementById('lobby-stats').textContent = 'Modo convidado';
  socket.emit('guest_login', username);
  showScreen('lobby-screen');
});

function saveAuth(data) {
  token = data.token;
  username = data.username;
  localStorage.setItem('uno_token', token);
  localStorage.setItem('uno_user', username);
  document.getElementById('lobby-username').textContent = username;
  document.getElementById('lobby-stats').textContent = `${data.wins || 0} vitórias • ${data.games || 0} jogos`;
  socket.emit('authenticate', token);
  showScreen('lobby-screen');
}

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('uno_token');
  localStorage.removeItem('uno_user');
  token = null;
  username = null;
  showScreen('auth-screen');
});

if (token) {
  fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(r => r.json())
    .then(data => {
      if (data.username) {
        username = data.username;
        document.getElementById('lobby-username').textContent = username;
        document.getElementById('lobby-stats').textContent = `${data.wins || 0} vitórias • ${data.games || 0} jogos`;
        socket.emit('authenticate', token);
        showScreen('lobby-screen');
      } else {
        localStorage.clear();
      }
    })
    .catch(() => localStorage.clear());
}

document.getElementById('btn-create-room').addEventListener('click', () => {
  socket.emit('create_room');
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim();
  if (code) socket.emit('join_room', code);
});

document.getElementById('join-code').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join-room').click();
});

socket.on('room_created', (room) => {
  currentRoom = room;
  updateRoomUI(room);
  showScreen('room-screen');
});

socket.on('joined_room', (room) => {
  currentRoom = room;
  updateRoomUI(room);
  showScreen('room-screen');
});

socket.on('room_update', (room) => {
  currentRoom = room;
  updateRoomUI(room);
});

function updateRoomUI(room) {
  document.getElementById('room-code').textContent = room.code;
  const list = document.getElementById('room-players-list');
  list.innerHTML = room.players.map(p => `
    <div class="player-chip ${p.id === room.host ? 'host' : ''}">
      <div class="name">${p.username}${p.isMe ? ' (você)' : ''}</div>
      <div class="role">${p.id === room.host ? 'Host' : 'Jogador'}</div>
    </div>
  `).join('');

  const startBtn = document.getElementById('btn-start-game');
  const me = room.players.find(p => p.username === username);
  if (room.status === 'waiting' && room.players.length >= 2 && me && room.host === me.id) {
    startBtn.style.display = 'inline-block';
  } else {
    startBtn.style.display = 'none';
  }
  document.getElementById('room-status').textContent = 
    room.players.length < 2 ? 'Aguardando mais jogadores...' : 'Pronto para começar!';
}

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('start_game');
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  socket.emit('leave_room');
});

socket.on('left_room', () => {
  currentRoom = null;
  showScreen('lobby-screen');
});

socket.on('game_started', ({ room, hand }) => {
  currentRoom = room;
  myHand = hand;
  justDrew = false;
  updateGameUI(room);
  showScreen('game-screen');
});

socket.on('game_update', ({ room, hand, lastPlay, message }) => {
  currentRoom = room;
  if (hand) myHand = hand;
  justDrew = false;
  updateGameUI(room);
  if (message) showMsg(message);
  if (lastPlay) {
    showMsg(`${lastPlay.username} jogou uma carta`);
  }
});

socket.on('drew_card', ({ card, hand }) => {
  myHand = hand;
  justDrew = true;
  updateGameUI(currentRoom);
  document.getElementById('btn-pass').disabled = false;
});

socket.on('player_drew', ({ username: u }) => {
  if (u !== username) showMsg(`${u} comprou uma carta`);
});

socket.on('uno_called', ({ username: u }) => {
  showMsg(`${u} gritou UNO!`);
});

socket.on('game_over', ({ winner }) => {
  document.getElementById('winner-text').textContent = 
    winner === username ? 'Você venceu! 🎉' : `${winner} venceu a partida!`;
  document.getElementById('gameover-modal').classList.add('active');
});

document.getElementById('btn-back-lobby').addEventListener('click', () => {
  document.getElementById('gameover-modal').classList.remove('active');
  socket.emit('leave_room');
  showScreen('lobby-screen');
});

function updateGameUI(room) {
  const currentP = room.players[room.currentPlayerIndex];
  document.getElementById('current-turn-name').textContent = currentP.username;
  document.getElementById('direction').textContent = room.direction === 1 ? '→' : '←';
  document.getElementById('room-code-game').textContent = room.code;

  isMyTurn = currentP.username === username;

  const oppEl = document.getElementById('opponents');
  oppEl.innerHTML = room.players.map((p, i) => `
    <div class="opp ${i === room.currentPlayerIndex ? 'active' : ''}">
      <div class="n">${p.username}${p.username === username ? ' (você)' : ''}</div>
      <div class="c">${p.cardCount} carta${p.cardCount !== 1 ? 's' : ''}</div>
    </div>
  `).join('');

  const discardEl = document.getElementById('discard-pile');
  discardEl.innerHTML = '';
  if (room.topCard) {
    discardEl.appendChild(createCardEl(room.topCard, false));
  }

  document.getElementById('deck-count').textContent = room.deckCount + ' cartas';
  const colorDot = document.getElementById('color-dot');
  colorDot.style.background = `var(--${room.currentColor})`;

  document.getElementById('my-name').textContent = username;
  document.getElementById('my-count').textContent = myHand.length + ' cartas';
  const handEl = document.getElementById('my-hand');
  handEl.innerHTML = '';

  const sorted = [...myHand].sort((a, b) => {
    const colors = ['red','blue','green','yellow','black'];
    return colors.indexOf(a.color) - colors.indexOf(b.color) || String(a.value).localeCompare(String(b.value));
  });

  sorted.forEach(card => {
    const el = createCardEl(card, true);
    const canPlay = isMyTurn && canPlayCard(card, room);
    if (canPlay) el.classList.add('playable');
    else el.classList.add('disabled');

    el.addEventListener('click', () => {
      if (!canPlay) return;
      if (card.value === 'wild' || card.value === 'wild4') {
        pendingWildCard = card;
        document.getElementById('color-modal').classList.add('active');
      } else {
        socket.emit('play_card', { cardId: card.id });
      }
    });
    handEl.appendChild(el);
  });

  document.getElementById('btn-draw').disabled = !isMyTurn;
  document.getElementById('btn-pass').disabled = !isMyTurn || !justDrew;
  if (room.drawStack > 0) {
    document.getElementById('btn-draw').textContent = `Comprar ${room.drawStack}`;
  } else {
    document.getElementById('btn-draw').textContent = 'Comprar';
  }

  const unoBtn = document.getElementById('btn-uno');
  if (myHand.length === 1) {
    unoBtn.disabled = false;
    unoBtn.classList.add('active');
  } else {
    unoBtn.disabled = true;
    unoBtn.classList.remove('active');
  }
}

function canPlayCard(card, room) {
  if (room.drawStack > 0) {
    return card.value === 'draw2' || card.value === 'wild4';
  }
  if (card.color === 'black') return true;
  if (card.color === room.currentColor) return true;
  if (room.topCard && card.value === room.topCard.value) return true;
  return false;
}

function createCardEl(card, interactive) {
  const el = document.createElement('div');
  el.className = `card ${card.color} ${card.value}`;
  const display = { skip: '⊘', reverse: '↺', draw2: '+2', wild: 'W', wild4: '+4' }[card.value] || card.value;
  const sm = ['skip','reverse','draw2','wild','wild4'].includes(card.value) ? 'sm' : '';
  el.innerHTML = `
    <div class="card-inner">
      <span class="card-corner tl">${display}</span>
      <span class="card-value ${sm}">${display}</span>
      <span class="card-corner br">${display}</span>
    </div>
  `;
  return el;
}

function showMsg(text) {
  const el = document.getElementById('game-msg');
  el.textContent = text;
  setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
}

document.getElementById('btn-draw').addEventListener('click', () => {
  if (isMyTurn) socket.emit('draw_card');
});

document.getElementById('btn-pass').addEventListener('click', () => {
  if (isMyTurn && justDrew) {
    socket.emit('pass_turn');
    justDrew = false;
  }
});

document.getElementById('btn-uno').addEventListener('click', () => {
  socket.emit('call_uno');
  document.getElementById('btn-uno').classList.remove('active');
});

document.getElementById('draw-pile').addEventListener('click', () => {
  if (isMyTurn) socket.emit('draw_card');
});

document.querySelectorAll('.c-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pendingWildCard) {
      socket.emit('play_card', { cardId: pendingWildCard.id, chosenColor: btn.dataset.c });
      pendingWildCard = null;
      document.getElementById('color-modal').classList.remove('active');
    }
  });
});

socket.on('error_msg', ({ msg }) => {
  if (document.getElementById('lobby-screen').classList.contains('active')) {
    document.getElementById('lobby-error').textContent = msg;
  } else if (document.getElementById('game-screen').classList.contains('active')) {
    showMsg(msg);
  } else {
    document.getElementById('auth-error').textContent = msg;
  }
});

socket.on('auth_error', () => {
  localStorage.clear();
  showScreen('auth-screen');
});
