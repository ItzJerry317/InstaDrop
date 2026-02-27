<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Send from './components/Send.vue'
import TestPanel from './components/TestPanel.vue'
import Settings from './components/Settings.vue'
import Receive from './components/Receive.vue'
import { useTheme } from 'vuetify'
import { themePreference } from './store/localStorageRead'
import { useWebRTC } from './composables/useWebRTC'
import { isElectron } from './utils/platform'

const currentTab = ref('send')
const drawer = ref(false)
const windowStatus = ref('mdi-window-maximize')
const { connectToServer, disconnectServer, connectionError } = useWebRTC()

const showSnackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('')
const isDev = import.meta.env.DEV

// 窗口状态
const checkWindowStatus = async () => {
  windowStatus.value = await window.myElectronAPI.getWindowStatus()
  console.log(`当前窗口状态: ${windowStatus.value}`)
}

const closeApp = () => {
  window.myElectronAPI.closeWindow()
}

const toggleWindowStatus = () => {
  window.myElectronAPI.toggleWindowStatus()
  checkWindowStatus()
}
const minimizeApp = () => {
  window.myElectronAPI.minimizeWindow()
}

const theme = useTheme()
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (pref: string) => {
  if (pref === 'system') {
    // 如果是系统默认，则根据操作系统的深色模式状态来决定
    theme.change(systemThemeMedia.matches ? 'dark' : 'light')
  } else {
    // 否则强制使用用户选择的 light 或 dark
    theme.change(pref)
  }
}

watch(connectionError, (err) => {
  if (err) {
    snackbarMessage.value = err
    snackbarColor.value = 'error'
    showSnackbar.value = true
    setTimeout(() => {
      connectionError.value = ''
    }, 3000)
  }
})

onMounted(() => {
  applyTheme(themePreference.value)
  if (isElectron()) {
    checkWindowStatus()
    window.myElectronAPI.onWindowStateChanged((newState) => {
      console.log(`窗口状态变化: ${newState}`)
      windowStatus.value = newState === 'maximized' ? 'mdi-window-restore' : 'mdi-window-maximize'
    })
  }
  if (localStorage.getItem('instadrop_disclaimer_accepted') === 'true') {
    connectToServer(true)
  }
})

onUnmounted(() => {
  disconnectServer()
})
</script>

<template>
  <v-app>

    <v-app-bar color="primary" density="compact" style="-webkit-app-region: drag;">
      <v-btn icon="mdi-menu" style="-webkit-app-region: no-drag;" @click="drawer = !drawer"></v-btn>
      <v-app-bar-title>Instadrop</v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn icon="mdi-window-minimize" style="-webkit-app-region: no-drag;" @click="minimizeApp"
        v-if="isElectron()"></v-btn>
      <v-btn :icon="windowStatus" style="-webkit-app-region: no-drag;" @click="toggleWindowStatus"
        v-if="isElectron()"></v-btn>
      <v-btn icon="mdi-close" style="-webkit-app-region: no-drag;" @click="closeApp" v-if="isElectron()"></v-btn>
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" temporary>
      <v-list density="compact" nav>
        <v-list-item prepend-icon="mdi-upload" title="发送" value="send" :active="currentTab === 'send'"
          @click="currentTab = 'send'" color="primary"></v-list-item>

        <v-list-item prepend-icon="mdi-download" title="接收" value="receive" :active="currentTab === 'receive'"
          @click="currentTab = 'receive'" color="primary">
        </v-list-item>

        <v-list-item v-if="isDev" prepend-icon="mdi-test-tube" title="测试" value="test" :active="currentTab === 'test'"
          @click="currentTab = 'test'" color="primary"></v-list-item>

        <v-list-item prepend-icon="mdi-cog" title="设置" value="settings" :active="currentTab === 'settings'"
          @click="currentTab = 'settings'" color="primary">
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <Send v-if="currentTab === 'send'" />
      <TestPanel v-if="currentTab === 'test'" />
      <Settings v-if="currentTab === 'settings'" />
      <Receive v-if="currentTab === 'receive'" />

      <!-- snackbar配置 全局可用 用于提示错误信息 -->
      <v-snackbar v-model="showSnackbar" :color="snackbarColor" timeout="3000" location="bottom">
        {{ snackbarMessage }}
        <template v-slot:actions>
          <v-btn variant="text" @click="showSnackbar = false; connectionError = ''">
            关闭
          </v-btn>
        </template>
      </v-snackbar>
    </v-main>
  </v-app>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden !important; 
  position: fixed; /* 锁定视口 */
}
body {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

#app,
.v-application,
.v-application__wrap {
  height: 100% !important;
  min-height: 100% !important;
}

.v-app-bar {
  padding-top: env(safe-area-inset-top) !important;
  height: calc(48px + env(safe-area-inset-top)) !important; 
}

.v-main {
  padding-top: calc(48px + env(safe-area-inset-top)) !important;
  height: 100vh;
  overflow-y: auto !important; 
  -webkit-overflow-scrolling: touch;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
</style>