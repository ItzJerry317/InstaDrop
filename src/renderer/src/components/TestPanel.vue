<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { SystemInfo } from '../../../shared/types'
import {
   themePreference, 
   disclaimerAcceptedStatus, 
   signalingUrl, 
   stunUrl, 
   turnUrl, 
   turnUser, 
   turnPass, 
   savePath
  } 
   from '../store/localStorageRead'


// 存储主进程传来的系统信息
const sysInfo = ref<SystemInfo | null>(null)
const latencyTestShow = ref(false)
const isAutoStart = ref(false)
var latency = ref(0)

onMounted(async () => {
  // 页面加载时请求数据
  sysInfo.value = await window.myElectronAPI.getSystemInfo()
  isAutoStart.value = await window.myElectronAPI.getAutoStartStatus()
})

// 测试 IPC 通信
const handlePing = async () => {
  latency.value = await window.myElectronAPI.ping()
  console.log(`Latency: ${latency.value}ms`)
  latencyTestShow.value = true
}
</script>

<template>
  <v-container>
    <v-col>
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
          <div class="d-flex justify-space-between mb-2">
            <span>Chromium 版本:</span>
            <span class="text-primary font-weight-bold">{{ sysInfo.chromeVersion }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>系统主题模式:</span>
            <span class="text-primary font-weight-bold">{{ sysInfo.isDarkMode ? '深色模式' : '浅色模式' }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2" v-if="latencyTestShow">
            <span>IPC延迟测试结果：{{ latency }}ms</span>
          </div>
        </v-card-text>
        <v-card-text v-else>
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
          正在读取系统状态...
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-lan-connect" @click="handlePing">
            发送测试 Ping
          </v-btn>
        </v-card-actions>
      </v-card>

      <div style="height: 10px"></div>

      <v-card variant="elevated" elevation="3">
        <v-card-item>
          <template v-slot:prepend>
            <v-icon icon="mdi-server" color="info" size="x-large" class="mr-2"></v-icon>
          </template>
          <v-card-title>LocalStorage信息</v-card-title>
          <v-card-subtitle>LocalStorage info</v-card-subtitle>
        </v-card-item>

        <v-divider></v-divider>

        <v-card-text v-if="sysInfo">
          <div class="d-flex justify-space-between mb-2">
            <span>主题模式：</span>
            <span class="text-primary font-weight-bold">{{ themePreference || '未设置（默认system）' }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>是否已同意免责声明：</span>
            <span class="text-primary font-weight-bold">{{ disclaimerAcceptedStatus }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>信令服务器地址：</span>
            <span class="text-primary font-weight-bold">{{ signalingUrl }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>STUN 服务器地址：</span>
            <span class="text-primary font-weight-bold">{{ stunUrl }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>TURN 服务器地址：</span>
            <span class="text-primary font-weight-bold">{{ turnUrl }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>TURN 服务器用户名：</span>
            <span class="text-primary font-weight-bold">{{ turnUser }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>TURN 服务器密码：</span>
            <span class="text-primary font-weight-bold">{{ turnPass }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>下载文件默认保存路径：</span>
            <span class="text-primary font-weight-bold">{{ savePath }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span>开机自启：</span>
            <span class="text-primary font-weight-bold">{{ isAutoStart }}</span>
          </div>
        </v-card-text>
        <v-card-text v-else>
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
          正在读取系统状态...
        </v-card-text>
      </v-card>
    </v-col>
  </v-container>
</template>