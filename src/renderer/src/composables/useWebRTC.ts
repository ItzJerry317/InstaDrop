import { ref, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'

export function useWebRTC() {
  const roomCode = ref('')
  const isConnected = ref(false)
  const isP2PReady = ref(false) // 核心：P2P 物理通道是否打通
  
  let socket: Socket | null = null
  let peerConnection: RTCPeerConnection | null = null
  let dataChannel: RTCDataChannel | null = null

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.hitv.com:3478' }] // 芒果公共 STUN
  }

  const connectToServer = () => {
    // 假设老师的电脑既运行客户端，又运行 Node 服务器
    socket = io('http://localhost:3000')

    socket.on('connect', () => {
      isConnected.value = true
      socket?.emit('create-room')
    })

    socket.on('room-created', (code: string) => {
      roomCode.value = code
    })

    socket.on('peer-joined', async (peerId: string) => {
      console.log(`[WebRTC] 手机已加入，准备打洞！`)
      isP2PReady.value = false
      peerConnection = new RTCPeerConnection(rtcConfig)

      // 监控底层物理连接状态
      peerConnection.oniceconnectionstatechange = () => {
        console.log('📡 [物理层状态]:', peerConnection?.iceConnectionState)
      }

      dataChannel = peerConnection.createDataChannel('instadrop-file')

      dataChannel.onopen = () => {
        console.log('⚡ WebRTC 数据通道已完全敞开！')
        isP2PReady.value = true // 通道打通，允许发送！
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

  // 🔥 核心：发送单个文件 (返回 Promise 用于队列控制)
  const sendFile = (filePath: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      if (!dataChannel || dataChannel.readyState !== 'open') {
        return reject(new Error('P2P 通道未打开'))
      }

      try {
        const { name, size } = await window.myElectronAPI.getFileInfo(filePath)
        dataChannel.send(JSON.stringify({ type: 'meta', name, size }))

        const chunkSize = 64 * 1024
        let offset = 0

        while (offset < size) {
          if (dataChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 50))
            continue
          }
          const chunk = await window.myElectronAPI.readFileChunk(filePath, offset, chunkSize)
          dataChannel.send(chunk as any)
          offset += chunk.length
        }

        dataChannel.send(JSON.stringify({ type: 'eof' }))
        resolve() // 这个文件发送完毕，放行下一个！
      } catch (err) {
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
    sendFile
  }
}