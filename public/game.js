import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// Audio system
const audioLoader = new THREE.AudioLoader();
const listener = new THREE.AudioListener();
let weaponSounds = {};

// Game State
let redScore = 0;
let blueScore = 0;
let myName = '';
let myTeam = '';
let gameTime = 0;
let lastScoreCheck = 0;
let currentNameInput = '';
let respawnTimer = null;

// Voice Chat Variables
let localStream = null;
let peerConnections = {};
let isVoiceEnabled = false;
let isMuted = false;

// --- GLOBALS ---
let scene, camera, renderer, localPlayer, weaponMesh;
let obstacles = [], bullets = [], remotePlayers = {};
let isJoined = false, isDead = false;

// Character Animation with Skinned Mesh
let mixer, idleAction, runAction;
let clock = new THREE.Clock();
let characterModel;
let animations = {};

// Physics / Movement
let keys = { w: false, a: false, s: false, d: false, space: false };
let velocityY = 0;
const GRAVITY = 0.05; 
const JUMP_FORCE = 0.8;
let canJump = false;

// Mobile Controls
let isMobile = false;
let joystickActive = false;
let joystickData = { x: 0, y: 0 };
let mobileFire = false;
let mobileJump = false;
let mobileAim = false;
let mobileTouchStartX = 0;
let mobileTouchStartY = 0;
let mobileTouchActive = false;

// Settings
const FPS_LIMIT = 60;
const FRAME_DELAY = 1000 / FPS_LIMIT;
let lastFrameTime = 0;

const MAX_LOOK_UP = 1.5;
const MAX_LOOK_DOWN = -1.5;

let currentWeaponIdx = 1;
let lastFireTime = 0;
let isShooting = false;
let isAiming = false; 
let recoilVal = 0; 
let swingVal = 0; 

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
    camera.add(listener);
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
    setupMobileControls();
    createSkinnedCharacter();
    loadWeaponSounds();
    
    requestAnimationFrame(animate);
}

function loadWeaponSounds() {
    // Load weapon sound effects
    audioLoader.load('sniper.mp3', (buffer) => {
        weaponSounds.sniper = buffer;
    });
    
    audioLoader.load('ak.mp3', (buffer) => {
        weaponSounds.ak = buffer;
    });
    
    audioLoader.load('swing.mp3', (buffer) => {
        weaponSounds.swing = buffer;
    });
    
    audioLoader.load('kill.mp3', (buffer) => {
        weaponSounds.kill = buffer;
    });
}

function updateScoreDisplay() {
    document.getElementById('red-score').textContent = redScore;
    document.getElementById('blue-score').textContent = blueScore;
}

function showKillNotification(victimName) {
    const notification = document.getElementById('kill-notification');
    notification.textContent = `You killed ${victimName}!`;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

function showWinAnnouncement(winningTeam) {
    const announcement = document.getElementById('win-announcement');
    announcement.textContent = `${winningTeam.toUpperCase()} TEAM WINS!`;
    announcement.style.display = 'block';
    
    setTimeout(() => {
        announcement.style.display = 'none';
        // Reset scores after win
        redScore = 0;
        blueScore = 0;
        updateScoreDisplay();
    }, 5000);
}

function checkWinCondition() {
    const now = Date.now();
    if (now - lastScoreCheck > 3000) { // Check every 3 minutes
        if (redScore >= 10) {
            showWinAnnouncement('red');
        } else if (blueScore >= 10) {
            showWinAnnouncement('blue');
        }
        lastScoreCheck = now;
    }
}

function createSkinnedCharacter() {
    // Create a skinned character with bones and animation system
    // Based on Three.js skinned animation example
    
    const geometry = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x4169e1,
        skinning: true 
    });

    // Create bones for the character
    const bones = [];
    const boneHeight = 0.4;

    // Root bone
    const rootBone = new THREE.Bone();
    rootBone.position.y = -0.8;
    bones.push(rootBone);

    // Spine bones
    for (let i = 0; i < 4; i++) {
        const bone = new THREE.Bone();
        bone.position.y = boneHeight;
        bones[bones.length - 1].add(bone);
        bones.push(bone);
    }

    // Arm bones
    const leftArmBone = new THREE.Bone();
    leftArmBone.position.set(0.4, 0.3, 0);
    bones[2].add(leftArmBone);
    bones.push(leftArmBone);

    const rightArmBone = new THREE.Bone();
    rightArmBone.position.set(-0.4, 0.3, 0);
    bones[2].add(rightArmBone);
    bones.push(rightArmBone);

    // Leg bones
    const leftLegBone = new THREE.Bone();
    leftLegBone.position.set(0.15, -0.4, 0);
    bones[0].add(leftLegBone);
    bones.push(leftLegBone);

    const rightLegBone = new THREE.Bone();
    rightLegBone.position.set(-0.15, -0.4, 0);
    bones[0].add(rightLegBone);
    bones.push(rightLegBone);

    // Create skinned mesh
    const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
    skinnedMesh.add(rootBone);
    skinnedMesh.bind(new THREE.Skeleton(bones));

    // Create animation mixer
    mixer = new THREE.AnimationMixer(skinnedMesh);

    // Create idle animation
    const idleTrack = new THREE.NumberKeyframeTrack(
        '.bones[' + bones.length + '].rotation[y]',
        [0, 1, 2],
        [0, 0.1, 0]
    );
    const idleClip = new THREE.AnimationClip('idle', 2, [idleTrack]);
    idleAction = mixer.clipAction(idleClip);
    idleAction.setEffectiveWeight(1);

    // Create run animation
    const runTracks = [];
    
    // Leg animation for running
    runTracks.push(new THREE.NumberKeyframeTrack(
        '.bones[' + (bones.length - 2) + '].rotation[x]',
        [0, 0.25, 0.5, 0.75, 1],
        [0, 0.5, 0, -0.5, 0]
    ));
    
    runTracks.push(new THREE.NumberKeyframeTrack(
        '.bones[' + (bones.length - 1) + '].rotation[x]',
        [0, 0.25, 0.5, 0.75, 1],
        [0, -0.5, 0, 0.5, 0]
    ));

    // Arm animation for running
    runTracks.push(new THREE.NumberKeyframeTrack(
        '.bones[' + (bones.length - 4) + '].rotation[x]',
        [0, 0.25, 0.5, 0.75, 1],
        [0, 0.3, 0, -0.3, 0]
    ));
    
    runTracks.push(new THREE.NumberKeyframeTrack(
        '.bones[' + (bones.length - 3) + '].rotation[x]',
        [0, 0.25, 0.5, 0.75, 1],
        [0, -0.3, 0, 0.3, 0]
    ));

    const runClip = new THREE.AnimationClip('run', 1, runTracks);
    runAction = mixer.clipAction(runClip);
    runAction.setEffectiveWeight(0);

    // Start with idle animation
    idleAction.play();
    runAction.play();

    // Set additive blending for run animation
    runAction.blendingMode = THREE.AdditiveAnimationBlendMode;

    // Hide first person character
    skinnedMesh.visible = false;
    
    localPlayer.add(skinnedMesh);
    characterModel = skinnedMesh;
    
    // Store bone references for manual animation
    localPlayer.userData.bones = bones;
    localPlayer.userData.skinnedMesh = skinnedMesh;
}

function updateCharacterAnimation() {
    if (!mixer) return;
    
    const isMoving = keys.w || keys.s || keys.a || keys.d;
    
    // Blend between idle and run animations with additive blending
    if (isMoving) {
        idleAction.setEffectiveWeight(0.3);
        runAction.setEffectiveWeight(1);
    } else {
        idleAction.setEffectiveWeight(1);
        runAction.setEffectiveWeight(0);
    }
    
    mixer.update(clock.getDelta());
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
        const { team, name } = e.detail;
        myName = name;
        myTeam = team;
        socket.emit('join-game', { team, name });
        isJoined = true;
        if(team === 'red') localPlayer.position.set(-60, 5, 0);
        else localPlayer.position.set(60, 5, 0);
        updateWeaponMesh();
        updateScoreDisplay();
        
        // Initialize voice chat after joining
        initializeVoiceChat();
    });

    // Text input handler for name tag
    const nameInput = document.getElementById('name-input');
    console.log('Name input element:', nameInput); // Debug log
    
    if (nameInput) {
        // Make sure input is visible and enabled
        nameInput.style.display = 'block';
        nameInput.style.pointerEvents = 'auto';
        
        nameInput.addEventListener('input', (e) => {
            currentNameInput = e.target.value;
            console.log('Name input changed:', currentNameInput);
        });
        
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Apply the name to local player
                myName = currentNameInput;
                nameInput.value = '';
                currentNameInput = '';
                
                // Update server with new name
                socket.emit('update-name', { name: myName });
            }
        });
    } else {
        console.error('Name input element not found!');
    }
    
    // Voice chat button handler
    const voiceBtn = document.getElementById('voice-btn');
    if (voiceBtn) {
        voiceBtn.addEventListener('click', toggleMute);
    }

    document.addEventListener('dblclick', () => document.body.requestPointerLock());

    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if(keys.hasOwnProperty(k)) keys[k] = true;
        if(k === ' ') {
            keys.space = true;
            e.preventDefault(); 
        }
        
        // Respawn when dead and pressing R
        if (isDead && k === 'r') {
            const respawnPosition = myTeam === 'red' ? 
                { x: -60, y: 5, z: 0 } : 
                { x: 60, y: 5, z: 0 };
            
            socket.emit('respawn', { position: respawnPosition });
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

// --- HELPER: Create a Bullet (Visual + Logic) ---
function createBullet(origin, velocity, weapon, isRemote) {
    const size = isRemote ? 0.3 : 0.08; 
    const color = isRemote ? 0xff0000 : 0xffff00;

    const bMesh = new THREE.Mesh(
        new THREE.SphereGeometry(size), 
        new THREE.MeshBasicMaterial({color: color})
    );
    bMesh.position.copy(origin);
    scene.add(bMesh);
    
    bullets.push({
        mesh: bMesh,
        velocity: velocity,
        life: 100,
        weapon: weapon,
        isRemote: isRemote 
    });
}

function playWeaponSound(weaponName) {
    if (weaponSounds[weaponName]) {
        const sound = new THREE.Audio(listener);
        sound.setBuffer(weaponSounds[weaponName]);
        sound.setVolume(0.5);
        sound.play();
    }
}

function fireWeapon() {
    const now = Date.now();
    const w = WEAPONS[currentWeaponIdx];

    if(now - lastFireTime < w.rate) return;
    lastFireTime = now;

    if(w.melee) {
        swingVal = 1;
        playWeaponSound('swing');
    } else {
        recoilVal = 0.2;
        // Play weapon-specific sound
        if (w.name === 'SNIPER') {
            playWeaponSound('sniper');
        } else if (w.name === 'AK-47') {
            playWeaponSound('ak');
        }
    }

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
        const speed = 2;
        const velocity = dir.multiplyScalar(speed);
        
        const origin = localPlayer.position.clone().add(new THREE.Vector3(0, 1.6, 0));

        createBullet(origin, velocity, w, false);

        console.log("Sending shot...");
        socket.emit('shoot', { 
            origin: origin, 
            velocity: velocity, 
            weaponId: w.id 
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
        
        // If voice chat is enabled and this is a new player, start voice call
        if (isVoiceEnabled && data.id !== socket.id && !peerConnections[data.id]) {
            startVoiceCall(data.id);
        }
    });

    socket.on('hp-update', (d) => {
        if(d.id === socket.id) document.getElementById('hp-fill').style.width = d.hp + '%';
    });

    socket.on('shoot', (data) => {
        console.log("RECEIVED SHOOT EVENT FROM:", data.shooterId);

        const origin = new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z);
        const velocity = new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z);
        const w = WEAPONS.find(w => w.id === data.weaponId) || WEAPONS[0];
        
        createBullet(origin, velocity, w, true);
    });

    socket.on('player-died', (d) => {
        if(d.id === socket.id) {
            isDead = true;
            document.getElementById('death-screen').style.display = 'block';
            
            // Clear any existing respawn timer
            if (respawnTimer) {
                clearTimeout(respawnTimer);
            }
            
            // Start countdown
            let countdown = 3;
            const timerElement = document.getElementById('respawn-timer');
            if (timerElement) {
                timerElement.textContent = countdown;
            }
            
            // Update countdown every second
            const countdownInterval = setInterval(() => {
                countdown--;
                if (timerElement) {
                    timerElement.textContent = countdown;
                }
                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                }
            }, 1000);
            
            // Auto-respawn after 3 seconds
            respawnTimer = setTimeout(() => {
                const respawnPosition = myTeam === 'red' ? 
                    { x: -60, y: 5, z: 0 } : 
                    { x: 60, y: 5, z: 0 };
                
                socket.emit('respawn', { position: respawnPosition });
                respawnTimer = null;
            }, 3000);
        } else if(remotePlayers[d.id]) {
            remotePlayers[d.id].visible = false;
            
            // Update score based on killer's team
            if (d.killerTeam === 'red') {
                redScore++;
            } else if (d.killerTeam === 'blue') {
                blueScore++;
            }
            updateScoreDisplay();
            checkWinCondition();
        }
    });

    socket.on('player-killed', (data) => {
        // Show kill notification to killer
        if (data.killerId === socket.id && data.victimName) {
            showKillNotification(data.victimName);
            playWeaponSound('kill');
        }
    });

    socket.on('player-respawn', (d) => {
        if(d.id === socket.id) {
            isDead = false;
            localPlayer.position.copy(d.position);
            velocityY = 0;
            document.getElementById('death-screen').style.display = 'none';
            document.getElementById('hp-fill').style.width = '100%';
            
            // Recreate name tag for local player if it exists
            if (!remotePlayers[socket.id]) {
                const localPlayerData = {
                    id: socket.id,
                    name: myName || "Player",
                    team: myTeam
                };
                createRemotePlayer(localPlayerData);
            }
        } else if(remotePlayers[d.id]) {
            remotePlayers[d.id].visible = true;
        }
    });

    socket.on('voice-player-left', (data) => {
        console.log('Player left voice chat:', data.playerName);
        // Clean up peer connection
        if (peerConnections[data.playerId]) {
            peerConnections[data.playerId].close();
            delete peerConnections[data.playerId];
        }
    });

    socket.on('voice-offer', handleVoiceOffer);
    socket.on('voice-answer', handleVoiceAnswer);
    socket.on('voice-ice-candidate', handleIceCandidate);

    socket.on('voice-chat-status', (data) => {
        console.log(`${data.playerName} is ${data.isMuted ? 'muted' : 'unmuted'}`);
        // Update UI to show speaking status
    });

    socket.on('player-disconnected', (data) => {
        // Clean up voice chat connection for disconnected player
        if (peerConnections[data.id]) {
            peerConnections[data.id].close();
            delete peerConnections[data.id];
        }
        cleanupPlayer(data.id);
    });
}

function setupMobileControls() {
    // Detect mobile device
    isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    if (isMobile) {
        document.getElementById('mobile-controls').style.display = 'block';
        document.getElementById('mobile-buttons').style.display = 'block';
        
        const joystickContainer = document.getElementById('joystick-container');
        const joystick = document.getElementById('joystick');
        const fireBtn = document.getElementById('fire-btn');
        const jumpBtn = document.getElementById('jump-btn');
        const aimBtn = document.getElementById('aim-btn');
        
        if (!joystickContainer || !joystick || !fireBtn || !jumpBtn || !aimBtn) return;
        
        // Joystick controls
        joystickContainer.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            joystickActive = true;
        }, { passive: false });
        
        joystickContainer.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!joystickActive) return;
            
            const touch = e.touches[0];
            const rect = joystickContainer.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            let deltaX = touch.clientX - centerX;
            let deltaY = touch.clientY - centerY;
            
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const maxDistance = rect.width / 2 - 20;
            
            if (distance > maxDistance) {
                deltaX = (deltaX / distance) * maxDistance;
                deltaY = (deltaY / distance) * maxDistance;
            }
            
            joystick.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
            
            joystickData.x = deltaX / maxDistance;
            joystickData.y = deltaY / maxDistance;
            
            // Update keyboard state based on joystick with proper thresholds
            keys.w = joystickData.y < -0.3;
            keys.s = joystickData.y > 0.3;
            keys.a = joystickData.x < -0.3;
            keys.d = joystickData.x > 0.3;
        }, { passive: false });
        
        joystickContainer.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            joystickActive = false;
            joystick.style.transform = 'translate(0px, 0px)';
            joystickData.x = 0;
            joystickData.y = 0;
            
            // Reset keyboard state
            keys.w = false;
            keys.s = false;
            keys.a = false;
            keys.d = false;
        }, { passive: false });
        
        // Fire button
        fireBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileFire = true;
            isShooting = true;
        }, { passive: false });
        
        fireBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileFire = false;
            isShooting = false;
        }, { passive: false });
        
        // Jump button
        jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileJump = true;
            keys.space = true;
        }, { passive: false });
        
        jumpBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileJump = false;
            keys.space = false;
        }, { passive: false });
        
        // Aim button
        aimBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileAim = true;
            isAiming = true;
        }, { passive: false });
        
        aimBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileAim = false;
            isAiming = false;
        }, { passive: false });
        
        // Camera turning with touch
        document.addEventListener('touchstart', (e) => {
            // Only handle touches that aren't on controls
            const touch = e.touches[0];
            const target = e.target;
            
            // Check if touch is on any control element
            const isOnControl = target.closest('#mobile-controls') || 
                              target.closest('#mobile-buttons') ||
                              target.closest('#text-input-holder');
            
            if (!isOnControl && e.touches.length === 1) {
                mobileTouchActive = true;
                mobileTouchStartX = touch.clientX;
                mobileTouchStartY = touch.clientY;
            }
        }, { passive: false });
        
        document.addEventListener('touchmove', (e) => {
            if (mobileTouchActive && e.touches.length === 1) {
                e.preventDefault();
                const touch = e.touches[0];
                const deltaX = touch.clientX - mobileTouchStartX;
                const deltaY = touch.clientY - mobileTouchStartY;
                
                // Rotate camera based on touch movement
                const sensitivity = 0.005;
                localPlayer.rotation.y -= deltaX * sensitivity;
                camera.rotation.x -= deltaY * sensitivity;
                
                // Clamp vertical rotation
                camera.rotation.x = Math.max(MAX_LOOK_DOWN, Math.min(MAX_LOOK_UP, camera.rotation.x));
                
                // Update start position for continuous rotation
                mobileTouchStartX = touch.clientX;
                mobileTouchStartY = touch.clientY;
            }
        }, { passive: false });
        
        document.addEventListener('touchend', (e) => {
            mobileTouchActive = false;
        }, { passive: false });
        
        // Mobile weapon switching
        const mobileWeapons = document.getElementById('mobile-weapons');
        const weaponIcons = mobileWeapons.querySelectorAll('.mobile-weapon');
        
        weaponIcons.forEach(icon => {
            icon.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const weaponIndex = parseInt(icon.dataset.weapon);
                if (!isNaN(weaponIndex) && weaponIndex >= 0 && weaponIndex < WEAPONS.length) {
                    currentWeaponIdx = weaponIndex;
                    updateWeaponMesh();
                    
                    // Update active state
                    weaponIcons.forEach(w => w.classList.remove('active'));
                    icon.classList.add('active');
                }
            }, { passive: false });
        });
        
        // Show mobile weapons on mobile
        if (isMobile) {
            mobileWeapons.style.display = 'flex';
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
    group.userData.name = data.name || "Player";
    group.userData.team = data.team;
    
    // Create name tag
    const nameDiv = document.createElement('div');
    nameDiv.className = 'player-name';
    nameDiv.textContent = group.userData.name;
    nameDiv.style.color = data.team === 'red' ? '#ff6666' : '#6666ff';
    document.body.appendChild(nameDiv);
    
    group.userData.nameElement = nameDiv;
    
    scene.add(group);
    remotePlayers[data.id] = group;
}

function cleanupPlayer(id) {
    const player = remotePlayers[id];
    if (player && player.userData.nameElement) {
        document.body.removeChild(player.userData.nameElement);
    }
    if (player) {
        scene.remove(player);
        delete remotePlayers[id];
    }
}

// Voice Chat Functions
async function initializeVoiceChat() {
    try {
        // Request microphone permission
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
        });
        
        isVoiceEnabled = true;
        console.log('Voice chat initialized successfully');
        
        // Start voice calls with all existing players
        Object.keys(remotePlayers).forEach(playerId => {
            if (playerId !== socket.id) {
                startVoiceCall(playerId);
            }
        });
        
        // Notify server that we're ready for voice chat
        socket.emit('voice-chat-ready', { playerId: socket.id });
        
    } catch (error) {
        console.error('Failed to initialize voice chat:', error);
        
        // Show user-friendly error message
        const errorMessage = document.createElement('div');
        errorMessage.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 10px;
            z-index: 1000;
            text-align: center;
        `;
        errorMessage.innerHTML = `
            <h3>Microphone Access Required</h3>
            <p>Please allow microphone access to use voice chat.</p>
            <button onclick="this.parentElement.remove()" style="margin-top: 10px; padding: 5px 15px;">OK</button>
        `;
        document.body.appendChild(errorMessage);
    }
}

function createPeerConnection(targetId) {
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    
    const pc = new RTCPeerConnection(config);
    
    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle incoming streams
    pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true; // Ensure audio plays automatically
        audio.play().catch(error => {
            console.log('Audio play failed, trying again:', error);
            // Try to play audio on user interaction
            document.addEventListener('click', () => {
                audio.play().catch(e => console.log('Audio play on click failed:', e));
            }, { once: true });
        });
        console.log('Playing remote audio from:', targetId);
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('voice-ice-candidate', {
                targetId: targetId,
                candidate: event.candidate
            });
        }
    };
    
    return pc;
}

async function startVoiceCall(targetId) {
    try {
        const pc = createPeerConnection(targetId);
        peerConnections[targetId] = pc;
        
        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        socket.emit('voice-offer', {
            targetId: targetId,
            offer: offer
        });
        
    } catch (error) {
        console.error('Error starting voice call:', error);
    }
}

async function handleVoiceOffer(data) {
    try {
        const pc = createPeerConnection(data.from);
        peerConnections[data.from] = pc;
        
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('voice-answer', {
            targetId: data.from,
            answer: answer
        });
        
    } catch (error) {
        console.error('Error handling voice offer:', error);
    }
}

async function handleVoiceAnswer(data) {
    try {
        const pc = peerConnections[data.from];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    } catch (error) {
        console.error('Error handling voice answer:', error);
    }
}

async function handleIceCandidate(data) {
    try {
        const pc = peerConnections[data.from];
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error handling ICE candidate:', error);
    }
}

function toggleMute() {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        
        // Update UI
        const voiceBtn = document.getElementById('voice-btn');
        if (voiceBtn) {
            voiceBtn.textContent = isMuted ? '🔇 Unmute' : '🎤 Mute';
            voiceBtn.style.background = isMuted ? 'rgba(255,0,0,0.8)' : 'rgba(0,255,0,0.8)';
        }
        
        // Notify server
        socket.emit('voice-chat-toggle', {
            isMuted: isMuted,
            isSpeaking: false
        });
    }
}

function cleanupVoiceChat() {
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => {
        pc.close();
    });
    peerConnections = {};
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    
    isVoiceEnabled = false;
}

function updateNameTags() {
    // Update name tag positions for all remote players
    for (let id in remotePlayers) {
        const player = remotePlayers[id];
        if (player.userData.nameElement) {
            // Don't show own name
            if (id === socket.id) {
                player.userData.nameElement.style.display = 'none';
                continue;
            }
            
            const vector = player.position.clone().project(camera);
            
            // Check if player is behind camera
            if (vector.z > 1) {
                player.userData.nameElement.style.display = 'none';
                continue;
            }
            
            const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
            
            // Only show name if player is in front of camera
            if (vector.z < 1) {
                // Check if there's a wall between player and camera
                const direction = player.position.clone().sub(camera.position).normalize();
                const ray = new THREE.Raycaster(camera.position, direction);
                let hasWallObstruction = false;
                
                for (let wall of obstacles) {
                    // Create a temporary mesh for raycasting
                    const tempGeometry = new THREE.BoxGeometry(1, 1, 1);
                    const tempMaterial = new THREE.MeshBasicMaterial({ visible: false });
                    const tempMesh = new THREE.Mesh(tempGeometry, tempMaterial);
                    
                    // Use the wall's bounding box to check for intersection
                    const wallBox = wall;
                    const raycaster = new THREE.Raycaster(camera.position, direction);
                    raycaster.far = player.position.distanceTo(camera.position);
                    
                    // Simple distance-based obstruction check
                    const wallCenter = new THREE.Vector3();
                    wallBox.getCenter(wallCenter);
                    const distanceToWall = camera.position.distanceTo(wallCenter);
                    
                    if (distanceToWall < player.position.distanceTo(camera.position)) {
                        // Check if wall is roughly between camera and player
                        const toWall = wallCenter.clone().sub(camera.position).normalize();
                        const toPlayer = player.position.clone().sub(camera.position).normalize();
                        const dot = toWall.dot(toPlayer);
                        
                        if (dot > 0.7) { // Wall is in front direction
                            hasWallObstruction = true;
                            break;
                        }
                    }
                }
                
                if (!hasWallObstruction) {
                    player.userData.nameElement.style.display = 'block';
                    player.userData.nameElement.style.left = x + 'px';
                    player.userData.nameElement.style.top = y + 'px';
                } else {
                    player.userData.nameElement.style.display = 'none';
                }
            } else {
                player.userData.nameElement.style.display = 'none';
            }
        }
    }
}

function animate(currentTime) {
    requestAnimationFrame(animate);

    if (currentTime - lastFrameTime < FRAME_DELAY) return;
    lastFrameTime = currentTime;

    if(isJoined && !isDead) {
        // Update character animation
        updateCharacterAnimation();
        
        const moveSpeed = 0.2;
        
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

        // Update Bullets
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

            // Check Players (Only for Local Bullets)
            if(!hit && !b.isRemote) {
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

    // Update name tags for all players
    updateNameTags();

    renderer.render(scene, camera);
}
