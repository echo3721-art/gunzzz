mport * as THREE from 'three';

const socket = io();

// --- GLOBALS ---
let scene, camera, renderer, localPlayer, weaponMesh;
let obstacles = [], bullets = [], remotePlayers = {};
// NEW: Array to store ladder collision boxes
let ladders = []; 
let isJoined = false, isDead = false;

// Physics / Movement
let keys = { w: false, a: false, s: false, d: false, space: false };
let velocityY = 0;
const GRAVITY = 0.05; 
const JUMP_FORCE = 0.8;
let canJump = false;

// FPS Limiter
const FPS_LIMIT = 60;
const FRAME_DELAY = 1000 / FPS_LIMIT;
let lastFrameTime = 0;

// Camera
const MAX_LOOK_UP = 1.5;
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
    scene.fog = new THREE.Fog(0x87ceeb, 20, 150);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    localPlayer = new THREE.Group();
    localPlayer.add(camera);
    camera.position.y = 1.6; 
    scene.add(localPlayer);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; 
    document.body.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    scene.add(ambient, sun);

    createMap();
    setupEvents();
    setupSocket();
    
    requestAnimationFrame(animate);
}

function createMap() {
    // 1. Huge Floor
    const floorGeo = new THREE.PlaneGeometry(1000, 1000);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57 }); 
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Wall Helper
    const addWall = (x, z, w, h, d, col = 0x555555) => {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshStandardMaterial({ color: col });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, h/2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        obstacles.push(new THREE.Box3().setFromObject(mesh));
    };

    // Ladder Helper (Orange)
    const addLadder = (x, z, h) => {
        const geo = new THREE.BoxGeometry(2, h, 1); // 2 wide, h tall
        const mat = new THREE.MeshStandardMaterial({ color: 0xffa500 }); // Orange
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, h/2, z);
        scene.add(mesh);
        // Add to special ladder collision list
        ladders.push(new THREE.Box3().setFromObject(mesh));
    };

    // 2. Borders
    addWall(0, -500, 1000, 20, 10);
    addWall(0, 500, 1000, 20, 10);
    addWall(-500, 0, 10, 20, 1000);
    addWall(500, 0, 10, 20, 1000);

    // 3. Central Tower
    addWall(0, 0, 20, 25, 20, 0x333333); 
    // ADD LADDER TO MAIN TOWER (Back side)
    addLadder(0, 10.5, 25); 

    // 4. Random City Generation
    for (let i = 0; i < 60; i++) {
        const x = (Math.random() - 0.5) * 800; 
        const z = (Math.random() - 0.5) * 800;
        
        if (Math.abs(x) < 50 && Math.abs(z) < 20) continue;

        const w = 5 + Math.random() * 15;
        const d = 5 + Math.random() * 15;
        const h = 4 + Math.random() * 15; // Taller walls
        
        const col = Math.random() > 0.5 ? 0x7f8c8d : 0x8b4513;
        addWall(x, z, w, h, d, col);

        // 20% Chance to add a ladder to this wall
        if(Math.random() > 0.8 && h > 6) {
            addLadder(x, z + (d/2) + 0.6, h);
        }
    }
}

function createBullet(position, velocity, weaponConfig, isLocalOwner) {
    const bMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.15), 
        new THREE.MeshBasicMaterial({color: 0xffff00})
    );
    bMesh.position.copy(position);
    scene.add(bMesh);
    
    bullets.push({
        mesh: bMesh,
        velocity: velocity,
        life: 100, 
        weapon: weaponConfig,
        prevPos: position.clone(),
        isLocal: isLocalOwner 
    });
}

function fireWeapon() {
    const now = Date.now();
    const w = WEAPONS[currentWeaponIdx];

    if(now - lastFireTime < w.rate) return;
    lastFireTime = now;

    if(w.melee) {
        swingVal = 1;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const ray = new THREE.Raycaster(localPlayer.position, dir, 0, 3);
        const hits = ray.intersectObjects(Object.values(remotePlayers), true);
        if(hits.length > 0) {
            const pid = hits[0].object.parent.userData.id;
            socket.emit('take-damage', { victimId: pid, damage: w.dmg });
        }
    } else {
        recoilVal = 0.2;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const startPos = localPlayer.position.clone().add(new THREE.Vector3(0, 1.6, 0));
        const velocity = dir.multiplyScalar(5); 

        createBullet(startPos, velocity, w, true);

        socket.emit('fire-bullet', {
            position: startPos,
            velocity: velocity,
            weaponId: w.id,
            ownerId: socket.id
        });
    }

    if(!w.auto) isShooting = false;
}

function setupSocket() {
    socket.on('player-moved', (data) => {
        if(!remotePlayers[data.id]) createRemotePlayer(data);
        remotePlayers[data.id].position.copy(data.position);
        remotePlayers[data.id].rotation.y = data.rotation.y;
    });

    socket.on('spawn-remote-bullet', (data) => {
        const w = WEAPONS.find(weap => weap.id === data.weaponId) || WEAPONS[0];
        const vel = new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z);
        const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        createBullet(pos, vel, w, false);
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

function setupEvents() {
    window.addEventListener('join', (e) => {
        socket.emit('join-game', { team: e.detail });
        isJoined = true;
        if(e.detail === 'red') localPlayer.position.set(-100, 5, 0);
        else localPlayer.position.set(100, 5, 0);
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

function animate(currentTime) {
    requestAnimationFrame(animate);

    if (currentTime - lastFrameTime < FRAME_DELAY) return;
    lastFrameTime = currentTime;

    if(isJoined && !isDead) {
        const moveSpeed = 0.2;
        
        // --- CLIMBING LOGIC ---
        // Create a box for the player to check collisions
        const playerBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(localPlayer.position.x, localPlayer.position.y + 1, localPlayer.position.z),
            new THREE.Vector3(0.5, 2, 0.5) 
        );

        let isOnLadder = false;
        // Check if player is touching any ladder
        for(let ladder of ladders) {
            if(playerBox.intersectsBox(ladder)) {
                isOnLadder = true;
                break;
            }
        }

        if(isOnLadder) {
            // CLIMBING MODE: Gravity off, W goes up, S goes down
            velocityY = 0;
            canJump = true; // Allow jumping off ladder
            
            if(keys.w) localPlayer.position.y += 0.15; // Climb Up
            if(keys.s) localPlayer.position.y -= 0.15; // Climb Down
            
            // Standard jump logic if they press space
            if(keys.space) {
                velocityY = JUMP_FORCE;
            }
        } else {
            // NORMAL GRAVITY
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
        }

        // Horizontal Movement
        const prevPos = localPlayer.position.clone();
        const direction = new THREE.Vector3();
        
        // Only allow standard WSAD movement if NOT climbing (or allow slightly slower)
        // Here we allow it so you can move onto the ladder
        if(keys.w) direction.z -= 1;
        if(keys.s) direction.z += 1;
        if(keys.a) direction.x -= 1;
        if(keys.d) direction.x += 1;

        if(direction.length() > 0) {
            direction.normalize().multiplyScalar(moveSpeed);
            direction.applyEuler(new THREE.Euler(0, localPlayer.rotation.y, 0));
            localPlayer.position.add(direction);
        }

        // Collision with Map Walls
        // Re-update box after movement
        const playerBoxMoved = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(localPlayer.position.x, localPlayer.position.y + 1, localPlayer.position.z),
            new THREE.Vector3(0.5, 2, 0.5) 
        );

        for(let wall of obstacles) {
            if(playerBoxMoved.intersectsBox(wall)) {
                localPlayer.position.x = prevPos.x;
                localPlayer.position.z = prevPos.z;
            }
        }

        if(isShooting) fireWeapon();
        animateWeapon();

        // Bullet Logic
        for(let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            const oldPos = b.mesh.position.clone();
            b.mesh.position.add(b.velocity);
            
            const dist = b.velocity.length();
            const dir = b.velocity.clone().normalize();
            const ray = new THREE.Raycaster(oldPos, dir, 0, dist);
            
            let shouldRemove = false;

            for(let wall of obstacles) {
                if(ray.ray.intersectsBox(wall)) {
                    shouldRemove = true;
                    break;
                }
            }

            if(!shouldRemove && b.isLocal) {
                for(let id in remotePlayers) {
                    const hits = ray.intersectObject(remotePlayers[id], true);
                    if(hits.length > 0) {
                        const isHead = hits[0].object.name === "HEAD";
                        socket.emit('take-damage', { 
                            victimId: id, 
                            damage: isHead ? b.weapon.head : b.weapon.dmg 
                        });
                        shouldRemove = true;
                        break;
                    }
                }
            }

            b.life--;
            if(b.life <= 0 || shouldRemove) {
                scene.remove(b.mesh);
                bullets.splice(i, 1);
            }
        }

        socket.emit('move', { position: localPlayer.position, rotation: {y: localPlayer.rotation.y}, weapon: currentWeaponIdx });
    }

    renderer.render(scene, camera);
}
