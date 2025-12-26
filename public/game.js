import * as THREE from 'three';

const socket = io();

// --- GLOBALS ---
let scene, camera, renderer, localPlayer, weaponMesh;
let obstacles = [], bullets = [], remotePlayers = {};
let isJoined = false, isDead = false;

// Physics / Movement
let keys = { w: false, a: false, s: false, d: false, space: false };
let velocityY = 0;
// TUNED PHYSICS
const GRAVITY = 0.05; 
const JUMP_FORCE = 0.8;
let canJump = false;

// --- TPS / FPS LIMITER SETTINGS ---
const FPS_LIMIT = 60; // Limits game to 60 ticks per second
const FRAME_DELAY = 1000 / FPS_LIMIT;
let lastFrameTime = 0;

// Camera Limits
const MAX_LOOK_UP = 1.5; // radians (approx 85 degrees)
const MAX_LOOK_DOWN = -1.5;

// Weapon State
let currentWeaponIdx = 1;
let lastFireTime = 0;
let isShooting = false;
let isAiming = false; 
let recoilVal = 0; 
let swingVal = 0; 

// Weapon Config
const WEAPONS = [
    { id: 1, name: 'SNIPER', dmg: 100, head: 200, rate: 1500, auto: false, color: 0x222222, scale: [0.1, 0.1, 1.2], melee: false },
    { id: 2, name: 'AK-47',  dmg: 20,  head: 40,  rate: 100,  auto: true,  color: 0x5d4037, scale: [0.1, 0.1, 0.6], melee: false },
    { id: 5, name: 'KNIFE',  dmg: 50,  head: 50,  rate: 500,  auto: false, color: 0x999999, scale: [0.05, 0.2, 0.4], melee: true }
];

init();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    localPlayer = new THREE.Group();
    localPlayer.add(camera);
    camera.position.y = 1.6; 
    scene.add(localPlayer);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(50, 100, 50);
    scene.add(ambient, sun);

    createMap();
    setupEvents();
    setupSocket();
    
    // Pass timestamp to animate
    requestAnimationFrame(animate);
}

function createMap() {
    const floorGeo = new THREE.PlaneGeometry(300, 300);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57 }); 
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const addWall = (x, z, w, h, d, col = 0x555555) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: col }));
        mesh.position.set(x, h/2, z);
        scene.add(mesh);
        obstacles.push(new THREE.Box3().setFromObject(mesh));
    };

    addWall(0, 0, 10, 6, 40); 
    addWall(-40, -40, 20, 8, 20, 0x8b4513); 
    addWall(40, 40, 20, 8, 20, 0x8b4513); 
    addWall(0, 50, 60, 4, 2); 
}

function setupEvents() {
    window.addEventListener('join', (e) => {
        socket.emit('join-game', { team: e.detail });
        isJoined = true;
        if(e.detail === 'red') localPlayer.position.set(-60, 5, 0);
        else localPlayer.position.set(60, 5, 0);
        updateWeaponMesh();
    });

    document.addEventListener('dblclick', () => document.body.requestPointerLock());

    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if(keys.hasOwnProperty(k)) keys[k] = true;
        if(k === ' ') {
            keys.space = true;
            e.preventDefault(); 
        }
    });
    
    document.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if(keys.hasOwnProperty(k)) keys[k] = false;
        if(k === ' ') keys.space = false;
    });

    document.addEventListener('mousemove', (e) => {
        if(document.pointerLockElement && !isDead) {
            localPlayer.rotation.y -= e.movementX * 0.002;
            camera.rotation.x -= e.movementY * 0.002;
            
            // --- NEW: VERTICAL LOOK LIMIT (TPS LIMIT) ---
            camera.rotation.x = Math.max(MAX_LOOK_DOWN, Math.min(MAX_LOOK_UP, camera.rotation.x));
        }
    });

    document.addEventListener('mousedown', (e) => {
        if(isDead || !isJoined) return;
        if(e.button === 0) isShooting = true;
        if(e.button === 2) isAiming = true;
    });
    document.addEventListener('mouseup', (e) => {
        if(e.button === 0) isShooting = false;
        if(e.button === 2) isAiming = false;
    });

    document.addEventListener('wheel', (e) => {
        if(!isJoined) return;
        if(e.deltaY > 0) currentWeaponIdx = (currentWeaponIdx + 1) % WEAPONS.length;
        else currentWeaponIdx = (currentWeaponIdx - 1 + WEAPONS.length) % WEAPONS.length;
        updateWeaponMesh();
    });
}

function updateWeaponMesh() {
    if(weaponMesh) camera.remove(weaponMesh);
    const w = WEAPONS[currentWeaponIdx];
    
    const geo = new THREE.BoxGeometry(...w.scale);
    const mat = new THREE.MeshStandardMaterial({ color: w.color });
    weaponMesh = new THREE.Mesh(geo, mat);
    weaponMesh.position.set(0.3, -0.3, -0.6);
    camera.add(weaponMesh);

    document.querySelectorAll('.slot').forEach(el => el.classList.remove('active'));
    const ids = ['s1', 's2', 's5'];
    document.getElementById(ids[currentWeaponIdx]).classList.add('active');
}

function fireWeapon() {
    const now = Date.now();
    const w = WEAPONS[currentWeaponIdx];

    if(now - lastFireTime < w.rate) return;
    lastFireTime = now;

    if(w.melee) swingVal = 1;
    else recoilVal = 0.2;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    if(w.melee) {
        const ray = new THREE.Raycaster(localPlayer.position, dir, 0, 3);
        const hits = ray.intersectObjects(Object.values(remotePlayers), true);
        if(hits.length > 0) {
            const pid = hits[0].object.parent.userData.id;
            socket.emit('take-damage', { victimId: pid, damage: w.dmg });
        }
    } else {
        const bMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({color: 0xffff00}));
        bMesh.position.copy(localPlayer.position).add(new THREE.Vector3(0, 1.6, 0));
        scene.add(bMesh);
        
        bullets.push({
            mesh: bMesh,
            velocity: dir.multiplyScalar(4),
            life: 60,
            weapon: w,
            prevPos: bMesh.position.clone() 
        });
    }

    if(!w.auto) isShooting = false;
}

function animateWeapon() {
    if(!weaponMesh) return;
    const w = WEAPONS[currentWeaponIdx];

    if(w.name === 'SNIPER' && isAiming) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, 20, 0.2);
    } else {
        camera.fov = THREE.MathUtils.lerp(camera.fov, 75, 0.2);
    }
    camera.updateProjectionMatrix();

    if(recoilVal > 0) {
        weaponMesh.position.z = -0.6 + recoilVal;
        weaponMesh.rotation.x = recoilVal; 
        recoilVal -= 0.02;
        if(recoilVal < 0) recoilVal = 0;
    } else {
        weaponMesh.position.z = -0.6;
        weaponMesh.rotation.x = 0;
    }

    if(swingVal > 0) {
        weaponMesh.rotation.y = -swingVal * 2;
        weaponMesh.position.x = 0.3 - (swingVal * 0.2);
        swingVal -= 0.1;
        if(swingVal < 0) {
            swingVal = 0;
            weaponMesh.rotation.y = 0;
            weaponMesh.position.x = 0.3;
        }
    }
}

function setupSocket() {
    socket.on('player-moved', (data) => {
        if(!remotePlayers[data.id]) createRemotePlayer(data);
        remotePlayers[data.id].position.copy(data.position);
        remotePlayers[data.id].rotation.y = data.rotation.y;
    });

    socket.on('hp-update', (d) => {
        if(d.id === socket.id) document.getElementById('hp-fill').style.width = d.hp + '%';
    });

    socket.on('player-died', (d) => {
        if(d.id === socket.id) {
            isDead = true;
            document.getElementById('death-screen').style.display = 'block';
        } else if(remotePlayers[d.id]) {
            remotePlayers[d.id].visible = false;
        }
    });

    socket.on('player-respawn', (d) => {
        if(d.id === socket.id) {
            isDead = false;
            localPlayer.position.copy(d.position);
            velocityY = 0;
            document.getElementById('death-screen').style.display = 'none';
            document.getElementById('hp-fill').style.width = '100%';
        } else if(remotePlayers[d.id]) {
            remotePlayers[d.id].visible = true;
        }
    });
}

function createRemotePlayer(data) {
    const group = new THREE.Group();
    const color = data.team === 'red' ? 0xff0000 : 0x0000ff;
    
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.8), new THREE.MeshStandardMaterial({color: color}));
    body.position.y = 0.9;
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({color: 0xffccaa}));
    head.position.y = 1.7; 
    head.name = "HEAD"; 

    group.add(body, head);
    group.userData.id = data.id;
    scene.add(group);
    remotePlayers[data.id] = group;
}

// --- NEW ANIMATE LOOP WITH TPS LIMIT ---
function animate(currentTime) {
    requestAnimationFrame(animate);

    // TPS LIMITER: If not enough time has passed, skip this frame
    if (currentTime - lastFrameTime < FRAME_DELAY) return;
    lastFrameTime = currentTime;

    if(isJoined && !isDead) {
        const moveSpeed = 0.2;
        
        // 1. Gravity
        velocityY -= GRAVITY;
        localPlayer.position.y += velocityY;

        if(localPlayer.position.y <= 0) {
            localPlayer.position.y = 0;
            velocityY = 0;
            canJump = true;
        }

        if(keys.space && canJump) {
            velocityY = JUMP_FORCE;
            canJump = false;
        }

        // 2. Horizontal Movement
        const prevPos = localPlayer.position.clone();
        const direction = new THREE.Vector3();
        if(keys.w) direction.z -= 1;
        if(keys.s) direction.z += 1;
        if(keys.a) direction.x -= 1;
        if(keys.d) direction.x += 1;

        if(direction.length() > 0) {
            direction.normalize().multiplyScalar(moveSpeed);
            direction.applyEuler(new THREE.Euler(0, localPlayer.rotation.y, 0));
            localPlayer.position.add(direction);
        }

        // 3. Wall Collision
        const playerBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(localPlayer.position.x, 1, localPlayer.position.z),
            new THREE.Vector3(0.5, 2, 0.5) 
        );

        for(let wall of obstacles) {
            if(playerBox.intersectsBox(wall)) {
                localPlayer.position.x = prevPos.x;
                localPlayer.position.z = prevPos.z;
            }
        }

        if(isShooting) fireWeapon();
        animateWeapon();

        // 4. Bullets
        for(let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            const oldPos = b.mesh.position.clone();
            b.mesh.position.add(b.velocity);
            
            const dist = b.velocity.length();
            const dir = b.velocity.clone().normalize();
            const ray = new THREE.Raycaster(oldPos, dir, 0, dist);
            
            let hit = false;
            // Check Walls
            for(let wall of obstacles) {
                const bSphere = new THREE.Sphere(b.mesh.position, 0.1);
                if(wall.intersectsSphere(bSphere)) hit = true;
            }

            // Check Players
            if(!hit) {
                for(let id in remotePlayers) {
                    const hits = ray.intersectObject(remotePlayers[id], true);
                    if(hits.length > 0) {
                        const isHead = hits[0].object.name === "HEAD";
                        socket.emit('take-damage', { 
                            victimId: id, 
                            damage: isHead ? b.weapon.head : b.weapon.dmg 
                        });
                        hit = true;
                        break;
                    }
                }
            }

            b.life--;
            if(b.life <= 0 || hit) {
                scene.remove(b.mesh);
                bullets.splice(i, 1);
            }
        }

        socket.emit('move', { position: localPlayer.position, rotation: {y: localPlayer.rotation.y} });
    }

    renderer.render(scene, camera);
}
