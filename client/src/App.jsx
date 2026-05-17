import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import confetti from 'canvas-confetti';

const SERVER_URL = import.meta.env.API_URL || 'http://localhost:3001';
const socket = io(SERVER_URL);

const avatars = ['😊', '😄', '🥰', '😎', '🤗', '😇', '🤩', '😸'];

function App() {
  const [view, setView] = useState('welcome');
  const [playerName, setPlayerName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(avatars[0]);
  const [roomCode, setRoomCode] = useState('');
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [board, setBoard] = useState([]);
  const [turnCards, setTurnCards] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const [showCountdown, setShowCountdown] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [specialAbilityUsed, setSpecialAbilityUsed] = useState(false);
  const [history, setHistory] = useState([]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem('memoryGameHistory');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  useEffect(() => {
    socket.on('roomCreated', ({ roomCode, player }) => {
      setCurrentRoomCode(roomCode);
      setMyPlayer(player);
      setView('lobby');
    });

    socket.on('playerJoined', ({ players }) => {
      setPlayers(players);
    });

    socket.on('opponentJoined', ({ player }) => {
    });

    socket.on('playerReady', ({ playerId, ready }) => {
      setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, ready } : p));
    });

    socket.on('gameStart', ({ board: newBoard, currentTurn: turn, specialAbility }) => {
      setBoard(newBoard);
      setCurrentTurn(turn);
      setGameState('playing');
      setView('game');
      setSpecialAbilityUsed(false);
    });

    socket.on('cardFlipped', ({ cardIndex, card }) => {
      setBoard(prev => prev.map((c, i) => i === cardIndex ? { ...c, flipped: true } : c));
      setTurnCards(prev => [...prev, cardIndex]);
    });

    socket.on('matchFound', ({ playerId, playerName, score }) => {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      setBoard(prev => prev.map(c => c.flipped && !c.matched ? { ...c, matched: true } : c));
      setTurnCards([]);
      playSound('match');
    });

    socket.on('turnContinue', ({ playerId }) => {
      setCurrentTurn(playerId);
    });

    socket.on('turnChanged', ({ playerId }) => {
      setCurrentTurn(playerId);
      setTurnCards([]);
    });

    socket.on('specialAbilityActivated', ({ playerId }) => {
      if (playerId === myPlayer?.id) {
        setSpecialAbilityUsed(true);
      }
    });

    socket.on('newMessage', ({ playerId, playerName, playerAvatar, message }) => {
      setMessages(prev => [...prev, { playerId, playerName, playerAvatar, message }]);
    });

    socket.on('gameEnd', ({ players: finalPlayers, winner }) => {
      setGameState('ended');
      setView('end');

      const newHistory = [...history, {
        date: new Date().toLocaleDateString(),
        players: finalPlayers.map(p => `${p.name}: ${p.score}`).join(' vs '),
        winner: winner.name
      }];
      setHistory(newHistory);
      localStorage.setItem('memoryGameHistory', JSON.stringify(newHistory));

      if (winner.id === myPlayer?.id) {
        confetti({
          particleCount: 200,
          spread: 100,
          origin: { y: 0.6 }
        });
      }
    });

    socket.on('gameEnded', ({ reason }) => {
      alert('El otro jugador salió del juego');
      setView('welcome');
    });

    socket.on('error', ({ message }) => {
      alert(message);
    });

    return () => {
      socket.off('roomCreated');
      socket.off('playerJoined');
      socket.off('opponentJoined');
      socket.off('playerReady');
      socket.off('gameStart');
      socket.off('cardFlipped');
      socket.off('matchFound');
      socket.off('turnContinue');
      socket.off('turnChanged');
      socket.off('specialAbilityActivated');
      socket.off('newMessage');
      socket.off('gameEnd');
      socket.off('gameEnded');
      socket.off('error');
    };
  }, [history, myPlayer?.id, playerName]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const playSound = (type) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'flip') {
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.1);
    } else if (type === 'match') {
      oscillator.frequency.setValueAtTime(523, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2);
    }

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  };

  const createRoom = () => {
    if (!playerName.trim()) {
      alert('Por favor ingresa tu nombre');
      return;
    }
    socket.emit('createRoom', { playerName, avatar: selectedAvatar });
  };

  const joinRoom = () => {
    if (!playerName.trim() || !roomCode.trim()) {
      alert('Por favor ingresa tu nombre y el código de sala');
      return;
    }
    socket.emit('joinRoom', { roomCode: roomCode.toUpperCase(), playerName, avatar: selectedAvatar });
  };

  const setReady = () => {
    socket.emit('playerReady');
  };

  const flipCard = (index) => {
    if (!gameState || currentTurn !== myPlayer?.id) return;
    if (turnCards.length >= (specialAbilityUsed ? 3 : 2)) return;
    if (board[index].flipped || board[index].matched) return;

    playSound('flip');
    socket.emit('flipCard', { cardIndex: index });
  };

  const useSpecialAbility = () => {
    if (specialAbilityUsed || currentTurn !== myPlayer?.id) return;
    socket.emit('useSpecialAbility');
  };

  const sendMessage = () => {
    if (!messageInput.trim()) return;
    socket.emit('sendMessage', { message: messageInput });
    setMessageInput('');
  };

  const renderWelcome = () => (
    <div className="container">
      <h1>Memory Game</h1>

      <div className="input-group">
        <input
          type="text"
          placeholder="Tu nombre"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />
      </div>

      <h3>Elige tu avatar</h3>
      <div className="avatar-select">
        {avatars.map((avatar) => (
          <div
            key={avatar}
            className={`avatar-option ${selectedAvatar === avatar ? 'selected' : ''}`}
            onClick={() => setSelectedAvatar(avatar)}
          >
            {avatar}
          </div>
        ))}
      </div>

      <div className="tabs">
        <button className="tab active" onClick={() => setView('welcome')}>Jugar</button>
        <button className="tab" onClick={() => setView('howToPlay')}>Cómo jugar</button>
        <button className="tab" onClick={() => setView('history')}>Historial</button>
      </div>

      <div style={{ marginTop: '30px' }}>
        <button className="btn" onClick={createRoom}>Crear Sala</button>
        <p style={{ margin: '20px 0' }}>o</p>
        <input
          type="text"
          placeholder="Código de sala"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          style={{ maxWidth: '200px', marginBottom: '10px' }}
        />
        <br />
        <button className="btn btn-secondary" onClick={joinRoom}>Unirse a Sala</button>
      </div>
    </div>
  );

  const renderLobby = () => (
    <div className="container">
      <h1>Sala de Espera</h1>

      <div className="room-code">{currentRoomCode}</div>

      <p>Comparte este código con tu oponente</p>

      <h3>Jugadores</h3>
      <div className="players-list">
        {players.map((player) => (
          <div key={player.id} className="player-card">
            <span className="player-avatar">{player.avatar}</span>
            <span>{player.name}</span>
            <span className={`ready-status ${player.ready ? 'ready' : 'waiting'}`}>
              {player.ready ? '✓ Listo' : '⏳ Esperando'}
            </span>
          </div>
        ))}
      </div>

      {players.length === 2 && !players.find(p => p.id === myPlayer?.id)?.ready && (
        <button className="btn" onClick={setReady}>Estoy Listo</button>
      )}
    </div>
  );

  const renderGame = () => {
    const myScore = players.find(p => p.id === myPlayer?.id)?.score || 0;
    const opponent = players.find(p => p.id !== myPlayer?.id);
    const opponentScore = opponent?.score || 0;
    const isMyTurn = currentTurn === myPlayer?.id;

    return (
      <div className="container">
        <div className="game-header">
          <div className="player-info">
            <span className="player-avatar">{selectedAvatar}</span>
            <span>{playerName}</span>
            <span className="score">{myScore}</span>
          </div>

          {isMyTurn && !specialAbilityUsed && (
            <div className="special-ability" onClick={useSpecialAbility}>
              🎴 Voltear 3 cartas
            </div>
          )}

          <div className="player-info">
            <span>{opponent?.name || 'Oponente'}</span>
            <span className="player-avatar">{opponent?.avatar}</span>
            <span className="score">{opponentScore}</span>
          </div>
        </div>

        <div className={`turn-indicator ${isMyTurn ? 'your-turn' : ''}`}>
          {isMyTurn ? '¡Es tu turno!' : `Turno de ${opponent?.name}`}
        </div>

        {showCountdown && (
          <div className="countdown">{countdown}</div>
        )}

        <div className="game-board">
          {board.map((card, index) => (
            <div
              key={index}
              className={`card ${card.flipped || card.matched ? 'flipped' : ''} ${card.matched ? 'matched' : ''}`}
              onClick={() => flipCard(index)}
            >
              <div className="card-inner">
                <div className="card-front">{card.image}</div>
                <div className="card-back">?</div>
              </div>
            </div>
          ))}
        </div>

        {isMyTurn && (
          <p style={{ marginTop: '20px', color: '#666' }}>
            💡 {specialAbilityUsed
              ? 'Voltea la 3ra carta (habilidad especial activa)'
              : 'Voltea dos cartas para encontrar pares'}
          </p>
        )}
      </div>
    );
  };

  const renderEnd = () => (
    <div className="game-end">
      <h1>¡Fin del Juego!</h1>

      <div className="winner">
        {gameState === 'playing' ? '¡Empate!' : ''}
      </div>

      <div className="scores">
        {players.map(player => (
          <div key={player.id} className="score-item">
            <div className="player-avatar" style={{ fontSize: '3rem' }}>{player.avatar}</div>
            <div>{player.name}</div>
            <div className="score-value">{player.score}</div>
          </div>
        ))}
      </div>

      <button className="btn" onClick={() => {
        setView('welcome');
        setGameState(null);
        setBoard([]);
        setTurnCards([]);
        setPlayers([]);
        setMessages([]);
      }}>
        Jugar de nuevo
      </button>
    </div>
  );

  const renderHowToPlay = () => (
    <div className="instructions">
      <h2>📖 Cómo Jugar</h2>
      <ul>
        <li>
          <span className="step-number">1</span>
          Crea una sala o únete con un código
        </li>
        <li>
          <span className="step-number">2</span>
          Cuando ambos estén listos, el juego comienza
        </li>
        <li>
          <span className="step-number">3</span>
          En tu turno, voltea dos cartas para encontrar pares
        </li>
        <li>
          <span className="step-number">4</span>
          Si encuentra un par, ganas un punto y sigues jugando
        </li>
        <li>
          <span className="step-number">5</span>
          Si no son par, el turno pasa al oponente
        </li>
        <li>
          <span className="step-number">6</span>
          ¡Usa la habilidad especial (una vez) para voltear 3 cartas!
        </li>
        <li>
          <span className="step-number">7</span>
          Gana quien tenga más puntos al final
        </li>
      </ul>
      <button className="btn" onClick={() => setView('welcome')} style={{ marginTop: '20px' }}>
        ¡Entendido!
      </button>
    </div>
  );

  const renderHistory = () => (
    <div className="history">
      <h2>📊 Historial de Partidas</h2>
      {history.length === 0 ? (
        <p className="history-empty">No hay partidas jugadas aún</p>
      ) : (
        history.map((item, index) => (
          <div key={index} className="history-item">
            <span>{item.players}</span>
            <span style={{ color: '#ff69b4', fontWeight: 'bold' }}>
              Ganador: {item.winner}
            </span>
          </div>
        ))
      )}
      <button className="btn" onClick={() => setView('welcome')} style={{ marginTop: '20px' }}>
        Volver
      </button>
    </div>
  );

  const renderChat = () => (
    <div className="chat-container">
      <div className="chat-header">💬 Chat</div>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`chat-message ${msg.playerId === myPlayer?.id ? 'my-message' : 'other-message'}`}
          >
            <div className="sender">{msg.playerAvatar} {msg.playerName}</div>
            <div>{msg.message}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div className="chat-input">
        <input
          type="text"
          placeholder="Escribe un mensaje..."
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button onClick={sendMessage}>➤</button>
      </div>
    </div>
  );

  return (
    <div className="app">
      {view === 'welcome' && renderWelcome()}
      {view === 'lobby' && renderLobby()}
      {(view === 'game' || view === 'end') && (
        <>
          {view === 'game' && renderGame()}
          {view === 'end' && renderEnd()}
          {view === 'game' && renderChat()}
        </>
      )}
      {view === 'howToPlay' && renderHowToPlay()}
      {view === 'history' && renderHistory()}
    </div>
  );
}

export default App;