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

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-game', (data) => {
        players[socket.id] = {
            id: socket.id,
            team: data.team,
            hp: 100,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 }
        };
        socket.broadcast.emit('player-moved', players[socket.id]);
        Object.values(players).forEach(p => {
            if (p.id !== socket.id) socket.emit('player-moved', p);
        });
    });

    // --- VOICE CHAT SIGNALING ---
    // This allows players to find each other and establish a Peer-to-Peer connection
    
    socket.on('readyForVoice', () => {
        // Notify everyone else that this player is ready to talk
        socket.broadcast.emit('playerJoinedVoice', socket.id);
    });

    socket.on('offer', (data) => {
        // Forward the WebRTC offer to the specific target player
        socket.to(data.to).emit('offer', { offer: data.offer, from: socket.id });
    });

    socket.on('answer', (data) => {
        // Forward the WebRTC answer back to the offerer
        socket.to(data.to).emit('answer', { answer: data.answer, from: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        // Help peers navigate through firewalls (NAT traversal)
        socket.to(data.to).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
    });

    // --- MOVEMENT & COMBAT ---

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            socket.broadcast.emit('player-moved', {
                id: socket.id,
                position: data.position,
                rotation: data.rotation,
                team: players[socket.id].team
            });
        }
    });

    socket.on('shoot', (data) => {
        socket.broadcast.emit('shoot', {
            shooterId: socket.id,
            origin: data.origin,
            velocity: data.velocity,
            weaponId: data.weaponId
        });
    });

    socket.on('take-damage', (data) => {
        const victim = players[data.victimId];
        if (victim && victim.hp > 0) {
            victim.hp -= data.damage;
            io.emit('hp-update', { id: victim.id, hp: victim.hp });

            if (victim.hp <= 0) {
                io.emit('player-died', { id: victim.id });
                setTimeout(() => {
                    if (players[victim.id]) {
                        victim.hp = 100;
                        const respawnPos = victim.team === 'red' ? 
                            { x: -60, y: 5, z: 0 } : { x: 60, y: 5, z: 0 };
                        victim.position = respawnPos;
                        io.emit('player-respawn', { id: victim.id, position: respawnPos });
                    }
                }, 3000);
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('player-died', { id: socket.id });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
