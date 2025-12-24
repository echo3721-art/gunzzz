import * as THREE from 'three';

const socket = io();

// --- GLOBALS ---
let scene, camera, renderer, localPlayer, weaponMesh;
let obstacles = [], bullets = [], remotePlayers = {};
let isJoined = false, isDead = false;
let scoreMesh; 

// Physics & Speed (UPDATED: Faster)
let keys = { w: false, a: false, s: false, d: false, space: false };
let velocityY = 0;
const GRAVITY = 0.05;
const JUMP_FORCE = 0.8;
const MOVE_SPEED = 0.4; // Made player faster (was 0.2)
let canJump = false;

const FPS_LIMIT = 60;
const FRAME_DELAY = 1000 / FPS_LIMIT;
let lastFrameTime = 0;

// Weapon Config (UPDATED: Sniper Balance)
const WEAPONS = [
    { id: 1, name: 'SNIPER', dmg: 50, head: 100, rate: 1500, auto: false, color: 0x222222, scale: [0.1, 0.1, 1.2], melee: false }, // 2 shot kill
    { id: 2, name: 'AK-47',  dmg: 15, head: 30,  rate: 100,  auto: true,  color: 0x5d4037, scale: [0.1, 0.1, 0.6], melee: false },
    { id: 5, name: 'KNIFE',  dmg: 35, head: 35,  rate: 500,  auto: false, color: 0x999999, scale: [0.05, 0.2, 0.4], melee: true }
];

let currentWeaponIdx = 1;
let lastFireTime = 0;
let isShooting = false;

init();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 10, 100); // Added fog for atmosphere

    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    localPlayer = new THREE.Group();
    localPlayer.add(camera);
    camera.position.y = 1.6;
    scene.add(localPlayer);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Lighting
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x404040));

    createMap();
    createSkyScoreboard(); // NEW: Giant Board
    setupEvents();
    setupSocket();
    requestAnimationFrame(animate);
}

// --- NEW: GIANT SCOREBOARD ---
function createSkyScoreboard() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Draw initial board
    updateScoreCanvas(ctx, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    scoreMesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), mat);
    scoreMesh.position.set(0, 30, 0); // High in the sky
    scoreMesh.lookAt(0, 0, 0); // Facing center
    scene.add(scoreMesh);

    // Save context for updates
    scoreMesh.userData = { ctx: ctx, canvas: canvas, tex: tex };
}

function updateScoreCanvas(ctx, red, blue) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 512, 128);
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4444';
    ctx.fillText(`RED: ${red}`, 150, 85);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('|', 256, 85);
    ctx.fillStyle = '#4444ff';
    ctx.fillText(`BLUE: ${blue}`, 362, 85);
}

function createMap() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x2e8b57 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const addWall = (x, z, w, h, d) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x555555 }));
        mesh.position.set(x, h/2, z);
        scene.add(mesh);
        obstacles.push(new THREE.Box3().setFromObject(mesh));
    };

    addWall(0, 0, 10, 8, 40);
    addWall(-40, -40, 20, 10, 20);
    addWall(40, 40, 20, 10, 20);
}

function setupSocket() {
    socket.on('player-moved', (data) => {
        if(!remotePlayers[data.id]) createRemotePlayer(data);
        const p = remotePlayers[data.id];
        p.position.copy(data.position);
        p.rotation.y = data.rotation.y;
        
        // NEW: Sync Weapon Visuals
        if(p.userData.lastWeapon !== data.weapon) {
            updateRemoteWeapon(p, data.weapon);
            p.userData.lastWeapon = data.weapon;
        }
    });

    socket.on('score-update', (scores) => {
        if(scoreMesh) {
            updateScoreCanvas(scoreMesh.userData.ctx, scores.red, scores.blue);
            scoreMesh.userData.tex.needsUpdate = true;
        }
    });

    socket.on('spawn-remote-bullet', (data) => {
        spawnBullet(new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z), 
                    new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z), 
                    WEAPONS.find(w => w.id === data.weaponId), true);
    });
    
    // ... existing hp-update, player-died, player-respawn, voice code ...
}

// --- NEW: ROBOT CHARACTER MODEL ---
function createRemotePlayer(data) {
    const root = new THREE.Group();
    root.userData = { id: data.id };
    
    // Robot Body
    const color = data.team === 'red' ? 0xff0000 : 0x0000ff;
    const bodyMat = new THREE.MeshStandardMaterial({ color: color });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), bodyMat);
    torso.position.y = 1.0;
    root.add(torso);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), bodyMat);
    head.position.y = 1.7;
    head.name = "HEAD";
    root.add(head);

    // Visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.25), new THREE.MeshStandardMaterial({color: 0x00ffff, emissive: 0x00ffff}));
    visor.position.set(0, 1.7, 0.1);
    root.add(visor);

    // Weapon Holder
    const hand = new THREE.Group();
    hand.name = "Hand";
    hand.position.set(0.4, 1.2, 0.4);
    root.add(hand);

    scene.add(root);
    remotePlayers[data.id] = root;
    updateRemoteWeapon(root, data.weapon || 1);
}

function updateRemoteWeapon(playerGroup, weaponId) {
    const hand = playerGroup.getObjectByName("Hand");
    hand.clear();
    const wConfig = WEAPONS.find(w => w.id === weaponId) || WEAPONS[0];
    const geom = new THREE.BoxGeometry(...wConfig.scale);
    const mat = new THREE.MeshStandardMaterial({ color: wConfig.color });
    const mesh = new THREE.Mesh(geom, mat);
    hand.add(mesh);
}

function fireWeapon() {
    const now = Date.now();
    const w = WEAPONS[currentWeaponIdx];
    if(now - lastFireTime < w.rate) return;
    lastFireTime = now;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // NEW: EFFECTS
    if(w.melee) {
        // Knife Slash Effect
        createSlashEffect();
        // Melee logic
        const ray = new THREE.Raycaster(localPlayer.position, dir, 0, 4);
        const hits = ray.intersectObjects(Object.values(remotePlayers), true);
        if(hits.length > 0) {
            let target = hits[0].object;
            while(target.parent && !target.userData.id) target = target.parent;
            if(target.userData.id) socket.emit('take-damage', { victimId: target.userData.id, damage: w.dmg });
        }
    } else {
        // Gun Muzzle Flash
        createMuzzleFlash();
        
        const origin = localPlayer.position.clone().add(new THREE.Vector3(0, 1.6, 0));
        const velocity = dir.clone().multiplyScalar(6); // Faster bullets

        spawnBullet(origin, velocity, w, false);
        socket.emit('fire-bullet', { origin, velocity, weaponId: w.id });
    }
    if(!w.auto) isShooting = false;
}

// --- NEW: VISUAL EFFECTS ---
function createMuzzleFlash() {
    const flash = new THREE.PointLight(0xffaa00, 5, 5);
    flash.position.set(0.5, -0.5, -1).applyMatrix4(camera.matrixWorld);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 50);
}

function createSlashEffect() {
    // Simple visual swipe
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const slash = new THREE.Mesh(geometry, material);
    
    slash.position.set(0, 1.6, -1.5).applyMatrix4(localPlayer.matrixWorld);
    slash.rotation.copy(localPlayer.rotation);
    slash.rotation.z = Math.random(); 
    scene.add(slash);

    let frames = 0;
    const animateSlash = () => {
        frames++;
        slash.scale.x += 0.2;
        slash.material.opacity -= 0.1;
        if(frames < 10) requestAnimationFrame(animateSlash);
        else scene.remove(slash);
    };
    animateSlash();
}

function spawnBullet(origin, velocity, weapon, isRemote) {
    const bMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial({color: isRemote ? 0xff0000 : 0xffff00}));
    bMesh.position.copy(origin);
    scene.add(bMesh);

    // Trail
    const trailGeo = new THREE.BufferGeometry().setFromPoints([origin, origin]);
    const trailMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const trail = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);

    bullets.push({ mesh: bMesh, trail, velocity, life: 100, weapon, isRemote });
}

function spawnExplosion(pos) {
    for(let i=0; i<8; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.2,0.2), new THREE.MeshBasicMaterial({color: 0xff4500}));
        p.position.copy(pos);
        p.position.add(new THREE.Vector3((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)));
        scene.add(p);
        setTimeout(() => scene.remove(p), 300);
    }
}

function animate(currentTime) {
    requestAnimationFrame(animate);
    if (currentTime - lastFrameTime < FRAME_DELAY) return;
    lastFrameTime = currentTime;

    if(isJoined && !isDead) {
        // Physics
        velocityY -= GRAVITY;
        localPlayer.position.y += velocityY;
        if(localPlayer.position.y <= 0) { localPlayer.position.y = 0; velocityY = 0; canJump = true; }
        if(keys.space && canJump) { velocityY = JUMP_FORCE; canJump = false; }

        const moveDir = new THREE.Vector3();
        if(keys.w) moveDir.z -= 1; if(keys.s) moveDir.z += 1;
        if(keys.a) moveDir.x -= 1; if(keys.d) moveDir.x += 1;
        
        if(moveDir.length() > 0) {
            moveDir.normalize().multiplyScalar(MOVE_SPEED).applyEuler(new THREE.Euler(0, localPlayer.rotation.y, 0));
            // Wall Collision
            const nextPos = localPlayer.position.clone().add(moveDir);
            const pBox = new THREE.Box3().setFromCenterAndSize(nextPos, new THREE.Vector3(0.5, 2, 0.5));
            let hitWall = false;
            for(let wall of obstacles) {
                if(pBox.intersectsBox(wall)) hitWall = true;
            }
            if(!hitWall) localPlayer.position.add(moveDir);
        }

        if(isShooting) fireWeapon();
        
        // --- BULLETS AND WALLS ---
        for(let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            const oldPos = b.mesh.position.clone();
            b.mesh.position.add(b.velocity);
            
            // Update Trail
            b.trail.geometry.setFromPoints([oldPos, b.mesh.position]);
            setTimeout((t) => scene.remove(t), 100, b.trail); // Quick fade

            let hit = false;
            
            // 1. Wall Collision (Explode logic)
            for(let wall of obstacles) {
                if(wall.containsPoint(b.mesh.position)) {
                    spawnExplosion(b.mesh.position);
                    hit = true; 
                    break;
                }
            }

            // 2. Player Collision
            if(!hit && !b.isRemote) {
                const ray = new THREE.Raycaster(oldPos, b.velocity.clone().normalize(), 0, b.velocity.length());
                for(let id in remotePlayers) {
                    const hits = ray.intersectObject(remotePlayers[id], true);
                    if(hits.length > 0) {
                        const target = hits[0].object;
                        const isHead = target.name === "HEAD";
                        socket.emit('take-damage', { 
                            victimId: id, 
                            damage: isHead ? b.weapon.head : b.weapon.dmg 
                        });
                        hit = true; break;
                    }
                }
            }

            if(b.life <= 0 || hit) {
                scene.remove(b.mesh);
                bullets.splice(i, 1);
            }
        }
        
        // Send weapon data in move packet
        socket.emit('move', { 
            position: localPlayer.position, 
            rotation: {y: localPlayer.rotation.y},
            weapon: WEAPONS[currentWeaponIdx].id
        });
    }
    renderer.render(scene, camera);
}

// Helper: Setup events
function setupEvents() {
    document.addEventListener('keydown', (e) => {
        if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = true;
        if(e.key === '1') currentWeaponIdx = 0;
        if(e.key === '2') currentWeaponIdx = 1;
        if(e.key === '3') currentWeaponIdx = 2;
    });
    document.addEventListener('keyup', (e) => {
        if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = false;
    });
    document.addEventListener('mousedown', () => isShooting = true);
    document.addEventListener('mouseup', () => isShooting = false);
    document.addEventListener('mousemove', (e) => {
        if(document.pointerLockElement === document.body) {
            localPlayer.rotation.y -= e.movementX * 0.002;
        }
    });
    document.body.addEventListener('click', () => document.body.requestPointerLock());
    window.join = (team) => {
        isJoined = true;
        document.getElementById('ui').style.display = 'none';
        document.getElementById('hud').style.display = 'block';
        socket.emit('join-game', { team });
    };
}
