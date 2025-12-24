const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};

io.on('connection', (socket) => {
    players[socket.id] = {
        id: socket.id,
        position: { x: 0, y: 1, z: 0 },
        rotation: { y: 0 },
        team: null,
        hp: 100
    };

    socket.on('join-game', (data) => {
        players[socket.id].team = data.team;
        players[socket.id].position = { x: data.team === 'red' ? -60 : 60, y: 1, z: 0 };
        io.emit('player-joined', players[socket.id]);
        socket.emit('current-players', players);
    });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            socket.broadcast.emit('player-moved', players[socket.id]);
        }
    });

    socket.on('take-damage', (data) => {
        const victim = players[data.victimId];
        if (victim && victim.hp > 0) {
            victim.hp -= data.damage;
            io.emit('hp-update', { id: data.victimId, hp: victim.hp });
            if (victim.hp <= 0) {
                victim.hp = 100;
                victim.position = { x: victim.team === 'red' ? -60 : 60, y: 1, z: 0 };
                io.emit('player-respawn', { id: data.victimId, position: victim.position });
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('player-disconnected', socket.id);
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));
