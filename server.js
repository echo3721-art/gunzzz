const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
const voiceRooms = {}; // Track voice chat rooms by team

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-game', (data) => {
        players[socket.id] = {
            id: socket.id,
            team: data.team,
            name: data.name || "Player",
            hp: 100,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 }
        };
        socket.broadcast.emit('player-moved', players[socket.id]);
        Object.values(players).forEach(p => {
            if (p.id !== socket.id) socket.emit('player-moved', p);
        });
        
        // Join global voice chat room for everyone
        const voiceRoom = 'voice-global';
        socket.join(voiceRoom);
        
        // Notify all players in voice room
        socket.to(voiceRoom).emit('voice-player-joined', {
            playerId: socket.id,
            playerName: data.name || "Player",
            team: data.team
        });
        
        console.log(`${socket.id} joined team ${data.team} and global voice room ${voiceRoom}`);
    });

    // --- VOICE CHAT SIGNALING ---
    // This allows players to find each other and establish a Peer-to-Peer connection
    
    socket.on('voice-chat-ready', (data) => {
        console.log(`Player ${data.playerId} is ready for voice chat`);
        
        // Notify all existing players about the new voice-enabled player
        Object.keys(players).forEach(playerId => {
            if (playerId !== data.playerId && players[playerId]) {
                socket.to(playerId).emit('voice-player-joined', {
                    playerId: data.playerId,
                    playerName: players[data.playerId]?.name || "Unknown",
                    team: players[data.playerId]?.team || "unknown"
                });
            }
        });
    });
    
    socket.on('voice-offer', (data) => {
        console.log(`Voice offer from ${socket.id} to ${data.targetId}`);
        socket.to(data.targetId).emit('voice-offer', {
            offer: data.offer,
            from: socket.id,
            fromName: players[socket.id]?.name || "Unknown"
        });
    });

    socket.on('voice-answer', (data) => {
        console.log(`Voice answer from ${socket.id} to ${data.targetId}`);
        socket.to(data.targetId).emit('voice-answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('voice-ice-candidate', (data) => {
        console.log(`ICE candidate from ${socket.id} to ${data.targetId}`);
        socket.to(data.targetId).emit('voice-ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('voice-chat-toggle', (data) => {
        const player = players[socket.id];
        if (player) {
            const voiceRoom = 'voice-global';
            
            // Notify all players about voice chat status
            socket.to(voiceRoom).emit('voice-chat-status', {
                playerId: socket.id,
                playerName: player.name,
                isSpeaking: data.isSpeaking,
                isMuted: data.isMuted
            });
            
            console.log(`${player.name} voice status: speaking=${data.isSpeaking}, muted=${data.isMuted}`);
        }
    });

    socket.on('voice-data', (data) => {
        // Relay voice data to all players in the global voice room
        const player = players[socket.id];
        if (player) {
            const voiceRoom = 'voice-global';
            socket.to(voiceRoom).emit('voice-data', {
                audioData: data.audioData,
                from: socket.id,
                fromName: player.name
            });
        }
    });

    // --- GAME EVENTS ---
    
    socket.on('move', (data) => {
        if(players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            socket.broadcast.emit('player-moved', players[socket.id]);
        }
    });

    socket.on('shoot', (data) => {
        socket.broadcast.emit('shoot', { ...data, shooterId: socket.id });
    });

    socket.on('take-damage', (data) => {
        if(players[data.victimId]) {
            players[data.victimId].hp -= data.damage;
            io.emit('hp-update', { id: data.victimId, hp: players[data.victimId].hp });
            
            if(players[data.victimId].hp <= 0) {
                players[data.victimId].hp = 0;
                io.emit('player-died', { 
                    id: data.victimId, 
                    killerTeam: players[socket.id]?.team,
                    killerId: socket.id
                });
                
                // Send kill notification
                const victimName = players[data.victimId].name;
                const killerName = players[socket.id]?.name || "Unknown";
                io.emit('player-killed', {
                    killerId: socket.id,
                    victimId: data.victimId,
                    victimName: victimName,
                    killerName: killerName
                });
            }
        }
    });

    socket.on('respawn', (data) => {
        if(players[socket.id]) {
            players[socket.id].hp = 100;
            players[socket.id].position = data.position;
            io.emit('player-respawn', { id: socket.id, position: data.position });
        }
    });

    socket.on('update-name', (data) => {
        if(players[socket.id]) {
            players[socket.id].name = data.name;
            console.log(`Player ${socket.id} updated name to: ${data.name}`);
        }
    });

    socket.on('chat-message', (data) => {
        // Broadcast chat message to all players
        io.emit('chat-message', {
            message: `${data.sender}: ${data.message}`,
            sender: data.sender,
            timestamp: new Date().toISOString()
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Notify global voice chat room about disconnection
        if (players[socket.id]) {
            const voiceRoom = 'voice-global';
            socket.to(voiceRoom).emit('voice-player-left', {
                playerId: socket.id,
                playerName: players[socket.id].name
            });
        }
        
        delete players[socket.id];
        socket.broadcast.emit('player-disconnected', { id: socket.id });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
