const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, 'public')));

// Game State
const players = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Handle Player Joining
    socket.on('join-game', (data) => {
        players[socket.id] = {
            id: socket.id,
            team: data.team, // 'red' or 'blue'
            hp: 100,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 }
        };

        // Notify others about the new player
        socket.broadcast.emit('player-moved', players[socket.id]);
        
        // Send existing players to the newcomer
        Object.values(players).forEach(p => {
            if (p.id !== socket.id) {
                socket.emit('player-moved', p);
            }
        });
    });

    // Handle Movement
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            
            // Broadcast movement to all other players
            socket.broadcast.emit('player-moved', {
                id: socket.id,
                position: data.position,
                rotation: data.rotation,
                team: players[socket.id].team
            });
        }
    });

    // Handle Damage
    socket.on('take-damage', (data) => {
        const victim = players[data.victimId];
        if (victim && victim.hp > 0) {
            victim.hp -= data.damage;

            // Update all clients on health
            io.emit('hp-update', { id: victim.id, hp: victim.hp });

            // Check for death
            if (victim.hp <= 0) {
                io.emit('player-died', { id: victim.id });

                // Respawn Timer (3 seconds)
                setTimeout(() => {
                    if (players[victim.id]) {
                        victim.hp = 100;
                        // Respawn coordinates based on team
                        const respawnPos = victim.team === 'red' ? 
                            { x: -60, y: 5, z: 0 } : { x: 60, y: 5, z: 0 };
                        
                        victim.position = respawnPos;
                        io.emit('player-respawn', { 
                            id: victim.id, 
                            position: respawnPos 
                        });
                    }
                }, 3000);
            }
        }
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('player-died', { id: socket.id }); // Removes mesh from other clients
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
