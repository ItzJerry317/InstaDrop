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


const isCheckingUpdate = ref(false)
const hasNewVersion = ref(false)
const currentVersion = ref('v1.2.0-dev.2') // 你的当前版本号
const latestVersion = ref('')
const latestVersionInfo = ref({ version: '', url: '', notes: '' })

const checkForUpdates = async () => {
  if (isCheckingUpdate.value) return
  isCheckingUpdate.value = true

  try {
    const response = await fetch('https://api.github.com/repos/ItzJerry317/Instadrop/releases/latest')
    const data = await response.json()
    latestVersion.value = data.tag_name

    // 假设这是从你的服务器拉取到的最新版本信息
    const mockApiResult = {
      version: latestVersion.value, // 试试把它改成 v1.0.0 测试“已是最新版”的提示
      url: 'https://github.com/ItzJerry317/Instadrop/releases/' + latestVersion.value, // 下载链接
      notes: data.body
    }

    // 对比版本号 (这里做了简单的字符串对比，实际开发可用 semver 库)
    if (mockApiResult.version !== currentVersion.value) {
      hasNewVersion.value = true
      latestVersionInfo.value = mockApiResult
    } else {
      hasNewVersion.value = false
    }
  } catch (error) {
    console.error('检查更新失败:', error)
  } finally {
    isCheckingUpdate.value = false
  }
}

const openDownloadUrl = () => {
  // 跨平台通用的打开外部浏览器的方法
  window.open(latestVersionInfo.value.url, '_blank')
}

onMounted(() => {
  applyTheme(themePreference.value)
  checkForUpdates()
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
      <v-btn style="-webkit-app-region: no-drag; margin-right: 5px;" variant="elevated" size="small" color="warning" v-if="hasNewVersion" @click="openDownloadUrl">
        更新
      </v-btn>
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

.v-navigation-drawer__content {
  padding-top: calc(env(safe-area-inset-top)) !important;
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