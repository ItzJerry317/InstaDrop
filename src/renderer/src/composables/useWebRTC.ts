import { ref, watch } from 'vue'
import { io, Socket } from 'socket.io-client'
import { isElectron } from '../utils/platform'
import { Filesystem, Directory } from '@capacitor/filesystem'
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
let lastUIUpdateTime = 0
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
let eofResolver: (() => void) | null = null
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
  channel.bufferedAmountLowThreshold = 1 * 1024 * 1024
  // 通用onChannelOpen函数
  const onChannelOpen = () => {
    console.log('P2P 通道打通！')
    // isP2PReady.value = true

    // 发送身份握手
    channel.send(JSON.stringify({
      type: 'identity-handshake',
      id: myDeviceId.value,
      name: myDeviceName.value
    }))
  }

  // 针对较慢建立的连接，正常绑定
  channel.onopen = onChannelOpen

  // 如果当前通道状态已经是 open，手动触发一次，修复有时虽然通道已打开但不能更新ui状态的bug
  // (针对接收端，往往收到通道时已经是 open 状态)
  if (channel.readyState === 'open') {
    onChannelOpen()
  }

  channel.onmessage = (e) => {
    const data = e.data

    // 1. 处理二进制数据 (文件切片)
    if (data instanceof ArrayBuffer) {
      handleFileChunk(data)
      return
    }

    try {
      // 这里处理握手消息，如果收到 identity-handshake，就存入信任列表
      const msg = JSON.parse(e.data as string)
      if (msg.type === 'request-transfer') {
        // 检查本地是否正在收/发文件
        const isBusy = receiveStatus.value === 'receiving' ||
          sendStatus.value.status === 'sending' ||
          sendStatus.value.status === 'paused'

        if (isBusy) {
          channel.send(JSON.stringify({ type: 'response-transfer', accepted: false, reason: '对方设备正忙 (正在传输其他文件)，请稍后再试' }))
        } else {
          channel.send(JSON.stringify({ type: 'response-transfer', accepted: true }))
        }
        return
      }
      if (msg.type === 'response-transfer') {
        if (transferRequestResolver) {
          if (msg.accepted) {
            transferRequestResolver(true)
          } else {
            transferRequestResolver(msg.reason)
          }
          transferRequestResolver = null
        }
        return
      }
      if (msg.type === 'eof-ack') {
        console.log('收到eof-ack')
        if (eofResolver) {
          eofResolver()
          eofResolver = null
        }
        return
      }
      if (msg.type === 'identity-handshake') {
        console.log('收到身份握手:', msg.name)
        addTrustedDevice(msg.id, msg.name)
        connectedPeerId.value = msg.id // 记录当前连接的设备 ID
        connectedPeerName.value = msg.name // 记录当前连接的设备名称

        // 如果有备注，就用备注
        const existingDevice = trustedDevices.value.find(d => d.id === msg.id)
        if (existingDevice && existingDevice.remark) {
          connectedPeerName.value = existingDevice.remark
        } else {
          connectedPeerName.value = msg.name
        }

        isP2PReady.value = true
      }
      else if (msg.type === 'meta') {
        // 收到文件头 准备接收
        console.log('收到文件发送请求:', msg.name, msg.size)
        handleFileMeta(msg)
      }
      else if (msg.type === 'eof') {
        // 收到结束符 接收完成
        console.log('文件接收完成')
        handleFileTransferDone()
      }
    } catch (err) {
      console.error('消息解析失败', err)
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
    }
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      handleDisconnect('连接断开')
      clearWatchdog()
    }
  }

  if (isPolite) {
    // 我是发送方 (Host)：主动创建通道
    dataChannel = peerConnection.createDataChannel('instadrop-file')
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
let writeQueuePromise = Promise.resolve()

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

const handleFileMeta = async (meta: { name: string, size: number }) => {
  // 重置内部计数器
  internalReceivedSize = 0
  lastUIUpdateTime = 0

  // 更新 UI 状态
  receiveStatus.value = 'receiving'
  currentReceivingFile.value = {
    name: meta.name,
    size: meta.size,
    receivedSize: 0
  }
  receiveProgress.value = 0
  receiveSpeed.value = '0 B/s'

  // 重置速度计算器
  lastReceiveTime = Date.now()
  lastReceiveOffset = 0

  // 重置接收队列
  writeQueuePromise = (async () => {
    if (isElectron()) {
      const savedPath = localStorage.getItem('instadrop_save_path')
      const targetPath = (savedPath && savedPath !== '默认 (下载/Instadrop)') ? savedPath : undefined
      await window.myElectronAPI?.startReceiveFile(meta.name, meta.size, targetPath)
    } else {
      try {
        const savedPath = localStorage.getItem('instadrop_save_path') || 'Instadrop'
        const mobileDir = (savedPath === '默认 (下载/Instadrop)') ? 'Instadrop' : savedPath

        // 🔥 双重保险：显式创建父文件夹 (如果文件夹已存在会抛错，直接 catch 忽略)
        try {
          await Filesystem.mkdir({
            path: mobileDir,
            directory: Directory.Documents,
            recursive: true
          })
        } catch (err) {
          // 忽略目录已存在的错误
        }

        // 等文件夹确保创建完毕后，再写入空文件初始化
        await Filesystem.writeFile({
          path: `${mobileDir}/${meta.name}`,
          data: '',
          directory: Directory.Documents,
          recursive: true
        })
      } catch (e) {
        console.error('初始化手机文件失败:', e)
        receiveStatus.value = 'error'
        receiveError.value = '无法在手机上创建文件'
      }
    }
  })()
}

const handleFileChunk = (chunk: ArrayBuffer) => {
  if (!currentReceivingFile.value) return

  // 更新进度
  const fileName = currentReceivingFile.value.name
  const chunkSize = chunk.byteLength
  internalReceivedSize += chunkSize

  writeQueuePromise = writeQueuePromise.then(async () => {
    if (isElectron()) {
      // 调用 Electron 主进程：追加写入数据
      await window.myElectronAPI?.receiveFileChunk(chunk)
    } else {
      try {
        const savedPath = localStorage.getItem('instadrop_save_path') || 'Instadrop'
        const mobileDir = (savedPath === '默认 (下载/Instadrop)') ? 'Instadrop' : savedPath
        const base64Chunk = arrayBufferToBase64(chunk)
        await Filesystem.appendFile({
          path: `${mobileDir}/${fileName}`,
          data: base64Chunk,
          directory: Directory.Documents
        })
      } catch (e) {
        console.error('手机端追加写入切片失败:', e)
      }
    }
  }).catch(e => console.error('写入队列异常:', e))

  // 计算速度 (每 500ms 更新一次 UI)
  const now = Date.now()
  if (now - lastUIUpdateTime >= 100) {
    // 只有到了时间点，才去碰 Vue 的响应式变量
    currentReceivingFile.value.receivedSize = internalReceivedSize
    receiveProgress.value = (internalReceivedSize / currentReceivingFile.value.size) * 100
    lastUIUpdateTime = now
  }

  // 计算速度 (保持每 500ms 一次，逻辑不变)
  if (now - lastReceiveTime >= 500) {
    const speed = ((internalReceivedSize - lastReceiveOffset) / (now - lastReceiveTime)) * 1000
    receiveSpeed.value = formatSpeed(speed)
    lastReceiveTime = now
    lastReceiveOffset = internalReceivedSize
  }
}

const handleFileTransferDone = async () => {
  await writeQueuePromise
  receiveStatus.value = 'done'
  receiveSpeed.value = '0 B/s'
  receiveProgress.value = 100
  if (currentReceivingFile.value) {
    currentReceivingFile.value.receivedSize = currentReceivingFile.value.size
    receivedFiles.value.push({
      name: currentReceivingFile.value.name,
      size: currentReceivingFile.value.size,
      timestamp: Date.now()
    })
  }

  if (isElectron()) {
    // 调用 Electron 主进程：关闭文件流
    await window.myElectronAPI?.finishReceiveFile()
  } else {
    // 手机端此时已存储完毕 直接关闭即可
    console.log(`文件已完整保存到 Documents/Instadrop/${currentReceivingFile.value?.name}`)
  }
  console.log('存储完毕，正在发送eof-ack')
  dataChannel?.send(JSON.stringify({ type: 'eof-ack' }))
}

// 去掉 new Promise 包装，直接声明 async 函数
const sendFile = async (fileOrPath: string | File): Promise<void> => {
  // 2. 检查前置条件
  const channel = dataChannel
  if (!channel || channel.readyState !== 'open') {
    throw new Error('P2P 通道未打开') // 直接 throw，会被下面的 catch 捕获
  }

  try {
    isCancelled.value = false
    if (receiveStatus.value === 'receiving') {
      throw new Error('本地正在接收文件，无法同时发送')
    }
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
    sendStatus.value = { status: 'sending' }
    // 1. 双端获取文件元数据
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

    channel.send(JSON.stringify({ type: 'meta', name, size }))

    const chunkSize = 64 * 1024
    let offset = 0
    sendStatus.value = { status: 'sending', message: `正在发送 ${name} (${Math.round(size / 1024)} KB)` }

    let lastTime = Date.now()
    let lastOffset = 0
    transferSpeed.value = '计算中...'

    while (offset < size) {
      // 检查取消
      if (isCancelled.value) {
        throw new Error('传输已被手动终止') // 统一用 throw
      }

      // 检查连接
      if (sendStatus.value.status === 'error' || !socket || !socket.connected) {
        throw new Error('disconnected')
      }

      // 暂停逻辑
      while (sendStatus.value.status === 'paused') {
        if (isCancelled.value) break
        if (channel.readyState !== 'open' || !socket || !socket.connected) {
          throw new Error('disconnected')
        }
        transferSpeed.value = '0 B/s'
        await new Promise(r => setTimeout(r, 100))
        lastTime = Date.now()
        lastOffset = offset
      }

      // 再次检查取消（暂停唤醒后）
      if (isCancelled.value) {
        throw new Error('传输已被手动终止')
      }

      // 检查通道
      if (channel.readyState !== 'open') {
        throw new Error('disconnected')
      }

      // 流控
      if (channel.bufferedAmount > 3 * 1024 * 1024) {
        await new Promise<void>((resolve) => {
          channel.onbufferedamountlow = () => {
            clearInterval(watchdog)
            channel.onbufferedamountlow = null
            resolve()
          }

          // 2. 加上“看门狗”轮询：防止事件没触发，或者用户点了取消！
          const watchdog = setInterval(() => {
            if (
              channel.bufferedAmount <= 1 * 1024 * 1024 ||
              isCancelled.value ||
              channel.readyState !== 'open'
            ) {
              clearInterval(watchdog)
              channel.onbufferedamountlow = null
              resolve() // 立刻解除阻塞，让外部的 while 循环去处理取消或断开
            }
          }, 50)
        })
      }

      // 区分环境：读取文件切片
      let chunkData: ArrayBuffer | Uint8Array
      if (isElectron() && typeof fileOrPath === 'string') {
        chunkData = await window.myElectronAPI.readFileChunk(fileOrPath, offset, chunkSize)
      } else if (fileOrPath instanceof File) {
        const blobSlice = fileOrPath.slice(offset, offset + chunkSize)
        chunkData = await blobSlice.arrayBuffer()
      } else {
        throw new Error('读取文件失败')
      }

      if (channel.readyState !== 'open' || isCancelled.value) {
        if (isCancelled.value) throw new Error('传输已被手动终止')
        throw new Error('disconnected')
      }

      // 发送前最后一次检查
      if (channel.readyState !== 'open' || isCancelled.value) {
        if (isCancelled.value) throw new Error('传输已被手动终止')
        throw new Error('disconnected')
      }

      channel.send(chunkData as any)
      offset += chunkData.byteLength
      fileProgress.value = Math.round((offset / size) * 100)

      // 速度计算
      const now = Date.now()
      if (now - lastTime >= 500) {
        const speed = ((offset - lastOffset) / (now - lastTime)) * 1000
        transferSpeed.value = formatSpeed(speed)
        lastTime = now
        lastOffset = offset
      }
    }

    // 完成逻辑
    if (!isCancelled.value && sendStatus.value.status !== 'error') {
      channel.send(JSON.stringify({ type: 'eof' }))
      sendStatus.value = { status: 'sending', message: `等待对方保存文件` }
      try {
        await new Promise<void>((resolve, reject) => {
          eofResolver = resolve
          // 给对方 15 秒的极限硬盘写入时间，防止无限卡死
          const timeoutTimer = setTimeout(() => {
            if (eofResolver) {
              eofResolver = null
              reject(new Error('等待对方保存文件超时'))
            }
          }, 15000)

          eofResolver = () => {
            clearTimeout(timeoutTimer)
            resolve()
          }
        })
      } catch (err) {
        console.warn(err)
      }

      // 等对方完全保存后，再彻底结束当前文件的发送
      sendStatus.value = { status: 'done', message: `文件 ${name} 发送完成` }
      transferSpeed.value = '0 B/s'
    }

  } catch (err: any) {
    if (isCancelled.value) {
      // 场景 A: 断开连接 (保留 Error)
      // 场景 B: 终止传输 (重置 Idle)
      if (sendStatus.value.status !== 'error') {
        resetTransfer()
      }
    } else {
      const errorMsg = err.message === 'disconnected' ? '连接意外断开 (Disconnected)' : (err.message || '未知错误')
      sendStatus.value = { status: 'error', message: `传输异常：${errorMsg}` }
      transferSpeed.value = '0 B/s'
    }

    throw err // 继续向上抛出，以便调用者也能感知
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