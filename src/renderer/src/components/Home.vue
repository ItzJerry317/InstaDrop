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
  isCancelled,
  pauseTransfer,
  resumeTransfer,
  cancelTransfer,
  resetTransfer
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

    console.log(`文件已添加: ${file.name} (${file.size} bytes) path: ${actualPath}`)
  }
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  // 用对数算出它是属于哪个量级 (0=B, 1=KB, 2=MB...)
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  // toFixed(2) 保留两位小数，parseFloat 去掉末尾多余的 0
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const handleDrop = (event: DragEvent) => {
  isDragging.value = false // 恢复 UI 状态

  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    processFileList(event.dataTransfer.files)
  }
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    processFileList(target.files)
  }
  // 清空 input 的值，确保下次选择相同文件时依然能触发 change 事件
  target.value = ''
}

const removeFile = (index: number) => {
  droppedFiles.value.splice(index, 1)
}

const processFiles = async () => {
  if (droppedFiles.value.length === 0) return
  if (!isP2PReady.value) {
    return alert('请先连线基站并等待手机接入！')
  }

  try {
    // 遍历拖进去的所有文件，发完一个再发下一个
    for (const file of droppedFiles.value) {
      console.log(`🚀 正在极速空投: ${file.name}`)
      await sendFile(file.path)
    }
    console.log('Drop done')
    // 只有所有文件都在未被强行终止的情况下发完了，才标记为 done
    if (sendStatus.value.status !== 'idle') {
      sendStatus.value = { status: 'done', message: '全部文件传输完成' }
    }
  } catch (error) {
    console.error('传输任务结束或被终止：', error)
  }
}
</script>

<template>
  <v-container class="fill-height">
    <v-row justify="center" align="center">
      <v-col cols="12">
        <v-card variant="flat" color="primary" class="mb-4 bg-surface-variant rounded-lg">
          <v-card-text class="d-flex align-center justify-space-between py-2">
            <div class="d-flex align-center">
              <v-icon :color="isP2PReady ? 'purple-accent-3' : (isConnected ? 'success' : 'grey')" class="mr-3">
                {{ isP2PReady ? 'mdi-lightning-bolt' : 'mdi-access-point-network' }}
              </v-icon>

              <span v-if="!isConnected" class="text-medium-emphasis">离线状态，准备就绪</span>
              <span v-else-if="!isP2PReady" class="font-weight-bold text-success">
                等待手机接入... 取件码: <span class="text-h6 mx-2">{{ roomCode }}</span>
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
            {{ isDragging ? '松开鼠标，即可选定文件！' : '将文件拖拽至此' }}
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
                    <span class="text-truncate font-weight-bold" style="max-width: 60%;">
                      {{ file.name }}
                    </span>

                    <span class="text-medium-emphasis text-body-2 ml-2">
                      (大小: {{ file.formattedSize }})
                    </span>
                  </div>
                </template>
                <template v-slot:append>
                  <v-btn icon="mdi-close" variant="text" color="error" size="small" @click="removeFile(index)"></v-btn>
                </template>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item>
                <span class="text-primary font-weight-bold">
                  {{ sendStatus.status === "idle" ? "等待传输" : 
                  sendStatus.status === "sending" ? "正在传输：" + (currentFile?.name || '未知文件') : 
                  sendStatus.status === "paused" ? "已暂停传输：" + (currentFile?.name || '未知文件') : 
                  sendStatus.status === "done" ? "所有文件传输完成" : "传输异常：" + sendStatus.message || "未知原因" }}
                </span>
                <div v-if="sendStatus.status !== 'idle'">
                  <span class="text-medium-emphasis">传输进度: {{ fileProgress }}%</span>
                </div>
                <div style="height: 10px;"></div>
                <v-progress-linear :model-value="fileProgress"
                  :color="sendStatus.status === 'done' ? 'success' : sendStatus.status === 'error' ? 'error' : 'primary'"></v-progress-linear>
              </v-list-item>
            </v-list>

            <v-divider></v-divider>
            <v-card-actions class="pa-3">
              <v-spacer></v-spacer>

              <template v-if="sendStatus.status === 'idle'">
                <v-btn color="error" variant="flat" prepend-icon="mdi-delete" @click="droppedFiles = []; resetTransfer()">
                  清空全部
                </v-btn>
                <v-btn color="success" variant="flat" prepend-icon="mdi-arrow-right-drop-circle" :disabled="droppedFiles.length === 0 || !isP2PReady" @click="processFiles">
                  开始传输
                </v-btn>
              </template>

              <template v-else-if="sendStatus.status === 'sending' || sendStatus.status === 'paused'">
                <v-btn color="error" variant="flat" prepend-icon="mdi-stop-circle-outline" @click="cancelTransfer">
                  终止传输
                </v-btn>
                
                <v-btn v-if="sendStatus.status === 'sending'" color="warning" variant="flat" prepend-icon="mdi-pause-circle-outline" @click="pauseTransfer">
                  暂停
                </v-btn>
                
                <v-btn v-else color="info" variant="flat" prepend-icon="mdi-play-circle-outline" @click="resumeTransfer">
                  继续
                </v-btn>
              </template>

              <template v-else>
                <v-btn color="primary" variant="flat" prepend-icon="mdi-check-circle-outline" @click="resetTransfer">
                  关闭控制面板
                </v-btn>
              </template>
            </v-card-actions>
          </v-card>
        </v-expand-transition>

      </v-col>
    </v-row>
  </v-container>
</template>
