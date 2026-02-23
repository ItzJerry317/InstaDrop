<script setup lang="ts">
import { ref } from 'vue'
import { useWebRTC } from '../composables/useWebRTC'

const {
  roomCode,
  isConnected,
  isP2PReady,
  connectToServer,
  disconnectServer,
  sendFile,
  fileProgress,
  currentFile,
  sendStatus,
  pauseTransfer,
  resumeTransfer,
  cancelTransfer,
  resetTransfer,
  // 引入全新的设备与身份管理状态
  myDeviceId,
  myDeviceName,
  trustedDevices,
  regenerateDeviceId,
  updateDeviceName,
  addTrustedDevice,
  removeTrustedDevice,
  connectToDevice,
  transferSpeed
} = useWebRTC()

interface DroppedFile {
  name: string
  path: string
  size: number
  formattedSize: string
}

const isDragging = ref(false)
const droppedFiles = ref<DroppedFile[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)


// === 弹窗控制状态 (替代 prompt) ===
const showEditNameDialog = ref(false)
const tempDeviceName = ref('')

const showAddDeviceDialog = ref(false)
const tempTargetId = ref('')
const tempTargetName = ref('')

// === 弹窗操作方法 ===
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

const openAddDeviceDialog = () => {
  tempTargetId.value = ''
  tempTargetName.value = '新设备'
  showAddDeviceDialog.value = true
}
const confirmAddDevice = () => {
  const id = tempTargetId.value.trim()
  const name = tempTargetName.value.trim()

  if (!id) {
    alert('UUID 不能为空！')
    return
  }

  // 经典的 36 位 UUID 正则表达式 (包含连字符 8-4-4-4-12)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!uuidRegex.test(id)) {
    alert('输入的 UUID 格式不正确，请检查是否包含完整字符和中划线！')
    return
  }

  // 如果自己添加自己，进行拦截
  if (id === myDeviceId.value) {
    alert('不能添加本机为信任设备！')
    return
  }

  addTrustedDevice(id, name || '新设备')
  showAddDeviceDialog.value = false
}

const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const processFileList = (files: FileList) => {
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const actualPath = window.myElectronAPI.getFilePath(file)
    if (!droppedFiles.value.some(f => f.path === actualPath)) {
      droppedFiles.value.push({
        name: file.name,
        path: actualPath,
        size: file.size,
        formattedSize: formatFileSize(file.size)
      })
    }
  }
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const handleDrop = (event: DragEvent) => {
  isDragging.value = false
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    processFileList(event.dataTransfer.files)
  }
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    processFileList(target.files)
  }
  target.value = ''
}

const removeFile = (index: number) => {
  droppedFiles.value.splice(index, 1)
  if (droppedFiles.value.length === 0) {
    resetTransfer()
  }
}

const processFiles = async () => {
  if (droppedFiles.value.length === 0) return
  if (!isP2PReady.value) {
    return alert('请先建立 P2P 连接！')
  }

  try {
    for (const file of droppedFiles.value) {
      await sendFile(file.path)
    }
    if (sendStatus.value.status !== 'idle') {
      sendStatus.value = { status: 'done', message: '全部文件传输完成' }
    }
  } catch (error) {
    console.error('传输任务结束或被终止：', error)
  }
}

// === 身份与信任列表的 UI 交互控制 ===

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    alert('已复制到剪贴板')
  } catch (e) {
    console.error('复制失败', e)
  }
}

const handleRegenerateId = () => {
  if (confirm('警告：重置设备 ID 后，之前信任您的设备将无法自动连接。确定要重置吗？')) {
    regenerateDeviceId()
    alert('设备 ID 已重置，需等待双方重新通过 6 位码建立一次信任。')
  }
}
</script>

<template>
  <v-container class="fill-height align-start pt-6">
    <v-row>
      <v-col cols="12" md="6">
        <v-card variant="flat" color="primary" class="mb-4 bg-surface-variant rounded-lg">
          <v-card-text class="d-flex align-center justify-space-between py-2">
            <div class="d-flex align-center">
              <v-icon :color="isP2PReady ? 'purple-accent-3' : (isConnected ? 'success' : 'grey')" class="mr-3">
                {{ isP2PReady ? 'mdi-lightning-bolt' : 'mdi-access-point-network' }}
              </v-icon>

              <span v-if="!isConnected" class="text-medium-emphasis">离线状态，准备就绪</span>
              <span v-else-if="!isP2PReady" class="font-weight-bold text-success">
                <template v-if="roomCode === '加密直连'">
                  正在建立无感直连安全通道...
                </template>
                <template v-else>
                  等待接入... 临时取件码: <span class="text-h6 mx-2">{{ roomCode }}</span>
                </template>
              </span>
              <span v-else class="font-weight-bold text-purple-accent-3">
                P2P 连接已建立，可以发送文件
              </span>
            </div>

            <v-btn :color="isConnected ? 'error' : 'success'" variant="elevated" size="small"
              @click="isConnected ? disconnectServer() : connectToServer()">
              {{ isConnected ? '断开连接' : '启动信令基站' }}
            </v-btn>
          </v-card-text>
        </v-card>

        <input type="file" ref="fileInputRef" multiple style="display: none;" @change="handleFileSelect" />

        <v-card @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false" @drop.prevent="handleDrop"
          @click="triggerFileInput" :elevation="isDragging ? 8 : 2" :color="isDragging ? 'primary' : 'surface'"
          variant="elevated" class="text-center pa-10 transition-swing"
          style="border: 2px dashed rgba(150, 150, 150, 0.4); cursor: pointer;">
          <v-icon :icon="isDragging ? 'mdi-package-down' : 'mdi-cloud-upload-outline'" size="80"
            :color="isDragging ? 'white' : 'primary'" class="mb-4"></v-icon>
          <h2 class="text-h4 font-weight-bold mb-2">
            {{ isDragging ? '松开鼠标，即可选定文件' : '将文件拖拽至此' }}
          </h2>
          <p class="text-medium-emphasis">支持任意格式文件的快速载入</p>
        </v-card>

        <v-expand-transition>
          <v-card v-if="droppedFiles.length > 0" class="mt-6" variant="outlined">
            <v-list lines="two" bg-color="transparent">
              <v-list-subheader class="text-primary font-weight-bold">
                等待传输 ({{ droppedFiles.length }})
              </v-list-subheader>

              <v-list-item v-for="(file, index) in droppedFiles" :key="index" :subtitle="file.path">
                <template v-slot:prepend>
                  <v-icon icon="mdi-file-document-outline" color="info"></v-icon>
                </template>
                <template v-slot:title>
                  <div class="d-flex align-center">
                    <span class="text-truncate font-weight-bold" style="max-width: 60%;">{{ file.name }}</span>
                    <span class="text-medium-emphasis text-body-2 ml-2">(大小: {{ file.formattedSize }})</span>
                  </div>
                </template>
                <template v-slot:append>
                  <v-btn icon variant="text" color="error" size="small" @click="removeFile(index)" :disabled="sendStatus.status === 'sending' || sendStatus.status === 'paused'">
                    <v-icon>
                      mdi-trash-can-outline
                    </v-icon>
                  </v-btn>
                </template>
              </v-list-item>

              <v-divider></v-divider>

              <v-list-item>
                <span class="text-primary font-weight-bold">
                  {{ sendStatus.status === "idle" ? "等待传输" :
                    sendStatus.status === "sending" ? "正在传输：" + (currentFile?.name || '未知文件') :
                      sendStatus.status === "paused" ? "已暂停传输：" + (currentFile?.name || '未知文件') :
                        sendStatus.status === "done" ? "所有文件传输完成" : "传输异常：" + (sendStatus.message || "未知原因") }}
                </span>
                <div v-if="sendStatus.status !== 'idle'">
                  <span class="text-medium-emphasis">传输进度: {{ fileProgress }}% | 传输速度：{{ transferSpeed }}</span>
                </div>
                <div style="height: 10px;"></div>
                <v-progress-linear :model-value="fileProgress"
                  :color="sendStatus.status === 'done' ? 'success' : sendStatus.status === 'error' ? 'error' : 'primary'">
                </v-progress-linear>
                <div style="height: 10px;"></div>
                <div v-if="sendStatus.status === 'paused' || sendStatus.status === 'sending' || sendStatus.status === 'error'">
                  <span class="text-warning font-weight-bold">
                    <v-icon>mdi-alert</v-icon>
                    注意：传输过程中，不可更改队列中的文件。
                  </span>
                </div>
              </v-list-item>
            </v-list>

            <v-divider></v-divider>
            <v-card-actions class="pa-3">
              <v-spacer></v-spacer>

              <template v-if="sendStatus.status === 'idle'">
                <v-btn color="error" variant="flat" prepend-icon="mdi-delete"
                  @click="droppedFiles = []; resetTransfer()">清空全部</v-btn>
                <v-btn color="success" variant="flat" prepend-icon="mdi-arrow-right-drop-circle"
                  :disabled="droppedFiles.length === 0 || !isP2PReady" @click="processFiles">开始传输</v-btn>
              </template>

              <template v-else-if="sendStatus.status === 'sending' || sendStatus.status === 'paused'">
                <v-btn color="error" variant="flat" prepend-icon="mdi-stop-circle-outline"
                  @click="cancelTransfer">终止传输</v-btn>
                <v-btn v-if="sendStatus.status === 'sending'" color="warning" variant="flat"
                  prepend-icon="mdi-pause-circle-outline" @click="pauseTransfer">暂停</v-btn>
                <v-btn v-else color="info" variant="flat" prepend-icon="mdi-play-circle-outline"
                  @click="resumeTransfer">继续</v-btn>
              </template>

              <template v-else>
                <v-btn color="primary" variant="flat" prepend-icon="mdi-check-circle-outline"
                  @click="resetTransfer">关闭控制面板</v-btn>
              </template>
            </v-card-actions>
          </v-card>
        </v-expand-transition>
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
                <div class="text-caption text-truncate" style="color: #888;" :title="myDeviceId">{{ myDeviceId }}</div>
              </div>
              <div class="d-flex">
                <v-btn icon="mdi-content-copy" variant="text" size="small" color="primary"
                  @click="copyToClipboard(myDeviceId)" title="复制 ID"></v-btn>
                <v-btn icon="mdi-refresh" variant="text" size="small" color="error" @click="handleRegenerateId"
                  title="重置 ID"></v-btn>
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
            <v-btn icon="mdi-plus" variant="text" size="small" color="primary" @click="openAddDeviceDialog"
              title="手动添加设备"></v-btn>
          </v-card-title>
          <v-divider></v-divider>

          <v-list v-if="trustedDevices.length > 0" lines="two" bg-color="transparent" class="pa-0">
            <template v-for="(device, index) in trustedDevices" :key="device.id">
              <v-list-item>
                <template v-slot:prepend>
                  <v-badge :color="device.isOnline ? 'success' : 'grey'" dot inline class="mr-3"></v-badge>
                  <v-icon icon="mdi-cellphone" color="primary"></v-icon>
                </template>

                <v-list-item-title class="font-weight-bold">{{ device.name }}</v-list-item-title>
                <v-list-item-subtitle class="text-caption">{{ device.isOnline ? '当前在线，可直连' : '已离线'
                }}</v-list-item-subtitle>

                <template v-slot:append>
                  <v-btn size="small" color="success" variant="tonal" class="mr-2"
                    :disabled="!device.isOnline || isP2PReady" @click="connectToDevice(device.id)">
                    连接
                  </v-btn>
                  <v-btn icon="mdi-trash-can-outline" variant="text" size="small" color="error"
                    @click="removeTrustedDevice(device.id)"></v-btn>
                </template>
              </v-list-item>
              <v-divider v-if="index < trustedDevices.length - 1"></v-divider>
            </template>
          </v-list>

          <v-card-text v-else class="text-center text-medium-emphasis py-6">
            暂无信任设备。
            <br>
            <span class="text-caption">通过 6 位取件码连接成功后将自动保存</span>
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
          <v-btn text="保存" color="primary" @click="confirmEditName"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showAddDeviceDialog" max-width="400">
      <v-card title="手动添加信任设备">
        <v-card-text>
          <v-text-field v-model="tempTargetId" label="对方设备 UUID" variant="outlined" class="mb-2"
            autofocus></v-text-field>
          <v-text-field v-model="tempTargetName" label="备注名称" variant="outlined"
            @keyup.enter="confirmAddDevice"></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showAddDeviceDialog = false"></v-btn>
          <v-btn text="添加" color="primary" @click="confirmAddDevice"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>