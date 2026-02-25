<script setup lang="ts">
import { ref, watch } from 'vue'
import { useWebRTC } from '../composables/useWebRTC'

// 引入核心逻辑
const {
  roomCode,
  isConnected,
  isP2PReady,
  connectedPeerId,
  connectToServer,
  disconnectPeer, // 用于刷新取件码
  // === 身份数据 ===
  myDeviceId,
  myDeviceName,
  trustedDevices,
  updateDeviceName,
  removeTrustedDevice,
  updateDeviceRemark,
  connectedPeerName,
  connectToDevice,
  refreshShareCode,
  joinRoom,
  connectionError,
  currentReceivingFile,
  receiveProgress,
  receiveSpeed,
  receiveStatus,
  receiveError
} = useWebRTC()

// === 接收状态 (TODO: 下一步我们需要在 useWebRTC.ts 中真正实现这些状态) ===
// 目前先用本地 ref 模拟 UI 效果，等会去底层接通
// const receiveStatus = ref<'idle' | 'receiving' | 'done' | 'error'>('idle')
// const currentReceivingFile = ref<{ name: string, size: number, receivedSize: number } | null>(null)
// const receiveProgress = ref(0)
// const receiveSpeed = ref('0 B/s')
const tempRoomCode = ref('')
const connectBtnDisabled = ref(false)
const isJoining = ref(false)

const handleJoin = () => {
  if (tempRoomCode.value.length !== 6) return

  isJoining.value = true

  // 调用底层的加入房间逻辑
  // 注意：加入房间是一个异步过程（发请求 -> 等服务器响应 -> 等 P2P 建立）
  // joinRoom 目前是“发后即忘”的，我们通过监听 P2P 状态来判断是否成功
  joinRoom(tempRoomCode.value)

  // 简单的超时重置 (防止万一没连上，按钮一直转圈)
  setTimeout(() => {
    isJoining.value = false
  }, 3000)
}

watch(connectionError, (err) => {
  if (err) {
    isJoining.value = false
  }
})

watch(isP2PReady, (ready) => {
  if (ready) {
    isJoining.value = false
  }
})

const disableConnectBtnTemporarily = () => {
  connectBtnDisabled.value = true
  setTimeout(() => {
    connectBtnDisabled.value = false
  }, 2000) // 2秒后重新启用按钮
}


const handleDisconnect = () => {
  // 先断开本地 P2P
  disconnectPeer()

  receiveStatus.value = 'idle'

  if (roomCode.value === '加密直连') {
    // 场景 A：如果是直连，我们希望“退出直连模式，回到公开模式”
    // 调用 refreshShareCode 是最简单的“重置”方式，它会销毁直连房间并给你一个新的 6 位码
    refreshShareCode()

    // 如果你想保留原来的 6 位码不换，目前 Server 端不支持。
    // 因为 Server 端只有 create-room (建新房) 和 disconnect (全删)。
    // 所以目前 refreshShareCode() 是退出直连并恢复服务的唯一路径。
  } else {
    // 场景 B：如果是 6 位码连接
    // 为了安全，踢掉陌生人后最好换个码
    refreshShareCode()
  }
}

// === 辅助工具 ===
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    // 这里可以触发一个全局 Snackbar，或者简单的 console
    console.log('已复制')
  } catch (e) {
    console.error('复制失败', e)
  }
}

// 打开下载文件夹 (需要 Electron 主进程支持，我们稍后实现)
const openDownloadsFolder = () => {
  // 从 LocalStorage 读取用户设置的路径
  const savedPath = localStorage.getItem('instadrop_save_path')

  // 处理“默认”文本 (如果用户没改过，内容是 '默认 (下载/Instadrop)')
  const targetPath = (savedPath && savedPath !== '默认 (下载/Instadrop)') ? savedPath : undefined

  if (window.myElectronAPI?.openDownloadsFolder) {
    window.myElectronAPI.openDownloadsFolder(targetPath)
  } else {
    console.log('正在打开默认下载路径...')
  }
}

// === 身份与备注修改弹窗 (与 Send.vue 保持一致) ===
const showEditNameDialog = ref(false)
const tempDeviceName = ref('')
const showEditDeviceRemarkDialog = ref(false)
const tempEditDeviceOriginalName = ref('')
const tempEditDeviceRemark = ref('')
const tempEditDeviceId = ref('')

const openEditNameDialog = () => {
  tempDeviceName.value = myDeviceName.value
  showEditNameDialog.value = true
}

const confirmEditName = () => {
  if (tempDeviceName.value.trim()) {
    updateDeviceName(tempDeviceName.value.trim())
    showEditNameDialog.value = false
  }
}

const openEditDeviceRemarkDialog = (device: { id: string, name: string, remark?: string }) => {
  tempEditDeviceId.value = device.id
  tempEditDeviceOriginalName.value = device.name
  tempEditDeviceRemark.value = device.remark || ''
  showEditDeviceRemarkDialog.value = true
}

const confirmEditDeviceRemark = () => {
  if (tempEditDeviceId.value) {
    updateDeviceRemark(tempEditDeviceId.value, tempEditDeviceRemark.value.trim())
    showEditDeviceRemarkDialog.value = false
  }
}

// UUID 可见性
const deviceIdVisibility = ref(false)

// 计算属性：格式化文件大小
const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>

<template>
  <v-container class="fill-height align-start pt-6">
    <v-row>
      <v-col cols="12" md="6">
        <v-card variant="flat" color="primary" class="mb-4 bg-surface-variant rounded-lg">
          <v-card-text class="d-flex align-center justify-space-between py-2">
            <div class="d-flex align-center">
              <v-icon :color="isP2PReady ? '' : (isConnected ? 'success' : 'grey')" class="mr-3">
                {{ isP2PReady ? 'mdi-lightning-bolt' : 'mdi-access-point-network' }}
              </v-icon>

              <span v-if="!isConnected" class="text-medium-emphasis">离线状态</span>
              <span v-else-if="!isP2PReady" class="font-weight-bold text-success">服务在线，等待连接...</span>
              <span v-else class="font-weight-bold">已成功建立连接</span>
            </div>

            <v-btn :disabled="connectBtnDisabled" :color="isConnected ? 'error' : 'success'" variant="elevated"
              size="small" @click="if (isConnected) { handleDisconnect() }
              else { connectToServer(true); disableConnectBtnTemporarily() }"
              v-if="connectedPeerId !== null || !isConnected">
              {{ isConnected ? '断开连接' : connectBtnDisabled ? '连接中...' : '连接服务器' }}
            </v-btn>
          </v-card-text>
        </v-card>

        <v-card class="text-center py-10 d-flex flex-column align-center justify-center" variant="outlined"
          style="border: 2px dashed rgba(150, 150, 150, 0.3); min-height: 400px;">

          <div v-if="receiveStatus === 'idle' && !isP2PReady" class="d-flex flex-column align-center">
            <div class="text-h6 text-medium-emphasis mb-4" v-if="isConnected">请输入取件码</div>

            <div v-if="isConnected" class="d-flex align-center">
              <v-otp-input v-model="tempRoomCode" length="6" :disabled="!isConnected || isJoining"></v-otp-input>
            </div>

            <v-btn :disabled="tempRoomCode.length < 6 || !isConnected" :loading="isJoining" class="mt-4"
              v-if="isConnected" @click="handleJoin">连接</v-btn>

            <div v-if="!isConnected" class="text-h4 text-grey font-weight-bold">
              请先连接到信令服务器
            </div>

            <div class="mt-8 text-body-2 text-medium-emphasis px-10" v-if="isConnected">
              请在发送端 (手机/电脑) 输入此 6 位数字，<br>或者在“信任设备”列表中直接点击连接。
            </div>
          </div>

          <div v-else-if="receiveStatus === 'idle' && isP2PReady" class="d-flex flex-column align-center">
            <v-icon icon="mdi-account-check-outline" size="80" color="purple-accent-3" class="mb-4"></v-icon>
            <h3 class="text-h5 font-weight-bold mb-2">已与 {{ connectedPeerName }} 建立连接</h3>
            <p class="text-medium-emphasis">正在等待对方发送文件...</p>
          </div>

          <div v-else class="w-100 px-10">
            <v-icon :icon="receiveStatus === 'done' ? 'mdi-check-circle-outline' : 'mdi-download-network-outline'"
              size="60" :color="receiveStatus === 'done' ? 'success' : (receiveStatus === 'error' ? 'error' : 'primary')" class="mb-4"></v-icon>

            <h3 class="text-h6 font-weight-bold text-truncate mb-1">
              {{ currentReceivingFile?.name || '未知文件' }}
            </h3>
            <div class="text-caption text-medium-emphasis mb-4">
              {{ formatSize(currentReceivingFile?.receivedSize || 0) }} / {{ formatSize(currentReceivingFile?.size || 0)
              }}
            </div>

            <v-progress-linear :model-value="receiveProgress" height="5" rounded
              :color="receiveStatus === 'done' ? 'success' : receiveStatus === 'error' ? 'error' : 'primary'">
            </v-progress-linear>

            <div class="d-flex justify-space-between mt-2 text-caption font-weight-bold">
              <span :class="receiveStatus === 'error' ? 'text-error' : 'text-primary'">
              {{ receiveStatus === 'error' ? '已停止' : receiveSpeed }}</span>
              <span>{{ receiveProgress.toFixed(2) }}%</span>
              <span v-if="receiveStatus === 'receiving'">正在写入磁盘...</span>
              <span v-if="receiveStatus === 'done'" class="text-success">接收完成</span>
              <span v-if="receiveStatus === 'error'" class="text-error">接收失败</span>
            </div>

            <div class="mt-4 d-flex justify-space-between text-caption font-weight-bold text-error" v-if="receiveStatus === 'error'">
              <span>失败原因：{{ receiveError }}</span>
              <v-spacer></v-spacer>
            </div>

            <v-btn class="mt-4" v-if="receiveStatus === 'error'" variant="tonal" color="primary" prepend-icon="mdi-arrow-left"
            @click="receiveStatus = 'idle'; receiveError = null; currentReceivingFile = null;">
              返回
            </v-btn>

            <v-btn v-if="receiveStatus === 'done'" class="mt-6" variant="tonal" color="primary"
              prepend-icon="mdi-folder-open" @click="openDownloadsFolder">
              打开下载文件夹
            </v-btn>
            <div class="mt-4"></div>
            <v-divider></v-divider>
            <div class="mt-4"></div>
            <div class="text-caption text-weight-bold">
              <span>你可以在发送端设备上继续传输文件。</span><br>
              <span>在断开与 {{ connectedPeerName }} 的连接之前，你无法接收来自其他设备的文件。</span><br>
              <span>要断开连接，请点击“断开连接”按钮。</span>
            </div>
          </div>
        </v-card>

        <div class="d-flex justify-center mt-4">
          <v-btn variant="text" size="small" color="grey" prepend-icon="mdi-folder-marker-outline"
            @click="openDownloadsFolder">
            点击打开存储位置
          </v-btn>
        </div>
        <div class="text-caption text-medium-emphasis d-flex justify-center mt-2">
          <span>你可以前往 设置 里修改默认存储位置</span>
        </div>
      </v-col>

      <v-col cols="12" md="6">
        <v-card variant="outlined" class="mb-4">
          <v-card-title class="text-primary font-weight-bold d-flex align-center">
            <v-icon icon="mdi-card-account-details-outline" class="mr-2"></v-icon>
            本机身份
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text>
            <div class="d-flex align-center justify-space-between mb-3">
              <div>
                <div class="text-caption text-medium-emphasis">设备名称</div>
                <div class="font-weight-bold text-subtitle-1">{{ myDeviceName }}</div>
              </div>
              <v-btn icon="mdi-pencil-outline" variant="text" size="small" color="primary" @click="openEditNameDialog"
                title="修改设备名"></v-btn>
            </div>

            <div class="d-flex align-center justify-space-between">
              <div style="overflow: hidden;">
                <div class="text-caption text-medium-emphasis">唯一标识符 (UUID)</div>
                <div class="text-caption text-truncate" style="color: #888;" :title="myDeviceId">{{ deviceIdVisibility ?
                  myDeviceId : '••••••••' }}</div>
              </div>
              <div class="d-flex">
                <v-btn :icon="deviceIdVisibility ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                  @click="deviceIdVisibility = !deviceIdVisibility" variant="text" size="small" color="primary"></v-btn>
                <v-btn icon="mdi-content-copy" variant="text" size="small" color="primary"
                  @click="copyToClipboard(myDeviceId)"></v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <v-card variant="outlined">
          <v-card-title class="text-primary font-weight-bold d-flex align-center justify-space-between">
            <div class="d-flex align-center">
              <v-icon icon="mdi-devices" class="mr-2"></v-icon>
              信任设备
            </div>
          </v-card-title>
          <v-divider></v-divider>

          <v-list v-if="trustedDevices.length > 0" lines="two" bg-color="transparent" class="pa-0">
            <template v-for="(device, index) in trustedDevices" :key="device.id">
              <v-list-item>
                <template v-slot:prepend>
                  <v-badge :color="device.isOnline ? 'success' : 'grey'" dot inline class="mr-3"></v-badge>
                  <v-icon icon="mdi-cellphone" color="primary"></v-icon>
                </template>

                <v-list-item-title class="font-weight-bold">
                  {{ device.remark || device.name }}
                </v-list-item-title>
                <v-list-item-subtitle class="text-caption">
                  {{ device.isOnline ? '当前在线，可直连' : '已离线' }}
                </v-list-item-subtitle>

                <template v-slot:append>
                  <v-btn size="small" color="success" variant="tonal" class="mr-2"
                    :disabled="!device.isOnline || isP2PReady" @click="connectToDevice(device.id)">
                    连接
                  </v-btn>

                  <v-btn icon="mdi-pencil-outline" variant="text" size="small" color="primary" class="mr-1"
                    @click="openEditDeviceRemarkDialog(device)" title="修改备注名"></v-btn>

                  <v-btn icon="mdi-trash-can-outline" variant="text" size="small" color="error"
                    @click="removeTrustedDevice(device.id)"></v-btn>
                </template>
              </v-list-item>
              <v-divider v-if="index < trustedDevices.length - 1"></v-divider>
            </template>
          </v-list>

          <v-card-text v-else class="text-center text-medium-emphasis py-6">
            暂无信任设备。<br><span class="text-caption">在接收文件后会自动保存对方信息</span>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="showEditNameDialog" max-width="400">
      <v-card title="修改设备名称">
        <v-card-text>
          <v-text-field v-model="tempDeviceName" label="设备名称" variant="outlined" autofocus
            @keyup.enter="confirmEditName"></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showEditNameDialog = false"></v-btn>
          <v-btn variant='elevated' text="保存" color="primary" @click="confirmEditName"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showEditDeviceRemarkDialog" max-width="400">
      <v-card title="修改设备备注名">
        <v-card-text>
          <div class="text-caption text-medium-emphasis mb-1">
            原设备名称 (由对方设置，不可修改)
          </div>
          <span> {{ tempEditDeviceOriginalName }}</span>
          <div class="text-caption text-medium-emphasis">(uuid: {{ tempEditDeviceId }})</div>
          <div style="height: 5px;"></div>
          <div class="text-caption text-medium-emphasis mb-2">自定义备注名称</div>
          <v-text-field v-model="tempEditDeviceRemark" variant="outlined" density="compact" autofocus
            @keyup.enter="confirmEditDeviceRemark()" placeholder="留空则恢复显示原名"></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showEditDeviceRemarkDialog = false"></v-btn>
          <v-btn variant='elevated' text="保存" color="primary" @click="confirmEditDeviceRemark()"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
<style scoped>
#roomCode {
  width: 100%;
  padding: 15px;
  margin-bottom: 20px;
  border: none;
  border-radius: 12px;
  font-size: 32px;
  font-weight: bold;
  text-align: center;
  letter-spacing: 8px;
  box-sizing: unset;
  transition: all 0.3s;
  color: #2196F3;
}

#roomCode:focus {
  outline: none;
}
</style>