import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();
const waitingPlayer = null;

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

const cardImages = [
  '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🥝', '🍑',
  '⌚', '📱', '💻', '🎮', '📷', '🎧', '🔑', '💡'
];

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('createRoom', ({ playerName, avatar }) => {
    const roomCode = generateRoomCode();
    const player = { id: socket.id, name: playerName, avatar, ready: false, score: 0 };

    rooms.set(roomCode, {
      players: [player],
      board: [],
      currentTurn: null,
      gameStarted: false,
      turnCards: [],
      specialAbilityUsed: { [player.id]: false }
    });

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerId = player.id;

    socket.emit('roomCreated', { roomCode, player });
  });

  socket.on('joinRoom', ({ roomCode, playerName, avatar }) => {
    const room = rooms.get(roomCode.toUpperCase());

    if (!room) {
      socket.emit('error', { message: 'La sala no existe' });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('error', { message: 'La sala está llena' });
      return;
    }

    const player = { id: socket.id, name: playerName, avatar, ready: false, score: 0 };
    room.players.push(player);

    socket.join(roomCode.toUpperCase());
    socket.roomCode = roomCode.toUpperCase();
    socket.playerId = player.id;

    io.to(roomCode.toUpperCase()).emit('playerJoined', { players: room.players });
    io.to(room.players[0].id).emit('opponentJoined', { player });
  });

  socket.on('playerReady', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = true;
      io.to(socket.roomCode).emit('playerReady', { playerId: socket.id, ready: true });

      const allReady = room.players.every(p => p.ready);
      if (allReady && room.players.length === 2 && !room.gameStarted) {
        startGame(room, socket.roomCode);
      }
    }
  });

  socket.on('flipCard', ({ cardIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.gameStarted) return;

    const currentPlayer = room.players.find(p => p.id === socket.id);
    if (!currentPlayer || room.currentTurn !== socket.id) return;

    if (room.turnCards.length >= (currentPlayer.specialAbilityUsed ? 3 : 2)) return;

    const card = room.board[cardIndex];
    if (card.flipped || card.matched) return;

    card.flipped = true;
    room.turnCards.push(cardIndex);

    io.to(socket.roomCode).emit('cardFlipped', { cardIndex, card });

    if (room.turnCards.length === 2 || (currentPlayer.specialAbilityUsed && room.turnCards.length === 3)) {
      const flippedCards = room.turnCards.map(i => room.board[i]);

      const hasMatch = flippedCards.every(c => c.image === flippedCards[0].image && c.image !== flippedCards[0].image);

      if (hasMatch && !currentPlayer.specialAbilityUsed) {
        currentPlayer.score += 1;
        flippedCards.forEach(c => {
          const boardCard = room.board.find(bc => bc.id === c.id);
          if (boardCard) boardCard.matched = true;
        });

        io.to(socket.roomCode).emit('matchFound', {
          playerId: socket.id,
          playerName: currentPlayer.name,
          score: currentPlayer.score
        });

        room.turnCards = [];

        const allMatched = room.board.every(c => c.matched);
        if (allMatched) {
          endGame(room, socket.roomCode);
        } else {
          io.to(socket.roomCode).emit('turnContinue', { playerId: socket.id });
        }
      } else {
        currentPlayer.specialAbilityUsed = true;

        setTimeout(() => {
          room.turnCards.forEach(i => {
            if (!room.board[i].matched) {
              room.board[i].flipped = false;
            }
          });
          room.turnCards = [];
          room.currentTurn = room.players.find(p => p.id !== socket.id)?.id;
          io.to(socket.roomCode).emit('turnChanged', { playerId: room.currentTurn });
        }, 1000);
      }
    }
  });

  socket.on('useSpecialAbility', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.gameStarted || room.currentTurn !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player && !player.specialAbilityUsed) {
      player.specialAbilityUsed = true;
      io.to(socket.roomCode).emit('specialAbilityActivated', { playerId: socket.id });
    }
  });

  socket.on('sendMessage', ({ message }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(socket.roomCode).emit('newMessage', {
        playerId: socket.id,
        playerName: player.name,
        playerAvatar: player.avatar,
        message
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    const roomCode = socket.roomCode;
    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomCode).emit('playerLeft', { playerId: socket.id });

        if (room.players.length < 2) {
          io.to(roomCode).emit('gameEnded', { reason: 'opponentLeft' });
          rooms.delete(roomCode);
        }
      }
    }
  });
});

function startGame(room, roomCode) {
  room.gameStarted = true;
  const shuffledImages = shuffleArray(cardImages.slice(0, 8));
  room.board = shuffledImages.map((image, index) => ({
    id: index,
    image,
    flipped: false,
    matched: false
  }));

  room.board = shuffleArray(room.board);

  room.currentTurn = room.players[Math.floor(Math.random() * room.players.length)].id;

  io.to(roomCode).emit('gameStart', {
    board: room.board,
    currentTurn: room.currentTurn,
    specialAbility: { available: true, activated: false }
  });
}

function endGame(room, roomCode) {
  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score
  }));

  players.sort((a, b) => b.score - a.score);
  const winner = players[0];

  io.to(roomCode).emit('gameEnd', { players, winner });

  setTimeout(() => {
    if (rooms.has(roomCode)) {
      rooms.delete(roomCode);
    }
  }, 60000);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});