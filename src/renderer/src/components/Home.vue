<script setup lang="ts">
import { ref } from 'vue'

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

const processFiles = () => {
  if (droppedFiles.value.length === 0) return

  const filePaths = droppedFiles.value.map(f => f.path)

  // TODO: 这里即将调用 IPC
  console.log('准备送往后台执行的物理路径:', filePaths)
  alert(`成功抓取了 ${filePaths.length} 个文件的路径！按 F12 看看控制台。`)
}
</script>

<template>
  <v-container class="fill-height">
    <v-row justify="center" align="center">
      <v-col cols="12">
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
            </v-list>

            <v-divider></v-divider>

            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn color="error" variant="flat" @click="droppedFiles = []">清空全部</v-btn>
              <v-btn color="success" variant="flat" prepend-icon="mdi-rocket-launch" @click="processFiles">
                传输
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-expand-transition>

      </v-col>
    </v-row>
  </v-container>
</template>
