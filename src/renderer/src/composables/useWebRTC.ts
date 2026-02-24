import { ref, watch } from 'vue'
import { io, Socket } from 'socket.io-client'
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

// === 接收端状态定义 ===
const receiveStatus = ref<'idle' | 'receiving' | 'done' | 'error'>('idle')
const currentReceivingFile = ref<{ name: string, size: number, receivedSize: number } | null>(null)
const receiveProgress = ref(0)
const receiveSpeed = ref('0 B/s')

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

// 监听变动并持久化
watch(myDeviceId, (val) => localStorage.setItem('instadrop_did', val))
watch(myDeviceName, (val) => localStorage.setItem('instadrop_dname', val))
watch(trustedDevices, (val) => localStorage.setItem('instadrop_trusted', JSON.stringify(val)), { deep: true })

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
  channel.onopen = () => {
    console.log('P2P 通道打通！')
    isP2PReady.value = true
    channel.send(JSON.stringify({
      type: 'identity-handshake',
      id: myDeviceId.value,
      name: myDeviceName.value
    }))
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
      if (msg.type === 'identity-handshake') {
        console.log('收到身份握手:', msg.name)
        addTrustedDevice(msg.id, msg.name)
        connectedPeerId.value = msg.id // 记录当前连接的设备 ID
        connectedPeerName.value = msg.name // 记录当前连接的设备名称
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
  isP2PReady.value = false
  connectedPeerId.value = null
  connectedPeerName.value = null
  if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
    sendStatus.value = { status: 'error', message: reason }
    transferSpeed.value = '0 B/s'
  }
}

// 主动断开当前的 P2P 对等连接，并重新申请新房间
const disconnectPeer = () => {
  if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
    isCancelled.value = true
  }

  // 关闭 WebRTC 连接和数据通道
  if (dataChannel) {
    dataChannel.close()
    dataChannel = null
  }
  if (peerConnection) {
    peerConnection.close()
    peerConnection = null
  }

  handleDisconnect('已主动断开连接')
}

// 刷新房间方法
const refreshShareCode = () => {
  console.log('正在刷新取件码...')
  if (isP2PReady.value) {
    console.log('正在断开当前连接以刷新取件码...')
    disconnectPeer() // 先断开当前连接
  }
  roomCode.value = '获取中'

  if (socket && socket.connected) {
    socket.emit('create-room')
    // 服务端逻辑通常是：同一个 Socket ID 再发 create-room，会销毁旧房间并创建新房间
  } else {
    // 如果没连上，尝试重连并创建房间
    connectToServer(true)
  }
}

const disconnectServer = () => {
  if (socket) socket.disconnect()
  isConnected.value = false
  isP2PReady.value = false
  connectedPeerId.value = null
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

// === 连接管理 ===
// === 核心信令逻辑 ===
const connectToServer = (createRoomStat?: boolean) => {
  // 动态读取信令服务器地址
  const signalingUrl = localStorage.getItem('instadrop_signaling_url') || 'http://localhost:3000' // !! dev temp

  // 连接你的 Node 服务器
  socket = io(signalingUrl, {
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
        await startWebRTC(false, roomCode.value)
      }
      await peerConnection!.setRemoteDescription(new RTCSessionDescription(payload.offer))
      const answer = await peerConnection!.createAnswer()
      await peerConnection!.setLocalDescription(answer)
      socket?.emit('signal', { roomCode: roomCode.value, payload: { type: 'answer', answer: answer } })
    }
    else if (payload.type === 'answer') {
      if (!peerConnection) return // 如果是 answer，必须有 peerConnection
      await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer))
    }
    else if (payload.type === 'candidate') {
      if (!peerConnection) return // 如果是 candidate，必须有 peerConnection
      await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
    }
  })

  socket.on('peer-disconnected', () => {
    handleDisconnect('对方断开连接')
  })
}

// 主动创建房间 (Send.vue 调用)
const createRoom = () => {
  if (socket && socket.connected) {
    socket.emit('create-room')
  }
}

// 主动加入房间 (Receive.vue 调用)
const joinRoom = (code: string) => {
  if (!code || code.length !== 6) return alert('请输入 6 位取件码')
  if (socket && socket.connected) {
    roomCode.value = code // 暂时记录
    socket.emit('join-room', code)
  } else {
    alert('未连接服务器')
  }
}


// 封装 WebRTC 启动逻辑 (复用)
const startWebRTC = async (isPolite: boolean, roomId: string) => {
  isP2PReady.value = false
  peerConnection = new RTCPeerConnection(getRTCConfig())

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection?.iceConnectionState
    console.log('[物理层状态]:', state)
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      handleDisconnect('连接断开')
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

  peerConnection.onicecandidate = (event) => { /* ... */ }

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
  
  // 调用 Electron 主进程：创建一个新文件写入流
  await window.myElectronAPI?.startReceiveFile(meta.name, meta.size)
}

const handleFileChunk = async (chunk: ArrayBuffer) => {
  if (!currentReceivingFile.value) return
  
  // 更新进度
  const chunkSize = chunk.byteLength
  currentReceivingFile.value.receivedSize += chunkSize
  receiveProgress.value = (currentReceivingFile.value.receivedSize / currentReceivingFile.value.size) * 100
  
  // 调用 Electron 主进程：追加写入数据
  await window.myElectronAPI?.receiveFileChunk(chunk)

  // 计算速度 (每 500ms 更新一次 UI)
  const now = Date.now()
  if (now - lastReceiveTime >= 500) {
    const speed = ((currentReceivingFile.value.receivedSize - lastReceiveOffset) / (now - lastReceiveTime)) * 1000
    receiveSpeed.value = formatSpeed(speed)
    lastReceiveTime = now
    lastReceiveOffset = currentReceivingFile.value.receivedSize
  }
}

const handleFileTransferDone = async () => {
  receiveStatus.value = 'done'
  receiveSpeed.value = '0 B/s'
  receiveProgress.value = 100
  // 调用 Electron 主进程：关闭文件流
  await window.myElectronAPI?.finishReceiveFile()
}

// 去掉 new Promise 包装，直接声明 async 函数
const sendFile = async (filePath: string): Promise<void> => {
  // 2. 检查前置条件
  const channel = dataChannel
  if (!channel || channel.readyState !== 'open') {
    throw new Error('P2P 通道未打开') // 直接 throw，会被下面的 catch 捕获
  }

  try {
    isCancelled.value = false
    const { name, size } = await window.myElectronAPI.getFileInfo(filePath)
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
      if (channel.bufferedAmount > 1024 * 1024) {
        await new Promise(r => setTimeout(r, 50))
        continue
      }

      const chunk = await window.myElectronAPI.readFileChunk(filePath, offset, chunkSize)

      // 发送前最后一次检查
      if (channel.readyState !== 'open' || isCancelled.value) {
        if (isCancelled.value) throw new Error('传输已被手动终止')
        throw new Error('disconnected')
      }

      channel.send(chunk as any)
      offset += chunk.length
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
    receiveStatus, currentReceivingFile, receiveProgress, receiveSpeed,
    // 身份数据
    myDeviceId, myDeviceName, trustedDevices, connectedPeerId, connectedPeerName,
    // 方法
    connectToServer, disconnectServer,
    regenerateDeviceId, updateDeviceName,
    addTrustedDevice, removeTrustedDevice, connectToDevice, disconnectPeer, updateDeviceRemark,
    createRoom, joinRoom, refreshShareCode,
    // 传输控制
    sendFile, resetTransfer, pauseTransfer, resumeTransfer, cancelTransfer, transferSpeed,
    // 连接错误信息
    connectionError
  }
}