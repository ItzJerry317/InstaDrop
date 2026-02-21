<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { SystemInfo } from '../../shared/types'

// 存储主进程传来的系统信息
const sysInfo = ref<SystemInfo | null>(null)
const closeApp = () => {
  window.myElectronAPI.closeWindow()
}

onMounted(async () => {
  // 页面加载时请求数据
  sysInfo.value = await window.myElectronAPI.getSystemInfo()
})

// 测试 IPC 通信
const handlePing = () => {
  window.myElectronAPI.ping()
}
</script>

<template>
  <v-app>
    <v-app-bar color="primary" density="compact" style="-webkit-app-region: drag;">
      <v-app-bar-title>Server Control Panel</v-app-bar-title>
      <v-btn icon="mdi-close" style="-webkit-app-region: no-drag;" @click="closeApp"></v-btn>
    </v-app-bar>

    <v-main>
      <v-container>
        <v-row>
          <v-col cols="12" md="6">
            <v-card variant="elevated" elevation="3">
              <v-card-item>
                <template v-slot:prepend>
                  <v-icon icon="mdi-server-network" color="info" size="x-large" class="mr-2"></v-icon>
                </template>
                <v-card-title>本地运行环境状态</v-card-title>
                <v-card-subtitle>Local System Environment</v-card-subtitle>
              </v-card-item>

              <v-divider></v-divider>

              <v-card-text v-if="sysInfo">
                <div class="d-flex justify-space-between mb-2">
                  <span>Node.js 版本:</span>
                  <span class="text-primary font-weight-bold">{{ sysInfo.nodeVersion }}</span>
                </div>
                <div class="d-flex justify-space-between mb-2">
                  <span>Electron 核心:</span>
                  <span class="text-primary font-weight-bold">{{ sysInfo.electronVersion }}</span>
                </div>
              </v-card-text>
              <v-card-text v-else>
                <v-progress-circular indeterminate color="primary"></v-progress-circular>
                正在读取系统状态...
              </v-card-text>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn 
                  color="success" 
                  variant="flat" 
                  prepend-icon="mdi-lan-connect"
                  @click="handlePing"
                >
                  发送测试 Ping
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
/* Vuetify 处理了 99% 的样式，这里通常不需要写什么了 */
</style>