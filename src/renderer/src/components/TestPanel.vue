<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { SystemInfo } from '../../../shared/types'
import { themePreference } from '../store/themeStore'
import { io, Socket } from 'socket.io-client'

// 配置socket.io客户端
const roomCode = ref('')
const isConnected = ref(false)
const isP2PReady = ref(false)
let socket: Socket | null = null
let peerConnection: RTCPeerConnection | null = null
let dataChannel: RTCDataChannel | null = null

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.hitv.com:3478' },
  ]
}

const connectToServer = () => {
  socket = io('http://localhost:3000')

  socket.on('connect', () => {
    isConnected.value = true
    socket?.emit('create-room')
  })

  socket.on('room-created', (code: string) => {
    roomCode.value = code
  })

  // 🔥 核心起点：当老师手机成功加入房间时触发
  socket.on('peer-joined', async (peerId: string) => {
    console.log(`老师手机已加入，Socket ID: ${peerId}，准备发起 WebRTC 直连！`)

    // 1. 创建 P2P 连接对象
    peerConnection = new RTCPeerConnection(rtcConfig)
    peerConnection.oniceconnectionstatechange = () => {
      console.log('📡 [WebRTC 物理层状态变化]:', peerConnection?.iceConnectionState)
    }
    // 2. 🔥 创建一条名为 "instadrop-file" 的数据通道
    dataChannel = peerConnection.createDataChannel('instadrop-file')

    dataChannel.onopen = () => {
        console.log('⚡ WebRTC 数据通道已敞开！')
        isP2PReady.value = true // 🔥 告诉 Vue：物理通道打通了！
    }

    // 3. 收集本地的网络坐标(ICE)发送给手机端
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit('signal', { roomCode: roomCode.value, payload: { type: 'candidate', candidate: event.candidate } })
      }
    }

    // 4. 创建 Offer (握手请求) 并发送给手机端
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    socket?.emit('signal', { roomCode: roomCode.value, payload: { type: 'offer', offer: offer } })
  })

  socket.on('signal', async (data: any) => {
    const payload = data.payload

    if (payload.type === 'answer' && peerConnection) {
      // 收到手机端的同意(Answer)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer))
      console.log('✅ 收到手机端 Answer，WebRTC 握手完成！')
    } else if (payload.type === 'candidate' && peerConnection) {
      // 收到手机端的网络坐标
      await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
    }
  })
}
// 🔥 终极文件切片发送引擎
const sendFile = async (filePath: string) => {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    return alert('WebRTC 通道还未打开，请先连线手机！')
  }

  try {
    // 1. 获取文件大小和名字
    const { name, size } = await window.myElectronAPI.getFileInfo(filePath)
    console.log(`准备发送文件: ${name} (大小: ${size} 字节)`)

    // 2. 发送第一条特殊消息：告诉手机“我要开始发文件啦，做好接收准备”
    dataChannel.send(JSON.stringify({ type: 'meta', name: name, size: size }))

    // 3. 开始切片！(64KB 是 WebRTC 的黄金传输大小)
    const chunkSize = 64 * 1024
    let offset = 0

    // 只要还没读完，就一直循环发
    while (offset < size) {
      // ⚠️ 极其关键的一步：背压控制 (Backpressure)
      // 如果发得太快，WebRTC 底层网卡缓冲区会被撑爆。超过 1MB 缓存就等 50 毫秒。
      if (dataChannel.bufferedAmount > 1024 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 50))
        continue
      }

      // 请求主进程读取这一块的二进制数据
      const chunk = await window.myElectronAPI.readFileChunk(filePath, offset, chunkSize)

      // 直接把二进制塞进 WebRTC 通道射出去！
      dataChannel.send(chunk as any)
      offset += chunk.length

      // 这里可以用来做进度条 (可选打印)
      // console.log(`发送进度: ${Math.round((offset / size) * 100)}%`)
    }

    // 4. 全部发完后，发最后一条特殊消息：告诉手机“接收完毕，可以保存了”
    dataChannel.send(JSON.stringify({ type: 'eof' }))
    console.log('🎉 文件物理发送全部完成！')
    alert('文件发送完毕！看一眼手机吧！')

  } catch (err) {
    console.error('发送文件失败:', err)
  }
}
// 防呆设计：当你切换到别的页面或者关闭软件时，自动断开连接，防止内存泄漏
onUnmounted(() => {
  disconnectServer()
})
const disconnectServer = () => {
  if (socket) {
    socket.disconnect()
    isP2PReady.value = false
    isConnected.value = false
    roomCode.value = ''
  }
}

// 存储主进程传来的系统信息
const sysInfo = ref<SystemInfo | null>(null)
const latencyTestShow = ref(false)
var latency = ref(0)

onMounted(async () => {
  // 页面加载时请求数据
  sysInfo.value = await window.myElectronAPI.getSystemInfo()
})

// 测试 IPC 通信
const handlePing = async () => {
  latency.value = await window.myElectronAPI.ping()
  console.log(`Latency: ${latency.value}ms`)
  latencyTestShow.value = true
}
</script>

<template>
  <v-app>
    <v-main>
      <v-container>
        <v-col>
          <v-card variant="elevated" elevation="3">
            <v-card-item>
              <template v-slot:prepend>
                <v-icon icon="mdi-server-network" color="info" size="x-large" class="mr-2"></v-icon>
              </template>
              <v-card-title>本地运行环境状态</v-card-title>
              <v-card-subtitle>Local System Environment</v-card-subtitle>
            </v-card-item>

            <v-divider></v-divider>

            <v-card-text v-if="sysInfo">
              <div class="d-flex justify-space-between mb-2">
                <span>Node.js 版本:</span>
                <span class="text-primary font-weight-bold">{{ sysInfo.nodeVersion }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span>Electron 核心:</span>
                <span class="text-primary font-weight-bold">{{ sysInfo.electronVersion }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span>Chromium 版本:</span>
                <span class="text-primary font-weight-bold">{{ sysInfo.chromeVersion }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span>系统主题模式:</span>
                <span class="text-primary font-weight-bold">{{ sysInfo.isDarkMode ? '深色模式' : '浅色模式' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2" v-if="latencyTestShow">
                <span>IPC延迟测试结果：{{ latency }}ms</span>
              </div>
            </v-card-text>
            <v-card-text v-else>
              <v-progress-circular indeterminate color="primary"></v-progress-circular>
              正在读取系统状态...
            </v-card-text>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn color="primary" variant="flat" prepend-icon="mdi-lan-connect" @click="handlePing">
                发送测试 Ping
              </v-btn>
            </v-card-actions>
          </v-card>

          <div style="height: 10px"></div>

          <v-card variant="elevated" elevation="3">
            <v-card-item>
              <template v-slot:prepend>
                <v-icon icon="mdi-server" color="info" size="x-large" class="mr-2"></v-icon>
              </template>
              <v-card-title>LocalStorage信息</v-card-title>
              <v-card-subtitle>LocalStorage info</v-card-subtitle>
            </v-card-item>

            <v-divider></v-divider>

            <v-card-text v-if="sysInfo">
              <div class="d-flex justify-space-between mb-2">
                <span>主题模式：</span>
                <span class="text-primary font-weight-bold">{{ themePreference || '未设置（默认system）' }}</span>
              </div>
            </v-card-text>
            <v-card-text v-else>
              <v-progress-circular indeterminate color="primary"></v-progress-circular>
              正在读取系统状态...
            </v-card-text>
          </v-card>

          <div style="height: 10px"></div>

          <v-card class="mt-4" variant="outlined">
            <v-card-title class="text-primary font-weight-bold">
              <v-icon icon="mdi-access-point-network" class="mr-2"></v-icon>
              WebRTC 信令中枢测试
            </v-card-title>

            <v-card-text>
              <div class="d-flex align-center mb-6">
                <span class="mr-3 font-weight-medium">服务器状态:</span>
                <v-chip :color="isConnected ? 'success' : 'error'" size="small" variant="flat" class="font-weight-bold">
                  {{ isConnected ? '🟢 已连接 (Online)' : '🔴 未连接 (Offline)' }}
                </v-chip>
              </div>

              <v-expand-transition>
                <div v-if="roomCode" class="text-center pa-6 bg-surface-variant rounded-xl mb-2 elevation-2">
                  <div class="text-subtitle-1 text-medium-emphasis mb-2">本机取件码 (Room Code)</div>
                  <div class="text-h2 font-weight-black text-primary" style="letter-spacing: 0.15em;">
                    {{ roomCode }}
                  </div>
                </div>
              </v-expand-transition>
            </v-card-text>

            <v-divider></v-divider>

            <v-card-actions class="pa-3">
              <v-chip 
                v-if="isConnected" 
                :color="isP2PReady ? 'purple-accent-3' : 'warning'" 
                variant="flat" 
                class="font-weight-bold"
              >
                {{ isP2PReady ? '⚡ P2P 通道已开启' : '⏳ 正在打洞穿透网络...' }}
              </v-chip>
            
              <v-spacer></v-spacer>
            
              <v-btn 
                :disabled="!isP2PReady"
                :color="isP2PReady ? 'success' : 'grey'"
                variant="elevated"
                @click="sendFile('C:\\Users\\Littl\\Downloads\\test.mp4')"
              >
                发送测试视频
              </v-btn>
            
              <v-btn v-if="!isConnected" color="primary" variant="flat" prepend-icon="mdi-link" @click="connectToServer">
                连线服务器
              </v-btn>
              <v-btn v-else color="error" variant="tonal" prepend-icon="mdi-link-off" @click="disconnectServer">
                切断连接
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-container>
    </v-main>
  </v-app>
</template>