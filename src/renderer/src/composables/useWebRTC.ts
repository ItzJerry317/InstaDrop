import { ref, onUnmounted, watch } from 'vue'
import { io, Socket } from 'socket.io-client'

// 生成 UUID 的简易函数
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// 定义信任设备的结构
export interface TrustedDevice {
  id: string
  name: string
  lastConnected: number
  isOnline?: boolean // 运行时状态，不存库
}

export function useWebRTC() {
  // === 状态定义 ===
  const roomCode = ref('')
  const isConnected = ref(false)
  const isP2PReady = ref(false)
  const fileProgress = ref(0)
  const currentFile = ref<{ name: string, size: number } | null>(null)
  const sendStatus = ref<{ status: 'idle' | 'sending' | 'done' | 'error' | 'paused', message?: string }>({ status: 'idle' })
  const isCancelled = ref(false)

  const transferSpeed = ref('0 B/s')
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 B/s'
    const k = 1024
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // === 身份与信任管理 ===
  // 从 localStorage 读取或生成新身份
  const myDeviceId = ref(localStorage.getItem('instadrop_did') || generateUUID())
  const myDeviceName = ref(localStorage.getItem('instadrop_dname') || '未命名设备-' + Math.floor(Math.random()*1000))
  
  // 信任设备列表
  const trustedDevices = ref<TrustedDevice[]>(JSON.parse(localStorage.getItem('instadrop_trusted') || '[]'))

  // 初始化信任设备在线状态
  trustedDevices.value.forEach(d => d.isOnline = false)

  // 监听变动并持久化
  watch(myDeviceId, (val) => localStorage.setItem('instadrop_did', val))
  watch(myDeviceName, (val) => localStorage.setItem('instadrop_dname', val))
  watch(trustedDevices, (val) => localStorage.setItem('instadrop_trusted', JSON.stringify(val)), { deep: true })

  let socket: Socket | null = null
  let peerConnection: RTCPeerConnection | null = null
  let dataChannel: RTCDataChannel | null = null

  // 既然你指定了 stun.hitv.com，我们这里就锁死它
  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.hitv.com:3478' }]
  }

  // === 身份管理方法 ===
  const regenerateDeviceId = () => {
    myDeviceId.value = generateUUID()
    trustedDevices.value = [] // 重置信任设备列表
    disconnectServer()
    setTimeout(connectToServer, 500) // 重连以更新服务器记录
    return myDeviceId.value
  }

  const updateDeviceName = (name: string) => {
    myDeviceName.value = name
    // 如果在线，需要重新注册信息
    if (socket && socket.connected) {
      socket.emit('device-online', { deviceId: myDeviceId.value, deviceName: myDeviceName.value })
    }
  }

  const addTrustedDevice = (id: string, name: string) => {
    if (id === myDeviceId.value) return
    const exists = trustedDevices.value.find(d => d.id === id)
    if (exists) {
      exists.name = name
      exists.lastConnected = Date.now()
    } else {
      trustedDevices.value.push({ id, name, lastConnected: Date.now() })
    }
  }

  const removeTrustedDevice = (id: string) => {
    trustedDevices.value = trustedDevices.value.filter(d => d.id !== id)
  }

  // === 传输控制方法 (保持不变) ===
  const resetTransfer = () => {
    fileProgress.value = 0
    currentFile.value = null
    sendStatus.value = { status: 'idle' }
    isCancelled.value = false
    transferSpeed.value = '0 B/s'
  }

  const pauseTransfer = () => {
    if (sendStatus.value.status === 'sending') sendStatus.value.status = 'paused'
  }

  const resumeTransfer = () => {
    if (sendStatus.value.status === 'paused') sendStatus.value.status = 'sending'
  }

  const cancelTransfer = () => {
    isCancelled.value = true
    if (sendStatus.value.status === 'paused') sendStatus.value.status = 'sending'
  }

  // === 核心信令逻辑 ===
  const connectToServer = () => {
    // 连接你的 Node 服务器
    socket = io('http://localhost:3000', {
      reconnectionAttempts: 3,
      reconnectionDelay: 2000
    })

    socket.on('connect', () => {
      isConnected.value = true
      // 🔥 核心升级：连上后立即上报身份
      socket?.emit('device-online', { 
        deviceId: myDeviceId.value, 
        deviceName: myDeviceName.value 
      })
      
      // 同时也请求旧版的房间码（为了兼容 6 位数连接）
      socket?.emit('create-room')
      
      // 启动心跳检查：查询信任设备的在线状态
      checkOnlineStatus()
    })

    socket.on('room-created', (code: string) => {
      roomCode.value = code
    })

    // === 新增：处理无感直连请求 ===
    socket.on('direct-connection-ready', ({ roomId, role, peerDeviceId, peerDeviceName }) => {
      console.log(`[Direct] 收到直连请求，房间: ${roomId}, 角色: ${role}`)
      roomCode.value = '加密直连' // UI 显示
      startWebRTC(role === 'host', roomId) // 启动 WebRTC
      
      // 连上了，新增信任信息
      if (peerDeviceId) {
        addTrustedDevice(peerDeviceId, peerDeviceName || '未知设备')
      }
    })

    socket.on('direct-connection-error', (msg: string) => {
      alert('直连失败：' + msg)
    })

    // === 旧版：6 位数连接逻辑 ===
    socket.on('join-success', (code: string) => {
      // 手机端用的，电脑端主要是 Host
      console.log('加入房间成功', code)
    })
    
    // 对方加入房间 (旧版流程)
    socket.on('peer-joined', () => {
      console.log('[WebRTC] 对方通过 6 位码加入，准备打洞')
      startWebRTC(true, roomCode.value)
    })

    // === 通用 WebRTC 信令 ===
    socket.on('signal', async (data: any) => {
      const payload = data.payload
      if (!peerConnection) return
      
      if (payload.type === 'offer') {
        // 如果我是接收方 (Client)，我收到了 Offer
        if (!peerConnection) startWebRTC(false, roomCode.value)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.offer))
        const answer = await peerConnection.createAnswer()
        await peerConnection.setLocalDescription(answer)
        socket?.emit('signal', { roomCode: roomCode.value, payload: { type: 'answer', answer: answer } })
      } 
      else if (payload.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer))
      } 
      else if (payload.type === 'candidate') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
      }
    })

    socket.on('peer-disconnected', () => {
      handleDisconnect('对方断开连接')
    })
  }

  // 封装 WebRTC 启动逻辑 (复用)
  const startWebRTC = async (isPolite: boolean, roomId: string) => {
    isP2PReady.value = false
    peerConnection = new RTCPeerConnection(rtcConfig)

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection?.iceConnectionState
      console.log('[物理层状态]:', state)
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        handleDisconnect('连接断开')
      }
    }

    dataChannel = peerConnection.createDataChannel('instadrop-file')
    setupDataChannel(dataChannel)

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit('signal', { roomCode: roomId, payload: { type: 'candidate', candidate: event.candidate } })
      }
    }

    if (isPolite) {
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      socket?.emit('signal', { roomCode: roomId, payload: { type: 'offer', offer: offer } })
    }
  }

  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onopen = () => {
      console.log('⚡ P2P 通道打通！')
      isP2PReady.value = true
      
      // 🔥 自动握手：通道一通，立马交换身份信息
      channel.send(JSON.stringify({ 
        type: 'identity-handshake', 
        id: myDeviceId.value, 
        name: myDeviceName.value 
      }))
    }
    
    channel.onmessage = (e) => {
      // 这里处理握手消息，如果收到 identity-handshake，就存入信任列表
      try {
        const msg = JSON.parse(e.data as string)
        if (msg.type === 'identity-handshake') {
          console.log('🤝 收到身份握手:', msg.name)
          addTrustedDevice(msg.id, msg.name)
        }
      } catch (err) {
        // 忽略非 JSON 消息 (可能是二进制文件片)
      }
    }

    channel.onclose = () => handleDisconnect('通道关闭')
    channel.onerror = () => handleDisconnect('通道错误')
  }

  const handleDisconnect = (reason: string) => {
    isP2PReady.value = false
    if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
      sendStatus.value = { status: 'error', message: reason }
      transferSpeed.value = '0 B/s'
    }
  }

  const disconnectServer = () => {
    if (socket) socket.disconnect()
    isConnected.value = false
    isP2PReady.value = false
    roomCode.value = ''
    transferSpeed.value = '0 B/s'
  }

  // 定期检查信任设备的在线状态
  const checkOnlineStatus = () => {
    if (!socket || !socket.connected || trustedDevices.value.length === 0) return
    const ids = trustedDevices.value.map(d => d.id)
    socket.emit('check-online-status', ids, (statuses: Record<string, boolean>) => {
      trustedDevices.value.forEach(d => {
        d.isOnline = statuses[d.id] || false
      })
    })
  }
  // 每 5 秒刷新一次在线状态
  setInterval(checkOnlineStatus, 5000)

  // 发起无感直连
  const connectToDevice = (targetDeviceId: string) => {
    if (!socket || !socket.connected) return alert('未连接服务器')
    socket.emit('request-direct-connection', { targetDeviceId })
  }

const sendFile = (filePath: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      const channel = dataChannel //锁定当前dataChannel
      if (!channel || channel.readyState !== 'open') {
        return reject(new Error('P2P 通道未打开'))
      }

      try {
        isCancelled.value = false 
        const { name, size } = await window.myElectronAPI.getFileInfo(filePath)
        currentFile.value = { name, size }

        //锁定channel变量，防止在传输过程中被disconnectServer重置
        channel.send(JSON.stringify({ type: 'meta', name, size }))

        const chunkSize = 64 * 1024
        let offset = 0
        sendStatus.value = { status: 'sending', message: `正在发送 ${name} (${Math.round(size / 1024)} KB)` }

        //速度计算
        let lastTime = Date.now()
        let lastOffset = 0
        transferSpeed.value = '计算中...'

        while (offset < size) {
          if (isCancelled.value) {
            resetTransfer()
            return reject(new Error('传输已被手动终止'))
          }

          if (sendStatus.value.status === 'error' || !socket || !socket.connected) {
            return reject(new Error('disconnected'))
          }

          while (sendStatus.value.status === 'paused') {
            if (isCancelled.value) break 
            
            // 在暂停的休眠期间，如果手机突然断网，需要立刻跳出死循环
            if (channel.readyState !== 'open' || !socket || !socket.connected) {
              return reject(new Error('disconnected'))
            }
            transferSpeed.value = '0 B/s' // 暂停时速度归零
            await new Promise(r => setTimeout(r, 100))
            // 从暂停唤醒时，重置时间戳，防止计算出错误的低速
            lastTime = Date.now()
            lastOffset = offset
          }

          if (isCancelled.value) {
            resetTransfer()
            return reject(new Error('传输已被手动终止'))
          }

          // 关键点：每次读取并发送切片前，必须检查底层物理通道是否依然存活
          if (channel.readyState !== 'open' || !socket || !socket.connected) {
            return reject(new Error('disconnected'))
          }

          if (channel.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 50))
            continue
          }
          const chunk = await window.myElectronAPI.readFileChunk(filePath, offset, chunkSize)
          channel.send(chunk as any)
          offset += chunk.length
          fileProgress.value = Math.round((offset / size) * 100)
          //每500ms计算一次速度
          const now = Date.now()
          if (now - lastTime >= 500) {
            const speed = ((offset - lastOffset) / (now - lastTime)) * 1000
            transferSpeed.value = formatSpeed(speed)
            lastTime = now
            lastOffset = offset
          }
        }

        // 修复：只有在“没有”被取消的情况下，才发送结束标记并标记为完成
        if (!isCancelled.value && sendStatus.value.status !== 'error') {
          channel.send(JSON.stringify({ type: 'eof' }))
          sendStatus.value = { status: 'done', message: `文件 ${name} 发送完成` }
          resolve()
          transferSpeed.value = '0 B/s'
        }
      } catch (err: any) {
        // 修复：只有在“非手动取消”的情况下，才记录为系统错误
        if (!isCancelled.value) {
          const errorMsg = err.message === 'disconnected' ? '连接意外断开 (Disconnected)' : (err.message || '未知错误')
          sendStatus.value = { status: 'error', message: `传输异常：${errorMsg}` }
          transferSpeed.value = '0 B/s'
        }
        reject(err)
      }
    })
  }

  onUnmounted(() => disconnectServer())

  return {
    // 基础状态
    roomCode, isConnected, isP2PReady, 
    // 传输状态
    fileProgress, currentFile, sendStatus, 
    // 身份数据
    myDeviceId, myDeviceName, trustedDevices,
    // 方法
    connectToServer, disconnectServer, 
    regenerateDeviceId, updateDeviceName,
    addTrustedDevice, removeTrustedDevice, connectToDevice,
    // 传输控制
    sendFile, resetTransfer, pauseTransfer, resumeTransfer, cancelTransfer, transferSpeed
  }
}