import { ref, watch } from 'vue'
import { io, Socket } from 'socket.io-client'
import { isElectron } from '../utils/platform'
import { Capacitor } from '@capacitor/core'
// 更改为全局变量

// === 发送端状态定义 ===
const roomCode = ref('')
const isConnected = ref(false)
const isP2PReady = ref(false)
const fileProgress = ref(0)
const currentFile = ref<{ name: string, size: number } | null>(null)
const sendStatus = ref<{ status: 'idle' | 'sending' | 'done' | 'error' | 'paused', message?: string }>({ status: 'idle' })
const isCancelled = ref(false)
const connectedPeerId = ref<string | null>(null)
const connectedPeerName = ref<string | null>(null)
const transferSpeed = ref('0 B/s')
const currentRoomId = ref<string | null>(null)
const connectionError = ref<string | null>(null)
const isHostRole = ref(false)
const isDefaultHost = ref(false)
const myRealIP = ref<string | null>(null)
export interface DroppedFile {
  name: string
  path: string
  size: number
  formattedSize: string
  rawFile?: File // 移动端用，原生文件对象
  status: 'pending' | 'sending' | 'done' | 'error'
}
const droppedFiles = ref<DroppedFile[]>([])

// === 接收端状态定义 ===
const receiveStatus = ref<'idle' | 'receiving' | 'done' | 'error'>('idle')
const receiveError = ref<string | null>(null)
const currentReceivingFile = ref<{ name: string, size: number, receivedSize: number } | null>(null)
const receiveProgress = ref(0)
const receiveSpeed = ref('0 B/s')
let internalReceivedSize = 0
const receivedFiles = ref<{ name: string, size: number, timestamp: number }[]>([])

// === 身份与信任管理 ===
// 从 localStorage 读取或生成新身份
const myDeviceId = ref(localStorage.getItem('instadrop_did') || generateUUID())
const myDeviceName = ref(localStorage.getItem('instadrop_dname') || '未命名设备-' + Math.floor(Math.random() * 1000))

// === 信任设备列表 ===
const trustedDevices = ref<TrustedDevice[]>(JSON.parse(localStorage.getItem('instadrop_trusted') || '[]'))

// === 网络层对象定义 ===
let socket: Socket | null = null
let peerConnection: RTCPeerConnection | null = null
let dataChannel: RTCDataChannel | null = null
let pendingCandidates: RTCIceCandidateInit[] = []
let transferRequestResolver: ((value: boolean | string) => void) | null = null
let httpReadyResolver: ((url: string) => void) | null = null
let httpDoneResolver: (() => void) | null = null
// 获取房间码防抖
let lastAutoCreateTime = 0
// WebRTC watchdog
let watchdogTimer: ReturnType<typeof setTimeout> | null = null

const clearWatchdog = () => {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
    watchdogTimer = null
  }
}

const startWatchdog = (timeoutMs = 10000) => {
  clearWatchdog() // 启动前先清理旧的
  watchdogTimer = setTimeout(() => {
    console.error('[Watchdog] WebRTC 连接超时 (ICE Blackhole)')
    connectionError.value = '建立WebRTC连接超时！请检查双方是否开启了 VPN、代理或处于严格的局域网中。'

    // 主动掐断卡死的连接
    handleDisconnect('连接超时')
  }, timeoutMs)
}

// 监听变动并持久化
watch(myDeviceId, (val) => localStorage.setItem('instadrop_did', val), { immediate: true })
watch(myDeviceName, (val) => localStorage.setItem('instadrop_dname', val), { immediate: true })
watch(trustedDevices, (val) => localStorage.setItem('instadrop_trusted', JSON.stringify(val)), { deep: true, immediate: true })

// 生成 UUID 的简易函数
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// 定义信任设备的结构
export interface TrustedDevice {
  id: string
  name: string
  lastConnected: number
  remark?: string
  isOnline?: boolean // 运行时状态，不存库
}

// === 方法 ===
const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const getRTCConfig = (): RTCConfiguration => {
  const stunUrl = localStorage.getItem('instadrop_stun_url') || 'stun:stun.hitv.com:3478'
  const turnUrl = localStorage.getItem('instadrop_turn_url') || ''
  const turnUser = localStorage.getItem('instadrop_turn_user') || ''
  const turnPass = localStorage.getItem('instadrop_turn_pass') || ''

  const servers: RTCIceServer[] = []

  // 压入 STUN
  if (stunUrl) servers.push({ urls: stunUrl })

  // 压入 TURN (如果有配置)
  if (turnUrl) {
    const turnServer: RTCIceServer = { urls: turnUrl }
    if (turnUser) turnServer.username = turnUser
    if (turnPass) turnServer.credential = turnPass
    servers.push(turnServer)
  }

  return { iceServers: servers }
}

// 初始化信任设备在线状态
trustedDevices.value.forEach(d => d.isOnline = false)

// === 身份管理方法 ===
const regenerateDeviceId = () => {
  myDeviceId.value = generateUUID()
  trustedDevices.value = [] // 重置信任设备列表
  disconnectServer()
  setTimeout(() => connectToServer(true), 500) // 重连以更新服务器记录
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
  checkOnlineStatus() // 立即检查新设备的在线状态
}

const updateDeviceRemark = (id: string, remark: string) => {
  const exists = trustedDevices.value.find(d => d.id === id)
  if (exists) {
    exists.remark = remark
    if (connectedPeerId.value === id) {
      connectedPeerName.value = remark || exists.name
    }
  }
}

const removeTrustedDevice = (id: string) => {
  console.log('im here')
  if ((dataChannel?.readyState === 'open') && id === connectedPeerId.value) {
    console.log('无法移除正在连接的设备')
    return
  }
  console.log("test")
  trustedDevices.value = trustedDevices.value.filter(d => d.id !== id)
}

// === 传输控制方法 (保持不变) ===
const resetTransfer = () => {
  fileProgress.value = 0
  currentFile.value = null
  sendStatus.value = { status: 'idle' }
  isCancelled.value = false
  transferSpeed.value = '0 B/s'
  droppedFiles.value = []
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

const setupDataChannel = (channel: RTCDataChannel) => {
  // only used for signalling now
  const onChannelOpen = () => {
    console.log('P2P 通道打通！ (signaling ready)')
    channel.send(JSON.stringify({
      type: 'identity-handshake',
      id: myDeviceId.value,
      name: myDeviceName.value
    }))
  }

  channel.onopen = onChannelOpen
  if (channel.readyState === 'open') onChannelOpen()

  channel.onmessage = (e) => {
    try {
      const data = e.data
      const msg = typeof data === 'string' ? JSON.parse(data) : null
      if (!msg) return

      if (msg.type === 'request-transfer') {
        const isBusy = receiveStatus.value === 'receiving' ||
          sendStatus.value.status === 'sending' ||
          sendStatus.value.status === 'paused'
        channel.send(JSON.stringify({ type: 'response-transfer', accepted: !isBusy, reason: isBusy ? '对方设备正忙' : undefined }))
        return
      }

      if (msg.type === 'response-transfer') {
        if (transferRequestResolver) {
          if (msg.accepted) transferRequestResolver(true)
          else transferRequestResolver(msg.reason)
          transferRequestResolver = null
        }
        return
      }

      if (msg.type === 'identity-handshake') {
        addTrustedDevice(msg.id, msg.name)
        connectedPeerId.value = msg.id
        connectedPeerName.value = msg.name
        const existingDevice = trustedDevices.value.find(d => d.id === msg.id)
        if (existingDevice && existingDevice.remark) connectedPeerName.value = existingDevice.remark
        isP2PReady.value = true
        return
      }

      // Receiver: meta indicates incoming transfer. handleFileMeta will start HTTP server and reply http-ready
      if (msg.type === 'meta') {
        handleFileMeta({ name: msg.name, size: msg.size })
        return
      }

      // Sender: when remote announces its HTTP endpoint
      if (msg.type === 'http-ready') {
        if (httpReadyResolver) {
          httpReadyResolver(msg.url)
          httpReadyResolver = null
        }
        return
      }

      // When receiver notifies upload saved & done
      if (msg.type === 'http-done') {
        if (httpDoneResolver) {
          httpDoneResolver()
          httpDoneResolver = null
        }
        return
      }

    } catch (err) {
      console.error('信令解析失败', err)
    }
  }

  channel.onclose = () => handleDisconnect('通道关闭')
  channel.onerror = () => handleDisconnect('通道错误')
}

const handleDisconnect = (reason: string) => {
  console.log('正在处理连接断开:', reason)
  clearWatchdog()
  isP2PReady.value = false
  receivedFiles.value = []
  connectedPeerId.value = null
  connectedPeerName.value = null
  currentRoomId.value = null
  pendingCandidates = []
  if (dataChannel) {
    dataChannel.onclose = null // 移除监听，防止触发死循环
    dataChannel.onerror = null
    dataChannel.close()
    dataChannel = null
  }
  if (peerConnection) {
    peerConnection.oniceconnectionstatechange = null
    peerConnection.close()
    peerConnection = null
  }

  roomCode.value = ''
  if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
    sendStatus.value = { status: 'error', message: reason }
    transferSpeed.value = '0 B/s'
  }
  if (receiveStatus.value === 'receiving') {
    receiveStatus.value = 'error'
    receiveError.value = `传输意外中断: ${reason}` // 记录错误原因
    receiveSpeed.value = '0 B/s'

    // 强制关闭文件流，防止文件被锁定
    window.myElectronAPI?.finishReceiveFile().catch(err => console.error(err))
  }

  if (isDefaultHost.value) {
    const now = Date.now()

    // 🔥 终极修复：节流 (Throttle)。如果距离上次自动建房还不到 2 秒，说明是滞后的重复警告，直接忽略！
    if (now - lastAutoCreateTime > 2000) {
      lastAutoCreateTime = now
      roomCode.value = '获取中...' // 让发送端的 UI 立刻给出反馈，不要闪烁成空白

      setTimeout(() => {
        if (socket && socket.connected && !isP2PReady.value) {
          console.log('[handleDisconnect] 重新创建房间')
          createRoom()
        }
      }, 50)
    } else {
      console.log('[handleDisconnect] 忽略极短时间内的重复断开警告')
    }
  }
}

// 主动断开当前的 P2P 对等连接，并重新申请新房间
const disconnectPeer = () => {
  if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
    isCancelled.value = true
  }

  handleDisconnect('已主动断开连接')
}

// 刷新房间方法
const refreshShareCode = () => {
  console.log('正在刷新取件码...')
  roomCode.value = '获取中'
  if (isP2PReady.value) {
    console.log('正在断开当前连接以刷新取件码...')
    disconnectPeer() // 先断开当前连接
  } else {
    if (socket && socket.connected) {
      createRoom()
      // 服务端逻辑通常是：同一个 Socket ID 再发 create-room，会销毁旧房间并创建新房间
    } else {
      // 如果没连上，尝试重连并创建房间
      connectToServer(true)
    }
  }

}

const disconnectServer = () => {
  if (socket) socket.disconnect()
  isConnected.value = false
  isP2PReady.value = false
  connectedPeerId.value = null
  roomCode.value = ''
  currentRoomId.value = null
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

// === 连接管理 ===
// === 核心信令逻辑 ===
const connectToServer = (createRoomStat?: boolean) => {
  if (Capacitor.isNativePlatform() && (window as any).networkinterface) {
    (window as any).networkinterface.getWiFiIPAddress(
      (ipInfo: any) => {
        console.log('成功获取手机真实局域网 IP:', ipInfo.ip)
        myRealIP.value = ipInfo.ip
      },
      (err: any) => console.log('📶 获取局域网 IP 失败 (可能未连 Wi-Fi):', err)
    )
  }
  // 动态读取信令服务器地址
  const signalingUrl = localStorage.getItem('instadrop_signaling_url') || 'http://localhost:3000' // !! dev temp

  // 连接你的 Node 服务器
  socket = io(signalingUrl, {
    transports: ['websocket'],
    upgrade: false,
    reconnectionAttempts: 1,
    reconnectionDelay: 2000
  })

  socket.on('join-error', (msg: string) => {
    console.error('加入房间失败:', msg)
    connectionError.value = `加入房间失败: ${msg}`

    roomCode.value = ''
  })

  socket.on('connect', async () => {
    isConnected.value = true
    // 连上后立即上报身份
    socket?.emit('device-online', {
      deviceId: myDeviceId.value,
      deviceName: myDeviceName.value
    })

    connectionError.value = ''

    console.log(createRoomStat, 'createRoomStat')
    // 判断是否自动创建房间，由用户按需触发
    if (createRoomStat) {
      console.log('连接后自动创建房间...')
      createRoom()
    }
    // 启动心跳检查：查询信任设备的在线状态
    checkOnlineStatus()
  })

  socket.on('disconnect', (reason) => {
    console.log('❌ 与信令服务器断开连接，原因:', reason)
    isConnected.value = false

    if (reason === 'io server disconnect') {
      socket?.connect()
    }
    if (reason !== 'io client disconnect') {
      connectionError.value = `服务器连接已断开 (${reason})`
    }
    // 不要清空 P2P 相关的状态 (isP2PReady)，因为如果是直连传文件，
    // 信令服务器断了，P2P 连接还活着
    roomCode.value = ''
    trustedDevices.value.forEach(d => d.isOnline = false)
  })

  socket.on('connect_error', (error) => {
    console.log('⚠️ 连接信令服务器失败:', error.message)
    connectionError.value = '连接信令服务器失败：' + error.message
    isConnected.value = false
    trustedDevices.value.forEach(d => d.isOnline = false)
  })

  socket.on('room-created', (code: string) => {
    roomCode.value = code
    currentRoomId.value = code
  })

  // === 新增：处理无感直连请求 ===
  socket.on('direct-connection-ready', ({ roomId, role, peerDeviceId, peerDeviceName }) => {
    console.log(`[Direct] 收到直连请求，房间: ${roomId}, 角色: ${role}`)
    isHostRole.value = (role === 'host')
    roomCode.value = '加密直连' // UI 显示
    currentRoomId.value = roomId // 记录当前真实房间 ID
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

    if (payload.type === 'offer') {
      // 如果接收方收到 Offer 时发现还没有对等连接，则立刻初始化
      if (!peerConnection) {
        await startWebRTC(false, currentRoomId.value!)
      }
      await peerConnection!.setRemoteDescription(new RTCSessionDescription(payload.offer))
      const answer = await peerConnection!.createAnswer()
      await peerConnection!.setLocalDescription(answer)
      socket?.emit('signal', { roomCode: currentRoomId.value, payload: { type: 'answer', answer: answer } })
      for (const candidate of pendingCandidates) {
        await peerConnection!.addIceCandidate(new RTCIceCandidate(candidate))
      }
      pendingCandidates = []
    }
    else if (payload.type === 'answer') {
      if (!peerConnection) return // 如果是 answer，必须有 peerConnection
      await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer))
      // Answer 处理完毕后，消费积压的 Candidate
      for (const candidate of pendingCandidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      }
      pendingCandidates = []
    }
    else if (payload.type === 'candidate') {
      if (!peerConnection) return // 如果是 candidate，必须有 peerConnection
      if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        // 如果准备好了，直接添加
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
      } else {
        // 如果没准备好（说明 Candidate 比 Offer/Answer 先到了），就先塞进暂存队列
        console.log('Candidate 提前到达，暂存进队列...')
        pendingCandidates.push(payload.candidate)
      }
    }
  })

  socket.on('peer-disconnected', () => {
    handleDisconnect('对方断开连接')
  })
}

// 主动创建房间 (Send.vue 调用)
const createRoom = () => {
  if (socket && socket.connected) {
    isHostRole.value = true
    isDefaultHost.value = true
    socket.emit('create-room')
  }
}

// 主动加入房间 (Receive.vue 调用)
const joinRoom = (code: string) => {
  if (!code || code.length !== 6) return alert('请输入 6 位取件码')
  if (socket && socket.connected) {
    isHostRole.value = false
    isDefaultHost.value = false
    roomCode.value = code
    currentRoomId.value = code
    socket.emit('join-room', code)
  } else {
    alert('未连接服务器')
  }
}


// 封装 WebRTC 启动逻辑 (复用)
const startWebRTC = async (isPolite: boolean, roomId: string) => {
  isP2PReady.value = false
  peerConnection = new RTCPeerConnection(getRTCConfig())

  startWatchdog(10000) //10s超时

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection?.iceConnectionState
    console.log('[物理层状态]:', state)
    if (state === 'connected' || state === 'completed') {
      clearWatchdog()

      peerConnection?.getStats().then(stats => {
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          console.log('[ICE] Active pair:', JSON.stringify(report))
        }
        if (report.type === 'local-candidate') {
          console.log('[ICE] Local candidate type:', report.candidateType, report.address)
        }
      })
    })
    }
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      handleDisconnect('连接断开')
      clearWatchdog()
    }
  }

  if (isPolite) {
    // 我是发送方 (Host)：主动创建通道
    dataChannel = peerConnection.createDataChannel('instadrop-file', {
      ordered: false,
      maxRetransmits: 0
    })
    setupDataChannel(dataChannel)
  } else {
    // 我是接收方 (Client)：等待对方创建通道
    peerConnection.ondatachannel = (event) => {
      console.log('收到对方建立的数据通道')
      dataChannel = event.channel
      setupDataChannel(dataChannel)
    }
  }

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      let candidateString = event.candidate.candidate
      if (myRealIP.value && candidateString.includes('.local')) {
        console.log(`[WebRTC Hack] 拦截到虚拟 mDNS 地址，正在替换: ${myRealIP.value}`)
        candidateString = candidateString.replace(/[0-9a-zA-Z\-]+\.local/g, myRealIP.value)
      }
      const hackedCandidate = {
        candidate: candidateString,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex
      }

      socket?.emit('signal', {
        roomCode: roomId,
        payload: { type: 'candidate', candidate: hackedCandidate }
      })
    } else {
      console.log('所有 ICE Candidate 收集完毕')
    }
  }

  if (isPolite) {
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    socket?.emit('signal', { roomCode: roomId, payload: { type: 'offer', offer: offer } })
  }
}

// === 接收逻辑 ===
let lastReceiveTime = Date.now()
let lastReceiveOffset = 0

const handleFileMeta = async (meta: { name: string, size: number }) => {
  // reset counters & UI
  internalReceivedSize = 0
  receiveStatus.value = 'receiving'
  currentReceivingFile.value = { name: meta.name, size: meta.size, receivedSize: 0 }
  receiveProgress.value = 0
  receiveSpeed.value = '0 B/s'

  // Start a local HTTP server depending on platform. After server is started, send http-ready via dataChannel so sender can POST file.
  let localUrl: string | null = null
  try {
    if (isElectron()) {
      const savedPath = localStorage.getItem('instadrop_save_path')
      const targetPath = (savedPath && savedPath !== '默认 (下载/Instadrop)') ? savedPath : undefined
      const res = await window.myElectronAPI.startReceiveServer(targetPath)
      localUrl = (res && (res as any).url) || (res as any)
      // subscribe to progress/done
      const unsubProgress = window.myElectronAPI.onReceiveProgress((chunkLen: number) => {
        internalReceivedSize += chunkLen
        const now = Date.now()
        if (currentReceivingFile.value) {
          currentReceivingFile.value.receivedSize = internalReceivedSize
          receiveProgress.value = Number(((internalReceivedSize / currentReceivingFile.value.size) * 100).toFixed(2))
        }
        if (now - lastReceiveTime >= 500) {
          const speed = ((internalReceivedSize - lastReceiveOffset) / (now - lastReceiveTime)) * 1000
          receiveSpeed.value = formatSpeed(speed)
          lastReceiveTime = now
          lastReceiveOffset = internalReceivedSize
        }
      })
      const unsubDone = window.myElectronAPI.onReceiveDone((filePath: string) => {
        // notify sender that file saved
        dataChannel?.send(JSON.stringify({ type: 'http-done', path: filePath }))
        // cleanup listeners
        unsubProgress()
        unsubDone()
        receiveStatus.value = 'done'
        receiveProgress.value = 100
        receiveSpeed.value = '0 B/s'
        if (currentReceivingFile.value) {
          receivedFiles.value.push({ name: currentReceivingFile.value.name, size: currentReceivingFile.value.size, timestamp: Date.now() })
        }
      })
    } else if (Capacitor.isNativePlatform()) {
      // PSEUDOCODE: attempt to start an embedded HTTP server plugin on mobile
      // This requires adding a plugin such as cordova-plugin-httpd or @ionic-native/httpd.
      // Example pseudo:
      /*
      const httpd = (window as any).cordovaHTTPD || (window as any).httpd
      if (!httpd) throw new Error('请在移动端安装 cordova-plugin-httpd 或 @ionic-native/httpd，并重建应用')
      const startInfo = await httpd.startServer({ www_root: '', port: 8080, localhost_only: false })
      localUrl = `http://${myRealIP.value || '127.0.0.1'}:${startInfo.port}`
      // then use plugin events or simple server-side handlers to stream to filesystem and update progress/done
      */
      throw new Error('移动端本地 HTTP Server 未实现。请安装 cordova-plugin-httpd 或 @ionic-native/httpd 并实现启动逻辑。')
    } else {
      // Browser (unlikely as receiver) — fallback to error
      throw new Error('当前环境不支持作为接收端启动本地 HTTP Server')
    }

    // notify sender that HTTP endpoint is ready
    if (localUrl && dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'http-ready', url: localUrl }))
    }
  } catch (err: any) {
    console.error('启动接收服务器失败', err)
    receiveStatus.value = 'error'
    receiveError.value = err?.message || String(err)
  }
}


// 去掉 new Promise 包装，直接声明 async 函数
const sendFile = async (fileOrPath: string | File): Promise<void> => {
  const channel = dataChannel
  if (!channel || channel.readyState !== 'open') {
    throw new Error('P2P 通道未打开')
  }

  try {
    isCancelled.value = false
    if (receiveStatus.value === 'receiving') throw new Error('本地正在接收文件，无法同时发送')
    sendStatus.value = { status: 'idle', message: '正在等待对方确认...' }
    const canSend = await new Promise<boolean | string>((resolve) => {
      transferRequestResolver = resolve
      dataChannel!.send(JSON.stringify({ type: 'request-transfer' }))
      setTimeout(() => {
        if (transferRequestResolver) {
          transferRequestResolver('请求对方状态超时，请检查网络')
          transferRequestResolver = null
        }
      }, 5000)
    })
    if (canSend !== true) {
      sendStatus.value = { status: 'error', message: canSend as string }
      throw new Error(canSend as string)
    }

    // gather metadata
    let name = ''
    let size = 0
    if (isElectron() && typeof fileOrPath === 'string') {
      const info = await window.myElectronAPI.getFileInfo(fileOrPath)
      name = info.name
      size = info.size
    } else if (fileOrPath instanceof File) {
      name = fileOrPath.name
      size = fileOrPath.size
    } else {
      throw new Error('无效的文件输入')
    }
    currentFile.value = { name, size }

    // send meta
    channel.send(JSON.stringify({ type: 'meta', name, size }))

    // Wait for receiver to start its HTTP server and announce URL (http-ready)
    const httpUrl = await new Promise<string>((resolve) => {
      httpReadyResolver = resolve
      setTimeout(() => {
        if (httpReadyResolver) {
          httpReadyResolver = null
          // timeout — resolve with empty string to allow fallback
          resolve('')
        }
      }, 15000)
    })

    if (!httpUrl) {
      const msg = '对方未能提供有效的 HTTP 地址 (http-ready 超时或失败)'
      console.error(msg)
      sendStatus.value = { status: 'error', message: msg }
      throw new Error(msg)
    }

    // Perform upload: prefer XHR on browser/Capacitor for progress; use main-process helper on Electron path-based files
    sendStatus.value = { status: 'sending', message: `正在上传 ${name}` }
    fileProgress.value = 0
    transferSpeed.value = '计算中...'

    if (fileOrPath instanceof File) {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        try {
          xhr.open('POST', `${httpUrl}/upload`)
        } catch (err: any) {
          console.error('XHR open failed', err)
          return reject(new Error('无效的目标 URL: ' + String(err.message || err)))
        }
        xhr.setRequestHeader('x-filename', encodeURIComponent(name))
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            fileProgress.value = Number(((e.loaded / e.total) * 100).toFixed(1))
          } else {
            if (size > 0) fileProgress.value = Number(((e.loaded / size) * 100).toFixed(1))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else {
            const errMsg = `上传失败: ${xhr.status} ${xhr.statusText || ''} ${xhr.responseText || ''}`
            console.error(errMsg)
            reject(new Error(errMsg))
          }
        }
        xhr.onerror = () => {
          const errMsg = `XHR 上传错误: status=${xhr.status} statusText=${xhr.statusText}`
          console.error(errMsg)
          reject(new Error(errMsg))
        }
        xhr.send(fileOrPath)
      })
    } else {
      // Electron: fileOrPath is local file path string
      try {
        await window.myElectronAPI.uploadFileToUrl(fileOrPath as string, httpUrl)
      } catch (err: any) {
        const errMsg = 'Electron 上传失败: ' + (err?.message || String(err))
        console.error(errMsg, err)
        sendStatus.value = { status: 'error', message: errMsg }
        throw new Error(errMsg)
      }
    }

    // Wait for receiver to confirm save (http-done via dataChannel)
    try {
      await new Promise<void>((resolve) => {
        httpDoneResolver = resolve
        setTimeout(() => {
          if (httpDoneResolver) {
            httpDoneResolver = null
            // not fatal: upload done on our side, but receiver didn't ack in time
            resolve()
          }
        }, 15000)
      })
    } catch { /* ignore */ }

    sendStatus.value = { status: 'done', message: `文件 ${name} 发送完成` }
    transferSpeed.value = '0 B/s'
  } catch (err: any) {
    console.error('sendFile error:', err)
    if (isCancelled.value) {
      resetTransfer()
    } else {
      const errorMsg = err?.message || String(err) || '未知错误'
      sendStatus.value = { status: 'error', message: `传输异常：${errorMsg}` }
      transferSpeed.value = '0 B/s'
    }
    throw err
  }
}

export function useWebRTC() {
  return {
    // 基础状态
    roomCode, isConnected, isP2PReady,
    // 传输状态
    fileProgress, currentFile, sendStatus,
    // 接收状态
    receiveStatus, currentReceivingFile, receiveProgress, receiveSpeed, receivedFiles,
    // 身份数据
    myDeviceId, myDeviceName, trustedDevices, connectedPeerId, connectedPeerName,
    // 方法
    connectToServer, disconnectServer,
    regenerateDeviceId, updateDeviceName,
    addTrustedDevice, removeTrustedDevice, connectToDevice, disconnectPeer, updateDeviceRemark,
    createRoom, joinRoom, refreshShareCode, droppedFiles,
    // 传输控制
    sendFile, resetTransfer, pauseTransfer, resumeTransfer, cancelTransfer, transferSpeed,
    // 连接错误信息
    connectionError, receiveError
  }
}