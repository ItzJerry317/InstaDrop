import { ref, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'

export function useWebRTC() {
  const roomCode = ref('')
  const isConnected = ref(false)
  const isP2PReady = ref(false) // 核心：P2P 物理通道是否打通
  const fileProgress = ref(0) // 发送进度（0-100）
  const currentFile = ref<{ name: string, size: number } | null>(null) // 当前正在发送的文件信息
  const sendStatus = ref<{ status: 'idle' | 'sending' | 'done' | 'error' | 'paused', message?: string }>({ status: 'idle' }) // 发送状态
  const isCancelled = ref(false) // 取消标志

  let socket: Socket | null = null
  let peerConnection: RTCPeerConnection | null = null
  let dataChannel: RTCDataChannel | null = null

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.hitv.com:3478' }]
  }

  const resetTransfer = () => {
    fileProgress.value = 0
    currentFile.value = null
    sendStatus.value = { status: 'idle' }
    isCancelled.value = false
  }

  const pauseTransfer = () => {
    if (sendStatus.value.status === 'sending') {
      sendStatus.value.status = 'paused'
    }
  }

  const resumeTransfer = () => {
    if (sendStatus.value.status === 'paused') {
      sendStatus.value.status = 'sending'
    }
  }

  const cancelTransfer = () => {
    isCancelled.value = true
    if (sendStatus.value.status === 'paused') {
      sendStatus.value.status = 'sending'
    }
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

    //监听信令层面的意外掉线
    socket.on('peer-disconnected', () => {
      console.log('[WebRTC] 对方已从信令服务器断开')
      isP2PReady.value = false
      if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
        sendStatus.value = { status: 'error', message: '对方已断开连接' }
      }
    })

    socket.on('peer-joined', async () => {
      console.log('[WebRTC] 手机已加入，准备建立直连')
      isP2PReady.value = false
      peerConnection = new RTCPeerConnection(rtcConfig)

      //监控底层物理连接状态，抓取网络级异常断开
      peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection?.iceConnectionState
        console.log('[WebRTC 物理层状态变化]:', state)
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          isP2PReady.value = false
          if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
            sendStatus.value = { status: 'error', message: '对方已断开到WebRTC的连接，请检查网络' }
          }
        }
      }

      dataChannel = peerConnection.createDataChannel('instadrop-file')

      dataChannel.onopen = () => {
        console.log('[WebRTC] 数据通道已完全敞开')
        isP2PReady.value = true
      }

      //抓取 DataChannel 自身的错误和关闭事件
      dataChannel.onerror = (error) => {
        console.error('[WebRTC] 数据通道发生错误:', error)
        if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
          sendStatus.value = { status: 'error', message: 'data_channel_error WebRTC数据通道错误' }
        }
      }

      dataChannel.onclose = () => {
        console.log('[WebRTC] 数据通道已关闭')
        isP2PReady.value = false
        if (sendStatus.value.status === 'sending' || sendStatus.value.status === 'paused') {
          sendStatus.value = { status: 'error', message: 'data_channel_closed WebRTC数据通道已关闭' }
        }
      }

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket?.emit('signal', { roomCode: roomCode.value, payload: { type: 'candidate', candidate: event.candidate } })
        }
      }

      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      socket?.emit('signal', { roomCode: roomCode.value, payload: { type: 'offer', offer: offer } })
    })

    socket.on('signal', async (data: any) => {
      const payload = data.payload
      if (payload.type === 'answer' && peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer))
      } else if (payload.type === 'candidate' && peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
      }
    })
  }

  const disconnectServer = () => {
    if (socket) socket.disconnect()
    isConnected.value = false
    isP2PReady.value = false
    roomCode.value = ''
  }

  const sendFile = (filePath: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      if (!dataChannel || dataChannel.readyState !== 'open') {
        return reject(new Error('P2P 通道未打开'))
      }

      try {
        isCancelled.value = false 
        const { name, size } = await window.myElectronAPI.getFileInfo(filePath)
        currentFile.value = { name, size }
        dataChannel.send(JSON.stringify({ type: 'meta', name, size }))

        const chunkSize = 64 * 1024
        let offset = 0
        sendStatus.value = { status: 'sending', message: `正在发送 ${name} (${Math.round(size / 1024)} KB)` }

        while (offset < size) {
          if (isCancelled.value) {
            resetTransfer()
            return reject(new Error('传输已被手动终止'))
          }

          while (sendStatus.value.status === 'paused') {
            if (isCancelled.value) break 
            
            // 关键点：在暂停的休眠期间，如果手机突然断网，需要立刻跳出死循环
            if (dataChannel.readyState !== 'open') {
              return reject(new Error('disconnected'))
            }
            await new Promise(r => setTimeout(r, 100))
          }

          if (isCancelled.value) {
            resetTransfer()
            return reject(new Error('传输已被手动终止'))
          }

          // 关键点：每次读取并发送切片前，必须检查底层物理通道是否依然存活
          if (dataChannel.readyState !== 'open') {
            return reject(new Error('disconnected'))
          }

          if (dataChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 50))
            continue
          }
          const chunk = await window.myElectronAPI.readFileChunk(filePath, offset, chunkSize)
          dataChannel.send(chunk as any)
          offset += chunk.length
          fileProgress.value = Math.round((offset / size) * 100)
        }

        // 修复：只有在“没有”被取消的情况下，才发送结束标记并标记为完成
        if (!isCancelled.value) {
          dataChannel.send(JSON.stringify({ type: 'eof' }))
          sendStatus.value = { status: 'done', message: `文件 ${name} 发送完成` }
          resolve() 
        }
      } catch (err: any) {
        // 修复：只有在“非手动取消”的情况下，才记录为系统错误
        if (!isCancelled.value) {
          const errorMsg = err.message === 'disconnected' ? '连接意外断开 (Disconnected)' : (err.message || '未知错误')
          sendStatus.value = { status: 'error', message: `传输异常：${errorMsg}` }
        }
        reject(err)
      }
    })
  }

  onUnmounted(() => disconnectServer())

  return {
    roomCode,
    isConnected,
    isP2PReady,
    connectToServer,
    disconnectServer,
    sendFile,
    fileProgress,
    currentFile,
    sendStatus,
    resetTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer
  }
}