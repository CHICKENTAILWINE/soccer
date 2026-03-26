const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 创建HTTP服务器（用于提供静态文件）
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 存储房间: roomCode -> { host, guest, hostReady, guestReady, gameState }
const rooms = new Map();

// 生成6位房间号
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

wss.on('connection', (ws) => {
    console.log('新客户端连接');
    let currentRoom = null;
    let playerRole = null; // 'host' 或 'guest'

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        console.log('收到消息:', data);

        switch (data.type) {
            case 'create':
                // 创建房间
                const roomCode = generateRoomCode();
                rooms.set(roomCode, {
                    host: ws,
                    guest: null,
                    hostReady: false,
                    guestReady: false,
                    gameState: null
                });
                currentRoom = roomCode;
                playerRole = 'host';
                ws.send(JSON.stringify({
                    type: 'created',
                    roomCode: roomCode,
                    side: 'host'
                }));
                console.log(`房间创建: ${roomCode}`);
                break;

            case 'join':
                // 加入房间
                const room = rooms.get(data.roomCode);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
                    return;
                }
                if (room.guest !== null) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
                    return;
                }
                room.guest = ws;
                currentRoom = data.roomCode;
                playerRole = 'guest';
                ws.send(JSON.stringify({
                    type: 'joined',
                    roomCode: data.roomCode,
                    side: 'guest'
                }));
                // 通知房主对手已加入
                room.host.send(JSON.stringify({
                    type: 'opponent_joined',
                    message: '对手已加入，游戏即将开始'
                }));
                console.log(`玩家加入房间: ${data.roomCode}`);
                break;

            case 'ready':
                // 玩家准备（开始游戏）
                const readyRoom = rooms.get(currentRoom);
                if (!readyRoom) return;
                if (playerRole === 'host') {
                    readyRoom.hostReady = true;
                } else if (playerRole === 'guest') {
                    readyRoom.guestReady = true;
                }
                // 如果双方都准备就绪，通知开始游戏
                if (readyRoom.hostReady && readyRoom.guestReady) {
                    // 随机决定谁先开球
                    const firstTurn = Math.random() < 0.5 ? 'host' : 'guest';
                    const startMsg = {
                        type: 'start_game',
                        firstTurn: firstTurn,
                        yourSide: 'host'
                    };
                    readyRoom.host.send(JSON.stringify({ ...startMsg, yourSide: 'host' }));
                    readyRoom.guest.send(JSON.stringify({ ...startMsg, yourSide: 'guest' }));
                    console.log(`房间 ${currentRoom} 游戏开始，先手: ${firstTurn}`);
                }
                break;

            case 'action':
                // 游戏动作：转发给对手
                const actionRoom = rooms.get(currentRoom);
                if (!actionRoom) return;
                const opponent = (playerRole === 'host') ? actionRoom.guest : actionRoom.host;
                if (opponent && opponent.readyState === WebSocket.OPEN) {
                    opponent.send(JSON.stringify({
                        type: 'sync',
                        action: data.action
                    }));
                }
                break;

            case 'game_over':
                // 游戏结束，删除房间
                rooms.delete(currentRoom);
                console.log(`房间 ${currentRoom} 游戏结束，已清理`);
                break;

            default:
                break;
        }
    });

    ws.on('close', () => {
        console.log('客户端断开');
        // 如果玩家断开，清理房间
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                // 通知对方对手断开
                const opponent = (playerRole === 'host') ? room.guest : room.host;
                if (opponent && opponent.readyState === WebSocket.OPEN) {
                    opponent.send(JSON.stringify({
                        type: 'opponent_disconnected',
                        message: '对手已断开连接，游戏结束'
                    }));
                }
                rooms.delete(currentRoom);
                console.log(`房间 ${currentRoom} 因玩家断开而清理`);
            }
        }
    });
});

// 启动服务器
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`WebSocket地址: ws://localhost:${PORT}`);
});
