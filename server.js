const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'uno-secret-key-change-in-production-2026';
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let users = loadUsers();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token necessário' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
  if (username.length < 3) return res.status(400).json({ error: 'Usuário deve ter pelo menos 3 caracteres' });
  if (password.length < 4) return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres' });
  if (users[username.toLowerCase()]) return res.status(400).json({ error: 'Usuário já existe' });

  const hash = await bcrypt.hash(password, 10);
  users[username.toLowerCase()] = {
    username,
    password: hash,
    createdAt: new Date().toISOString(),
    wins: 0,
    games: 0
  };
  saveUsers(users);

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, wins: 0, games: 0 });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users[username?.toLowerCase()];
  if (!user) return res.status(400).json({ error: 'Usuário ou senha incorretos' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Usuário ou senha incorretos' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username, wins: user.wins || 0, games: user.games || 0 });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = users[req.user.username.toLowerCase()];
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ username: user.username, wins: user.wins || 0, games: user.games || 0 });
});

const COLORS = ['red', 'blue', 'green', 'yellow'];

class Card {
  constructor(color, value) {
    this.color = color;
    this.value = value;
    this.id = uuidv4().slice(0, 8);
  }
  isWild() { return this.value === 'wild' || this.value === 'wild4'; }
  canPlayOn(top, currentColor) {
    if (this.isWild()) return true;
    if (this.color === currentColor) return true;
    if (this.value === top.value) return true;
    return false;
  }
}

function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(new Card(color, '0'));
    for (let i = 0; i < 2; i++) {
      for (const v of ['1','2','3','4','5','6','7','8','9','skip','reverse','draw2']) {
        deck.push(new Card(color, v));
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(new Card('black', 'wild'));
    deck.push(new Card('black', 'wild4'));
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rooms = new Map();

function createRoom(hostSocketId, hostUsername) {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 7).toUpperCase();
  } while (rooms.has(code));

  const room = {
    code,
    host: hostSocketId,
    players: [{
      id: hostSocketId,
      username: hostUsername,
      hand: [],
      calledUno: false,
      connected: true
    }],
    status: 'waiting',
    deck: [],
    discard: [],
    currentPlayerIndex: 0,
    direction: 1,
    currentColor: null,
    drawStack: 0,
    settings: { stacking: true },
    maxPlayers: 8,
    createdAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function getPublicRoomState(room, forSocketId = null) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => ({
      id: p.id,
      username: p.username,
      cardCount: p.hand.length,
      calledUno: p.calledUno,
      connected: p.connected,
      isMe: p.id === forSocketId
    })),
    currentPlayerIndex: room.currentPlayerIndex,
    direction: room.direction,
    currentColor: room.currentColor,
    drawStack: room.drawStack,
    topCard: room.discard.length ? room.discard[room.discard.length - 1] : null,
    deckCount: room.deck.length,
    maxPlayers: room.maxPlayers,
    host: room.host
  };
}

function startGame(room) {
  room.deck = createDeck();
  room.discard = [];
  room.direction = 1;
  room.drawStack = 0;
  room.currentPlayerIndex = 0;
  room.status = 'playing';

  for (const player of room.players) {
    player.hand = [];
    player.calledUno = false;
    for (let i = 0; i < 7; i++) {
      player.hand.push(room.deck.pop());
    }
  }

  let first;
  do {
    first = room.deck.pop();
  } while (first.isWild() || ['skip','reverse','draw2'].includes(first.value));
  room.discard.push(first);
  room.currentColor = first.color;
}

function nextPlayer(room, skip = false) {
  let idx = room.currentPlayerIndex + room.direction;
  if (idx < 0) idx = room.players.length - 1;
  if (idx >= room.players.length) idx = 0;
  room.currentPlayerIndex = idx;
  if (skip) {
    idx = room.currentPlayerIndex + room.direction;
    if (idx < 0) idx = room.players.length - 1;
    if (idx >= room.players.length) idx = 0;
    room.currentPlayerIndex = idx;
  }
}

function drawFromDeck(room) {
  if (room.deck.length === 0) {
    if (room.discard.length <= 1) {
      room.deck = createDeck();
    } else {
      const top = room.discard.pop();
      room.deck = shuffle(room.discard);
      room.discard = [top];
    }
  }
  return room.deck.pop();
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('authenticate', (token) => {
    try {
      const data = jwt.verify(token, JWT_SECRET);
      currentUser = data.username;
      socket.emit('authenticated', { username: currentUser });
    } catch {
      socket.emit('auth_error', { error: 'Token inválido' });
    }
  });

  // Login como convidado (sem conta)
  socket.on('guest_login', (name) => {
    if (!name || name.trim().length < 2) {
      return socket.emit('error_msg', { msg: 'Nome inválido' });
    }
    currentUser = name.trim().slice(0, 15);
    socket.emit('authenticated', { username: currentUser, guest: true });
  });

  socket.on('create_room', () => {
    if (!currentUser) return socket.emit('error_msg', { msg: 'Digite um nome ou faça login primeiro' });
    if (currentRoom) return socket.emit('error_msg', { msg: 'Você já está em uma sala' });

    const room = createRoom(socket.id, currentUser);
    currentRoom = room.code;
    socket.join(room.code);
    socket.emit('room_created', getPublicRoomState(room, socket.id));
  });

  socket.on('join_room', (code) => {
    if (!currentUser) return socket.emit('error_msg', { msg: 'Digite um nome ou faça login primeiro' });
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('error_msg', { msg: 'Sala não encontrada' });
    if (room.status !== 'waiting') return socket.emit('error_msg', { msg: 'Jogo já começou' });
    if (room.players.length >= room.maxPlayers) return socket.emit('error_msg', { msg: 'Sala cheia' });
    if (room.players.some(p => p.username === currentUser)) {
      return socket.emit('error_msg', { msg: 'Você já está nessa sala' });
    }

    room.players.push({
      id: socket.id,
      username: currentUser,
      hand: [],
      calledUno: false,
      connected: true
    });
    currentRoom = code;
    socket.join(code);

    io.to(code).emit('room_update', getPublicRoomState(room));
    socket.emit('joined_room', getPublicRoomState(room, socket.id));
  });

  socket.on('start_game', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error_msg', { msg: 'Só o host pode começar' });
    if (room.players.length < 2) return socket.emit('error_msg', { msg: 'Mínimo 2 jogadores' });

    startGame(room);

    for (const p of room.players) {
      io.to(p.id).emit('game_started', {
        room: getPublicRoomState(room, p.id),
        hand: p.hand
      });
    }
  });

  socket.on('play_card', ({ cardId, chosenColor }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) {
      return socket.emit('error_msg', { msg: 'Não é sua vez' });
    }

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return socket.emit('error_msg', { msg: 'Carta inválida' });

    const card = player.hand[cardIndex];
    const top = room.discard[room.discard.length - 1];

    if (room.drawStack > 0) {
      if (!room.settings.stacking) return socket.emit('error_msg', { msg: 'Você deve comprar as cartas' });
      if (card.value !== 'draw2' && card.value !== 'wild4') {
        return socket.emit('error_msg', { msg: 'Só pode jogar +2 ou +4' });
      }
    } else if (!card.canPlayOn(top, room.currentColor)) {
      return socket.emit('error_msg', { msg: 'Carta não pode ser jogada' });
    }

    player.hand.splice(cardIndex, 1);
    room.discard.push(card);

    if (player.hand.length === 0) {
      room.status = 'finished';
      const user = users[player.username.toLowerCase()];
      if (user) {
        user.wins = (user.wins || 0) + 1;
        user.games = (user.games || 0) + 1;
        saveUsers(users);
      }
      room.players.forEach(p => {
        if (p.username !== player.username) {
          const u = users[p.username.toLowerCase()];
          if (u) { u.games = (u.games || 0) + 1; }
        }
      });
      saveUsers(users);

      io.to(room.code).emit('game_over', {
        winner: player.username,
        room: getPublicRoomState(room)
      });
      return;
    }

    if (card.value === 'skip') {
      nextPlayer(room, true);
    } else if (card.value === 'reverse') {
      room.direction *= -1;
      if (room.players.length === 2) nextPlayer(room, true);
      else nextPlayer(room);
    } else if (card.value === 'draw2') {
      room.drawStack += 2;
      room.currentColor = card.color;
      nextPlayer(room);
    } else if (card.value === 'wild' || card.value === 'wild4') {
      if (!chosenColor || !COLORS.includes(chosenColor)) {
        chosenColor = COLORS[Math.floor(Math.random() * 4)];
      }
      room.currentColor = chosenColor;
      if (card.value === 'wild4') room.drawStack += 4;
      nextPlayer(room);
    } else {
      room.currentColor = card.color;
      nextPlayer(room);
    }

    for (const p of room.players) {
      io.to(p.id).emit('game_update', {
        room: getPublicRoomState(room, p.id),
        hand: p.hand,
        lastPlay: { username: player.username, card, chosenColor }
      });
    }
  });

  socket.on('draw_card', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) {
      return socket.emit('error_msg', { msg: 'Não é sua vez' });
    }

    if (room.drawStack > 0) {
      for (let i = 0; i < room.drawStack; i++) {
        player.hand.push(drawFromDeck(room));
      }
      const amount = room.drawStack;
      room.drawStack = 0;
      nextPlayer(room);
      for (const p of room.players) {
        io.to(p.id).emit('game_update', {
          room: getPublicRoomState(room, p.id),
          hand: p.hand,
          message: `${player.username} comprou ${amount} cartas`
        });
      }
      return;
    }

    const card = drawFromDeck(room);
    player.hand.push(card);
    socket.emit('drew_card', { card, hand: player.hand });
    io.to(room.code).emit('player_drew', { username: player.username });
  });

  socket.on('pass_turn', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'playing') return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;

    nextPlayer(room);
    for (const p of room.players) {
      io.to(p.id).emit('game_update', {
        room: getPublicRoomState(room, p.id),
        hand: p.hand
      });
    }
  });

  socket.on('call_uno', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player && player.hand.length === 1) {
      player.calledUno = true;
      io.to(room.code).emit('uno_called', { username: player.username });
    }
  });

  socket.on('leave_room', () => {
    leaveCurrentRoom();
  });

  function leaveCurrentRoom() {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) { currentRoom = null; return; }

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      room.players.splice(idx, 1);
    }

    if (room.players.length === 0) {
      rooms.delete(currentRoom);
    } else {
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      if (room.status === 'playing' && room.currentPlayerIndex >= room.players.length) {
        room.currentPlayerIndex = 0;
      }
      io.to(currentRoom).emit('room_update', getPublicRoomState(room));
    }
    socket.leave(currentRoom);
    currentRoom = null;
    socket.emit('left_room');
  }

  socket.on('disconnect', () => {
    leaveCurrentRoom();
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.length === 0 || (room.status === 'waiting' && now - room.createdAt > 3600000)) {
      rooms.delete(code);
    }
  }
}, 60000);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`UNO Online rodando na porta ${PORT}`);
});
