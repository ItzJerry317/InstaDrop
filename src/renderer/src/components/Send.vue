<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useWebRTC } from '../composables/useWebRTC'

const {
  roomCode,
  isConnected,
  isP2PReady,
  connectToServer,
  sendFile,
  fileProgress,
  currentFile,
  sendStatus,
  pauseTransfer,
  resumeTransfer,
  cancelTransfer,
  resetTransfer,
  myDeviceId,
  myDeviceName,
  trustedDevices,
  regenerateDeviceId,
  updateDeviceName,
  addTrustedDevice,
  removeTrustedDevice,
  connectToDevice,
  transferSpeed,
  connectedPeerId,
  connectedPeerName,
  disconnectPeer,
  updateDeviceRemark,
  refreshShareCode,
  createRoom
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

const rules = {
  required: (value: string) => !!value || '此项为必填项',
}

// === 免责声明弹窗控制 ===
const showDisclaimerDialog = ref(false)

const acceptDisclaimer = () => {
  // 记录到本地存储，以后不再弹出
  localStorage.setItem('instadrop_disclaimer_accepted', 'true')
  showDisclaimerDialog.value = false
  // 同意后才开始连接服务器
  connectToServer()
}

const rejectDisclaimer = () => {
  // 退出应用
  window.myElectronAPI.closeWindow()
}

// === UUID可见性控制 ===
const deviceIdVisibility = ref(false)

// === 确认弹窗控制 ===
const showConfirmDialog = ref(false)
const confirmDialogMessage = ref('')
const showconfirmCheck = ref(false) //是否显示确认复选框
const confirmCheck = ref(false) //复选框状态
let dialogResolve: ((value: boolean) => void) | null = null
const triggerDialog = (message: string, requireCheck?: boolean): Promise<boolean> => {
  confirmDialogMessage.value = message
  showConfirmDialog.value = true
  showconfirmCheck.value = requireCheck || false
  return new Promise((resolve) => {
    dialogResolve = resolve
  })
}

const confirmDialogAction = (result: boolean) => {
  showConfirmDialog.value = false
  if (dialogResolve) {
    dialogResolve(result)
    dialogResolve = null
  }
}

// === SnackBar控制 ===
const showSnackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('')

const triggerSnackbar = (message: string, color: string) => {
  snackbarMessage.value = message
  snackbarColor.value = color
  showSnackbar.value = true
}


// === 弹窗控制状态 (替代 prompt) ===
const showEditNameDialog = ref(false)
const tempDeviceName = ref('')

const showAddDeviceDialog = ref(false)
const tempTargetId = ref('')
const tempTargetName = ref('')
const showEditDeviceNameDialog = ref(false)
const tempEditDeviceId = ref('')
const tempEditDeviceOriginalName = ref('')
const tempEditDeviceRemark = ref('')

// === 弹窗操作方法 ===
const openEditDeviceNameDialog = (device: { id: string, name: string, remark?: string }) => {
  tempEditDeviceId.value = device.id
  tempEditDeviceOriginalName.value = device.name // 对方的真实设备名
  tempEditDeviceRemark.value = device.remark || '' // 你的备注
  showEditDeviceNameDialog.value = true
}

const confirmEditDeviceName = () => {
  if (tempEditDeviceOriginalName.value.trim() && tempEditDeviceId.value) {
    // 调用专门的改备注方法，允许为空（为空则代表清空备注）
    updateDeviceRemark(tempEditDeviceId.value, tempEditDeviceRemark.value.trim())
    showEditDeviceNameDialog.value = false
    triggerSnackbar('设备备注已更新', 'success')
  }
}

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
    triggerSnackbar('设备 UUID 不能为空！', 'error')
    return
  }

  // 经典的 36 位 UUID 正则表达式 (包含连字符 8-4-4-4-12)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!uuidRegex.test(id)) {
    triggerSnackbar('输入的 UUID 格式不正确，请检查是否正确输入！', 'error')
    return
  }

  // 如果自己添加自己，进行拦截
  if (id === myDeviceId.value) {
    triggerSnackbar('不能添加本机为信任设备！', 'error')
    return
  }

  addTrustedDevice(id, '等待连接获取设备原名...')
  updateDeviceRemark(id, name || '新设备')
  showAddDeviceDialog.value = false
}

const handleRemoveDevice = (id: string) => {
  if (isP2PReady.value && id === connectedPeerId.value) {
    console.log(id + " 是当前连接设备: " + connectedPeerId.value)
    triggerSnackbar('不能删除正在连接的设备', 'error')
  } else {
    // 其他所有情况（没连网，或者连着 A 但想删 B），直接放行
    console.log("执行删除: " + id)
    removeTrustedDevice(id)
  }
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
    return triggerSnackbar('请先建立 P2P 连接！', 'error')
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
    triggerSnackbar('已复制到剪贴板', 'info')
  } catch (e) {
    console.error('复制失败', e)
  }
}

const handleRegenerateId = async () => {
  const isConfirmed = await triggerDialog(
    '重置 UUID 后，需要等待双方重新通过 6 位码建立一次信任。\n' +
    '你的现有 UUID 将被清空。\n你需要在绑定了该设备的其他设备上手动删除原来的绑定信息。\n\n' +
    '确定要重置吗？\n' +
    '（仅在你的 UUID 泄露时才需要进行此操作）', true
  )
  console.log(isConfirmed)
  if (isConfirmed) {
    regenerateDeviceId()
    triggerSnackbar('UUID 已重置，需等待双方重新通过 6 位码建立一次信任。', 'info')
  }
}

const leaveRoom = () => {
  if (isP2PReady.value) {
    triggerSnackbar('已断开连接，正在刷新取件码', 'success')
  } else {
    triggerSnackbar('正在刷新取件码', 'success')
  }
  disconnectPeer()
}

const handleDisconnect = () => {
  // 先断开本地 P2P
  disconnectPeer()

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

onMounted(() => {
  // 检查是否已经同意过免责声明
  const hasAccepted = localStorage.getItem('instadrop_disclaimer_accepted') === 'true'

  if (!hasAccepted) {
    // 没同意过，弹出强制提示框（此时不连接服务器）
    showDisclaimerDialog.value = true
  } else {
    // 如果已经连上了，而且还没房号，那就建一个
    setTimeout(() => {
       if (isConnected.value && !roomCode.value) createRoom()
    }, 500)
  }
})
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
              <span v-else-if="!isP2PReady" class="font-weight-bold text-success">
                <template v-if="roomCode === '加密直连'">
                  正在建立无感直连安全通道...
                </template>
                <template v-else>
                  等待接入... 临时取件码: <span class="text-h6 mx-2">{{ roomCode }}</span>
                </template>
              </span>
              <span v-else class="font-weight-bold">
                已与 {{ connectedPeerName }} 建立 P2P 连接，可以发送文件
              </span>
            </div>

            <v-btn :color="isConnected ? 'error' : 'success'" variant="elevated" size="small"
              @click="
                if (!isConnected) connectToServer();
                else if (isP2PReady) handleDisconnect(); // 有人连着时，只踢人
                else refreshShareCode(); // 没人连着时，刷新取件码
              ">
              {{ !isConnected ? '连接服务器' : (isP2PReady ? '断开连接' : '刷新取件码') }}
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
          <p class="text-medium-emphasis">支持任意格式文件，也可点击上传。支持多选文件。</p>
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
                  <v-btn icon variant="text" color="error" size="small" @click="removeFile(index)"
                    :disabled="sendStatus.status === 'sending' || sendStatus.status === 'paused'">
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
                <div
                  v-if="sendStatus.status === 'paused' || sendStatus.status === 'sending' || sendStatus.status === 'error'">
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
                <div class="text-caption text-truncate" style="color: #888;" :title="myDeviceId">{{ deviceIdVisibility ?
                  myDeviceId : '••••••••' }}</div>
              </div>
              <div class="d-flex">
                <v-btn :icon="deviceIdVisibility ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                  @click="deviceIdVisibility = !deviceIdVisibility" variant="text" size="small" color="primary"
                  :title="deviceIdVisibility ? '点击使UUID不可见' : '点击使UUID可见'"></v-btn>
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

                <v-list-item-title class="font-weight-bold">{{ device.remark || device.name }}</v-list-item-title>
                <v-list-item-subtitle class="text-caption">{{ device.isOnline ? '当前在线，可直连' : '已离线'
                }}</v-list-item-subtitle>

                <template v-slot:append>
                  <v-btn size="small" color="success" variant="tonal" class="mr-2"
                    :disabled="!device.isOnline || isP2PReady" @click="connectToDevice(device.id)"
                    v-if="connectedPeerId !== device.id">
                    连接
                  </v-btn>
                  <v-btn size="small" color="error" variant="tonal" class="mr-2"
                    :disabled="!device.isOnline || !isP2PReady || device.id !== connectedPeerId" @click="leaveRoom()"
                    v-if="connectedPeerId === device.id">
                    断开
                  </v-btn>
                  <v-btn icon="mdi-pencil-outline" variant="text" size="small" color="primary" class="mr-1"
                    @click="openEditDeviceNameDialog(device)" title="修改备注名"></v-btn>
                  <v-btn icon="mdi-trash-can-outline" variant="text" size="small" color="error"
                    @click="handleRemoveDevice(device.id)"></v-btn>
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
          <v-text-field v-model="tempDeviceName" :rules="[rules.required]" label="设备名称" variant="outlined" autofocus
            @keyup.enter="confirmEditName"></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showEditNameDialog = false"></v-btn>
          <v-btn variant='elevated' :disabled="!tempDeviceName" text="保存" color="primary"
            @click="confirmEditName"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showAddDeviceDialog" max-width="400">
      <v-card title="手动添加信任设备">
        <v-card-text>
          <v-text-field v-model="tempTargetId" :rules="[rules.required]" label="对方设备 UUID" variant="outlined"
            class="mb-2" autofocus></v-text-field>
          <v-text-field v-model="tempTargetName" :rules="[rules.required]" label="备注名称" variant="outlined"
            @keyup.enter="confirmAddDevice"></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showAddDeviceDialog = false"></v-btn>
          <v-btn :disabled="!tempTargetId || !tempTargetName" variant="elevated" text="添加" color="primary"
            @click="confirmAddDevice"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showConfirmDialog" max-width="400">
      <v-card title="确认操作">
        <v-card-text class="pt-2">
          <template v-for="(line, index) in confirmDialogMessage.split('\n')" :key="index">
            {{ line }}<br />
          </template>
          <v-checkbox v-if="showconfirmCheck" v-model="confirmCheck" label="我已知晓以上信息，并确认执行此操作"
            class="mt-4"></v-checkbox>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="confirmDialogAction(false)"></v-btn>
          <v-btn :disabled="!confirmCheck" text="确定" color="error" variant="elevated"
            @click="confirmDialogAction(true)"></v-btn>
        </v-card-actions>
      </v-card>

    </v-dialog>

    <v-dialog v-model="showEditDeviceNameDialog" max-width="400">
      <v-card title="修改设备备注名">
        <v-card-text>
          <div class="text-caption text-medium-emphasis mb-1">
            原设备名称 (由对方设置，不可修改)
          </div>
          <span> {{ tempEditDeviceOriginalName }}</span> <div class="text-caption text-medium-emphasis">(uuid: {{ tempEditDeviceId }})</div>
          <div style="height: 5px;"></div>
          <div class="text-caption text-medium-emphasis mb-2">自定义备注名称</div>
          <v-text-field v-model="tempEditDeviceRemark" variant="outlined" density="compact" autofocus
            @keyup.enter="confirmEditDeviceName()" placeholder="留空则恢复显示原名"></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showEditDeviceNameDialog = false"></v-btn>
          <v-btn variant='elevated' text="保存" color="primary" @click="confirmEditDeviceName()"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showDisclaimerDialog" persistent max-width="500">
      <v-card class="rounded-lg">
        <v-card-title class="text-h6 font-weight-bold text-primary d-flex align-center pt-5 pb-3 px-5">
          <v-icon icon="mdi-shield-check-outline" class="mr-2" size="large"></v-icon>
          免责与隐私提示
        </v-card-title>
        <v-divider></v-divider>

        <v-card-text class="pt-5 px-5 text-body-1" style="line-height: 1.6; color: white;">
          <p class="mb-4">
            <strong>Instadrop</strong> 是一款端到端加密的 P2P 传输工具，不包含任何云端文件存储功能，开发者无法查看、获取或审查您传输的任何内容。
          </p>
          <p class="mb-2">
            您承诺在使用本软件时：
          </p>
          <ul class="pl-5 mb-4 text-medium-emphasis">
            <li class="mb-1">遵守当地法律法规。</li>
            <li class="mb-1">不传输任何非法、侵权或包含恶意代码的文件。</li>
            <li>对您传输的内容承担全部法律责任。</li>
          </ul>
          <p class="text-caption text-medium-emphasis">
            * 本软件按“原样”开源提供，不对传输的稳定性及安全性提供绝对保证，也不对因使用本软件造成的任何数据或财产损失负责。
            <br>
            * 您可以随时在 设置 页面重新查看详细的条款。
          </p>
        </v-card-text>

        <v-card-actions class="pa-4">
          <v-spacer></v-spacer>
          <v-btn text="拒绝并退出" color="error" variant="text" @click="rejectDisclaimer"></v-btn>
          <v-btn text="我已阅读并同意" color="primary" variant="elevated" prepend-icon="mdi-check"
            @click="acceptDisclaimer"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="showSnackbar" :color="snackbarColor" timeout="3000" location="bottom">
      {{ snackbarMessage }}
      <template v-slot:actions>
        <v-btn variant="text" @click="showSnackbar = false">
          关闭
        </v-btn>
      </template>
    </v-snackbar>
  </v-container>
</template>